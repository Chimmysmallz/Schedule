const React = require("react");
const { registerRoot } = require("remotion");
const { Composition, continueRender, delayRender } = require("remotion");
const { ContentCard } = require("./ContentCard");

function RemotionRoot() {
  return (
    <Composition
      id="PostflowCard"
      component={ContentCard}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        title: "Create something worth sharing",
        caption: "Turn a simple idea into scroll-stopping content.",
        accent: "#8fa678",
        platform: "instagram"
      }}
    />
  );
}

registerRoot(RemotionRoot);
