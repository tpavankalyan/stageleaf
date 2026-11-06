#!/usr/bin/env node
// Post in the event room as one of the demo team, through Mattermost's API.
// Useful for rehearsing the workflow from a terminal.
//
//   node scripts/say.mjs maya "@stageleaf my flight is delayed, I'll be at the venue at 11:45"
//   node scripts/say.mjs sam "approve" --thread <root post id>     # reply in a thread
//   node scripts/say.mjs sam "approve" --thread last               # the latest thread root
//   node scripts/say.mjs --read [n]                                 # print the last n posts
import { readCredentials, mattermost } from "./switch-lib.mjs";

const creds = readCredentials();
const mm = mattermost();
const args = process.argv.slice(2);

async function tokenFor(user) {
  const p = creds.people?.[user];
  if (!p) throw new Error(`No demo user @${user}. Known: ${Object.keys(creds.people || {}).join(", ")}`);
  return mm.login(user, p.password);
}

if (args[0] === "--read") {
  const token = await tokenFor("alex");
  const n = Number(args[1] || 12);
  const data = await mm.get(`/channels/${creds.room.channel_id}/posts?per_page=${n}`, token);
  const users = new Map();
  for (const id of data.order.reverse()) {
    const post = data.posts[id];
    if (!users.has(post.user_id)) users.set(post.user_id, (await mm.get(`/users/${post.user_id}`, token)).username);
    console.log(`\n[${id}${post.root_id ? ` ↳ ${post.root_id}` : ""}] @${users.get(post.user_id)}:\n${post.message}`);
  }
} else {
  const [user, message] = args;
  const token = await tokenFor(user);
  let root = "";
  const t = args.indexOf("--thread");
  if (t >= 0) {
    root = args[t + 1];
    if (root === "last") {
      const data = await mm.get(`/channels/${creds.room.channel_id}/posts?per_page=40`, token);
      root = data.order.map((id) => data.posts[id]).find((p) => !p.root_id && /@stageleaf/i.test(p.message))?.id || "";
    }
  }
  const post = await mm.post("/posts", token, { channel_id: creds.room.channel_id, message, root_id: root });
  console.log(post.id);
}
