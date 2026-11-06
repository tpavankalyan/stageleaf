// The agent API: what a Switch-connected agent may read and do on a planner's
// behalf. Authenticated with a planner-issued agent token, scoped to that
// planner's events.
//
// Trust boundary: identity always comes from `evidence`, which the agent copies
// from the Switch event that triggered the action (sender handle, room, message).
// The language model never supplies it. Stageleaf then checks that the handle
// belongs to the right contact, that the room is the event's linked room, and
// that only the lead planner publishes.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  Problem,
  id,
  now,
  text,
  mutate,
  conflicts,
  handleField,
  buildProposal,
} from "./domain.mjs";
import {
  agentContext,
  proposalView,
  personChanges,
  runOfShowMarkdown,
  person,
  range,
} from "./views.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
export const newAgentToken = () => "sla_" + randomBytes(32).toString("base64url");
export const hashAgentToken = hash;
const ACTOR = { name: "Stageleaf agent (via Switch)" };

export function agentRouter({ db, readEvent, save, responsesFor }) {
  const r = express.Router();

  r.use((req, res, next) => {
    const raw = req
      .get("authorization")
      ?.match(/^Bearer\s+(sla_[A-Za-z0-9_-]{20,})$/)?.[1];
    if (!raw) return res.status(401).json({ error: "Use a Stageleaf agent token." });
    const t = db
      .prepare(
        "SELECT t.id,t.user_id,u.name AS owner_name,u.chat_handle AS owner_handle FROM agent_tokens t JOIN users u ON u.id=t.user_id WHERE t.hash=? AND t.revoked=0",
      )
      .get(hash(raw));
    if (!t)
      return res.status(401).json({ error: "This agent token is invalid or has been revoked." });
    req.token = t;
    req.owner = { id: t.user_id, name: t.owner_name, handle: t.owner_handle || "" };
    next();
  });

  const summary = (e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    venue: e.venue,
    status: e.status,
    chat: e.chat || null,
  });
  const ownEvents = (req) =>
    db
      .prepare("SELECT * FROM events WHERE owner=?")
      .all(req.owner.id)
      .map((row) => ({ row, e: JSON.parse(row.data) }));
  function load(req) {
    const row = readEvent(req.params.id);
    if (row.owner !== req.owner.id) throw new Problem("Event not found.", 404);
    return { row, e: JSON.parse(row.data) };
  }
  const context = (e) => agentContext(e, responsesFor(e), conflicts(e));
  const history = (e, line) => {
    e.history.unshift({ id: id(), at: now(), actor: ACTOR.name, text: line });
    e.updatedAt = now();
  };

  function evidenceOf(req, e) {
    const ev = req.body?.evidence;
    if (!ev || typeof ev !== "object")
      throw new Problem("This action needs the chat message it came from (evidence).");
    const handle = handleField(ev.handle);
    if (!handle) throw new Problem("The evidence must name the sender's chat handle.");
    if (!e.chat?.roomId)
      throw new Problem("Link this event to a Switch room before acting from chat.", 409);
    if (ev.roomId !== e.chat.roomId)
      throw new Problem(
        "That message came from a room that isn't linked to this event.",
        403,
      );
    return {
      platform: "switch",
      roomId: e.chat.roomId,
      roomName: e.chat.roomName || "",
      messageId: text(ev.messageId || "", "Message id", 200, false),
      threadId: text(ev.threadId || "", "Thread id", 200, false),
      senderId: text(ev.senderId || "", "Sender id", 300, false),
      senderName: text(ev.senderName || handle, "Sender name", 200, false),
      handle,
      at: now(),
    };
  }
  const where = (ev) => (ev.roomName ? `#${ev.roomName}` : "the event room");
  const contactByHandle = (e, handle) => e.contacts.find((c) => c.handle === handle);
  const label = (e, ev) => {
    const c = contactByHandle(e, ev.handle);
    return c ? `${c.name} (@${ev.handle})` : `@${ev.handle}`;
  };
  const plannerHandles = (req, e) =>
    [...new Set([...(e.chat?.plannerHandles || []), req.owner.handle].filter(Boolean))];
  function requirePlanner(req, e, ev, action) {
    const planners = plannerHandles(req, e);
    if (!planners.includes(ev.handle))
      throw new Problem(
        `Only the lead planner can ${action}${planners.length ? ` (${planners.map((h) => "@" + h).join(", ")})` : ""}. @${ev.handle} can't.`,
        403,
      );
  }
  const record = (e, personId, scope, version, answer, note, ev) =>
    db
      .prepare(
        "INSERT INTO responses(event,person,scope,version,answer,note,at,channel,evidence) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event,person,scope,version) DO UPDATE SET answer=excluded.answer,note=excluded.note,at=excluded.at,channel=excluded.channel,evidence=excluded.evidence",
      )
      .run(e.id, personId, scope, version, answer, note, now(), "switch", JSON.stringify(ev));

  r.get("/me", (req, res) =>
    res.json({
      owner: { name: req.owner.name, handle: req.owner.handle || null },
      events: ownEvents(req).map(({ e }) => summary(e)),
    }),
  );

  r.post("/heartbeat", (req, res) => {
    const status = {
      agent: text(req.body.agent || "", "Agent", 100, false),
      rooms: Array.isArray(req.body.rooms)
        ? req.body.rooms.slice(0, 50).map((x) => ({
            id: String(x.id || "").slice(0, 200),
            name: String(x.name || "").slice(0, 200),
          }))
        : [],
      model: text(req.body.model || "", "Model", 200, false),
    };
    db.prepare("UPDATE agent_tokens SET last_seen=?,status=? WHERE id=?").run(
      Date.now(),
      JSON.stringify(status),
      req.token.id,
    );
    res.json({ ok: true });
  });

  r.get("/events", (req, res) => res.json(ownEvents(req).map(({ e }) => summary(e))));

  r.get("/rooms/:roomId", (req, res) => {
    const match = ownEvents(req).find(({ e }) => e.chat?.roomId === req.params.roomId);
    if (!match)
      throw new Problem(
        "No Stageleaf event is linked to this room. The lead planner can link one.",
        404,
      );
    res.json(context(match.e));
  });

  r.post("/events/:id/link-room", (req, res) => {
    const { row, e } = load(req);
    const roomId = text(req.body.roomId, "Room id", 200);
    if (req.body.evidence) {
      const handle = handleField(req.body.evidence.handle);
      if (!req.owner.handle || handle !== req.owner.handle)
        throw new Problem("Only the lead planner can link a room to this event.", 403);
    }
    for (const other of ownEvents(req))
      if (other.e.id !== e.id && other.e.chat?.roomId === roomId) {
        delete other.e.chat;
        history(other.e, "Unlinked its Switch room, which now belongs to another event.");
        save(other.e, other.row.version);
      }
    e.chat = {
      roomId,
      roomName: text(req.body.roomName || "", "Room name", 200, false),
      url: req.body.url ? text(req.body.url, "Room link", 500) : "",
      plannerHandles: req.owner.handle ? [req.owner.handle] : [],
      documentId: e.chat?.roomId === roomId ? e.chat.documentId || "" : "",
      linkedAt: now(),
    };
    history(e, `Linked this event to the Switch room #${e.chat.roomName || roomId}.`);
    const saved = save(e, row.version);
    res.json(context(saved));
  });

  r.patch("/events/:id/chat", (req, res) => {
    const { row, e } = load(req);
    if (!e.chat) throw new Problem("This event has no linked room.", 409);
    e.chat.documentId = text(req.body.documentId || "", "Document id", 200, false);
    res.json(context(save(e, row.version)));
  });

  r.get("/events/:id/context", (req, res) => res.json(context(load(req).e)));

  r.post("/events/:id/preview", (req, res) => {
    const { e } = load(req);
    const plan = buildProposal(e, { changes: req.body.changes });
    res.json({
      title: plan.title,
      changes: plan.impact.map((x) => ({
        activityId: x.id,
        title: x.title,
        from: range(x.before, x.beforeDuration),
        to: range(x.after, x.afterDuration),
      })),
      issues: plan.issues,
      feasible: plan.issues.length === 0,
      approvalsNeeded: plan.required.map((pid) => person(e, pid)),
    });
  });

  r.post("/events/:id/availability", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    const c = e.contacts.find((x) => x.id === req.body.contactId);
    if (!c) throw new Problem("Choose a contact from this event.", 404);
    const note = text(req.body.note || "", "Note", 500, false);
    const next = mutate(
      e,
      "availability",
      {
        contactId: c.id,
        arrival: req.body.arrival || null,
        departure: req.body.departure || null,
        note: `Reported by ${label(e, ev)} in ${where(ev)}.${note ? " " + note : ""}`,
      },
      ACTOR,
    );
    res.json(context(save(next, row.version)));
  });

  r.post("/events/:id/proposals", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    const reason = text(req.body.reason, "Reason", 1500);
    const next = mutate(
      e,
      "propose",
      {
        changes: req.body.changes,
        title: req.body.title || "",
        reason,
        source: {
          channel: "switch",
          roomId: ev.roomId,
          roomName: ev.roomName,
          messageId: ev.messageId,
          threadId: ev.threadId,
          reportedBy: { name: contactByHandle(e, ev.handle)?.name || ev.senderName, handle: ev.handle },
        },
      },
      ACTOR,
    );
    const saved = save(next, row.version);
    res.status(201).json(proposalView(saved, saved.changes[0], responsesFor(saved)));
  });

  r.post("/events/:id/proposals/:changeId/decision", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    const c = e.changes.find((x) => x.id === req.params.changeId);
    if (!c) throw new Problem("That proposal doesn't exist.", 404);
    if (c.status !== "Proposed")
      throw new Problem(`That proposal is already ${c.status.toLowerCase()}.`, 409);
    if (c.base !== e.contentVersion)
      throw new Problem(
        "That proposal is outdated: the plan changed after it was made. Propose it again against the current plan.",
        409,
      );
    const contact = contactByHandle(e, ev.handle);
    if (!contact)
      throw new Problem(
        `@${ev.handle} isn't linked to a contact in this event, so their answer can't count as a decision.`,
        403,
      );
    if (!c.required.includes(contact.id))
      throw new Problem(
        `${contact.name} isn't an affected owner of this proposal. Decisions are needed from: ${c.required.map((pid) => person(e, pid)?.name).join(", ")}.`,
        403,
      );
    const answer = req.body.answer;
    if (!["Approved", "Declined"].includes(answer))
      throw new Problem("Answer with Approved or Declined.");
    const note = text(req.body.note || "", "Note", 1000, false);
    if (answer === "Declined" && !note)
      throw new Problem("A decline needs a reason so the planner can adjust the plan.");
    record(e, contact.id, c.id, c.base, answer, note, ev);
    history(e, `${contact.name} ${answer.toLowerCase()} “${c.title}” in ${where(ev)}.${note ? ` “${note}”` : ""}`);
    const saved = save(e, row.version);
    const view = proposalView(saved, saved.changes.find((x) => x.id === c.id), responsesFor(saved));
    res.json({
      ...view,
      allApproved: view.approvals.every((a) => a.response?.answer === "Approved"),
      waitingOn: view.approvals.filter((a) => a.response?.answer !== "Approved").map((a) => a.name),
    });
  });

  r.post("/events/:id/proposals/:changeId/cancel", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    const c = e.changes.find((x) => x.id === req.params.changeId);
    if (!c) throw new Problem("That proposal doesn't exist.", 404);
    if (!plannerHandles(req, e).includes(ev.handle) && c.source?.reportedBy?.handle !== ev.handle)
      throw new Problem("Only the lead planner or the person who reported the change can withdraw it.", 403);
    const reason = text(req.body.reason || "", "Reason", 500, false);
    const next = mutate(
      e,
      "cancelChange",
      { id: c.id, reason: `Withdrawn by ${label(e, ev)} in ${where(ev)}.${reason ? " " + reason : ""}` },
      ACTOR,
    );
    res.json(context(save(next, row.version)));
  });

  r.post("/events/:id/publish", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    requirePlanner(req, e, ev, "publish a revision");
    const previous = e.publications.at(-1);
    const actor = { name: `${req.owner.name} via Stageleaf agent in ${where(ev)}` };
    let next = e;
    if (req.body.changeId)
      next = mutate(next, "applyChange", { id: req.body.changeId }, actor, responsesFor(e));
    next = mutate(next, "publish", {}, actor);
    const saved = save(next, row.version);
    const pub = saved.publications.at(-1);
    res.json({
      version: pub.version,
      at: pub.at,
      changesByPerson: personChanges(previous?.data, pub.data),
      runOfShowMarkdown: runOfShowMarkdown(saved, pub),
      context: context(saved),
    });
  });

  r.post("/events/:id/acknowledge", (req, res) => {
    const { row, e } = load(req);
    const ev = evidenceOf(req, e);
    const pub = e.publications.at(-1);
    if (!pub) throw new Problem("Nothing has been published yet.", 409);
    const contact = contactByHandle(pub.data, ev.handle);
    if (!contact || !pub.data.activities.some((a) => a.ownerId === contact.id || a.vendorId === contact.id))
      throw new Problem(
        `@${ev.handle} has no assignments in brief v${pub.version}, so there is nothing for them to acknowledge.`,
        403,
      );
    const answer = req.body.answer;
    if (!["Acknowledged", "Correction requested"].includes(answer))
      throw new Problem("Answer with Acknowledged or Correction requested.");
    const note = text(req.body.note || "", "Note", 1000, false);
    if (answer === "Correction requested" && !note)
      throw new Problem("A correction request needs a note saying what is wrong.");
    record(e, contact.id, "brief", pub.version, answer, note, ev);
    history(e, `${contact.name} ${answer === "Acknowledged" ? "acknowledged" : "requested a correction to"} brief v${pub.version} in ${where(ev)}.${note ? ` “${note}”` : ""}`);
    const saved = save(e, row.version);
    const ctx = context(saved);
    res.json({
      version: pub.version,
      acknowledgments: ctx.acknowledgments,
      pending: ctx.acknowledgments.filter((a) => !a.response).map((a) => a.name),
    });
  });

  return r;
}
