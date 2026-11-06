import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwitchClient } from "../agent/switch-client.mjs";

// A fake agent bridge: one SSE stream at a time, a fenced heartbeat, one op.
function fakeBridge() {
  const state = { streams: [], beats: [], opens: [], ops: [], generation: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname.endsWith("/events")) {
      state.generation++;
      state.opens.push({ lastEventId: req.headers["last-event-id"] || null, connection: url.searchParams.get("connection_id") });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`event: connection_state\ndata: ${JSON.stringify({ connection_id: url.searchParams.get("connection_id"), generation: state.generation, rooms: ["r1"], heartbeat_interval_seconds: 0.2, protocol: 6, server: { version: "test" } })}\n\n`);
      state.streams.push(res);
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = body ? JSON.parse(body) : {};
      if (url.pathname.endsWith("/connection/beat")) {
        state.beats.push(data);
        const ok = data.generation === state.generation;
        res.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(ok ? { ok: true } : { detail: { code: "unfenced" } }));
      }
      if (url.pathname.includes("/ops/")) {
        state.ops.push({ name: url.pathname.split("/").pop(), args: data, connection: req.headers["x-switch-connection-id"] });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ result: { ok: true } }));
      }
      res.writeHead(404).end();
    });
  });
  const push = (id, payload) => state.streams.at(-1).write(`id: ${id}\nevent: message\ndata: ${JSON.stringify({ type: "message", room_id: "r1", payload, sequence: id })}\n\n`);
  const evict = () => state.streams.at(-1).end(`event: evicted\ndata: ${JSON.stringify({ reason: "test" })}\n\n`);
  return { server, state, push, evict };
}
const waitFor = async (fn, ms = 4000) => {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("Switch client: fenced heartbeats, event delivery, ops on the connection, resume after eviction", async (t) => {
  const bridge = fakeBridge();
  await new Promise((r) => bridge.server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "stageleaf-switch-"));
  const client = new SwitchClient({
    baseUrl: `http://127.0.0.1:${bridge.server.address().port}`,
    agentId: "a1",
    apiKey: "k",
    statePath: join(dir, "state.json"),
    log: { info() {}, warn() {}, error() {} },
  });
  t.after(() => {
    client.stop();
    bridge.state.streams.forEach((s) => s.destroy());
    bridge.server.closeAllConnections();
    bridge.server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const received = [];
  client.run((evt) => {
    received.push(evt);
    client.markHandled(evt.payload.message_id, evt.eventId);
  });
  await waitFor(() => client.connected && bridge.state.beats.length >= 2);
  assert.ok(bridge.state.beats.every((b) => b.generation === 1), "every beat carries the incarnation");

  bridge.push("41", { message_id: "m1", addressed: true, body: "hello", sender_name: "maya" });
  await waitFor(() => received.length === 1);
  assert.equal(received[0].eventId, "41");
  assert.equal(client.wasHandled("m1"), true);

  await client.op("post_message", { body: "hi" });
  assert.equal(bridge.state.ops[0].connection, client.connectionId);

  bridge.evict();
  await waitFor(() => bridge.state.opens.length === 2 && client.connected, 6000);
  assert.equal(bridge.state.opens[1].lastEventId, "41", "resumes from the last handled event");
  assert.equal(bridge.state.opens[1].connection, client.connectionId);
  await waitFor(() => bridge.state.beats.some((b) => b.generation === 2));
});
