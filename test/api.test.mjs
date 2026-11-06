import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { time } from "../server/domain.mjs";
import { parseCSV } from "../src/lib.js";
const settings = {
  name: "Real workshop",
  date: "2026-11-20",
  timezone: "America/Los_Angeles",
  start: "09:00",
  end: "18:00",
  guests: 80,
  venue: "Workshop studio",
  status: "Planning",
  notes: "Private planner note",
};
async function server(dbPath = ":memory:") {
  const service = createApp({ dbPath, secureCookies: false });
  const listener = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  const url = "http://127.0.0.1:" + listener.address().port;
  return {
    url,
    close: async () => {
      await new Promise((r) => listener.close(r));
      service.close();
    },
  };
}
function client(base) {
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
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return data;
  };
}
async function register(c, email = "planner@example.com") {
  return c(
    "/auth/register",
    { name: "Test Planner", email, password: "secure-test-password" },
    "POST",
    201,
  );
}
test("full workflow: isolated workspace, safe publication, real scoped responses and approved changes", async (t) => {
  const s = await server();
  t.after(s.close);
  const c = client(s.url),
    other = client(s.url),
    recipient = client(s.url);
  await c("/events", undefined, "GET", 401);
  await register(c);
  await register(other, "other@example.com");
  assert.equal((await c("/auth/me")).user.name, "Test Planner");
  let e = await c("/events", settings, "POST", 201);
  const key = "/events/" + e.id;
  const edit = async (op, p = {}, status = 200) => {
    const result = await c(
      key,
      { expectedVersion: e.version, operation: op, payload: p },
      "PATCH",
      status,
    );
    if (status === 200) e = result;
    return result;
  };
  await other(key, undefined, "GET", 404);
  assert.equal((await other("/events")).length, 0);
  await edit("publish", {}, 400);
  await edit("contact", {
    name: "Vendor One",
    type: "Vendor",
    role: "AV lead",
    notes: "Bring HDMI adapters",
    arrival: "09:00",
    departure: "17:00",
  });
  const vendor = e.contacts[0].id;
  await edit("contact", {
    name: "Speaker Two",
    type: "Speaker",
    email: "private@example.com",
    notes: "Other recipient private note",
  });
  const speaker = e.contacts[1].id;
  await edit("activity", {
    title: "Sound check",
    start: "10:00",
    duration: 30,
    location: "Main",
    ownerId: vendor,
    notes: "Check microphones",
  });
  const act = e.activities[0].id;
  await edit("activity", {
    title: "Private speaker prep",
    start: "12:00",
    duration: 30,
    location: "Green room",
    ownerId: speaker,
    notes: "Do not share with AV",
  });
  const old = e.version;
  await edit("task", {
    title: "Bring spare microphone",
    ownerId: vendor,
    activityId: act,
    status: "To do",
    due: "2026-11-19",
  });
  await c(
    key,
    { expectedVersion: old, operation: "deleteActivity", payload: { id: act } },
    "PATCH",
    409,
  );
  await edit("publish");
  assert.equal(e.publications.length, 1);
  const link = await c(key + "/share", { personId: vendor });
  assert.ok(Date.parse(link.expires) > Date.now() + 13 * 86400000);
  const sharedPath = "/shared/" + link.path.split("/").at(-1);
  let brief = await recipient(sharedPath);
  assert.equal(brief.activities.length, 1);
  assert.equal(brief.activities[0].title, "Sound check");
  assert.equal(brief.person.name, "Vendor One");
  assert.equal(JSON.stringify(brief).includes("private@example.com"), false);
  assert.equal(
    JSON.stringify(brief).includes("Other recipient private note"),
    false,
  );
  assert.equal(JSON.stringify(brief).includes("Private planner note"), false);
  await recipient(sharedPath + "/respond", {
    answer: "Acknowledged",
    note: "I have it",
  });
  e = await c(key);
  assert.equal(e.responses[0].answer, "Acknowledged");
  await edit("activity", {
    ...e.activities[0],
    start: "10:00",
    title: "Updated sound check",
  });
  brief = await recipient(sharedPath);
  assert.equal(
    brief.activities[0].title,
    "Sound check",
    "published snapshot must not leak working edits",
  );
  assert.equal(brief.stale, false);
  await edit("propose", {
    activityId: act,
    start: "10:15",
    duration: 30,
    ripple: false,
    reason: "AV delivery will arrive 15 minutes later",
    title: "Later sound check",
  });
  const change = e.changes[0];
  assert.equal(e.activities[0].start, 600, "proposal does not edit draft");
  await edit("applyChange", { id: change.id }, 400);
  await edit("publish", {}, 400);
  const decision = await c(key + "/share", {
    personId: vendor,
    changeId: change.id,
  });
  const decisionPath = "/shared/" + decision.path.split("/").at(-1);
  const proposal = await recipient(decisionPath);
  assert.equal(proposal.kind, "decision");
  assert.equal(proposal.activities[0].start, 615);
  await recipient(
    decisionPath + "/respond",
    { answer: "Declined", note: "" },
    "POST",
    400,
  );
  await recipient(decisionPath + "/respond", {
    answer: "Declined",
    note: "Need to check",
  });
  await edit("applyChange", { id: change.id }, 400);
  await recipient(decisionPath + "/respond", {
    answer: "Approved",
    note: "Confirmed with warehouse",
  });
  await edit("applyChange", { id: change.id });
  assert.equal(e.activities[0].start, 615);
  assert.equal((await recipient(decisionPath)).stale, true);
  await recipient(
    decisionPath + "/respond",
    { answer: "Approved" },
    "POST",
    409,
  );
  await edit("publish");
  brief = await recipient(sharedPath);
  assert.equal(brief.stale, true);
  await recipient(
    sharedPath + "/respond",
    { answer: "Acknowledged" },
    "POST",
    409,
  );
  const fresh = await c(key + "/share", { personId: vendor });
  assert.equal(
    (await recipient("/shared/" + fresh.path.split("/").at(-1))).activities[0]
      .start,
    615,
  );
  await c(key + "/revoke-links", {});
  await recipient(
    "/shared/" + fresh.path.split("/").at(-1),
    undefined,
    "GET",
    404,
  );
  const copy = await c(key + "/duplicate", {}, "POST", 201);
  assert.equal(copy.publications.length, 0);
  assert.equal(copy.changes.length, 0);
  assert.equal(copy.responses.length, 0);
  assert.equal(copy.tasks[0].status, "To do");
  assert.notEqual(copy.contacts[0].id, vendor);
  assert.equal(copy.activities[0].ownerId, copy.contacts[0].id);
  await edit("deleteContact", { id: vendor }, 400);
  await edit("deleteActivity", { id: act });
  assert.equal(e.tasks[0].activityId, "");
  await c("/auth/logout", {});
  await c(key, undefined, "GET", 401);
});
test("publication constraints, all-or-nothing imports, proposal staleness, fixed activities and origin validation", async (t) => {
  const s = await server();
  t.after(s.close);
  const c = client(s.url);
  await register(c);
  let e = await c("/events", settings, "POST", 201);
  const key = "/events/" + e.id;
  const edit = async (op, p = {}, status = 200) => {
    const result = await c(
      key,
      { expectedVersion: e.version, operation: op, payload: p },
      "PATCH",
      status,
    );
    if (status === 200) e = result;
    return result;
  };
  await edit(
    "import",
    {
      rows: [
        { title: "Good", start: "10:00", duration: 30 },
        { title: "Bad", start: "30:00", duration: 20 },
      ],
    },
    400,
  );
  assert.equal((await c(key)).activities.length, 0);
  await edit("activity", {
    title: "Opening",
    start: "10:00",
    duration: 60,
    location: "Main",
    fixed: true,
  });
  await edit("activity", {
    title: "Overlap",
    start: "10:30",
    duration: 60,
    location: "Main",
  });
  assert.ok(e.conflicts.length > 0);
  await edit("publish", {}, 400);
  await edit(
    "propose",
    {
      activityId: e.activities[0].id,
      start: "10:15",
      duration: 60,
      reason: "Fixed shift",
    },
    400,
  );
  await edit("activity", { ...e.activities[1], start: "11:00" });
  assert.equal(e.conflicts.length, 0);
  await edit("propose", {
    activityId: e.activities[1].id,
    start: "11:15",
    duration: 60,
    reason: "Later slot",
  });
  const change = e.changes[0];
  const proposalVersion = e.version;
  await edit("task", { title: "Another edit", status: "To do" });
  await edit("applyChange", { id: change.id }, 409);
  await c(
    key,
    { expectedVersion: proposalVersion, operation: "publish" },
    "PATCH",
    409,
  );
  await edit("cancelChange", { id: change.id });
  await edit("publish");
  const r = await fetch(s.url + "/api/auth/logout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  await edit("settings", { ...settings, date: "2026-02-30" }, 400);
  await edit("settings", { ...settings, timezone: "Invalid/Zone" }, 400);
});
test("SQLite persists users and edited records across process restarts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "stageleaf-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "app.sqlite");
  let s = await server(dbPath);
  const c = client(s.url);
  await register(c);
  const e = await c("/events", settings, "POST", 201);
  await s.close();
  s = await server(dbPath);
  t.after(s.close);
  const c2 = client(s.url);
  await c2("/auth/login", {
    email: "planner@example.com",
    password: "secure-test-password",
  });
  const restored = await c2("/events/" + e.id);
  assert.equal(restored.name, settings.name);
  assert.equal(restored.notes, settings.notes);
});
test("CSV quotes, multiline notes, comma titles and invalid columns", () => {
  const rows = parseCSV(
    'title,start,duration,notes\r\n"Hello, world",09:00,30,"Line one\nLine ""two"""',
  );
  assert.equal(rows[0].title, "Hello, world");
  assert.equal(rows[0].notes, 'Line one\nLine "two"');
  assert.throws(() => parseCSV("name,start,duration\nBad,10:00,30"), /columns/);
  assert.throws(
    () => parseCSV('title,start,duration\n"Bad,10:00,30'),
    /closed/,
  );
});

test("main and shared SPA routes serve from a checkout with hidden parent directories", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), ".stageleaf-web-"));
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><title>Stageleaf routing test</title>",
  );
  const service = createApp({
    dbPath: ":memory:",
    secureCookies: false,
    frontendDir: dir,
  });
  const listener = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  t.after(async () => {
    await new Promise((r) => listener.close(r));
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const route of ["/", "/share/example-token"]) {
    const response = await fetch(
      "http://127.0.0.1:" + listener.address().port + route,
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Stageleaf routing test/);
  }
});
