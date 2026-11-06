#!/usr/bin/env node
// The Stageleaf agent: a Switch agent-protocol client that works in the event
// team's chat room on the planner's behalf.
//
//   npm run agent
//
// Configuration (environment, or switch/credentials.json written by `npm run demo:setup`):
//   SWITCH_API_URL         Switch agent bridge (default http://127.0.0.1:8000)
//   SWITCH_AGENT_ID / SWITCH_AGENT_KEY   the registered agent's id and API key
//   STAGELEAF_URL          Stageleaf (default http://127.0.0.1:4317)
//   STAGELEAF_AGENT_TOKEN  agent token issued from Stageleaf → Team chat
//   STAGELEAF_LLM          auto | bedrock | bedrock-mantle | anthropic | rules
//   STAGELEAF_MODEL        default claude-opus-5-5;  STAGELEAF_EFFORT default medium
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SwitchClient } from "./switch-client.mjs";
import { StageleafClient } from "./stageleaf-client.mjs";
import { resolveLLM } from "./llm.mjs";
import { think } from "./brain.mjs";
import { rules } from "./rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (...a) => console.log(`[${stamp()}]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] ⚠`, ...a),
  error: (...a) => console.error(`[${stamp()}] ✗`, ...a),
};

export function loadConfig(env = process.env) {
  const credsPath = resolve(ROOT, "switch/credentials.json");
  const creds = existsSync(credsPath) ? JSON.parse(readFileSync(credsPath, "utf8")) : {};
  return {
    switchUrl: env.SWITCH_API_URL || "http://127.0.0.1:8000",
    agentId: env.SWITCH_AGENT_ID || creds.agent?.id,
    apiKey: env.SWITCH_AGENT_KEY || creds.agent?.api_key,
    agentName: env.SWITCH_AGENT_NAME || creds.agent?.name || "stageleaf",
    stageleafUrl: env.STAGELEAF_URL || creds.stageleaf?.url || "http://127.0.0.1:4317",
    stageleafToken: env.STAGELEAF_AGENT_TOKEN || creds.stageleaf?.agentToken,
    statePath: resolve(ROOT, "switch/agent-state.json"),
  };
}

function transcript(context, threadId, currentId) {
  const threads = context?.threads || [];
  const t = threads.find(
    (x) => x.root?.id === threadId || x.replies?.some((r) => r.id === threadId),
  );
  if (!t) return "";
  return [t.root, ...(t.replies || [])]
    .filter((m) => m && m.id !== currentId && m.kind !== "room_join")
    .map((m) => `@${m.sender_name}: ${(m.body || "").replace(/\s+$/g, "")}`)
    .join("\n")
    .slice(-8000);
}

export function createAgent({ config, llm, switchClient, stageleaf, logger = log }) {
  let queue = Promise.resolve();
  const roomNames = new Map();

  async function handle(evt) {
    const p = evt.payload;
    const started = Date.now();
    const roomId = evt.room_id;
    const threadId = p.thread_id || p.message_id;
    const room = await switchClient.op("connect_to_room", {
      room_id: roomId,
      include_general_instructions: false,
    });
    roomNames.set(roomId, room.name);
    let event = null,
      events = null;
    try {
      event = await stageleaf.eventForRoom(roomId);
    } catch (error) {
      if (error.status !== 404) throw error;
      events = (await stageleaf.me()).events
        .filter((e) => e.status !== "Archived")
        .map(({ id, name, date, venue }) => ({ id, name, date, venue }));
    }
    const context = await switchClient.op("read_context", { limit: 80 }).catch(() => null);
    const handle = String(p.sender_name || "").toLowerCase();
    const contact = event?.contacts.find((c) => c.handle === handle) || null;
    const turn = {
      room: {
        id: roomId,
        name: room.name,
        instructions: String(room.instructions || "").replace(/^## Room-specific instructions\s*/m, "").trim(),
        people: (room.participants || []).filter((x) => x.type === "user").map((x) => "@" + x.name),
      },
      sender: { handle, contact, isPlanner: !!event?.chat?.plannerHandles?.includes(handle) },
      message: String(p.body || ""),
      thread: transcript(context, threadId, p.message_id),
      event,
      events,
      evidence: {
        roomId,
        roomName: room.name,
        handle,
        messageId: p.message_id,
        threadId,
        senderId: p.sender,
        senderName: p.sender_name,
      },
    };
    const actions = {
      stageleaf,
      log: logger,
      announce: (body) => switchClient.op("post_message", { body }),
      async afterPublish(result) {
        const content = result.runOfShowMarkdown;
        const description = `Run of show v${result.version}, as published in Stageleaf`;
        const documentId = result.context?.chat?.documentId;
        if (documentId) {
          try {
            await switchClient.op("update_room_document", { document_id: documentId, description, content });
            return;
          } catch (error) {
            logger.warn(`Could not update the room document (${error.message}); creating a new one.`);
          }
        }
        let created;
        for (const name of ["run-of-show", `run-of-show-v${result.version}`]) {
          try {
            created = await switchClient.op("create_room_document", {
              name,
              description,
              instructions:
                "The latest published run of show for this event, copied from Stageleaf after each publish. Stageleaf is the source of truth.",
              content,
            });
            break;
          } catch (error) {
            logger.warn(`create_room_document ${name}: ${error.message}`);
          }
        }
        if (created?.document_id) await stageleaf.setDocument(result.context.id, created.document_id);
      },
    };
    const outcome = llm
      ? await think({ llm, turn, actions, log: logger })
      : await rules({ turn, actions });
    if (outcome.reply)
      await switchClient.op("post_message", { body: outcome.reply, thread_id: threadId });
    switchClient.markHandled(p.message_id, evt.eventId);
    logger.info(
      `#${room.name} @${handle}: “${turn.message.slice(0, 70)}” → ${outcome.used.length ? outcome.used.join(", ") : "no tools"} → ${outcome.reply ? "replied" : "no reply"} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  function onEvent(evt) {
    if (evt.type !== "message") return;
    const p = evt.payload || {};
    if (!p.addressed) return;
    if (p.sender_name === config.agentName || p.sender_kind === "platform") return;
    if (switchClient.wasHandled(p.message_id)) return;
    queue = queue
      .then(() => handle(evt))
      .catch(async (error) => {
        logger.error(`Could not handle ${p.message_id}: ${error.stack || error.message}`);
        switchClient.markHandled(p.message_id, evt.eventId);
        try {
          await switchClient.op("post_message", {
            body: `Sorry, I couldn't process that: ${String(error.message).slice(0, 200)}`,
            thread_id: p.thread_id || p.message_id,
          });
        } catch {}
      });
    return queue;
  }

  async function heartbeat() {
    try {
      await stageleaf.heartbeat({
        agent: config.agentName,
        rooms: switchClient.rooms.map((id) => ({ id, name: roomNames.get(id) || "" })),
        model: llm ? llm.label : "rules mode (no model)",
      });
    } catch (error) {
      logger.warn(`Stageleaf heartbeat failed: ${error.message}`);
    }
  }
  return { onEvent, heartbeat, idle: () => queue };
}

async function main() {
  const config = loadConfig();
  const missing = [
    ["SWITCH_AGENT_ID", config.agentId],
    ["SWITCH_AGENT_KEY", config.apiKey],
    ["STAGELEAF_AGENT_TOKEN", config.stageleafToken],
  ].filter(([, v]) => !v);
  if (missing.length) {
    log.error(
      `Missing ${missing.map(([k]) => k).join(", ")}. Run \`npm run demo:setup\`, or set them in the environment.`,
    );
    process.exit(1);
  }
  const stageleaf = new StageleafClient({ baseUrl: config.stageleafUrl, token: config.stageleafToken });
  const me = await stageleaf.me();
  log.info(`Acting for ${me.owner.name} in Stageleaf (${me.events.length} event${me.events.length === 1 ? "" : "s"}).`);
  const llm = resolveLLM(process.env, log);
  log.info(llm ? `Reasoning with ${llm.label}, effort ${llm.effort}.` : "No model configured: running in rules mode (explicit commands only).");
  const switchClient = new SwitchClient({
    baseUrl: config.switchUrl,
    agentId: config.agentId,
    apiKey: config.apiKey,
    statePath: config.statePath,
    log,
  });
  const agent = createAgent({ config, llm, switchClient, stageleaf });
  await agent.heartbeat();
  const timer = setInterval(agent.heartbeat, 15000);
  const stop = () => {
    log.info("Stopping.");
    switchClient.stop();
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await switchClient.run((evt) => {
    agent.onEvent(evt);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  log.error(error.stack || error.message);
  process.exit(1);
});
