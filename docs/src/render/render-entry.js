import { exportToSvg, exportToBlob } from "@excalidraw/excalidraw";
window.exportSceneSvg = async (scene, opts = {}) => {
  const svg = await exportToSvg({
    elements: scene.elements,
    appState: { ...(scene.appState || {}), exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false },
    files: scene.files || {},
    exportPadding: opts.padding ?? 0,
  });
  return svg.outerHTML;
};
window.exportScenePng = async (scene, opts = {}) => {
  let elements = scene.elements, exportingFrame = null;
  if (opts.frameId) {
    exportingFrame = elements.find(e => e.id === opts.frameId);
    elements = elements.filter(e => e.id === opts.frameId || e.frameId === opts.frameId);
  }
  const blob = await exportToBlob({
    elements, exportingFrame,
    appState: { ...(scene.appState || {}), exportBackground: true, exportWithDarkMode: false, exportScale: opts.scale ?? 1 },
    files: scene.files || {},
    mimeType: "image/png",
    exportPadding: opts.padding ?? 0,
    getDimensions: (w, h) => { const s = opts.maxWidth ? Math.min(opts.scale ?? 1, opts.maxWidth / w) : (opts.scale ?? 1); return { width: Math.round(w * s), height: Math.round(h * s), scale: s }; },
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
};
window.renderReady = true;
