import React from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import App from "../src/App.jsx";
import { sampleEvent, conflicts } from "../server/domain.mjs";
const user = { id: "design-only", name: "Pavan", email: "preview@example.com" };
const e = sampleEvent(user);
Object.assign(e, { version: 1, responses: [], conflicts: conflicts(e) });
const css = readFileSync("src/styles.css", "utf8");
mkdirSync("artifacts", { recursive: true });
for (const tab of ["overview", "schedule"]) {
  const markup = renderToString(
    <App initialData={{ user, events: [e], selected: e.id, tab }} />,
  );
  writeFileSync(
    `artifacts/${tab}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
}
writeFileSync(
  "artifacts/welcome.html",
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${renderToString(<App initialData={{}} />)}</body></html>`,
);
