// The no-model fallback: explicit commands, for running the workflow without any
// model credentials. Same tools, same verification; just no language understanding.
//
//   @stageleaf status
//   @stageleaf maya arrives 11:45
//   @stageleaf swap opening keynote with builders panel
//   @stageleaf move closing remarks to 15:30
//   approve | decline <reason>          (in the proposal's thread)
//   publish                             (lead planner)
//   ack | correction <what is wrong>

const HELP = [
  "I'm running without a language model, so I understand these commands:",
  "- `status`: open proposals and pending acknowledgments",
  "- `<handle> arrives HH:MM` / `<handle> leaves HH:MM`: record availability",
  "- `swap <activity> with <activity>` or `move <activity> to HH:MM`: propose a change",
  "- `approve`, or `decline <reason>`: your decision on the open proposal",
  "- `publish`: apply the approved proposal and publish (lead planner)",
  "- `ack`, or `correction <what is wrong>`: respond to the latest brief",
].join("\n");

const words = (s) => s.toLowerCase().replace(/[^a-z0-9: ]+/g, " ").split(/\s+/).filter(Boolean);
function findActivity(event, phrase) {
  const want = words(phrase).filter((w) => !["the", "a", "an", "session"].includes(w));
  let best = null,
    score = 0;
  for (const a of event.runOfShow) {
    const have = new Set(words(a.title));
    const s = want.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) && w.length > 3)).length;
    if (s > score) (best = a), (score = s);
  }
  return score ? best : null;
}
const startOf = (a) => a.time.split("–")[0];

export async function rules({ turn, actions }) {
  const text = turn.message.replace(/@stageleaf\b/gi, "").trim();
  const lower = text.toLowerCase();
  const event = turn.event;
  if (!event) return { reply: "This room isn't linked to a Stageleaf event yet. The lead planner can link it from Stageleaf.", used: [] };
  const s = actions.stageleaf;
  const ev = turn.evidence;
  const open = event.openProposals[0];
  const fmt = (p) => p.changes.map((c) => `- **${c.title}**: ${c.from} → ${c.to}`).join("\n");

  let m;
  if (/^(approve|approved|yes|ok|okay|works for me)\b/.test(lower) && open) {
    const r = await s.decide(event.id, open.id, { evidence: ev, answer: "Approved", note: "" });
    return { reply: r.allApproved ? `Recorded. Everyone has approved. @${event.chat?.plannerHandles?.[0] || "planner"}, reply \`publish\` to publish it.` : `Recorded your approval. Still waiting on: ${r.waitingOn.join(", ")}.`, used: ["record_decision"] };
  }
  if ((m = lower.match(/^(decline|declined|no)\b\s*(.*)$/)) && open) {
    await s.decide(event.id, open.id, { evidence: ev, answer: "Declined", note: m[2] || "" });
    return { reply: "Recorded your decline. The planner will look for an alternative.", used: ["record_decision"] };
  }
  if (/^publish\b/.test(lower)) {
    const r = await s.publish(event.id, { evidence: ev, changeId: open?.id || null });
    await actions.afterPublish(r).catch(() => {});
    const per = r.changesByPerson
      .filter((p) => p.handle)
      .map((p) => `- @${p.handle}: ${p.items.map((i) => `${i.title} → ${i.after || "removed"}`).join("; ")}`)
      .join("\n");
    await actions.announce(`Published run of show **v${r.version}**.`);
    return { reply: `Published v${r.version}. Please reply \`ack\` once you've seen your changes:\n${per}`, used: ["publish_revision"] };
  }
  if (/^(ack|acknowledged|got it|seen)\b|^👍/.test(lower)) {
    const r = await s.acknowledge(event.id, { evidence: ev, answer: "Acknowledged", note: "" });
    return { reply: r.pending.length ? `Thanks, recorded for v${r.version}. Still pending: ${r.pending.join(", ")}.` : `Thanks, everyone has acknowledged v${r.version}. ✅`, used: ["record_acknowledgment"] };
  }
  if ((m = lower.match(/^correction\s+(.+)$/))) {
    await s.acknowledge(event.id, { evidence: ev, answer: "Correction requested", note: m[1] });
    return { reply: "Recorded your correction request for the planner.", used: ["record_acknowledgment"] };
  }
  if ((m = lower.match(/^@?([a-z0-9._-]+)\s+(arrives|leaves)\s+(?:at\s+)?(\d{1,2}:\d{2})/))) {
    const c = event.contacts.find((x) => x.handle === m[1] || x.name.toLowerCase().startsWith(m[1]));
    if (!c) return { reply: `I couldn't find a contact matching “${m[1]}”.`, used: [] };
    const t = m[3].padStart(5, "0");
    const r = await s.availability(event.id, { evidence: ev, contactId: c.id, arrival: m[2] === "arrives" ? t : c.arrival, departure: m[2] === "leaves" ? t : c.departure, note: text });
    return { reply: `Recorded ${c.name} ${m[2] === "arrives" ? "arriving" : "leaving"} at ${t}.${r.conflicts.length ? `\nThis creates conflicts:\n${r.conflicts.map((x) => `- ${x}`).join("\n")}` : " No conflicts."}`, used: ["record_availability"] };
  }
  if ((m = text.match(/^swap\s+(.+?)\s+(?:with|and)\s+(.+)$/i))) {
    const a = findActivity(event, m[1]), b = findActivity(event, m[2]);
    if (!a || !b || a.id === b.id) return { reply: "I couldn't match both activities. Use words from their titles.", used: [] };
    const changes = [{ activityId: a.id, start: startOf(b), duration: null }, { activityId: b.id, start: startOf(a), duration: null }];
    const p = await s.preview(event.id, changes);
    if (!p.feasible) return { reply: `That swap fails Stageleaf's checks:\n${p.issues.map((x) => `- ${x}`).join("\n")}`, used: ["preview_change"] };
    const created = await s.propose(event.id, { evidence: ev, title: `Swap ${a.title} and ${b.title}`, reason: text, changes });
    return { reply: `Proposed:\n${fmt(created)}\nDecisions needed from ${created.approvals.map((x) => (x.handle ? "@" + x.handle : x.name)).join(", ")}: reply \`approve\` or \`decline <reason>\` here.`, used: ["preview_change", "propose_change"] };
  }
  if ((m = text.match(/^move\s+(.+?)\s+to\s+(\d{1,2}:\d{2})$/i))) {
    const a = findActivity(event, m[1]);
    if (!a) return { reply: "I couldn't match that activity.", used: [] };
    const changes = [{ activityId: a.id, start: m[2].padStart(5, "0"), duration: null }];
    const p = await s.preview(event.id, changes);
    if (!p.feasible) return { reply: `That move fails Stageleaf's checks:\n${p.issues.map((x) => `- ${x}`).join("\n")}`, used: ["preview_change"] };
    const created = await s.propose(event.id, { evidence: ev, title: `Move ${a.title}`, reason: text, changes });
    return { reply: `Proposed:\n${fmt(created)}\nDecisions needed from ${created.approvals.map((x) => (x.handle ? "@" + x.handle : x.name)).join(", ")}.`, used: ["preview_change", "propose_change"] };
  }
  if (/^status\b/.test(lower)) {
    const lines = [];
    for (const p of event.openProposals)
      lines.push(`Open: **${p.title}**, waiting on ${p.approvals.filter((x) => x.response?.answer !== "Approved").map((x) => x.name).join(", ") || "nobody"}`);
    if (event.published) {
      const pending = event.acknowledgments.filter((x) => !x.response).map((x) => x.name);
      lines.push(`Published v${event.published.version}; ${pending.length ? `pending acknowledgments: ${pending.join(", ")}` : "everyone has acknowledged"}.`);
    }
    if (event.conflicts.length) lines.push(`Conflicts in the working plan:\n${event.conflicts.map((x) => `- ${x}`).join("\n")}`);
    return { reply: lines.join("\n") || "No open proposals and nothing pending.", used: ["get_event"] };
  }
  return { reply: HELP, used: [] };
}
