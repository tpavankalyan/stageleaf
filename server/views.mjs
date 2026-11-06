// Read models shared by the agent API: compact, LLM-friendly views of an event,
// per-person revision summaries and the Markdown run of show posted to the room.
import { time } from "./domain.mjs";

export const range = (start, duration) => `${time(start)}–${time(start + duration)}`;
const clock = (n) => (n === null || n === undefined ? null : time(n));

export function person(e, contactId) {
  const c = e.contacts.find((x) => x.id === contactId);
  return c ? { id: c.id, name: c.name, handle: c.handle || null, role: c.role } : null;
}

function responseFor(responses, personId, scope, version) {
  const r = responses.find(
    (x) => x.person === personId && x.scope === scope && x.version === version,
  );
  if (!r) return null;
  let evidence = null;
  try {
    evidence = r.evidence ? JSON.parse(r.evidence) : null;
  } catch {
    evidence = null;
  }
  return {
    answer: r.answer,
    note: r.note || "",
    at: r.at,
    via: r.channel === "switch" ? `Switch room ${evidence?.roomName || ""}`.trim() : r.channel === "link" ? "brief link" : r.channel || "brief link",
  };
}

export function proposalView(e, c, responses) {
  return {
    id: c.id,
    title: c.title,
    reason: c.reason,
    status: c.status,
    outdated: c.status === "Proposed" && c.base !== e.contentVersion,
    createdAt: c.createdAt,
    source: c.source || null,
    changes: c.impact.map((x) => ({
      activityId: x.id,
      title: x.title,
      from: range(x.before, x.beforeDuration),
      to: range(x.after, x.afterDuration),
    })),
    issues: c.issues,
    approvals: c.required.map((pid) => ({
      ...person(e, pid),
      response: responseFor(responses, pid, c.id, c.base),
    })),
  };
}

export function agentContext(e, responses, conflicts) {
  const last = e.publications.at(-1);
  const people = new Map(e.contacts.map((c) => [c.id, c]));
  // Who must acknowledge the latest brief: for v1 everyone with assignments; for
  // a revision, the people whose assignments changed since the version before.
  const previous = e.publications.at(-2);
  const briefPeople = !last
    ? []
    : previous
      ? personChanges(previous.data, last.data).map((p) => last.data.contacts.find((c) => c.id === p.id))
      : last.data.contacts.filter((c) =>
          last.data.activities.some((a) => a.ownerId === c.id || a.vendorId === c.id),
        );
  return {
    id: e.id,
    name: e.name,
    date: e.date,
    timezone: e.timezone,
    venue: e.venue,
    venueHours: range(e.start, e.end - e.start),
    guests: e.guests,
    status: e.status,
    sample: !!e.sample,
    chat: e.chat || null,
    draftVersion: e.contentVersion,
    published: last
      ? {
          version: last.version,
          at: last.at,
          by: last.by,
          matchesDraft: last.contentVersion === e.contentVersion,
        }
      : null,
    contacts: e.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      type: c.type,
      company: c.company,
      handle: c.handle || null,
      arrival: clock(c.arrival),
      departure: clock(c.departure),
    })),
    runOfShow: [...e.activities]
      .sort((a, b) => a.start - b.start)
      .map((a) => ({
        id: a.id,
        time: range(a.start, a.duration),
        duration: a.duration,
        title: a.title,
        location: a.location,
        fixed: a.fixed,
        owner: a.ownerId ? { name: people.get(a.ownerId)?.name, handle: people.get(a.ownerId)?.handle || null } : null,
        vendor: a.vendorId ? { name: people.get(a.vendorId)?.name, handle: people.get(a.vendorId)?.handle || null } : null,
        notes: a.notes || "",
      })),
    conflicts,
    openProposals: e.changes
      .filter((c) => c.status === "Proposed")
      .map((c) => proposalView(e, c, responses)),
    recentlyClosedProposals: e.changes
      .filter((c) => c.status !== "Proposed")
      .slice(0, 3)
      .map((c) => ({ id: c.id, title: c.title, status: c.status, closedReason: c.closedReason || "" })),
    acknowledgments: last
      ? briefPeople.map((c) => ({
          ...person(last.data, c.id),
          response: responseFor(responses, c.id, "brief", last.version),
        }))
      : [],
  };
}

const describe = (a) => `${range(a.start, a.duration)} ${a.title}${a.location ? ` (${a.location})` : ""}`;

/** What changed for each person between two published snapshots. */
export function personChanges(before, after) {
  const result = [];
  for (const c of after.contacts) {
    const mine = (data) =>
      data.activities.filter((a) => a.ownerId === c.id || a.vendorId === c.id);
    const now = mine(after);
    const old = before ? mine(before) : [];
    const items = [];
    for (const a of now) {
      const o = old.find((x) => x.id === a.id);
      if (!o) items.push({ title: a.title, before: null, after: describe(a) });
      else if (o.start !== a.start || o.duration !== a.duration || o.location !== a.location)
        items.push({ title: a.title, before: describe(o), after: describe(a) });
    }
    for (const o of old)
      if (!now.some((a) => a.id === o.id))
        items.push({ title: o.title, before: describe(o), after: null });
    if (items.length)
      result.push({ id: c.id, name: c.name, handle: c.handle || null, items });
  }
  return result;
}

/** The published run of show, as the Markdown document kept in the Switch room. */
export function runOfShowMarkdown(e, publication) {
  const d = publication.data;
  const who = (pid) => d.contacts.find((c) => c.id === pid);
  const lines = [
    `# ${d.name} — run of show v${publication.version}`,
    "",
    `${d.date} · ${d.venue || "Venue not set"} · ${d.timezone}`,
    `Published ${publication.at} by ${publication.by}. Stageleaf is the source of truth; this document is a copy for the room.`,
    "",
    "| Time | Activity | Where | Owner | Support |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const a of [...d.activities].sort((x, y) => x.start - y.start)) {
    const owner = who(a.ownerId),
      vendor = who(a.vendorId);
    lines.push(
      `| ${range(a.start, a.duration)}${a.fixed ? " (fixed)" : ""} | ${a.title} | ${a.location || "—"} | ${owner ? owner.name : "—"} | ${vendor ? vendor.name : "—"} |`,
    );
  }
  return lines.join("\n");
}
