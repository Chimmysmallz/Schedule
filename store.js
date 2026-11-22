const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const database = new DatabaseSync(process.env.POSTFLOW_DB || path.join(dataDir, "postflow.sqlite"));

database.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    caption TEXT NOT NULL,
    format TEXT NOT NULL,
    platform TEXT NOT NULL,
    scheduled_at TEXT,
    media TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_at TEXT,
    provider_response TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT,
    failed_at TEXT
  );
`);

function migrateJsonPosts() {
  const oldFile = path.join(dataDir, "posts.json");
  if (!fs.existsSync(oldFile)) return;
  const posts = JSON.parse(fs.readFileSync(oldFile, "utf8"));
  if (!Array.isArray(posts)) return;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO posts (
      id,title,caption,format,platform,scheduled_at,media,status,retry_count,retry_at,
      provider_response,error,created_at,published_at,failed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const post of posts) {
    insert.run(
      post.id,
      post.title,
      post.caption || post.title,
      post.format || "post",
      post.platform,
      post.scheduledAt || null,
      JSON.stringify(post.media || []),
      post.status || "scheduled",
      post.retryCount || 0,
      post.retryAt || null,
      post.providerResponse ? JSON.stringify(post.providerResponse) : null,
      post.error || null,
      post.createdAt || new Date().toISOString(),
      post.publishedAt || null,
      post.failedAt || null
    );
  }
  fs.renameSync(oldFile, `${oldFile}.migrated`);
}

migrateJsonPosts();

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    format: row.format,
    platform: row.platform,
    scheduledAt: row.scheduled_at,
    media: JSON.parse(row.media),
    status: row.status,
    retryCount: row.retry_count,
    retryAt: row.retry_at,
    providerResponse: row.provider_response ? JSON.parse(row.provider_response) : null,
    error: row.error,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    failedAt: row.failed_at
  };
}

const store = {
  list() {
    return database.prepare("SELECT * FROM posts ORDER BY created_at DESC").all().map(fromRow);
  },
  get(id) {
    return fromRow(database.prepare("SELECT * FROM posts WHERE id = ?").get(id));
  },
  create(post) {
    database.prepare(`
      INSERT INTO posts (
        id,title,caption,format,platform,scheduled_at,media,status,retry_count,
        retry_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?, ?,?)
    `).run(
      post.id, post.title, post.caption, post.format, post.platform, post.scheduledAt,
      JSON.stringify(post.media), post.status, 0, null, post.createdAt
    );
    return this.get(post.id);
  },
  update(id, changes) {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    database.prepare(`
      UPDATE posts SET title=?,caption=?,format=?,platform=?,scheduled_at=?,media=?,
      status=?,retry_count=?,retry_at=?,provider_response=?,error=?,published_at=?,failed_at=?
      WHERE id=?
    `).run(
      next.title,
      next.caption,
      next.format,
      next.platform,
      next.scheduledAt,
      JSON.stringify(next.media),
      next.status,
      next.retryCount,
      next.retryAt,
      next.providerResponse ? JSON.stringify(next.providerResponse) : null,
      next.error,
      next.publishedAt,
      next.failedAt,
      id
    );
    return this.get(id);
  },
  delete(id) {
    return database.prepare("DELETE FROM posts WHERE id = ?").run(id).changes > 0;
  },
  claimDuePosts(now, limit = 10) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const rows = database.prepare("SELECT id FROM posts WHERE (status='scheduled' AND scheduled_at <= ?) OR (status='failed' AND retry_count < 5 AND retry_at IS NOT NULL AND retry_at <= ?) ORDER BY created_at LIMIT ?").all(now, now, limit);
      if (!rows.length) { database.exec('COMMIT'); return []; }
      const placeholders = rows.map(() => '?').join(',');
      const claimed = database.prepare("UPDATE posts SET status='processing' WHERE id IN (" + placeholders + ") RETURNING *").all(...rows.map(row => row.id));
      database.exec('COMMIT');
      return claimed.map(fromRow);
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  },
  duePosts(now) {
    return database.prepare("SELECT * FROM posts WHERE (status='scheduled' AND scheduled_at <= ?) OR (status='failed' AND retry_count < 5 AND retry_at IS NOT NULL AND retry_at <= ?) ORDER BY created_at").all(now, now).map(fromRow);
  },
  close() {
    database.close();
  }
};

module.exports = store;
