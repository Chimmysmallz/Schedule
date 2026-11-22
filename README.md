# Postflow

A browser-based social media scheduling workspace for planning Instagram and TikTok
posts across the calendar. Open `index.html` directly or serve the repository with:

```sh
npm start
```

Set `APP_PASSWORD` to enable signed-cookie authentication for mutations and publishing:

```sh
APP_PASSWORD='replace-with-a-long-secret' npm start
```

## Content generation

Enter a topic in the composer and select **Generate copy** for caption and hashtag
generation. Without an AI provider, Postflow uses built-in templates. To use an
OpenAI-compatible chat API:

```sh
TEXT_API_URL=https://api.example.com/v1/chat/completions \
TEXT_API_KEY='replace-with-a-secret' \
TEXT_API_MODEL='gpt-4o-mini' \
npm start
```

**Generate Remotion video** renders a vertical 1080×1920 H264 MP4 using the bundled
Remotion composition. Rendering is CPU/GPU intensive and requires Chromium dependencies
and enough disk space on the server. On Linux, install Chromium dependencies supplied
by your host or container image before live use.

The Node server persists scheduled posts and uploaded media in `data/` and checks the
schedule every 30 seconds.

## Publishing

Publishing is disabled by default. This safe dry-run mode lets you verify scheduling
without contacting a social network:

```sh
npm start
```

Set `PUBLISH_MODE=live` and provide public media URLs plus these provider credentials:

```sh
PUBLISH_MODE=live \
PUBLIC_BASE_URL=https://your-public-host.example \
APP_PASSWORD='replace-with-a-long-secret' \
IG_USER_ID=... \
IG_ACCESS_TOKEN=... \
TIKTOK_ACCESS_TOKEN=... \
npm start
```

- `IG_USER_ID` and `IG_ACCESS_TOKEN` enable Instagram Graph API publishing.
- `TIKTOK_ACCESS_TOKEN` enables TikTok direct-post video publishing.
- `PUBLIC_BASE_URL` must be reachable by Instagram and TikTok when they fetch media.
- A real deployment should remain running continuously and use a durable database,
  authenticated accounts, and HTTPS credentials.