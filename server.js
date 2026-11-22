const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const store = require("./store");
const { publishPost, getTikTokPublishStatus, getTikTokCreatorInfo } = require("./socialProviders");
const { generateCopy } = require("./contentEngine");
const { renderContentCard } = require("./renderContent");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const configuredPublicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const publicBaseUrl = configuredPublicBaseUrl.startsWith("http") ? configuredPublicBaseUrl : `https://${configuredPublicBaseUrl}`;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || "";
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || "postflow-media";
const useSupabaseStorage = Boolean(supabaseUrl && supabaseSecretKey);
const mediaDir = path.join(__dirname, "data", "media");
const publishMode = process.env.PUBLISH_MODE || "dry-run";
const appPassword = process.env.APP_PASSWORD || "";
const maxRequestBytes = Number(process.env.MAX_REQUEST_BYTES || 12 * 1024 * 1024);
const sessions = new Map();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 43200000);
const loginFailures = new Map();
let processingPromise = null;

fs.mkdirSync(mediaDir, { recursive: true });

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readRequestJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function serveStatic(requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(__dirname, relativePath));
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

function sessionFromRequest(request) {
  const cookie = request.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)postflow_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  return session;
}

function isAuthenticated(request) {
  return !appPassword || Boolean(sessionFromRequest(request));
}

function validateSameOrigin(request) {
  if (!request.headers.origin) return true;
  try { return Boolean(request.headers.host && new URL(request.headers.origin).host === request.headers.host); }
  catch { return false; }
}

function secureCookie(request) {
  return publishMode === 'live' || process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && Boolean(request.socket.encrypted));
}

function loginRateLimited(request) {
  const key = request.socket.remoteAddress || 'unknown';
  const recent = (loginFailures.get(key) || []).filter(time => Date.now() - time < 900000);
  loginFailures.set(key, recent);
  return recent.length >= 10;
}

function recordLoginFailure(request) {
  const key = request.socket.remoteAddress || 'unknown';
  loginFailures.set(key, [...(loginFailures.get(key) || []), Date.now()]);
}
function validatePostBody(body) {
  if (typeof body.title !== "string" || !body.title.trim()) {
    return "title is required";
  }
  if (!["instagram", "tiktok"].includes(body.platform)) {
    return "Unsupported platform";
  }
  if (body.format && !["post", "carousel", "reel"].includes(body.format)) {
    return "Unsupported format";
  }
  if (!["draft", "scheduled"].includes(body.status || "scheduled")) {
    return "Unsupported status";
  }
  if ((body.status || "scheduled") === "scheduled") {
    if (!body.scheduledAt || Number.isNaN(new Date(body.scheduledAt).getTime())) {
      return "scheduledAt must be a valid date";
    }
  }
  if (typeof body.caption !== "string" && body.caption !== undefined) {
    return "caption must be text";
  }
  if (body.privacyLevel != null && typeof body.privacyLevel !== "string") {
    return "privacyLevel must be text";
  }
  if (publishMode === "live" && body.platform === "tiktok" && (body.status || "scheduled") === "scheduled" && !body.privacyLevel) {
    return "Choose a TikTok privacy level before scheduling";
  }
  if (!Array.isArray(body.media)) return "media must be an array";
  if (body.media.length > 10) return "At most 10 media items are allowed";
  const mediaTypes = body.media.map(item => typeof item === "string"
    ? (/\.mp4(?:$|\?)/i.test(item) ? "video" : "image")
    : item?.type?.startsWith("video/") ? "video" : "image");
  const format = body.format || "post";
  if ((body.status || "scheduled") !== "draft" && body.platform === "instagram") {
    if (format === "carousel" && (mediaTypes.length < 2 || mediaTypes.length > 10)) return "Instagram carousels require 2 to 10 media items";
    if (format !== "carousel" && mediaTypes.length !== 1) return "Instagram posts and Reels require exactly one media item";
    if (format === "reel" && mediaTypes[0] !== "video") return "Instagram Reels require a video";
    if (format === "post" && mediaTypes[0] !== "image") return "Instagram feed posts require an image. Choose Reel for video.";
  }
  if ((body.status || "scheduled") !== "draft" && body.platform === "tiktok") {
    if (format === "carousel" && (mediaTypes.length < 2 || mediaTypes.some(type => type !== "image"))) return "TikTok photo carousels require 2 to 10 images";
    if (format === "reel" && (mediaTypes.length !== 1 || mediaTypes[0] !== "video")) return "TikTok videos require exactly one video";
    if (format === "post" && (mediaTypes.length !== 1 || !mediaTypes[0])) return "TikTok posts require exactly one image or video";
  }
  if (body.title.length > 2200 || (body.caption || "").length > 2200) {
    return "Title or caption is too long";
  }
  return null;
}

async function uploadToSupabaseStorage(fileName, buffer, mimeType) {
  if (!useSupabaseStorage) throw new Error("Supabase Storage is not configured");
  const objectPath = fileName.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${storageBucket}/${objectPath}`, {
    method: "POST",
    headers: { apikey: supabaseSecretKey, Authorization: "Bearer " + supabaseSecretKey, "Content-Type": mimeType, "x-upsert": "false" },
    body: buffer
  });
  if (!response.ok) throw new Error("Supabase media upload failed: " + (await response.text()).slice(0, 300));
  return `${supabaseUrl}/storage/v1/object/public/${storageBucket}/${objectPath}`;
}
async function handleMediaUpload(request, response) {
  const body = await readRequestJson(request);
  if (!body.name || typeof body.name !== "string" || !body.data || typeof body.data !== "string") {
    sendJson(response, 400, { error: "name and data are required" });
    return;
  }
  const match = body.data.match(/^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,(.*)$/);
  if (!match) {
    sendJson(response, 400, { error: "Only PNG, JPEG, WebP, and MP4 media are supported" });
    return;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 10 * 1024 * 1024) {
    sendJson(response, 413, { error: "Media must be 10 MB or smaller" });
    return;
  }
  const extensionByType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4"
  };
  const id = crypto.randomUUID();
  const fileName = `${id}${extensionByType[match[1]]}`;
  const mediaUrl = useSupabaseStorage
    ? await uploadToSupabaseStorage(fileName, buffer, match[1])
    : (await fsp.writeFile(path.join(mediaDir, fileName), buffer, { flag: "wx", mode: 0o600 }), `${publicBaseUrl}/media/${fileName}`);
  sendJson(response, 201, { id: fileName, url: mediaUrl, type: match[1] });
}

async function processDuePosts() {
  if (processingPromise) return processingPromise;
  processingPromise = (async () => {
    const nowIso = new Date().toISOString();
    const due = await store.claimDuePosts(nowIso, Number(process.env.SCHEDULER_BATCH_SIZE || 10));
    for (const post of due) {
      try {
        const result = publishMode === 'dry-run' ? { mode: 'dry-run' } : await publishPost(post, post.platform);
        if (result.pending) {
          await store.update(post.id, { status: 'publishing', providerResponse: result, error: null, retryAt: null });
        } else {
          store.update(post.id, { status: 'published', publishedAt: new Date().toISOString(), providerResponse: result, error: null, retryAt: null });
        }
      } catch (error) {
        const retryCount = post.retryCount + 1;
        const terminal = retryCount >= 5 || error.retryable === false;
        const delayMs = Math.min(6 * 60 * 60 * 1000, 60_000 * (2 ** Math.min(retryCount - 1, 8)));
        const retryAt = terminal ? null : new Date(Date.now() + delayMs).toISOString();
        store.update(post.id, { status: 'failed', retryCount, retryAt, failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (publishMode === 'live') await pollPublishingPosts();
    return due.length;
  })();
  try { return await processingPromise; } finally { processingPromise = null; }
}

async function pollPublishingPosts() {
  const pending = (await store.list()).filter(post => post.status === 'publishing' && post.platform === 'tiktok' && post.providerResponse?.publish_id);
  for (const post of pending.slice(0, 10)) {
    try {
      const statusResult = await getTikTokPublishStatus(post.providerResponse.publish_id);
      const status = statusResult.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        store.update(post.id, { status: 'published', publishedAt: new Date().toISOString(), providerResponse: { ...post.providerResponse, status: statusResult.data } });
      } else if (status === 'FAILED') {
        const retryCount = post.retryCount + 1;
        const terminal = retryCount >= 5;
        const retryAt = terminal ? null : new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60_000 * (2 ** (retryCount - 1)))).toISOString();
        store.update(post.id, { status: 'failed', retryCount, retryAt, failedAt: new Date().toISOString(), error: statusResult.data?.fail_reason || 'TikTok publishing failed' });
      } else {
        store.update(post.id, { providerResponse: { ...post.providerResponse, status: statusResult.data } });
      }
    } catch (error) {
      console.error('TikTok status check failed for ' + post.id + ':', error.message);
    }
  }
}
function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, {
          authenticated: isAuthenticated(request),
          authRequired: Boolean(appPassword),
          publishMode,
          providers: {
            instagram: Boolean(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN),
            tiktok: Boolean(process.env.TIKTOK_ACCESS_TOKEN)
          }
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/login") {
        if (!validateSameOrigin(request)) { sendJson(response, 403, { error: 'Cross-origin request rejected' }); return; }
        if (loginRateLimited(request)) { sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' }); return; }
        const body = await readRequestJson(request);
        const supplied = Buffer.from(typeof body.password === 'string' ? body.password : '');
        const expected = Buffer.from(appPassword);
        const valid = Boolean(appPassword) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        if (!valid) { recordLoginFailure(request); sendJson(response, 401, { error: 'Invalid credentials' }); return; }
        loginFailures.delete(request.socket.remoteAddress || 'unknown');
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
        const secure = secureCookie(request) ? '; Secure' : '';
        response.writeHead(204, { 'Set-Cookie': 'postflow_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) + secure, 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/logout") {
        if (!validateSameOrigin(request)) { sendJson(response, 403, { error: 'Cross-origin request rejected' }); return; }
        const cookie = request.headers.cookie || '';
        const match = cookie.match(/(?:^|;\s*)postflow_session=([^;]+)/);
        if (match) sessions.delete(decodeURIComponent(match[1]));
        const secure = secureCookie(request) ? '; Secure' : '';
        response.writeHead(204, { 'Set-Cookie': 'postflow_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + secure, 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tiktok/creator-info") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const creator = await getTikTokCreatorInfo();
        sendJson(response, 200, {
          privacyLevelOptions: creator.privacy_level_options || [],
          commentDisabled: Boolean(creator.comment_disabled),
          duetDisabled: Boolean(creator.duet_disabled),
          stitchDisabled: Boolean(creator.stitch_disabled)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/content/generate") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const body = await readRequestJson(request);
        if (!body.topic || typeof body.topic !== "string") {
          sendJson(response, 400, { error: "topic is required" });
          return;
        }
        sendJson(response, 200, await generateCopy(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/content/render") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const body = await readRequestJson(request);
        if (!body.title || typeof body.title !== "string") {
          sendJson(response, 400, { error: "title is required" });
          return;
        }
        const id = crypto.randomUUID();
        const outputFile = path.join(__dirname, "data", "rendered", `${id}.mp4`);
        await renderContentCard({
          title: body.title,
          caption: body.caption || body.title,
          accent: body.accent || "#8fa678",
          platform: body.platform === "tiktok" ? "tiktok" : "instagram"
        }, outputFile);
        const renderedUrl = useSupabaseStorage
          ? await uploadToSupabaseStorage(`rendered/${id}.mp4`, await fsp.readFile(outputFile), "video/mp4")
          : `${publicBaseUrl}/media/rendered/${id}.mp4`;
        sendJson(response, 201, { id: `${id}.mp4`, url: renderedUrl, type: "video/mp4" });
        return;
      }

      if (!["GET", "HEAD"].includes(request.method) && !validateSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/posts") {
        if (!isAuthenticated(request)) { sendJson(response, 401, { error: "Authentication required" }); return; }
        sendJson(response, 200, await store.list());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/posts") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const body = await readRequestJson(request);
        const validationError = validatePostBody(body);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        const status = body.status || "scheduled";
        const post = await store.create({
          id: crypto.randomUUID(),
          title: body.title.trim(),
          caption: body.caption === undefined ? body.title.trim() : body.caption,
          format: body.format || "post",
          platform: body.platform,
          scheduledAt: status === "scheduled" ? new Date(body.scheduledAt).toISOString() : null,
          media: body.media,
          privacyLevel: body.privacyLevel || null,
          status,
          createdAt: new Date().toISOString()
        });
        sendJson(response, 201, post);
        return;
      }

      const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
      if (postMatch) {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const id = decodeURIComponent(postMatch[1]);
        if (request.method === "PATCH") {
          const body = await readRequestJson(request);
          const current = await store.get(id);
          if (!current) {
            sendJson(response, 404, { error: "Post not found" });
            return;
          }
          const merged = {
            title: body.title ?? current.title,
            caption: body.caption ?? current.caption,
            format: body.format ?? current.format,
            platform: body.platform ?? current.platform,
            scheduledAt: body.scheduledAt ? new Date(body.scheduledAt).toISOString() : current.scheduledAt,
            media: body.media ?? current.media,
            privacyLevel: body.privacyLevel ?? current.privacyLevel,
            status: body.status ?? current.status
          };
          const validationError = validatePostBody({ ...merged, status: merged.status });
          if (validationError) {
            sendJson(response, 400, { error: validationError });
            return;
          }
          sendJson(response, 200, await store.update(id, merged));
          return;
        }
        if (request.method === "DELETE") {
          if (await store.delete(id)) {
            response.writeHead(204, { "Cache-Control": "no-store" });
            response.end();
          } else {
            sendJson(response, 404, { error: "Post not found" });
          }
          return;
        }
      }

      const retryMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/retry$/);
      if (retryMatch && request.method === "POST") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        const id = decodeURIComponent(retryMatch[1]);
        const current = store.get(id);
        if (!current) {
          sendJson(response, 404, { error: "Post not found" });
          return;
        }
        sendJson(response, 200, await store.update(id, {
          status: "scheduled",
          retryCount: 0,
          retryAt: null,
          error: null,
          failedAt: null
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/media") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        await handleMediaUpload(request, response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/process-due") {
        if (!isAuthenticated(request)) {
          sendJson(response, 401, { error: "Authentication required" });
          return;
        }
        sendJson(response, 200, { processed: await processDuePosts(), publishMode });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        const fileName = path.basename(url.pathname);
        if (url.pathname.startsWith("/media/rendered/")) {
          await serveStatic(`/data/rendered/${fileName}`, response);
        } else {
          await serveStatic(`/data/media/${fileName}`, response);
        }
        return;
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON" });
      } else {
        console.error(error);
        sendJson(response, error.statusCode || 500, { error: error.statusCode === 413 ? error.message : "Internal server error" });
      }
    }
  });
}

if (require.main === module) {
  if (publishMode === "live" && !appPassword) {
    console.error("APP_PASSWORD is required when PUBLISH_MODE=live");
    process.exit(1);
  }
  if (publishMode === "live" && !publicBaseUrl.startsWith("https://")) {
    console.error("PUBLIC_BASE_URL must be an HTTPS URL when PUBLISH_MODE=live");
    process.exit(1);
  }
  const server = createServer();
  setInterval(() => processDuePosts().catch(error => console.error("Scheduler error:", error)), 30_000);
  processDuePosts().catch(error => console.error("Initial scheduler error:", error));
  server.listen(port, host, () => {
    console.log(`Postflow listening at http://localhost:${port}`);
    console.log(`Publishing mode: ${publishMode}`);
  });
}

module.exports = { createServer, processDuePosts, validatePostBody };
