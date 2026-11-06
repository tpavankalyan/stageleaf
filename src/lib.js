export const time = (n) =>
  n == null
    ? ""
    : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const date = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const initials = (s) =>
  s
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
export async function api(path, body, method = body ? "POST" : "GET") {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(data.error || "Request failed.");
    e.status = r.status;
    throw e;
  }
  return data;
}
export function parseCSV(input) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const headers = rows.shift()?.map((x) =>
    x
      .trim()
      .toLowerCase()
      .replace(/^\uFEFF/, ""),
  );
  if (
    !headers ||
    !["title", "start", "duration"].every((x) => headers.includes(x))
  )
    throw new Error("CSV needs title, start and duration columns.");
  return rows.map((cells, i) => {
    if (cells.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of columns.`);
    const o = Object.fromEntries(headers.map((h, j) => [h, cells[j].trim()]));
    return {
      ...o,
      fileUrl: o.fileurl || "",
      duration: Number(o.duration),
      fixed: o.fixed === "true",
    };
  });
}
export function downloadCSV(e) {
  const fields = [
    "title",
    "start",
    "duration",
    "location",
    "owner",
    "vendor",
    "fixed",
    "notes",
  ];
  const name = (id) => e.contacts.find((x) => x.id === id)?.name || "";
  const quote = (s) =>
    '"' +
    String(s ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const rows = e.activities.map((a) => [
    a.title,
    time(a.start),
    a.duration,
    a.location,
    name(a.ownerId),
    name(a.vendorId),
    a.fixed,
    a.notes,
  ]);
  const blob = new Blob(
    [[fields, ...rows].map((r) => r.map(quote).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = e.name + "-working-schedule.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// People who must acknowledge the latest brief: everyone with assignments in v1;
// for a revision, only those whose assignments changed since the previous version.
export function mustAcknowledge(event) {
  const pubs = event.publications || [];
  const latest = pubs.at(-1), previous = pubs.at(-2);
  const ids = new Set();
  if (!latest) return ids;
  const mine = (data, id) =>
    data.activities.filter((a) => a.ownerId === id || a.vendorId === id);
  for (const c of latest.data.contacts) {
    const now = mine(latest.data, c.id);
    if (!previous) {
      if (now.length) ids.add(c.id);
      continue;
    }
    const old = mine(previous.data, c.id);
    const changed =
      now.length !== old.length ||
      now.some((a) => {
        const o = old.find((x) => x.id === a.id);
        return !o || o.start !== a.start || o.duration !== a.duration || o.location !== a.location;
      });
    if (changed) ids.add(c.id);
  }
  return ids;
}
