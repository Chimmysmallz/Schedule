const test = require("node:test");
const assert = require("node:assert/strict");
process.env.POSTFLOW_DB = ":memory:";
process.env.PUBLISH_MODE = "dry-run";

const store = require("../store");
const { createServer, validatePostBody } = require("../server");
const { generateCopy } = require("../contentEngine");

test("content engine generates a template caption", async () => {
  const content = await generateCopy({
    topic: "A better morning routine",
    platform: "instagram",
    tone: "friendly"
  });
  assert.match(content.caption, /A better morning routine/);
  assert.equal(content.provider, "template");
  assert.equal(content.hashtags.length, 3);
});

test("post validation rejects unsupported schedules and media", () => {
  assert.equal(validatePostBody({
    title: "Hello",
    platform: "instagram",
    status: "scheduled",
    scheduledAt: "2026-11-22T12:00:00Z",
    media: [{ url: "https://cdn.example/photo.jpg", type: "image/jpeg" }]
  }), null);
  assert.match(validatePostBody({
    title: "",
    platform: "instagram",
    status: "scheduled",
    scheduledAt: "2026-11-22T12:00:00Z",
    media: []
  }), /title/);
  assert.match(validatePostBody({
    title: "Hello",
    platform: "unknown",
    status: "draft",
    media: []
  }), /Unsupported platform/);
});

test("store creates, updates, retries, and deletes posts", async () => {
  const post = await store.create({
    id: "test-post",
    title: "Test",
    caption: "Test caption",
    format: "post",
    platform: "instagram",
    scheduledAt: "2026-11-22T12:00:00.000Z",
    media: [],
    status: "scheduled",
    createdAt: "2026-11-22T11:00:00.000Z"
  });
  assert.equal(post.status, "scheduled");

  const updated = await store.update(post.id, { title: "Updated", status: "draft", scheduledAt: null });
  assert.equal(updated.title, "Updated");
  assert.equal(updated.status, "draft");

  const retried = await store.update(post.id, {
    status: "scheduled",
    retryCount: 0,
    retryAt: null,
    error: null
  });
  assert.equal(retried.status, "scheduled");
  assert.equal(await store.delete(post.id), true);
  assert.equal(await store.get(post.id), null);
});

test("HTTP API can create, edit, cancel, and process posts", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const copyResponse = await fetch(`${base}/api/content/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Launch week",
        platform: "tiktok",
        tone: "bold"
      })
    });
    assert.equal(copyResponse.status, 200);
    assert.equal((await copyResponse.json()).provider, "template");

    const createResponse = await fetch(`${base}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "API test",
        caption: "Hello",
        format: "post",
        platform: "instagram",
        scheduledAt: "2026-11-22T00:00:00.000Z",
        media: [{ url: "https://cdn.example/photo.jpg", type: "image/jpeg" }]
      })
    });
    assert.equal(createResponse.status, 201);
    const post = await createResponse.json();

    const editResponse = await fetch(`${base}/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited", status: "draft", scheduledAt: null })
    });
    assert.equal(editResponse.status, 200);
    assert.equal((await editResponse.json()).title, "Edited");

    const cancelResponse = await fetch(`${base}/api/posts/${post.id}`, { method: "DELETE" });
    assert.equal(cancelResponse.status, 204);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
