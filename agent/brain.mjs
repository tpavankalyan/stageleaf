// The Stageleaf agent's reasoning loop: Claude reads the room, the thread and
// the live event, then acts through tools that call Stageleaf's agent API.
//
// The tools never take identity from the model. Every action that represents a
// person (a report, a decision, an acknowledgment, a publish) carries evidence
// built in code from the Switch message being handled. Stageleaf verifies it.

export const SYSTEM_PROMPT = `You are Stageleaf, the operations agent for an event team. You work inside the team's chat room, which Switch connects to you. Stageleaf, the planner's event workspace, is the system of record for the run of show, owners, vendor commitments, change proposals, decisions and published briefs. You read and change it only through your tools.

How this room works
- People report changes to you. Each change is handled in its own thread, and your reply is posted in that thread.
- A proposed change needs a decision from every affected owner that Stageleaf names. Only their own replies count. Never record a decision, acknowledgment or report on behalf of anyone other than the sender of the current message, and never treat one person's message as another person's approval.
- Only the lead planner publishes a revision.
- The tools attach the current message's sender as evidence automatically. Stageleaf verifies it and refuses actions the sender isn't allowed to take. When that happens, say plainly who can do it.

When someone reports a change
1. Work out what changed and who it affects, from the message, the thread and the event. If a person's arrival or departure changed, record it with record_availability (pass only the time that changed).
2. Check the consequences against the run of show. Use preview_change to test realistic options against Stageleaf's deterministic checks: venue hours, fixed activities, room overlaps and people's recorded availability. Never invent availability, costs or flexibility that isn't recorded. If you need something that is unknown, ask the person who would know.
3. Prefer the option that moves the fewest activities and people while keeping fixed commitments. Mention one rejected alternative only when it shows why your recommendation is right, citing the check that failed.
4. Create one proposal with propose_change. Then tell the thread what would change (old → new times), and @mention each person whose decision is needed, asking them to reply "approve" or "decline" with a reason in this thread.

When someone answers
- An approval or decline from the sender: call record_decision for the open proposal. Say who is still outstanding. When everyone has approved, @mention the lead planner and ask whether to publish.
- A request to publish from the lead planner: call publish_revision with the approved proposal. Then call post_announcement with a short top-level summary of the new version. In the thread, @mention each person whose times changed with their own changes, and ask them to reply "ack", or to say what is wrong.
- An acknowledgment ("ack", "got it", "👍") from someone with assignments in the published brief: call record_acknowledgment. Say who is still pending.
- A question about the plan: answer from the event data with exact times.
- If a decline arrives, withdraw the proposal only if the planner or the reporter asks you to, then work out an alternative.

Style
- Write like a calm, experienced event producer: short, specific, no filler. Use 24-hour times (14:30), names and @handles.
- Keep each reply short: one or two sentences, then a compact bullet list of time changes when there are any. Stay under about 80 words; a list of several people's changes may run longer.
- Raise a loose end or open question once. After that, bring it up again only if someone asks about it or it blocks the next step.
- Bullets for changes look like "- **Activity title**: 11:15–12:00 → 14:30–15:15" or "- @handle: **Activity title** → 14:30–15:15". Bold only activity titles, and never put markdown around an @mention.
- Never paste links, tokens or IDs into the room. Refer to activities by their titles.
- If the room isn't linked to a Stageleaf event: when the lead planner asks you to link it to one of the events listed, call link_room_to_event. Otherwise say the room isn't linked yet and that the lead planner can ask you to link it.`;

const nullable = (type) => ({ type: [type, "null"] });
const changeItems = {
  type: "array",
  description: "Each activity to move: its id from the event's runOfShow, the new start time (HH:MM, 24-hour) and optionally a new duration in minutes (null keeps it).",
  items: {
    type: "object",
    properties: {
      activity_id: { type: "string" },
      start: { type: "string", description: "New start, HH:MM" },
      duration: { ...nullable("integer"), description: "New duration in minutes, or null to keep" },
    },
    required: ["activity_id", "start", "duration"],
    additionalProperties: false,
  },
};
const tool = (name, description, properties = {}) => ({
  name,
  description,
  strict: true,
  input_schema: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});

export const TOOLS = [
  tool("get_event", "Re-read the live event from Stageleaf: run of show, contacts with chat handles, conflicts, open proposals with each owner's decision, the published version and acknowledgments."),
  tool(
    "record_availability",
    "Record a reported change to a contact's recorded arrival or departure time. This edits the working plan, so do it before proposing schedule changes. Pass only the time that changed; null keeps the recorded value.",
    {
      contact_id: { type: "string" },
      arrival: { ...nullable("string"), description: "New arrival HH:MM, or null to keep" },
      departure: { ...nullable("string"), description: "New departure HH:MM, or null to keep" },
      note: { type: "string", description: "What was reported, in a few words" },
    },
  ),
  tool(
    "preview_change",
    "Dry-run a schedule change against Stageleaf's deterministic checks without saving it. Returns the before/after times, any conflicts and who would need to approve.",
    { changes: changeItems },
  ),
  tool(
    "propose_change",
    "Create a change proposal in Stageleaf for the affected owners to decide on. The current message's sender is recorded as the reporter.",
    {
      title: { type: "string", description: "A short title, e.g. 'Swap the keynote and the panel'" },
      reason: { type: "string", description: "Why, in one or two sentences, including what was reported" },
      changes: changeItems,
    },
  ),
  tool(
    "record_decision",
    "Record the current message sender's own decision on an open proposal. Stageleaf accepts it only if the sender is an affected owner.",
    {
      proposal_id: { type: "string" },
      decision: { type: "string", enum: ["approve", "decline"] },
      note: { type: "string", description: "Their reason or comment, in their words (required for a decline)" },
    },
  ),
  tool(
    "withdraw_proposal",
    "Withdraw an open proposal, when the lead planner or the person who reported the change asks for it.",
    { proposal_id: { type: "string" }, reason: { type: "string" } },
  ),
  tool(
    "publish_revision",
    "Apply an approved proposal and publish a new brief version. Only works when the current message comes from the lead planner and every affected owner has approved. Returns each person's changes.",
    { proposal_id: { ...nullable("string"), description: "The approved proposal to apply first, or null to publish the current plan" } },
  ),
  tool(
    "record_acknowledgment",
    "Record the current message sender's acknowledgment of the latest published brief, or their request for a correction.",
    {
      response: { type: "string", enum: ["acknowledged", "correction"] },
      note: { type: "string", description: "Their comment; required for a correction" },
    },
  ),
  tool(
    "link_room_to_event",
    "Link this chat room to one of the planner's Stageleaf events, when the lead planner asks. Stageleaf accepts it only from the planner's own chat handle.",
    { event_id: { type: "string" } },
  ),
  tool(
    "post_announcement",
    "Post a short top-level message in the room (outside the thread), e.g. after publishing a new version.",
    { text: { type: "string" } },
  ),
];

const clip = (value, n = 6000) => {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/**
 * Handle one addressed message. `turn` carries everything known about it:
 * { room, sender, message, thread, event, evidence }.
 * `actions` are the side effects the tools may take (Stageleaf calls, posts).
 */
export async function think({ llm, turn, actions, log = console, maxRounds = 10 }) {
  const brief = [
    `<room name="${turn.room.name}">`,
    turn.room.instructions ? `Room instructions:\n${turn.room.instructions}` : "",
    `People in the room: ${turn.room.people.join(", ") || "unknown"}`,
    `</room>`,
    `<sender handle="@${turn.sender.handle}">${turn.sender.contact ? `${turn.sender.contact.name}, ${turn.sender.contact.role} (a contact in this event)` : "Not a contact in this event"}${turn.sender.isPlanner ? ", lead planner" : ""}</sender>`,
    turn.event
      ? `<event>\n${JSON.stringify(turn.event)}\n</event>`
      : `<event>This room is not linked to a Stageleaf event. The planner's events: ${JSON.stringify(turn.events || [])}</event>`,
    `<thread>\n${turn.thread || "(this message starts the thread)"}\n</thread>`,
    `<message from="@${turn.sender.handle}">\n${turn.message}\n</message>`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [{ role: "user", content: brief }];
  const used = [];
  for (let round = 0; round < maxRounds; round++) {
    const response = await llm.create({
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });
    if (response.stop_reason === "refusal")
      return { reply: "I can't help with that request here.", used };
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (response.stop_reason !== "tool_use" || !toolUses.length) return { reply: text, used };
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const use of toolUses) {
      used.push(use.name);
      try {
        const output = await run(use.name, use.input || {}, turn, actions);
        log.info(`  tool ${use.name} ✓`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: clip(output) });
      } catch (error) {
        log.info(`  tool ${use.name} ✗ ${error.message}`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: error.message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "", used };
}

async function run(name, input, turn, actions) {
  const ev = turn.evidence;
  const eventId = turn.event?.id;
  const needEvent = () => {
    if (!eventId) throw new Error("This room isn't linked to a Stageleaf event.");
  };
  const changes = (list) =>
    (list || []).map((c) => ({ activityId: c.activity_id, start: c.start, duration: c.duration ?? null }));
  switch (name) {
    case "get_event":
      needEvent();
      return (turn.event = await actions.stageleaf.context(eventId));
    case "record_availability": {
      needEvent();
      const live = await actions.stageleaf.context(eventId);
      const c = live.contacts.find((x) => x.id === input.contact_id);
      if (!c) throw new Error("No contact with that id in this event.");
      const result = await actions.stageleaf.availability(eventId, {
        evidence: ev,
        contactId: c.id,
        arrival: input.arrival ?? c.arrival,
        departure: input.departure ?? c.departure,
        note: input.note || "",
      });
      turn.event = result;
      return { recorded: true, contact: c.name, conflictsNow: result.conflicts };
    }
    case "preview_change":
      needEvent();
      return actions.stageleaf.preview(eventId, changes(input.changes));
    case "propose_change": {
      needEvent();
      const proposal = await actions.stageleaf.propose(eventId, {
        evidence: ev,
        title: input.title,
        reason: input.reason,
        changes: changes(input.changes),
      });
      return proposal;
    }
    case "record_decision":
      needEvent();
      return actions.stageleaf.decide(eventId, input.proposal_id, {
        evidence: ev,
        answer: input.decision === "approve" ? "Approved" : "Declined",
        note: input.note || "",
      });
    case "withdraw_proposal":
      needEvent();
      return actions.stageleaf.cancel(eventId, input.proposal_id, { evidence: ev, reason: input.reason || "" });
    case "publish_revision": {
      needEvent();
      const result = await actions.stageleaf.publish(eventId, {
        evidence: ev,
        changeId: input.proposal_id || null,
      });
      turn.event = result.context;
      await actions.afterPublish(result).catch((error) => actions.log.warn(`Room document update failed: ${error.message}`));
      return { version: result.version, changesByPerson: result.changesByPerson };
    }
    case "record_acknowledgment":
      needEvent();
      return actions.stageleaf.acknowledge(eventId, {
        evidence: ev,
        answer: input.response === "acknowledged" ? "Acknowledged" : "Correction requested",
        note: input.note || "",
      });
    case "link_room_to_event": {
      const linked = await actions.stageleaf.linkRoom(input.event_id, {
        roomId: ev.roomId,
        roomName: ev.roomName,
        url: actions.roomUrl || "",
        evidence: ev,
      });
      turn.event = linked;
      return { linked: true, event: linked.name, published: linked.published };
    }
    case "post_announcement":
      await actions.announce(String(input.text || "").slice(0, 4000));
      return { posted: true };
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}
