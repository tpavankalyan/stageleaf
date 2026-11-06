#!/usr/bin/env node
// Register the Stageleaf agent with a local Switch server, create the event team's
// Mattermost accounts, and open the event's Switch room with the agent in it.
//
//   npm run switch:setup                 # idempotent: reuses what already exists
//   npm run switch:setup -- --new-key    # re-register the agent and issue a new API key
//
// Reads secrets from switch/.env (written by ./switch/up.sh) and stores the agent
// credentials and demo sign-ins in switch/credentials.json (mode 600, git-ignored).
import { randomBytes } from "node:crypto";
import {
  readEnv,
  readCredentials,
  writeCredentials,
  switchApi,
  mattermost,
  sleep,
  CREDENTIALS,
} from "./switch-lib.mjs";

// The people in the event team's chat. Handles match the contacts in Stageleaf's
// sample event, which is how Stageleaf verifies who approved or acknowledged.
export const TEAM = [
  { username: "alex", first: "Alex", last: "Morgan", role: "Lead planner" },
  { username: "jamie", first: "Jamie", last: "Chen", role: "Program lead" },
  { username: "sam", first: "Sam", last: "Rivera", role: "Venue & AV (Assembly AV)" },
  { username: "avery", first: "Avery", last: "Brooks", role: "Catering (Table & Co.)" },
  { username: "robin", first: "Robin", last: "Park", role: "Guest experience" },
  { username: "maya", first: "Maya", last: "Ellis", role: "Keynote speaker" },
];

export const ROOM = {
  name: process.env.STAGELEAF_ROOM || "fieldwork-forum-ops",
  description: "Event operations for Fieldwork Forum: changes, decisions and published briefs.",
  instructions: [
    "This is the operations room for the Fieldwork Forum event team.",
    "Stageleaf (the event workspace) is the source of truth for the run of show, owners, vendor commitments and published briefs. The @stageleaf agent reads and updates it.",
    "Report a change by mentioning @stageleaf at the top level. Each change is discussed in its own thread.",
    "Decisions on a proposed change come from the people Stageleaf names as affected owners, replying in that thread. Stageleaf records who answered from the chat account they used.",
    "Only the lead planner publishes a revision. Nobody, human or agent, approves or acknowledges on someone else's behalf.",
    "The latest published run of show is kept as the room document 'run-of-show'.",
  ].join("\n"),
};

const AGENT = {
  name: "stageleaf",
  display_name: "Stageleaf",
  description:
    "Event operations agent for Stageleaf: checks reported changes against the live run of show, proposes revisions, collects approvals from affected owners and publishes updated briefs.",
  connector_type: "custom",
  integration_profile: {
    connection_model: "always_on",
    message_exchange: true,
    pre_invocation_mediation: [],
    post_invocation_mediation: [],
    event_reporting: [],
  },
};

async function gatewayOpenAddressing(base, env, agentId) {
  const login = await fetch(`${base}/gateway/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.GATEWAY_ADMIN_EMAIL,
      password: env.GATEWAY_ADMIN_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error(`Gateway sign-in failed: ${login.status}`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const res = await fetch(`${base}/gateway/agents/${agentId}/addressing-policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ policy: null }),
  });
  if (!res.ok)
    throw new Error(`Opening the agent's addressing failed: ${res.status} ${await res.text()}`);
}

export async function setupSwitch({
  newKey = false,
  roomName = process.env.STAGELEAF_ROOM || ROOM.name,
  freshRoom = false,
} = {}) {
  const env = readEnv();
  const creds = readCredentials();
  const sw = switchApi();
  const mm = mattermost();

  // 1. The agent.
  if (!creds.agent || newKey) {
    const registered = await sw.register(env.AGENT_REGISTRATION_TOKEN, {
      ...AGENT,
      overwrite: true,
    });
    creds.agent = { id: registered.id, api_key: registered.api_key, name: AGENT.name };
    writeCredentials(creds);
    console.log(`Registered agent @${AGENT.name} (${registered.id}).`);
  } else console.log(`Agent @${AGENT.name} already registered (${creds.agent.id}).`);
  const agent = creds.agent;

  // A newly registered agent answers only its owner. Everyone in the event room
  // must be able to report changes and give decisions, so the server admin opens
  // the agent's addressing policy through the Gateway (an agent can't change its
  // own settings).
  await gatewayOpenAddressing(sw.base, env, agent.id);
  console.log("Agent answers anyone in its rooms.");

  // 2. People.
  const admin = await mm.login(env.MATTERMOST_ADMIN_USER, env.MATTERMOST_ADMIN_PASSWORD);
  const team = await mm.get(`/teams/name/${env.MATTERMOST_TEAM_NAME}`, admin);
  creds.people ||= {};
  for (const person of TEAM) {
    let user = await mm.tryGet(`/users/username/${person.username}`, admin);
    if (person.username === env.MATTERMOST_USER) {
      creds.people[person.username] = {
        password: env.MATTERMOST_USER_PASSWORD,
        note: "Seeded by Switch; linked to the Switch admin (the agent's owner).",
      };
    }
    if (!user) {
      const password = creds.people[person.username]?.password || `Sl-${randomBytes(9).toString("base64url")}`;
      user = await mm.post("/users", admin, {
        username: person.username,
        email: `${person.username}@fieldwork.example`,
        password,
        first_name: person.first,
        last_name: person.last,
      });
      creds.people[person.username] = { password };
      console.log(`Created Mattermost user @${person.username}.`);
    }
    await mm.put(`/users/${user.id}/patch`, admin, {
      first_name: person.first,
      last_name: person.last,
      position: person.role,
    });
    await mm.post(`/teams/${team.id}/members`, admin, { team_id: team.id, user_id: user.id });
    creds.people[person.username] = { ...creds.people[person.username], id: user.id, name: `${person.first} ${person.last}`, role: person.role };
  }
  writeCredentials(creds);

  // 3. The room.
  if (freshRoom || (creds.room && creds.room.name !== roomName)) delete creds.room;
  if (!creds.room) {
    const bridges = await sw.op(agent, "list_bridges", {});
    const list = Array.isArray(bridges) ? bridges : bridges.bridges || [];
    const bridge = list.find((b) => b.type === "mattermost");
    if (!bridge) throw new Error("No Mattermost bridge is registered on this Switch server.");
    const created = await sw.op(agent, "create_room", {
      name: roomName,
      description: ROOM.description,
      instructions: ROOM.instructions,
      agent_names: [AGENT.name],
      user_names: TEAM.map((p) => p.username),
      bridge_id: bridge.id,
      channel_type: "channel_public",
    });
    let channel = null;
    for (let i = 0; i < 30 && !channel; i++) {
      channel = await mm.tryGet(`/teams/${team.id}/channels/name/${roomName}`, admin);
      if (!channel) await sleep(1000);
    }
    if (!channel) throw new Error(`Switch created room ${created.id}, but no Mattermost channel appeared.`);
    creds.room = {
      id: created.id,
      name: roomName,
      channel_id: channel.id,
      team: env.MATTERMOST_TEAM_NAME,
      url: `${process.env.MATTERMOST_PUBLIC_URL || "http://localhost:8065"}/${env.MATTERMOST_TEAM_NAME}/channels/${roomName}`,
    };
    writeCredentials(creds);
    console.log(`Created Switch room ${roomName} (${created.id}).`);
  } else console.log(`Room ${creds.room.name} already exists (${creds.room.id}).`);

  creds.room.url ||= `${process.env.MATTERMOST_PUBLIC_URL || "http://localhost:8065"}/${creds.room.team}/channels/${creds.room.name}`;
  writeCredentials(creds);
  for (const person of TEAM) {
    const id = creds.people[person.username].id;
    await mm.post(`/channels/${creds.room.channel_id}/members`, admin, { user_id: id }).catch(() => {});
  }

  return creds;
}

if (import.meta.url === `file://${process.argv[1]}`)
  setupSwitch({ newKey: process.argv.includes("--new-key"), freshRoom: process.argv.includes("--fresh-room") })
    .then((creds) => {
      console.log(`\nOpen ${creds.room.url}`);
      console.log(`Sign-in details for the demo team are in ${CREDENTIALS}.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
