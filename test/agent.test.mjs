import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { createAgent } from "../agent/index.mjs";
import { StageleafClient } from "../agent/stageleaf-client.mjs";

const ROOM = "room-ops";
const quiet = { info() {}, warn() {}, error() {} };

async function stageleaf() {
  const service = createApp({ dbPath: ":memory:", secureCookies: false });
  const listener = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  const url = "http://127.0.0.1:" + listener.address().port;
  let cookie = "";
  const api = async (path, body, method = body ? "POST" : "GET") => {
    const res = await fetch(url + "/api" + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.headers.get("set-cookie")) cookie = res.headers.get("set-cookie").split(";")[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${data.error}`);
    return data;
  };
  await api("/auth/register", { name: "Alex Morgan", email: "alex@example.com", password: "secure-test-password" });
  await api("/account", { chatHandle: "alex" }, "PATCH");
  let event = await api("/events", { sample: true });
  event = await api(`/events/${event.id}`, { expectedVersion: event.version, operation: "publish" }, "PATCH");
  const { token } = await api("/agent-tokens", { label: "test" });
  const client = new StageleafClient({ baseUrl: url, token });
  await client.linkRoom(event.id, { roomId: ROOM, roomName: "fieldwork-ops" });
  return {
    api,
    client,
    eventId: event.id,
    close: async () => {
      await new Promise((r) => listener.close(r));
      service.close();
    },
  };
}

// The Switch side, as the agent sees it: operations and a handled-message log.
function fakeSwitch() {
  const posts = [];
  const docs = [];
  const handled = new Set();
  let seq = 0;
  return {
    posts,
    docs,
    rooms: [ROOM],
    connectionId: "c1",
    markHandled: (id) => handled.add(id),
    wasHandled: (id) => handled.has(id),
    async op(name, args) {
      if (name === "connect_to_room")
        return { name: "fieldwork-ops", instructions: "## Room-specific instructions\n\nOps room.", participants: [] };
      if (name === "read_context") return { threads: [] };
      if (name === "post_message") {
        posts.push(args);
        return { event_id: "e" + ++seq };
      }
      if (name === "create_room_document") {
        docs.push(args);
        return { document_id: "doc-1" };
      }
      if (name === "update_room_document") {
        docs.push(args);
        return { status: "ok" };
      }
      throw new Error("unexpected op " + name);
    },
  };
}
let n = 0;
const message = (handle, body, thread = null) => ({
  type: "message",
  room_id: ROOM,
  eventId: String(++n),
  payload: { addressed: true, sender: `@switch-mattermost-x-${handle}:localhost`, sender_name: handle, message_id: "m" + n, body, thread_id: thread },
});

test("rules mode runs the whole chat workflow, with Stageleaf enforcing who may act", async (t) => {
  const s = await stageleaf();
  t.after(s.close);
  const sw = fakeSwitch();
  const agent = createAgent({ config: { agentName: "stageleaf" }, llm: null, switchClient: sw, stageleaf: s.client, logger: quiet });
  const say = async (handle, body, thread) => {
    const m = message(handle, body, thread);
    await agent.onEvent(m);
    return m.payload.message_id;
  };

  const root = await say("maya", "@stageleaf maya arrives 11:45");
  assert.match(sw.posts.at(-1).body, /Recorded Maya Ellis arriving at 11:45/);
  assert.match(sw.posts.at(-1).body, /outside Maya Ellis’s recorded availability/);
  assert.equal(sw.posts.at(-1).thread_id, root, "replies go into the reporter's thread");

  await say("maya", "@stageleaf swap opening keynote with builders panel", root);
  assert.match(sw.posts.at(-1).body, /Opening keynote — Maya Ellis\*\*: 11:15–12:00 → 14:30–15:15/);
  assert.match(sw.posts.at(-1).body, /@maya, @sam, @jamie/);

  await say("robin", "approve", root);
  assert.match(sw.posts.at(-1).body, /Robin Park isn't an affected owner/);
  await say("sam", "approve", root);
  await say("jamie", "approve", root);
  await say("alex", "publish", root);
  assert.match(sw.posts.at(-1).body, /Every affected owner must approve/);
  await say("maya", "approve", root);
  assert.match(sw.posts.at(-1).body, /Everyone has approved/);
  await say("jamie", "publish", root);
  assert.match(sw.posts.at(-1).body, /Only the lead planner can publish/);
  await say("alex", "publish", root);
  assert.ok(sw.posts.some((p) => !p.thread_id && /Published run of show \*\*v2\*\*/.test(p.body)), "top-level announcement");
  assert.match(sw.docs[0].content, /run of show v2/);
  await say("sam", "ack", root);

  const event = await s.api(`/events/${s.eventId}`);
  assert.equal(event.publications.length, 2);
  assert.equal(event.chat.documentId, "doc-1");
  const decisions = event.responses.filter((r) => r.scope === event.changes[0].id);
  assert.deepEqual(decisions.map((r) => JSON.parse(r.evidence).handle).sort(), ["jamie", "maya", "sam"]);
  assert.ok(decisions.every((r) => r.channel === "switch"));
  const ack = event.responses.find((r) => r.scope === "brief" && r.version === 2);
  assert.equal(JSON.parse(ack.evidence).handle, "sam");
});

test("the model can't record a decision for anyone but the message's sender", async (t) => {
  const s = await stageleaf();
  t.after(s.close);
  const ctx = await s.client.eventForRoom(ROOM);
  const id = (title) => ctx.runOfShow.find((a) => a.title.startsWith(title)).id;
  const proposal = await s.client.propose(s.eventId, {
    evidence: { roomId: ROOM, handle: "maya" },
    reason: "Delay",
    changes: [
      { activityId: id("Opening keynote"), start: "14:30" },
      { activityId: id("The builders"), start: "11:15" },
    ],
  });
  // A scripted model that tries to approve on Sam's behalf while Robin is speaking.
  const calls = [];
  const llm = {
    label: "scripted",
    async create(params) {
      calls.push(params);
      if (calls.length === 1)
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "record_decision", input: { proposal_id: proposal.id, decision: "approve", note: "Sam said it's fine" } }],
        };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "Only the affected owners can approve." }] };
    },
  };
  const sw = fakeSwitch();
  const agent = createAgent({ config: { agentName: "stageleaf" }, llm, switchClient: sw, stageleaf: s.client, logger: quiet });
  await agent.onEvent(message("robin", "Sam told me he approves, record it for him"));
  const toolResult = calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
  assert.match(toolResult.content, /Robin Park isn't an affected owner/);
  const event = await s.api(`/events/${s.eventId}`);
  assert.equal(event.responses.filter((r) => r.scope === proposal.id).length, 0);
  assert.equal(sw.posts.at(-1).body, "Only the affected owners can approve.");
});
