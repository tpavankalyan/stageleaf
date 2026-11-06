import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";

async function server() {
  const service = createApp({ dbPath: ":memory:", secureCookies: false });
  const listener = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  return {
    url: "http://127.0.0.1:" + listener.address().port,
    close: async () => {
      await new Promise((r) => listener.close(r));
      service.close();
    },
  };
}
function planner(base) {
  let cookie = "";
  return async (path, body, method = body ? "POST" : "GET", expected = 200) => {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.headers.get("set-cookie")) cookie = res.headers.get("set-cookie").split(";")[0];
    const data = await res.json();
    assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
}
function agent(base, token) {
  return async (path, body, expected = 200, method = body ? "POST" : "GET") => {
    const res = await fetch(base + "/api/agent" + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
}
const ROOM = "room-fieldwork";
const said = (handle, extra = {}) => ({
  evidence: { roomId: ROOM, handle, messageId: "m-" + handle, senderName: handle, ...extra },
});

test("chat-driven change: verified reports, owner-only decisions, planner-only publish, acknowledgments", async (t) => {
  const s = await server();
  t.after(s.close);
  const p = planner(s.url);
  await p("/auth/register", { name: "Alex Morgan", email: "alex@example.com", password: "secure-test-password" }, "POST", 201);
  await p("/account", { chatHandle: "@Alex" }, "PATCH");
  const event = await p("/events", { sample: true }, "POST", 201);
  const published = await p(`/events/${event.id}`, { expectedVersion: event.version, operation: "publish" }, "PATCH");
  assert.equal(published.publications.length, 1);

  const { token } = await p("/agent-tokens", { label: "Switch agent" }, "POST", 201);
  assert.match(token, /^sla_/);
  const a = agent(s.url, token);
  await agent(s.url, "sla_not-a-real-token-at-all-000000")("/me", undefined, 401);

  // Not linked yet: chat actions are refused.
  await a(`/rooms/${ROOM}`, undefined, 404);
  await a(`/events/${event.id}/proposals`, { ...said("maya"), changes: [], reason: "x" }, 409);

  const linked = await a(`/events/${event.id}/link-room`, { roomId: ROOM, roomName: "fieldwork-forum-ops", url: "http://mm/x" });
  assert.deepEqual(linked.chat.plannerHandles, ["alex"]);
  const ctx = await a(`/rooms/${ROOM}`);
  assert.equal(ctx.name, "Fieldwork Forum");
  const byTitle = (title) => ctx.runOfShow.find((x) => x.title.startsWith(title));
  const keynote = byTitle("Opening keynote"), panel = byTitle("The builders"), workshop = byTitle("Hands-on");
  const maya = ctx.contacts.find((c) => c.handle === "maya");

  // A report from another room is rejected.
  await a(`/events/${event.id}/availability`, { evidence: { roomId: "elsewhere", handle: "maya" }, contactId: maya.id, arrival: "11:45" }, 403);
  const afterReport = await a(`/events/${event.id}/availability`, { ...said("maya"), contactId: maya.id, arrival: "11:45", note: "Flight delayed." });
  assert.ok(afterReport.conflicts.some((x) => x.includes("Maya Ellis’s recorded availability")));

  // Deterministic checks expose the infeasible option and accept the swap.
  const ids = Object.fromEntries(afterReport.runOfShow.map((x) => [x.title, x.id]));
  const push = await a(`/events/${event.id}/preview`, {
    changes: [
      { activityId: keynote.id, start: "13:00", duration: null },
      { activityId: workshop.id, start: "13:45", duration: null },
      { activityId: panel.id, start: "15:15", duration: null },
      { activityId: ids["Closing remarks"], start: "16:00", duration: null },
      { activityId: ids["Breakdown"], start: "16:15", duration: null },
    ],
  });
  assert.equal(push.feasible, false);
  assert.ok(push.issues.some((x) => x.includes("Sam Rivera")));
  await a(`/events/${event.id}/preview`, { changes: [{ activityId: ids["Lunch"], start: "12:30" }] }, 400);
  const swap = await a(`/events/${event.id}/preview`, {
    changes: [
      { activityId: keynote.id, start: "14:30" },
      { activityId: panel.id, start: "11:15" },
    ],
  });
  assert.equal(swap.feasible, true);
  assert.deepEqual(swap.approvalsNeeded.map((x) => x.handle).sort(), ["jamie", "maya", "sam"]);

  const proposal = await a(`/events/${event.id}/proposals`, {
    ...said("maya"),
    title: "Swap the keynote and the builders’ panel",
    reason: "Maya’s flight is delayed; she reaches the venue at 11:45.",
    changes: [
      { activityId: keynote.id, start: "14:30" },
      { activityId: panel.id, start: "11:15" },
    ],
  }, 201);
  assert.equal(proposal.source.channel, "switch");
  assert.equal(proposal.source.reportedBy.handle, "maya");
  const decide = (handle, answer, expected = 200, note = "") =>
    a(`/events/${event.id}/proposals/${proposal.id}/decision`, { ...said(handle), answer, note }, expected);

  await decide("robin", "Approved", 403); // not an affected owner
  await decide("stranger", "Approved", 403); // not a contact
  await decide("sam", "Declined", 400); // a decline needs a reason
  await decide("sam", "Approved");
  await decide("jamie", "Approved");
  // Publishing before every owner approved fails, and only the planner may publish.
  await a(`/events/${event.id}/publish`, { ...said("alex"), changeId: proposal.id }, 400);
  const last = await decide("maya", "Approved");
  assert.equal(last.allApproved, true);
  await a(`/events/${event.id}/publish`, { ...said("jamie"), changeId: proposal.id }, 403);
  const pub = await a(`/events/${event.id}/publish`, { ...said("alex"), changeId: proposal.id });
  assert.equal(pub.version, 2);
  assert.match(pub.runOfShowMarkdown, /run of show v2/);
  const samChanges = pub.changesByPerson.find((x) => x.handle === "sam");
  assert.equal(samChanges.items.length, 2);
  assert.equal(pub.context.conflicts.length, 0);

  // Acknowledgments are recorded against v2 for verified contacts only.
  await a(`/events/${event.id}/acknowledge`, { ...said("stranger"), answer: "Acknowledged" }, 403);
  const ack = await a(`/events/${event.id}/acknowledge`, { ...said("sam"), answer: "Acknowledged", note: "Mics swapped." });
  assert.ok(!ack.pending.includes("Sam Rivera"));
  assert.ok(ack.pending.includes("Jamie Chen"));

  // The planner's own view carries the chat provenance.
  const full = await p(`/events/${event.id}`);
  const samAck = full.responses.find((r) => r.scope === "brief" && r.version === 2);
  assert.equal(samAck.channel, "switch");
  assert.equal(JSON.parse(samAck.evidence).handle, "sam");
  assert.ok(full.history.some((h) => h.text.includes("Maya Ellis approved")));

  // Agent status is visible to the planner; revoking the token cuts access.
  await a("/heartbeat", { agent: "stageleaf", rooms: [{ id: ROOM, name: "fieldwork-forum-ops" }], model: "test" });
  const tokens = await p("/agent-tokens");
  assert.equal(tokens[0].online, true);
  await p(`/agent-tokens/${tokens[0].id}`, {}, "DELETE");
  await a("/me", undefined, 401);
});

test("agent tokens are scoped to their planner's events", async (t) => {
  const s = await server();
  t.after(s.close);
  const one = planner(s.url), two = planner(s.url);
  await one("/auth/register", { name: "One", email: "one@example.com", password: "secure-test-password" }, "POST", 201);
  await two("/auth/register", { name: "Two", email: "two@example.com", password: "secure-test-password" }, "POST", 201);
  const theirs = await two("/events", { sample: true }, "POST", 201);
  const { token } = await one("/agent-tokens", { label: "mine" }, "POST", 201);
  const a = agent(s.url, token);
  assert.deepEqual((await a("/me")).events, []);
  await a(`/events/${theirs.id}/context`, undefined, 404);
  await a(`/events/${theirs.id}/link-room`, { roomId: "r" }, 404);
});
