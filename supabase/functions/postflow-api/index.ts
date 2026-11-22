import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "postflow-media";
const OWNER_USER_ID = Deno.env.get("POSTFLOW_OWNER_USER_ID") ?? "";
const allowedOrigin = Deno.env.get("POSTFLOW_ALLOWED_ORIGIN") ?? "https://chimmysmallz.github.io";

const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

function validatePost(body: any) {
  if (!body || typeof body.title !== "string" || !body.title.trim()) return "title is required";
  if (!["instagram", "tiktok"].includes(body.platform)) return "Unsupported platform";
  if (!["post", "carousel", "reel"].includes(body.format)) return "Unsupported format";
  if (!["draft", "scheduled"].includes(body.status ?? "scheduled")) return "Unsupported status";
  if (typeof body.caption !== "string" && body.caption !== undefined) return "caption must be text";
  if (!Array.isArray(body.media) || body.media.length > 35) return "Invalid media list";
  if ((body.status ?? "scheduled") === "scheduled" && (!body.scheduledAt || !Number.isFinite(Date.parse(body.scheduledAt)))) return "A valid schedule date is required";
  if (body.platform === "tiktok" && (body.status ?? "scheduled") === "scheduled" && !body.privacyLevel) return "Choose a TikTok privacy level";
  const mediaTypes = body.media.map((m: any) => m?.type?.startsWith("video/") || m?.type === "video" || /\.mp4(?:$|\?)/i.test(m?.url ?? m) ? "video" : "image");
  if ((body.status ?? "scheduled") !== "draft") {
    if (body.platform === "instagram") {
      if (body.format === "carousel" && (mediaTypes.length < 2 || mediaTypes.length > 10)) return "Instagram carousels require 2 to 10 items";
      if (body.format !== "carousel" && mediaTypes.length !== 1) return "Instagram posts and Reels require one item";
      if (body.format === "reel" && mediaTypes[0] !== "video") return "Instagram Reels require a video";
      if (body.format === "post" && mediaTypes[0] !== "image") return "Instagram feed posts require an image";
    }
    if (body.platform === "tiktok") {
      if (body.format === "carousel" && (mediaTypes.length < 2 || mediaTypes.some((t: string) => t !== "image"))) return "TikTok photo carousels require at least two images";
      if (body.format === "reel" && (mediaTypes.length !== 1 || mediaTypes[0] !== "video")) return "TikTok videos require one video";
      if (body.format === "post" && mediaTypes.length !== 1) return "TikTok posts require one image or video";
    }
  }
  if (body.title.length > 2200 || (body.caption ?? "").length > 2200) return "Title or caption is too long";
  return null;
}
const fromDb = (p: any) => ({ id:p.id, title:p.title, caption:p.caption, format:p.format, platform:p.platform, scheduledAt:p.scheduled_at, media:p.media, status:p.status, retryCount:p.retry_count, retryAt:p.retry_at, providerResponse:p.provider_response, error:p.error, createdAt:p.created_at, publishedAt:p.published_at, failedAt:p.failed_at, privacyLevel:p.privacy_level });
const toDb = (p: any) => ({ title:p.title, caption:p.caption ?? "", format:p.format, platform:p.platform, scheduled_at:p.scheduledAt ?? null, media:p.media ?? [], status:p.status ?? "scheduled", privacy_level:p.privacyLevel ?? null });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403, origin);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in required" }, 401, origin);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData.user) return json({ error: "Session expired. Please sign in again." }, 401, origin);
    if (!OWNER_USER_ID || userData.user.id !== OWNER_USER_ID) return json({ error: "This Postflow account is not authorised." }, 403, origin);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const url = new URL(req.url);
    const route = url.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
    const id = url.searchParams.get("id");

    if (route === "posts" && req.method === "GET") {
      const { data, error } = await admin.from("posts").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return json((data ?? []).map(fromDb), 200, origin);
    }
    if (route === "posts" && req.method === "POST") {
      const body = await req.json();
      const invalid = validatePost(body);
      if (invalid) return json({ error: invalid }, 400, origin);
      const { data, error } = await admin.from("posts").insert(toDb(body)).select("*").single();
      if (error) throw error;
      return json(fromDb(data), 201, origin);
    }
    if (route === "posts" && req.method === "PATCH") {
      const body = await req.json();
      if (!id) return json({ error: "Post id is required" }, 400, origin);
      const invalid = validatePost(body);
      if (invalid) return json({ error: invalid }, 400, origin);
      const { data, error } = await admin.from("posts").update(toDb(body)).eq("id", id).select("*").single();
      if (error) throw error;
      return json(fromDb(data), 200, origin);
    }
    if (route === "posts" && req.method === "DELETE") {
      if (!id) return json({ error: "Post id is required" }, 400, origin);
      const { error } = await admin.from("posts").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    }
    if (route === "retry" && req.method === "POST") {
      if (!id) return json({ error: "Post id is required" }, 400, origin);
      const { data, error } = await admin.from("posts").update({ status:"scheduled", retry_at:new Date().toISOString(), error:null, failed_at:null }).eq("id", id).eq("status", "failed").select("*").single();
      if (error) throw error;
      return json(fromDb(data), 200, origin);
    }
    if (route === "media" && req.method === "POST") {
      const body = await req.json();
      if (!body?.name || typeof body.data !== "string") return json({ error:"name and data are required" }, 400, origin);
      const match = body.data.match(/^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,(.*)$/);
      if (!match) return json({ error:"Only PNG, JPEG, WebP and MP4 are supported" }, 400, origin);
      const binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      if (binary.byteLength > 10 * 1024 * 1024) return json({ error:"Media must be 10 MB or smaller" }, 413, origin);
      const ext: Record<string,string> = { "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "video/mp4":"mp4" };
      const path = `${crypto.randomUUID()}.${ext[match[1]]}`;
      const { error } = await admin.storage.from(BUCKET).upload(path, binary, { contentType:match[1], upsert:false });
      if (error) throw error;
      const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
      return json({ id:path, url:data.publicUrl, type:match[1] }, 201, origin);
    }
    if (route === "creator-info" && req.method === "GET") {
      const token = Deno.env.get("TIKTOK_ACCESS_TOKEN");
      if (!token) return json({ error:"TikTok is not connected yet" }, 409, origin);
      const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json; charset=UTF-8" }, body:"{}" });
      const result = await response.json();
      if (!response.ok || result.error?.code !== "ok") return json({ error:result.error?.message ?? "TikTok creator lookup failed" }, 502, origin);
      return json({ privacyLevelOptions:result.data?.privacy_level_options ?? [] }, 200, origin);
    }
    if (route === "generate" && req.method === "POST") {
      const body = await req.json();
      const topic = String(body.topic ?? "").trim();
      const platform = body.platform === "tiktok" ? "tiktok" : "instagram";
      if (!topic) return json({ error:"topic is required" }, 400, origin);
      const apiUrl = Deno.env.get("TEXT_API_URL");
      const apiKey = Deno.env.get("TEXT_API_KEY");
      if (apiUrl && apiKey) {
        const response = await fetch(apiUrl, { method:"POST", headers:{ Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json" }, body:JSON.stringify({ model:Deno.env.get("TEXT_API_MODEL") ?? "gpt-4o-mini", messages:[{role:"system",content:"You are a concise social media copywriter. Return strict JSON."},{role:"user",content:`Write a ${platform} caption about ${topic}, tone ${body.tone ?? "friendly"}. Include 3 relevant hashtags. Return JSON with title and caption.`}], temperature:0.7 }) });
        const result = await response.json();
        if (response.ok) {
          const raw = result.choices?.[0]?.message?.content ?? "";
          try { return json({ ...JSON.parse(raw), provider:"ai" }, 200, origin); } catch { /* use template below */ }
        }
      }
      const tags = platform === "tiktok" ? "#TikTokCreator #ForYou #CreativeTok" : "#InstagramGrowth #ContentCreator #CreativeProcess";
      return json({ title:topic.slice(0,80), caption:`Here is something worth sharing: ${topic}.\n\nSave this for later and share it with someone creating today.\n\n${tags}`, provider:"template" }, 200, origin);
    }
    return json({ error:"Route not found" }, 404, origin);
  } catch (error) {
    console.error("Postflow API error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500, origin);
  }
});
