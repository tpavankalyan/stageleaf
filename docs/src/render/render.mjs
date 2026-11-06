// Usage: node render.mjs scene.excalidraw outDir [--frames] [--full-width=2400] [--scale=2]
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "playwright";
const [scenePath, outDir, ...flags] = process.argv.slice(2);
const opt = Object.fromEntries(flags.map(f => { const [k, v] = f.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "www");
const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;
const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", m => { if (m.type() === "error") console.error("console:", m.text()); });
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.renderReady === true, null, { timeout: 60000 });
const write = (name, b64) => fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, "base64"));
if (opt.frames) {
  const frames = scene.elements.filter(e => e.type === "frame" && !e.isDeleted).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [i, f] of frames.entries()) {
    const b64 = await page.evaluate(([s, id, sc]) => window.exportScenePng(s, { frameId: id, scale: sc }), [scene, f.id, Number(opt.scale || 1)]);
    const name = `frame-${String(i + 1).padStart(2, "0")}.png`; write(name, b64); console.log(name, f.name);
  }
}
if (opt["full-width"]) {
  const b64 = await page.evaluate(([s, w]) => window.exportScenePng(s, { scale: 1, maxWidth: w, padding: 40 }), [scene, Number(opt["full-width"])]);
  write("full.png", b64); console.log("full.png");
}
await browser.close(); server.close();
