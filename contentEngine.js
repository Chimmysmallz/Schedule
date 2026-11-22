const platformRules = {
  instagram: {
    maxLength: 2200,
    hashtags: ["InstagramGrowth", "ContentCreator", "CreativeProcess"]
  },
  tiktok: {
    maxLength: 2200,
    hashtags: ["TikTokCreator", "ForYou", "CreativeTok"]
  }
};

function clean(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function templateCopy({ topic, tone, platform }) {
  const safeTopic = clean(topic, "A fresh idea");
  const safeTone = clean(tone, "friendly").toLowerCase();
  const introductions = {
    friendly: `Here is something worth sharing: ${safeTopic}.`,
    bold: `Stop scrolling. ${safeTopic} deserves your attention.`,
    professional: `${safeTopic} — practical insight for your next step.`,
    playful: `Plot twist: ${safeTopic} is more interesting than it looks.`
  };
  const intro = introductions[safeTone] || introductions.friendly;
  const rules = platformRules[platform] || platformRules.instagram;
  const callToAction = platform === "tiktok"
    ? "Save this and try it in your next post."
    : "Save this for later and share it with someone creating today.";
  const caption = `${intro}\n\n${callToAction}\n\n${rules.hashtags.map(tag => `#${tag}`).join(" ")}`;
  return {
    title: safeTopic.slice(0, 80),
    caption: caption.slice(0, rules.maxLength),
    hashtags: rules.hashtags,
    topic: safeTopic,
    tone: safeTone,
    platform,
    provider: "template"
  };
}

async function generateCopy(input) {
  const topic = clean(input.topic);
  const platform = platformRules[input.platform] ? input.platform : "instagram";
  if (!topic) throw new Error("topic is required");

  const url = process.env.TEXT_API_URL;
  const apiKey = process.env.TEXT_API_KEY;
  if (!url || !apiKey) return templateCopy({ ...input, platform });

  const model = process.env.TEXT_API_MODEL || "gpt-4o-mini";
  const prompt = [
    `Create one engaging ${platform} post about: ${topic}`,
    `Tone: ${clean(input.tone, "friendly")}`,
    "Include a concise title, a natural caption, and 3 relevant hashtags.",
    "Return only strict JSON with title, caption, and hashtags fields."
  ].join("\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a concise social media copywriter." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Text API returned ${response.status}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Text API returned no content");

  const parsed = JSON.parse(content);
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.map(tag => String(tag).replace(/^#/, "")).slice(0, 5)
    : platformRules[platform].hashtags;
  const caption = clean(parsed.caption, topic);
  return {
    title: clean(parsed.title, topic).slice(0, 80),
    caption: `${caption}\n\n${hashtags.map(tag => `#${tag}`).join(" ")}`.slice(0, platformRules[platform].maxLength),
    hashtags,
    topic,
    tone: clean(input.tone, "friendly").toLowerCase(),
    platform,
    provider: "ai"
  };
}

module.exports = { generateCopy };
