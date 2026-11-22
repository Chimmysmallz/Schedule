const React = require("react");
const { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } = require("remotion");

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function ContentCard({ title, caption, accent, platform }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = interpolate(frame, [0, fps * 0.6], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill style={{
      background: "#171816",
      color: "#ffffff",
      padding: 88,
      fontFamily: "Inter, Arial, sans-serif"
    }}>
      <div style={{
        position: "absolute",
        left: 88,
        top: 88,
        width: 72,
        height: 8,
        borderRadius: 4,
        background: accent || "#8fa678"
      }} />
      <div style={{
        transform: `translateY(${enter}px)`,
        marginTop: 120,
        maxWidth: 820
      }}>
        <div style={{ fontSize: 32, color: accent || "#8fa678", fontWeight: 800, marginBottom: 24 }}>
          {platform === "tiktok" ? "TIKTOK" : "INSTAGRAM"}
        </div>
        <div style={{ fontSize: 84, lineHeight: 1.02, fontWeight: 800, letterSpacing: -4 }}>
          {truncate(title, 80)}
        </div>
        <div style={{ fontSize: 34, lineHeight: 1.35, marginTop: 42, color: "#dfe2dc" }}>
          {truncate(caption, 180)}
        </div>
      </div>
      <div style={{
        position: "absolute",
        left: 88,
        right: 88,
        bottom: 88,
        height: 8,
        borderRadius: 4,
        background: "#353731",
        overflow: "hidden"
      }}>
        <div style={{ width: `${progress}%`, height: "100%", background: accent || "#8fa678" }} />
      </div>
    </AbsoluteFill>
  );
}

module.exports = { ContentCard };
