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

## Reliability and controlled testing

- Live publishing requires an HTTPS `PUBLIC_BASE_URL`, an `APP_PASSWORD`, and provider credentials for the platform being used.
- Postflow uses expiring, HTTP-only, SameSite session cookies and rate-limits failed password attempts. Live mode always marks the session cookie Secure.
- Instagram supports single-image feed posts, single-video Reels, and mixed image/video carousels. Video and carousel containers are checked for readiness before publishing.
- TikTok supports single-video posts and photo posts/carousels. It queries creator settings before initiating a post and checks the publish status instead of marking an upload as published immediately.
- The TikTok composer loads the creator's available privacy options and requires an explicit visibility choice. Dry-run mode offers `SELF_ONLY` as a local placeholder; live publishing validates the selected value against TikTok's current creator settings.
- TikTok direct posting requires an approved Content Posting API app, the `video.publish` scope, and a verified domain or URL prefix for media pulled from your server. Unaudited apps are restricted to private visibility.
- The scheduler atomically claims due posts, prevents overlapping runs within one server process, and retries failed attempts with exponential backoff (up to five attempts).
- Use mocked provider tests first. Do not enable live publishing until you have completed the platform app review, configured verified HTTPS media hosting, and tested with private/test content.
