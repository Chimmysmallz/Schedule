const path = require("node:path");
const fs = require("node:fs");

async function renderContentCard(inputProps, outputFile) {
  const [{ bundle }, { selectComposition, renderMedia }] = await Promise.all([
    import("@remotion/bundler"),
    import("@remotion/renderer")
  ]);
  const entryPoint = path.join(__dirname, "remotion", "index.jsx");
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const bundleLocation = await bundle({
    entryPoint,
    outDir: path.join(__dirname, "data", "remotion-bundle")
  });
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "PostflowCard",
    inputProps
  });
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputFile,
    inputProps,
    onProgress: ({ progress }) => {
      if (typeof process.send === "function") process.send({ progress });
    }
  });
  return outputFile;
}

module.exports = { renderContentCard };
