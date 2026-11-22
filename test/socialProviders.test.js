const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { publishInstagram, publishTikTok } = require("../socialProviders");

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("Instagram single image creates and publishes a media container", async t => {
  process.env.IG_USER_ID = "test-user";
  process.env.IG_ACCESS_TOKEN = "test-token";
  const calls = [];
  mock.method(global, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("fields=status_code")) return jsonResponse({ status_code: "FINISHED" });
    return jsonResponse(calls.length === 1 ? { id: "container-1" } : { id: "media-1" });
  });
  t.after(() => mock.restoreAll());
  const result = await publishInstagram({
    format: "post", caption: "Hello", media: [{ url: "https://cdn.example/image.jpg", type: "image/jpeg" }]
  });
  assert.equal(result.id, "media-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/media\?/);
  assert.match(calls[1].url, /\/media_publish\?/);
});

test("Instagram carousel creates each child before publishing the parent", async t => {
  process.env.IG_USER_ID = "test-user";
  process.env.IG_ACCESS_TOKEN = "test-token";
  const calls = [];
  mock.method(global, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    const body = options?.body ? new URLSearchParams(options.body) : new URLSearchParams();
    if (String(url).includes("media_publish")) return jsonResponse({ id: "published-carousel" });
    if (body.get("media_type") === "CAROUSEL") return jsonResponse({ id: "parent-container" });
    return jsonResponse({ id: "child-" + calls.length });
  });
  t.after(() => mock.restoreAll());
  const result = await publishInstagram({
    format: "carousel", caption: "Slides",
    media: [
      { url: "https://cdn.example/one.jpg", type: "image/jpeg" },
      { url: "https://cdn.example/two.mp4", type: "video/mp4" }
    ]
  });
  assert.equal(result.id, "published-carousel");
  assert.equal(calls.length, 4);
});

test("TikTok queries creator settings and initializes an image carousel", async t => {
  process.env.TIKTOK_ACCESS_TOKEN = "test-token";
  const calls = [];
  mock.method(global, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("creator_info")) {
      return jsonResponse({ data: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false }, error: { code: "ok" } });
    }
    return jsonResponse({ data: { publish_id: "publish-123" }, error: { code: "ok" } });
  });
  t.after(() => mock.restoreAll());
  const result = await publishTikTok({
    format: "carousel", title: "Photos", caption: "A photo set",
    media: [
      { url: "https://cdn.example/one.jpg", type: "image/jpeg" },
      { url: "https://cdn.example/two.jpg", type: "image/jpeg" }
    ]
  });
  assert.equal(result.publish_id, "publish-123");
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.media_type, "PHOTO");
  assert.equal(payload.source_info.photo_images.length, 2);
  assert.equal(payload.post_info.privacy_level, "SELF_ONLY");
});

test("TikTok rejects mixed photo and video carousels", async t => {
  process.env.TIKTOK_ACCESS_TOKEN = "test-token";
  mock.method(global, "fetch", async () => jsonResponse({
    data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" }
  }));
  t.after(() => mock.restoreAll());
  await assert.rejects(() => publishTikTok({
    format: "carousel",
    media: [
      { url: "https://cdn.example/one.jpg", type: "image/jpeg" },
      { url: "https://cdn.example/two.mp4", type: "video/mp4" }
    ]
  }), /images only/);
});
