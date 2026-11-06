import { randomUUID } from "node:crypto";
export class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const time = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function minutes(s) {
  if (typeof s !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    throw new Problem("Use a valid time, such as 14:30.");
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
}
export function text(v, label, max = 500, required = true) {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw new Problem(
      `${label} ${required ? "is required and " : ""}must be at most ${max} characters.`,
    );
  return v.trim();
}
const integer = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max)
    throw new Problem(`${label} must be between ${min} and ${max}.`);
  return v;
};
export function eventFields(p) {
  const date = text(p.date, "Date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new Problem("Choose a valid event date.");
  p = { ...p, timezone: text(p.timezone, "Timezone", 100) };
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
  } catch {
    throw new Problem("Choose a valid timezone.");
  }
  const start = minutes(p.start),
    end = minutes(p.end);
  if (end <= start)
    throw new Problem(
      "End time must follow start time. This version supports single-day events.",
    );
  if (
    !["Draft", "Planning", "Live", "Completed", "Archived"].includes(
      p.status || "Draft",
    )
  )
    throw new Problem("Invalid event status.");
  return {
    name: text(p.name, "Event name", 120),
    date,
    timezone: p.timezone,
    venue: text(p.venue || "", "Venue", 200, false),
    start,
    end,
    guests: integer(Number(p.guests || 0), 0, 100000, "Guest count"),
    status: p.status || "Draft",
    notes: text(p.notes || "", "Event notes", 3000, false),
  };
}
export function newEvent(p, user) {
  return {
    id: id(),
    owner: user.id,
    ...eventFields(p),
    sample: false,
    createdAt: now(),
    updatedAt: now(),
    contentVersion: 1,
    activities: [],
    contacts: [],
    tasks: [],
    changes: [],
    publications: [],
    history: [
      { id: id(), at: now(), actor: user.name, text: "Created this event." },
    ],
  };
}
function contactExists(e, c) {
  if (c && !e.contacts.some((x) => x.id === c))
    throw new Problem("Choose a contact from this event.");
  return c || "";
}
function safeUrl(v) {
  if (!v) return "";
  try {
    const u = new URL(v);
    if (!["https:", "http:"].includes(u.protocol)) throw 0;
    return u.href;
  } catch {
    throw new Problem("Use an https:// or http:// document link.");
  }
}
export function activityFields(e, p) {
  return {
    title: text(p.title, "Activity title", 160),
    start: minutes(p.start),
    duration: integer(Number(p.duration), 1, 720, "Duration"),
    location: text(p.location || "", "Location", 160, false),
    ownerId: contactExists(e, p.ownerId),
    vendorId: contactExists(e, p.vendorId),
    fixed: !!p.fixed,
    notes: text(p.notes || "", "Instructions", 3000, false),
    fileUrl: safeUrl(p.fileUrl),
  };
}
export function handleField(v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") throw new Problem("Chat handle must be text.");
  const h = v.trim().replace(/^@/, "").toLowerCase();
  if (!h) return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(h))
    throw new Problem(
      "Use a chat handle such as @sam: letters, numbers, dots, dashes or underscores.",
    );
  return h;
}
export function contactFields(p) {
  const email = text(p.email || "", "Email", 254, false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Problem("Enter a valid email address.");
  if (!["Team", "Vendor", "Speaker"].includes(p.type))
    throw new Problem("Choose a valid contact type.");
  const arrival = p.arrival ? minutes(p.arrival) : null,
    departure = p.departure ? minutes(p.departure) : null;
  if (arrival !== null && departure !== null && departure <= arrival)
    throw new Problem("Departure must follow arrival.");
  return {
    name: text(p.name, "Contact name", 120),
    company: text(p.company || "", "Company", 160, false),
    email,
    phone: text(p.phone || "", "Phone", 60, false),
    role: text(p.role || "", "Responsibility", 160, false),
    handle: handleField(p.handle),
    type: p.type,
    arrival,
    departure,
    notes: text(p.notes || "", "Commitments", 3000, false),
    fileUrl: safeUrl(p.fileUrl),
    confirmation:
      p.confirmation === "Recorded from a call"
        ? "Recorded from a call"
        : "Entered by planner",
    confirmationNote: text(
      p.confirmationNote || "",
      "Confirmation note",
      1000,
      false,
    ),
  };
}
export function conflicts(e, activities = e.activities) {
  const issues = [];
  const sorted = [...activities].sort((a, b) => a.start - b.start);
  for (const a of sorted) {
    if (a.start < e.start || a.start + a.duration > e.end)
      issues.push(
        `${a.title} falls outside venue hours (${time(e.start)}–${time(e.end)}).`,
      );
    for (const personId of new Set([a.ownerId, a.vendorId].filter(Boolean))) {
      const c = e.contacts.find((c) => c.id === personId);
      if (
        c &&
        ((c.arrival !== null && a.start < c.arrival) ||
          (c.departure !== null && a.start + a.duration > c.departure))
      )
        issues.push(`${a.title} is outside ${c.name}’s recorded availability.`);
    }
  }
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (b.start >= a.start + a.duration) break;
      if (
        !a.location ||
        !b.location ||
        a.location === b.location ||
        [a.ownerId, a.vendorId]
          .filter(Boolean)
          .some((x) => x === b.ownerId || x === b.vendorId)
      )
        issues.push(
          `${a.title} overlaps ${b.title}${a.location && a.location === b.location ? " in " + a.location : ""}.`,
        );
    }
  return [...new Set(issues)];
}
export function snapshot(e) {
  return {
    name: e.name,
    date: e.date,
    timezone: e.timezone,
    venue: e.venue,
    start: e.start,
    end: e.end,
    guests: e.guests,
    notes: e.notes,
    activities: structuredClone(e.activities),
    contacts: structuredClone(e.contacts),
    tasks: structuredClone(e.tasks),
  };
}
export function affected(e, rows) {
  return rows.filter((a) => {
    const old = e.activities.find((x) => x.id === a.id);
    return old && (old.start !== a.start || old.duration !== a.duration);
  });
}
export function buildProposal(e, p) {
  const list =
    Array.isArray(p.changes) && p.changes.length
      ? p.changes
      : [
          {
            activityId: p.activityId,
            start: p.start,
            duration: p.duration,
            ripple: p.ripple,
          },
        ];
  if (list.length > 50)
    throw new Problem("Propose at most 50 activity changes at once.");
  const rows = e.activities.map((a) => ({ ...a }));
  const moved = new Set();
  for (const change of list) {
    const original = e.activities.find((x) => x.id === change.activityId);
    if (!original) throw new Problem("Choose an activity from this event.", 404);
    if (moved.has(original.id))
      throw new Problem(`${original.title} appears twice in this proposal.`);
    moved.add(original.id);
    const start = minutes(change.start);
    const duration =
      change.duration === undefined ||
      change.duration === null ||
      change.duration === ""
        ? original.duration
        : integer(Number(change.duration), 1, 720, "Duration");
    if (
      original.fixed &&
      (original.start !== start || original.duration !== duration)
    )
      throw new Problem(
        `${original.title} is fixed. Change its fixed status explicitly before proposing a new time.`,
      );
    const row = rows.find((x) => x.id === original.id);
    row.start = start;
    row.duration = duration;
    if (change.ripple && list.length === 1) {
      const delta = start + duration - (original.start + original.duration);
      for (const x of rows)
        if (
          x.id !== original.id &&
          !x.fixed &&
          x.start >= original.start + original.duration
        )
          x.start += delta;
    }
  }
  if (rows.some((x) => x.start < 0 || x.start + x.duration > 1440))
    throw new Problem("The proposal extends outside this calendar day.");
  const impact = affected(e, rows);
  if (!impact.length)
    throw new Problem("Change a start time or duration to create a proposal.");
  const first = e.activities.find((x) => x.id === list[0].activityId);
  return {
    title:
      impact.length === 1 || list.length === 1
        ? `Update ${first.title}`
        : `Reschedule ${impact.length} activities`,
    rows,
    issues: conflicts(e, rows),
    impact: impact.map((x) => {
      const old = e.activities.find((y) => y.id === x.id);
      return {
        id: x.id,
        title: x.title,
        before: old.start,
        after: x.start,
        beforeDuration: old.duration,
        afterDuration: x.duration,
      };
    }),
    required: [
      ...new Set(impact.flatMap((x) => [x.ownerId, x.vendorId]).filter(Boolean)),
    ],
  };
}
export function mutate(original, operation, p, user, responses = []) {
  const e = structuredClone(original);
  let dirty = true;
  let message = "";
  const upsert = (list, item) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
  };
  const get = (list, key) => {
    const x = list.find((x) => x.id === key);
    if (!x) throw new Problem("This record no longer exists.", 404);
    return x;
  };
  if (operation === "settings") {
    Object.assign(e, eventFields(p));
    message = "Updated event details.";
  } else if (operation === "activity") {
    if (p.id) get(e.activities, p.id);
    const a = { id: p.id || id(), ...activityFields(e, p) };
    upsert(e.activities, a);
    message = `Saved activity: ${a.title}.`;
  } else if (operation === "deleteActivity") {
    const a = get(e.activities, p.id);
    e.activities = e.activities.filter((x) => x.id !== p.id);
    for (const t of e.tasks) if (t.activityId === p.id) t.activityId = "";
    message = `Removed activity: ${a.title}.`;
  } else if (operation === "contact") {
    if (p.id) get(e.contacts, p.id);
    const c = { id: p.id || id(), ...contactFields(p) };
    if (c.handle && e.contacts.some((x) => x.id !== c.id && x.handle === c.handle))
      throw new Problem(`@${c.handle} already belongs to another contact in this event.`);
    if (c.confirmation === "Recorded from a call" && !c.confirmationNote)
      throw new Problem("Add a note explaining the offline confirmation.");
    upsert(e.contacts, c);
    message = `Saved ${c.name}’s details${c.confirmation === "Recorded from a call" ? " and recorded an offline confirmation" : ""}.`;
  } else if (operation === "deleteContact") {
    get(e.contacts, p.id);
    if (
      e.activities.some((a) => a.ownerId === p.id || a.vendorId === p.id) ||
      e.tasks.some((t) => t.ownerId === p.id)
    )
      throw new Problem(
        "Reassign this contact’s activities and tasks before removing them.",
      );
    e.contacts = e.contacts.filter((c) => c.id !== p.id);
    message = "Removed contact.";
  } else if (operation === "task") {
    if (p.id) get(e.tasks, p.id);
    if (p.activityId) get(e.activities, p.activityId);
    const due = text(p.due || "", "Due date", 10, false);
    if (
      due &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(due) ||
        Number.isNaN(Date.parse(due + "T12:00:00Z")) ||
        new Date(due + "T12:00:00Z").toISOString().slice(0, 10) !== due)
    )
      throw new Problem("Choose a valid task date.");
    if (!["To do", "In progress", "Done", "Blocked"].includes(p.status))
      throw new Problem("Invalid task status.");
    const t = {
      id: p.id || id(),
      title: text(p.title, "Task title", 200),
      ownerId: contactExists(e, p.ownerId),
      activityId: p.activityId || "",
      due,
      status: p.status,
      notes: text(p.notes || "", "Notes", 2000, false),
    };
    upsert(e.tasks, t);
    message = `Saved task: ${t.title}.`;
  } else if (operation === "deleteTask") {
    get(e.tasks, p.id);
    e.tasks = e.tasks.filter((t) => t.id !== p.id);
    message = "Removed task.";
  } else if (operation === "import") {
    if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 200)
      throw new Problem("Import 1–200 rows at a time.");
    const rows = p.rows.map((r, i) => {
      try {
        return {
          id: id(),
          ...activityFields(e, { ...r, ownerId: "", vendorId: "" }),
        };
      } catch (error) {
        throw new Problem(`Row ${i + 2}: ${error.message}`);
      }
    });
    e.activities.push(...rows);
    message = `Imported ${rows.length} activities from CSV.`;
  } else if (operation === "propose") {
    const plan = buildProposal(e, p);
    const c = {
      id: id(),
      title: text(p.title || plan.title, "Change title", 200),
      reason: text(p.reason, "Reason and source", 2000),
      createdAt: now(),
      base: e.contentVersion,
      status: "Proposed",
      rows: plan.rows,
      issues: plan.issues,
      impact: plan.impact,
      required: plan.required,
      source: p.source || { channel: "stageleaf", by: user.name },
    };
    e.changes.unshift(c);
    dirty = false;
    message = `Proposed: ${c.title}.`;
  } else if (operation === "availability") {
    const c = get(e.contacts, p.contactId);
    const arrival = p.arrival ? minutes(p.arrival) : null,
      departure = p.departure ? minutes(p.departure) : null;
    if (arrival !== null && departure !== null && departure <= arrival)
      throw new Problem("Departure must follow arrival.");
    const show = (n) => (n === null ? "not recorded" : time(n));
    const parts = [];
    if (c.arrival !== arrival) parts.push(`arrival from ${show(c.arrival)} to ${show(arrival)}`);
    if (c.departure !== departure) parts.push(`departure from ${show(c.departure)} to ${show(departure)}`);
    c.arrival = arrival;
    c.departure = departure;
    message = `${parts.length ? `Updated ${c.name}’s ${parts.join(" and ")}.` : `Confirmed ${c.name}’s availability.`} ${text(p.note || "", "Note", 1000, false)}`.trim();
  } else if (operation === "cancelChange") {
    const c = get(e.changes, p.id);
    if (c.status !== "Proposed")
      throw new Problem("This change is already closed.");
    c.status = "Cancelled";
    c.closedReason = text(p.reason || "", "Reason", 1000, false);
    dirty = false;
    message = `Cancelled change: ${c.title}.${c.closedReason ? " " + c.closedReason : ""}`;
  } else if (operation === "applyChange") {
    const c = get(e.changes, p.id);
    if (c.status !== "Proposed" || c.base !== e.contentVersion)
      throw new Problem(
        "This proposal is outdated. Create a fresh proposal against the current draft.",
        409,
      );
    const errors = conflicts(e, c.rows);
    if (errors.length) throw new Problem(errors.join(" "));
    if (
      c.required.some(
        (person) =>
          !responses.some(
            (r) =>
              r.scope === c.id &&
              r.version === c.base &&
              r.person === person &&
              r.answer === "Approved",
          ),
      )
    )
      throw new Problem(
        "Every affected owner must approve this version before it can be applied.",
      );
    e.activities = c.rows;
    c.status = "Applied";
    message = `Applied approved change: ${c.title}. Publish a revision to share it.`;
  } else if (operation === "publish") {
    if (!e.activities.length)
      throw new Problem("Add at least one activity before publishing.");
    if (e.changes.some((c) => c.status === "Proposed"))
      throw new Problem(
        "Resolve or cancel open change proposals before publishing.",
      );
    const errors = conflicts(e);
    if (errors.length) throw new Problem(errors.join(" "));
    if (e.publications.at(-1)?.contentVersion === e.contentVersion)
      throw new Problem("This draft is already published.");
    e.publications.push({
      version: e.publications.length + 1,
      contentVersion: e.contentVersion,
      at: now(),
      by: user.name,
      data: snapshot(e),
    });
    dirty = false;
    message = `Published event brief v${e.publications.length}.`;
  } else throw new Problem("Unsupported action.");
  if (dirty) e.contentVersion++;
  e.updatedAt = now();
  e.history.unshift({ id: id(), at: now(), actor: user.name, text: message });
  return e;
}
export function sampleEvent(user) {
  const e = newEvent(
    {
      name: "Fieldwork Forum",
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      timezone: "America/Los_Angeles",
      venue: "The Assembly, San Francisco",
      start: "08:30",
      end: "18:00",
      guests: 120,
      status: "Planning",
      notes:
        "Sample event. Replace these fictional details with your own. Single-track day: everyone attends the Main hall sessions.",
    },
    user,
  );
  e.sample = true;
  // [name, role, type, company, handle, arrival, departure]
  const defs = [
    ["Jamie Chen", "Program lead", "Team", "Fieldwork", "jamie", null, null],
    ["Sam Rivera", "Venue & AV lead", "Vendor", "Assembly AV", "sam", "08:30", "17:00"],
    ["Robin Park", "Guest experience", "Team", "Fieldwork", "robin", null, null],
    ["Maya Ellis", "Keynote speaker", "Speaker", "Independent", "maya", "10:45", null],
    ["Avery Brooks", "Catering", "Vendor", "Table & Co.", "avery", "11:00", "14:00"],
  ];
  e.contacts = defs.map(([name, role, type, company, handle, arrival, departure]) => ({
    id: id(),
    name,
    role,
    type,
    company,
    handle,
    email: "",
    phone: "",
    arrival: arrival ? minutes(arrival) : null,
    departure: departure ? minutes(departure) : null,
    notes: "",
    fileUrl: "",
    confirmation: "Entered by planner",
    confirmationNote: "",
  }));
  const [jamie, sam, robin, maya, avery] = e.contacts.map((c) => c.id);
  // [title, start, duration, location, owner, vendor, fixed, notes]
  const rows = [
    ["Load-in & AV checks", "09:00", 90, "Main hall", sam, "", true, "Line check for the keynote and panel mics."],
    ["Doors & registration", "10:30", 30, "Foyer", robin, "", true, "Badges and welcome coffee."],
    ["Welcome to Fieldwork", "11:00", 15, "Main hall", jamie, sam, false, ""],
    ["Opening keynote — Maya Ellis", "11:15", 45, "Main hall", maya, sam, false, "Slides on the stage laptop by 10:45."],
    ["Lunch", "12:00", 60, "Foyer", avery, "", true, "Hot buffet for 120. Catering crew leaves at 14:00."],
    ["Hands-on workshop", "13:00", 90, "Main hall", jamie, sam, false, ""],
    ["The builders’ panel", "14:30", 45, "Main hall", jamie, sam, false, "Four panelists, two handheld mics."],
    ["Closing remarks", "15:15", 15, "Main hall", jamie, sam, false, ""],
    ["Breakdown", "15:30", 75, "Main hall", sam, "", false, "AV crew is booked until 17:00."],
  ];
  e.activities = rows.map(([title, start, duration, location, ownerId, vendorId, fixed, notes]) => ({
    id: id(),
    title,
    start: minutes(start),
    duration,
    location,
    ownerId,
    vendorId,
    fixed,
    notes,
    fileUrl: "",
  }));
  e.tasks = [
    {
      id: id(),
      title: "Confirm keynote and panel mic plan",
      ownerId: sam,
      activityId: e.activities[0].id,
      due: e.date,
      status: "To do",
      notes: "",
    },
    {
      id: id(),
      title: "Collect final keynote slides",
      ownerId: jamie,
      activityId: e.activities[3].id,
      due: e.date,
      status: "In progress",
      notes: "",
    },
    {
      id: id(),
      title: "Print badges for 120 guests",
      ownerId: robin,
      activityId: e.activities[1].id,
      due: e.date,
      status: "Done",
      notes: "",
    },
  ];
  return e;
}
