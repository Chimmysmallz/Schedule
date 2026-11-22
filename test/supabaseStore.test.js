const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");

process.env.SUPABASE_URL = "https://postflow-test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
const store = require("../supabaseStore");

function row(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Test post",
    caption: "Caption",
    format: "post",
    platform: "instagram",
    scheduled_at: "2026-11-23T10:00:00.000Z",
    media: [{ url: "https://cdn.example/photo.jpg", type: "image/jpeg" }],
    status: "scheduled",
    retry_count: 0,
    retry_at: null,
    provider_response: null,
    error: null,
    created_at: "2026-11-22T10:00:00.000Z",
    published_at: null,
    failed_at: null,
    privacy_level: null,
    ...overrides
  };
}

test("Supabase store maps database rows into Postflow post objects", async t => {
  mock.method(global, "fetch", async (url, options) => {
    assert.match(String(url), /\/rest\/v1\/posts\?/);
    assert.equal(options.headers.apikey, "sb_secret_test");
    return new Response(JSON.stringify([row()]), { status: 200 });
  });
  t.after(() => mock.restoreAll());
  const posts = await store.list();
  assert.equal(posts[0].id, "00000000-0000-4000-8000-000000000001");
  assert.equal(posts[0].scheduledAt, "2026-11-23T10:00:00.000Z");
  assert.equal(posts[0].media.length, 1);
});

test("Supabase store atomically claims due posts through the database RPC", async t => {
  let payload;
  mock.method(global, "fetch", async (url, options) => {
    assert.match(String(url), /\/rest\/v1\/rpc\/claim_due_posts$/);
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify([row({ status: "processing" })]), { status: 200 });
  });
  t.after(() => mock.restoreAll());
  const posts = await store.claimDuePosts("2026-11-23T10:00:00.000Z", 7);
  assert.equal(payload.p_limit, 7);
  assert.equal(posts[0].status, "processing");
});
