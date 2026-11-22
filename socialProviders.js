async function graphRequest(url, method = "POST", body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Social API returned ${response.status}`);
  return data;
}

async function publishInstagram(post) {
  const { IG_USER_ID, IG_ACCESS_TOKEN, IG_GRAPH_VERSION = "v23.0" } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN");
  }
  if (!post.media.length) {
    throw new Error("Instagram publishing requires at least one public media URL");
  }

  const base = `https://graph.facebook.com/${IG_GRAPH_VERSION}/${IG_USER_ID}`;
  const media = post.media.map(item => typeof item === "string" ? item : item.url);

  if (post.format === "carousel" && media.length > 1) {
    const children = [];
    for (const mediaUrl of media) {
      const result = await graphRequest(
        `${base}/media?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
        "POST",
        { image_url: mediaUrl, is_carousel_item: true }
      );
      children.push(result.id);
    }
    const created = await graphRequest(
      `${base}/media?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
      "POST",
      { media_type: "CAROUSEL", children: children.join(","), caption: post.caption }
    );
    return graphRequest(
      `${base}/media_publish?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
      "POST",
      { creation_id: created.id }
    );
  }

  const first = media[0];
  const payload = post.format === "reel"
    ? { media_type: "REELS", video_url: first, caption: post.caption }
    : { image_url: first, caption: post.caption };
  const created = await graphRequest(
    `${base}/media?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
    "POST",
    payload
  );
  return graphRequest(
    `${base}/media_publish?access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`,
    "POST",
    { creation_id: created.id }
  );
}

async function publishTikTok(post) {
  const { TIKTOK_ACCESS_TOKEN } = process.env;
  if (!TIKTOK_ACCESS_TOKEN) throw new Error("Missing TIKTOK_ACCESS_TOKEN");
  if (!post.media.length) throw new Error("TikTok publishing requires a public media URL");

  const mediaUrl = typeof post.media[0] === "string" ? post.media[0] : post.media[0].url;
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TIKTOK_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      post_info: {
        title: post.caption || post.title,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: mediaUrl
      }
    })
  });
  const data = await response.json();
  if (!response.ok || data.error?.code !== "ok") {
    throw new Error(data.error?.message || `TikTok API returned ${response.status}`);
  }
  return data;
}

async function publishPost(post, platform) {
  if (platform === "instagram") return publishInstagram(post);
  if (platform === "tiktok") return publishTikTok(post);
  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = { publishPost };
