const GRAPH_TIMEOUT_MS = Number(process.env.SOCIAL_API_TIMEOUT_MS || 30_000);
const GRAPH_POLL_INTERVAL_MS = Number(process.env.INSTAGRAM_POLL_INTERVAL_MS || 2_000);
const GRAPH_POLL_ATTEMPTS = Number(process.env.INSTAGRAM_POLL_ATTEMPTS || 30);

function mediaUrl(item) {
  return typeof item === "string" ? item : item?.url;
}

function mediaType(item) {
  if (typeof item === "string") return /\\.mp4(?:$|\\?)/i.test(item) ? "video" : "image";
  return item?.type?.startsWith("video/") ? "video" : "image";
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data.error && data.error.code !== "ok")) {
      const message = data.error?.message || data.error?.error_description || `Social API returned ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.providerCode = data.error?.code;
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("Social API request timed out");
      timeout.retryable = true;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formBody(values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  return body;
}

async function instagramRequest(url, values, method = "POST") {
  const options = method === "GET"
    ? { method: "GET" }
    : { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(values) };
  return requestJson(url, options);
}

async function waitForInstagramContainer(base, token, creationId) {
  for (let attempt = 0; attempt < GRAPH_POLL_ATTEMPTS; attempt += 1) {
    const status = await requestJson(
      `${base}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { method: "GET" }
    );
    if (status.status_code === "FINISHED") return;
    if (["ERROR", "EXPIRED"].includes(status.status_code)) {
      throw new Error(status.status || `Instagram media processing ${status.status_code.toLowerCase()}`);
    }
    await new Promise(resolve => setTimeout(resolve, GRAPH_POLL_INTERVAL_MS));
  }
  const error = new Error("Instagram media is still processing. Retry publishing later.");
  error.retryable = true;
  throw error;
}

async function publishInstagram(post) {
  const { IG_USER_ID, IG_ACCESS_TOKEN, IG_GRAPH_VERSION = "v23.0" } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN");
  const items = (post.media || []).map(item => ({ url: mediaUrl(item), type: mediaType(item) }));
  if (!items.length || items.some(item => !item.url)) throw new Error("Instagram publishing requires public media URLs");

  const base = `https://graph.facebook.com/${IG_GRAPH_VERSION}/${IG_USER_ID}`;
  const createContainer = values => instagramRequest(
    `${base}/media?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
    { ...values, access_token: IG_ACCESS_TOKEN }
  );

  let creationId;
  if (post.format === "carousel") {
    if (items.length < 2 || items.length > 10) throw new Error("Instagram carousels require 2 to 10 media items");
    const children = [];
    for (const item of items) {
      const values = item.type === "video"
        ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: true }
        : { image_url: item.url, is_carousel_item: true };
      const child = await createContainer(values);
      if (!child.id) throw new Error("Instagram did not return a carousel item ID");
      if (item.type === "video") await waitForInstagramContainer(base, IG_ACCESS_TOKEN, child.id);
      children.push(child.id);
    }
    const carousel = await createContainer({
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: post.caption || ""
    });
    creationId = carousel.id;
  } else {
    if (items.length !== 1) throw new Error("Instagram posts and Reels must contain exactly one media item");
    const item = items[0];
    if (post.format === "reel" || item.type === "video") {
      const reel = await createContainer({
        media_type: "REELS",
        video_url: item.url,
        caption: post.caption || "",
        share_to_feed: true
      });
      creationId = reel.id;
      await waitForInstagramContainer(base, IG_ACCESS_TOKEN, creationId);
    } else {
      const image = await createContainer({ image_url: item.url, caption: post.caption || "" });
      creationId = image.id;
    }
  }
  if (!creationId) throw new Error("Instagram did not return a media container ID");
  return instagramRequest(
    `${base}/media_publish?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
    { creation_id: creationId, access_token: IG_ACCESS_TOKEN }
  );
}

async function tiktokRequest(endpoint, token, body) {
  const data = await requestJson(`https://open.tiktokapis.com/v2/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify(body || {})
  });
  if (data.error && data.error.code !== "ok") throw new Error(data.error.message || "TikTok API request failed");
  return data;
}

async function publishTikTok(post) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) throw new Error("Missing TIKTOK_ACCESS_TOKEN");
  const items = (post.media || []).map(item => ({ url: mediaUrl(item), type: mediaType(item) }));
  if (!items.length || items.some(item => !item.url)) throw new Error("TikTok publishing requires public media URLs");

  const creator = await tiktokRequest("post/publish/creator_info/query/", token);
  const options = creator.data?.privacy_level_options || [];
  const requestedPrivacy = process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY";
  const privacy = options.includes(requestedPrivacy) ? requestedPrivacy : options[0];
  if (!privacy) throw new Error("TikTok did not return an available privacy level");

  let result;
  if (post.format === "carousel" || items.every(item => item.type === "image")) {
    if (items.some(item => item.type !== "image")) throw new Error("TikTok photo carousels can contain images only");
    if (items.length > 35) throw new Error("TikTok photo posts support at most 35 images");
    result = await tiktokRequest("post/publish/content/init/", token, {
      post_info: {
        title: (post.title || "").slice(0, 90),
        description: (post.caption || "").slice(0, 4000),
        privacy_level: privacy,
        disable_comment: creator.data?.comment_disabled ?? false,
        auto_add_music: true
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: items.map(item => item.url)
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO"
    });
  } else {
    if (items.length !== 1 || items[0].type !== "video") {
      throw new Error("TikTok video posts require exactly one video. Use a photo carousel for multiple images.");
    }
    result = await tiktokRequest("post/publish/video/init/", token, {
      post_info: {
        title: (post.caption || post.title || "").slice(0, 2200),
        privacy_level: privacy,
        disable_duet: creator.data?.duet_disabled ?? false,
        disable_comment: creator.data?.comment_disabled ?? false,
        disable_stitch: creator.data?.stitch_disabled ?? false
      },
      source_info: { source: "PULL_FROM_URL", video_url: items[0].url }
    });
  }
  if (!result.data?.publish_id) throw new Error("TikTok did not return a publish ID");
  return { ...result.data, pending: true, provider: "tiktok" };
}

async function getTikTokPublishStatus(publishId) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) throw new Error("Missing TIKTOK_ACCESS_TOKEN");
  return tiktokRequest("post/publish/status/fetch/", token, { publish_id: publishId });
}

async function publishPost(post, platform) {
  if (platform === "instagram") return publishInstagram(post);
  if (platform === "tiktok") return publishTikTok(post);
  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = { publishPost, publishInstagram, publishTikTok, getTikTokPublishStatus, mediaType };
