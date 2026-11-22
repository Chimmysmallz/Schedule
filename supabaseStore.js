const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const secretKey = process.env.SUPABASE_SECRET_KEY || "";

if (!baseUrl || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

async function request(path, options = {}) {
  const response = await fetch(baseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || "Supabase database request failed");
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    format: row.format,
    platform: row.platform,
    scheduledAt: row.scheduled_at,
    media: row.media || [],
    status: row.status,
    retryCount: row.retry_count,
    retryAt: row.retry_at,
    providerResponse: row.provider_response,
    error: row.error,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    failedAt: row.failed_at,
    privacyLevel: row.privacy_level || null
  };
}

function toRow(post) {
  return {
    id: post.id,
    title: post.title,
    caption: post.caption || "",
    format: post.format || "post",
    platform: post.platform,
    scheduled_at: post.scheduledAt || null,
    media: post.media || [],
    status: post.status || "scheduled",
    retry_count: post.retryCount || 0,
    retry_at: post.retryAt || null,
    provider_response: post.providerResponse || null,
    error: post.error || null,
    created_at: post.createdAt || new Date().toISOString(),
    published_at: post.publishedAt || null,
    failed_at: post.failedAt || null,
    privacy_level: post.privacyLevel || null
  };
}

const store = {
  async list() {
    const rows = await request("posts?select=*&order=created_at.desc");
    return rows.map(fromRow);
  },
  async get(id) {
    const rows = await request("posts?select=*&id=eq." + encodeURIComponent(id) + "&limit=1");
    return fromRow(rows[0]);
  },
  async create(post) {
    const rows = await request("posts?select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toRow(post))
    });
    return fromRow(rows[0]);
  },
  async update(id, changes) {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    const rows = await request("posts?id=eq." + encodeURIComponent(id) + "&select=*", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toRow(next))
    });
    return fromRow(rows[0]);
  },
  async delete(id) {
    const rows = await request("posts?id=eq." + encodeURIComponent(id) + "&select=id", {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    return rows.length > 0;
  },
  async claimDuePosts(now, limit = 10) {
    const rows = await request("rpc/claim_due_posts", {
      method: "POST",
      body: JSON.stringify({ p_now: now, p_limit: limit })
    });
    return rows.map(fromRow);
  },
  async duePosts(now) {
    const rows = await request("posts?select=*&or=(and(status.eq.scheduled,scheduled_at.lte." +
      encodeURIComponent(now) + "),and(status.eq.failed,retry_count.lt.5,retry_at.not.is.null,retry_at.lte." +
      encodeURIComponent(now) + "))&order=created_at");
    return rows.map(fromRow);
  }
};

module.exports = store;
