#!/usr/bin/env node
// Play the delayed-keynote scenario in the event room as the demo team, waiting
// for the agent's real reply after each step. The agent and Stageleaf do the work;
// this script only types the people's messages.
//
//   node scripts/rehearse.mjs              # whole scenario
//   node scripts/rehearse.mjs --until approvals
//   STEP_PAUSE_MS=4000 node scripts/rehearse.mjs   # slower, for screen recording
import { readCredentials, mattermost, sleep } from "./switch-lib.mjs";

const creds = readCredentials();
const mm = mattermost();
const pause = Number(process.env.STEP_PAUSE_MS || 1500);
const until = process.argv.includes("--until") ? process.argv[process.argv.indexOf("--until") + 1] : null;

export const SCRIPT = [
  { phase: "report", who: "maya", top: true, text: "@stageleaf Heads up: my flight into SFO is running late. I won't get to the venue until about 11:45, so I can't do the 11:15 keynote slot." },
  { phase: "approvals", who: "sam", text: "Approve. AV is fine with the swap, the mic setup is the same for both sessions." },
  { phase: "approvals", who: "jamie", text: "Approved. I checked with the panelists and all four are already here and can do 11:15." },
  { phase: "approvals", who: "maya", text: "Approve, thank you! 14:30 works for me." },
  { phase: "publish", who: "alex", text: "Looks good. Publish it." },
  { phase: "acks", who: "sam", text: "ack, mic plan updated" },
  { phase: "acks", who: "jamie", text: "Got it 👍" },
  { phase: "acks", who: "maya", text: "ack" },
];

const tokens = {};
const tokenFor = async (u) => (tokens[u] ||= await mm.login(u, creds.people[u].password));
let agentUserId;

async function waitForAgent(root, since, timeoutMs = 120000) {
  const token = await tokenFor("alex");
  agentUserId ||= (await mm.get("/users/username/stageleaf", token)).id;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const thread = await mm.get(`/posts/${root}/thread`, token);
    const replies = Object.values(thread.posts)
      .filter((p) => p.user_id === agentUserId && p.create_at > since)
      .sort((a, b) => a.create_at - b.create_at);
    if (replies.length) {
      await sleep(1500); // let a second message (e.g. an announcement) land
      return replies;
    }
    await sleep(1000);
  }
  throw new Error("The agent did not reply within two minutes.");
}

let root = null;
for (const step of SCRIPT) {
  if (until && SCRIPT.findIndex((s) => s.phase === until) < SCRIPT.indexOf(step) && step.phase !== until) break;
  const token = await tokenFor(step.who);
  const post = await mm.post("/posts", token, {
    channel_id: creds.room.channel_id,
    message: step.text,
    root_id: step.top ? "" : root,
  });
  if (step.top) root = post.id;
  console.log(`\n@${step.who}: ${step.text}`);
  const replies = await waitForAgent(root, post.create_at);
  for (const r of replies) console.log(`\n  @stageleaf: ${r.message.replace(/\n/g, "\n  ")}`);
  await sleep(pause);
}
console.log(`\nThread root: ${root}`);
