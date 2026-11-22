const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePostBody } = require("../server");

const future = new Date(Date.now() + 60_000).toISOString();
const base = { title: "Post", caption: "Caption", platform: "instagram", format: "post", scheduledAt: future, status: "scheduled" };

test("accepts an Instagram single-image feed post", () => {
  assert.equal(validatePostBody({ ...base, media: [{ url: "https://cdn.example/photo.jpg", type: "image/jpeg" }] }), null);
});

test("rejects an Instagram video feed post unless it is a Reel", () => {
  assert.match(validatePostBody({ ...base, media: [{ url: "https://cdn.example/video.mp4", type: "video/mp4" }] }), /Choose Reel/);
});

test("accepts media-free drafts", () => {
  assert.equal(validatePostBody({ ...base, status: "draft", scheduledAt: null, media: [] }), null);
});

test("rejects TikTok carousels containing video", () => {
  assert.match(validatePostBody({
    ...base, platform: "tiktok", format: "carousel",
    media: [
      { url: "https://cdn.example/photo.jpg", type: "image/jpeg" },
      { url: "https://cdn.example/video.mp4", type: "video/mp4" }
    ]
  }), /images/);
});

test("accepts a TikTok single video post", () => {
  assert.equal(validatePostBody({
    ...base, platform: "tiktok",
    media: [{ url: "https://cdn.example/video.mp4", type: "video/mp4" }]
  }), null);
});
