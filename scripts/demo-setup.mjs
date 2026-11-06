#!/usr/bin/env node
// One command from a running Switch + Stageleaf to a working event room:
//   1. Switch: register the @stageleaf agent, create the team's Mattermost
//      accounts, and open the event room (scripts/switch-setup.mjs).
//   2. Stageleaf: create the lead planner's account, the clearly labelled sample
//      event, and its published v1 brief; issue an agent token; link the room.
//
//   ./switch/up.sh && npm start      # in one terminal
//   npm run demo:setup               # in another; then: npm run agent
//
//   --fresh   start a new sample event in a new room (for a clean run-through)
// Credentials go to switch/credentials.json (mode 600, git-ignored).
import { randomBytes } from "node:crypto";
import { setupSwitch } from "./switch-setup.mjs";
import { readCredentials, writeCredentials, sleep, CREDENTIALS } from "./switch-lib.mjs";

const STAGELEAF = process.env.STAGELEAF_URL || "http://127.0.0.1:4317";
const fresh = process.argv.includes("--fresh");

function session(base) {
  let cookie = "";
  return async (path, body, method = body ? "POST" : "GET") => {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${data.error || res.status}`), { status: res.status });
    return data;
  };
}
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const today = (tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function main() {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${STAGELEAF}/api/health`);
      if (r.ok) break;
    } catch {}
    if (i === 30) throw new Error(`Stageleaf is not answering at ${STAGELEAF}. Start it with \`npm start\`.`);
    await sleep(1000);
  }

  let creds = await setupSwitch({
    freshRoom: fresh,
    roomName: fresh ? `fieldwork-forum-ops-${Date.now().toString(36).slice(-4)}` : undefined,
  });

  // The lead planner's Stageleaf account.
  creds.stageleaf ||= {};
  const s = creds.stageleaf;
  s.url = STAGELEAF;
  s.email ||= "alex@fieldwork.example";
  s.password ||= `Sl-${randomBytes(12).toString("base64url")}`;
  const api = session(STAGELEAF);
  try {
    await api("/auth/register", { name: "Alex Morgan", email: s.email, password: s.password });
    console.log(`Created the Stageleaf account ${s.email}.`);
  } catch (error) {
    if (error.status !== 409) throw error;
    await api("/auth/login", { email: s.email, password: s.password });
  }
  await api("/account", { chatHandle: "alex" }, "PATCH");

  // The sample event, dated today in its own time zone, with v1 published.
  const events = await api("/events");
  let event = !fresh && events.find((e) => e.chat?.roomId === creds.room.id && e.status !== "Archived");
  if (!event) {
    event = await api("/events", { sample: true });
    event = await api(
      `/events/${event.id}`,
      {
        expectedVersion: event.version,
        operation: "settings",
        payload: {
          name: event.name,
          date: today(event.timezone),
          timezone: event.timezone,
          venue: event.venue,
          start: hhmm(event.start),
          end: hhmm(event.end),
          guests: event.guests,
          status: "Live",
          notes: event.notes,
        },
      },
      "PATCH",
    );
    event = await api(`/events/${event.id}`, { expectedVersion: event.version, operation: "publish" }, "PATCH");
    console.log(`Created the sample event “${event.name}” for ${event.date} and published brief v1.`);
  } else console.log(`Using the existing event “${event.name}”.`);
  s.eventId = event.id;

  // An agent token, checked before reuse.
  let valid = false;
  if (s.agentToken) {
    const r = await fetch(`${STAGELEAF}/api/agent/me`, { headers: { Authorization: `Bearer ${s.agentToken}` } });
    valid = r.ok;
  }
  if (!valid) {
    s.agentToken = (await api("/agent-tokens", { label: "Switch agent (@stageleaf)" })).token;
    console.log("Issued a Stageleaf agent token.");
  }
  creds = { ...readCredentials(), ...creds, stageleaf: s };
  writeCredentials(creds);

  // Link the Switch room to the event.
  const link = await fetch(`${STAGELEAF}/api/agent/events/${event.id}/link-room`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.agentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: creds.room.id, roomName: creds.room.name, url: creds.room.url }),
  });
  if (!link.ok) throw new Error(`Linking the room failed: ${(await link.json()).error}`);
  console.log(`Linked #${creds.room.name} to “${event.name}”.`);

  console.log(`
Ready.
  Stageleaf   ${STAGELEAF}   sign in as ${s.email}
  Mattermost  ${creds.room.url}
              people: ${Object.keys(creds.people).map((u) => "@" + u).join(", ")}
  Passwords are in ${CREDENTIALS}.
Next: npm run agent`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
