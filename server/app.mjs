import express from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Problem,
  id,
  now,
  text,
  newEvent,
  sampleEvent,
  mutate,
  conflicts,
  handleField,
} from "./domain.mjs";
import { agentRouter, newAgentToken, hashAgentToken } from "./agent-api.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  chatHandle: u.chat_handle || "",
});
export function createApp({
  dbPath = "data/stageleaf.sqlite",
  secureCookies = process.env.NODE_ENV === "production",
  publicOrigin = process.env.PUBLIC_ORIGIN,
  frontendDir,
} = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,version INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS event_owner ON events(owner);
  CREATE TABLE IF NOT EXISTS links(token TEXT PRIMARY KEY,event TEXT NOT NULL REFERENCES events(id),person TEXT NOT NULL,scope TEXT NOT NULL,version INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS responses(event TEXT NOT NULL,person TEXT NOT NULL,scope TEXT NOT NULL,version INTEGER NOT NULL,answer TEXT NOT NULL,note TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(event,person,scope,version));
  CREATE TABLE IF NOT EXISTS agent_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,created TEXT NOT NULL,last_seen INTEGER,status TEXT NOT NULL DEFAULT '',revoked INTEGER NOT NULL DEFAULT 0);`);
  // Additive migrations for databases created by earlier releases.
  for (const [table, column, ddl] of [
    ["users", "chat_handle", "ALTER TABLE users ADD COLUMN chat_handle TEXT NOT NULL DEFAULT ''"],
    ["responses", "channel", "ALTER TABLE responses ADD COLUMN channel TEXT NOT NULL DEFAULT 'link'"],
    ["responses", "evidence", "ALTER TABLE responses ADD COLUMN evidence TEXT NOT NULL DEFAULT ''"],
  ])
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column))
      db.exec(ddl);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "no-store",
    });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Use JSON requests." });
      const origin = req.get("origin");
      const allowed = publicOrigin || `${req.protocol}://${req.get("host")}`;
      if (
        origin &&
        origin !== allowed &&
        !(
          /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin) &&
          !secureCookies
        )
      )
        return res
          .status(403)
          .json({ error: "Request origin is not allowed." });
    }
    next();
  });
  const attempts = new Map();
  app.use("/api/auth", (req, res, next) => {
    if (req.method === "GET") return next();
    const key = req.ip;
    const a = attempts.get(key) || { count: 0, until: Date.now() + 600000 };
    if (Date.now() > a.until) {
      a.count = 0;
      a.until = Date.now() + 600000;
    }
    a.count++;
    attempts.set(key, a);
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
    if (a.count > 50)
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again in 10 minutes." });
    next();
  });
  function session(req) {
    const raw = req.headers.cookie?.match(/(?:^|;\s*)stageleaf=([^;]+)/)?.[1];
    if (!raw) return null;
    return db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      )
      .get(hash(raw), Date.now());
  }
  function setSession(res, u) {
    const raw = token();
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(raw),
      u.id,
      Date.now() + 7 * 86400000,
    );
    res.cookie("stageleaf", raw, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      maxAge: 7 * 86400000,
      path: "/",
    });
  }
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: session(req) ? publicUser(session(req)) : null }),
  );
  app.post("/api/auth/register", (req, res) => {
    const name = text(req.body.name, "Name", 100),
      email = text(req.body.email, "Email", 254).toLowerCase(),
      password = text(req.body.password, "Password", 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
      throw new Problem(
        "Use a valid email and a password of at least 10 characters.",
      );
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      throw new Problem("An account with this email already exists.", 409);
    const salt = randomBytes(16).toString("hex");
    const u = {
      id: id(),
      name,
      email,
      salt,
      password: scryptSync(password, salt, 64).toString("hex"),
    };
    db.prepare("INSERT INTO users(id,name,email,salt,password) VALUES(?,?,?,?,?)").run(
      u.id,
      name,
      email,
      salt,
      u.password,
    );
    setSession(res, u);
    res.status(201).json({ user: publicUser(u) });
  });
  app.post("/api/auth/login", (req, res) => {
    const email = text(req.body.email, "Email", 254).toLowerCase(),
      password = text(req.body.password, "Password", 200);
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const actual = scryptSync(password, u?.salt || "nonexistent-account", 64);
    if (!u || !timingSafeEqual(actual, Buffer.from(u.password, "hex")))
      throw new Problem("Email or password is incorrect.", 401);
    setSession(res, u);
    res.json({ user: publicUser(u) });
  });
  app.post("/api/auth/logout", (req, res) => {
    const raw = req.headers.cookie?.match(/(?:^|;\s*)stageleaf=([^;]+)/)?.[1];
    if (raw) db.prepare("DELETE FROM sessions WHERE token=?").run(hash(raw));
    res.clearCookie("stageleaf", { path: "/" });
    res.json({ ok: true });
  });
  const agentOnline = (lastSeen) => !!lastSeen && Date.now() - lastSeen < 45000;
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      storage: "sqlite",
      switchConnected: agentOnline(
        db.prepare("SELECT MAX(last_seen) AS t FROM agent_tokens WHERE revoked=0").get()?.t,
      ),
    }),
  );
  const rows = (e) =>
    db
      .prepare(
        "SELECT person,scope,version,answer,note,at,channel,evidence FROM responses WHERE event=?",
      )
      .all(e.id);
  const enriched = (row) => {
    const e = JSON.parse(row.data);
    return {
      ...e,
      version: row.version,
      responses: rows(e),
      conflicts: conflicts(e),
    };
  };
  function readEvent(key) {
    const r = db.prepare("SELECT * FROM events WHERE id=?").get(key);
    if (!r) throw new Problem("Event not found.", 404);
    return r;
  }
  function save(e, version) {
    const result = db
      .prepare(
        "UPDATE events SET data=?,version=version+1 WHERE id=? AND version=?",
      )
      .run(JSON.stringify(e), e.id, version);
    if (!result.changes)
      throw new Problem(
        "Someone updated this event. Refresh and review your edit.",
        409,
      );
    return enriched(readEvent(e.id));
  }
  const isStale = (l, e) =>
    l.scope === "brief"
      ? e.publications.at(-1)?.version !== l.version
      : e.contentVersion !== l.version ||
        !e.changes.some((c) => c.id === l.scope && c.status === "Proposed");
  const linkData = (req) => {
    const l = db
      .prepare("SELECT * FROM links WHERE token=?")
      .get(hash(req.params.token));
    if (!l || l.revoked || l.expires < Date.now())
      throw new Problem(
        "This link is expired or no longer available. Ask your planner for a new one.",
        404,
      );
    const e = JSON.parse(readEvent(l.event).data);
    return { l, e };
  };
  app.get("/api/shared/:token", (req, res) => {
    const { l, e } = linkData(req);
    const source =
      l.scope === "brief"
        ? e.publications.find((p) => p.version === l.version)?.data
        : e;
    if (!source) throw new Problem("Brief no longer available.", 404);
    const person = source.contacts.find((c) => c.id === l.person);
    if (!person) throw new Problem("Contact no longer available.", 404);
    const c =
      l.scope !== "brief" ? e.changes.find((c) => c.id === l.scope) : null;
    res.json({
      name: source.name,
      date: source.date,
      timezone: source.timezone,
      venue: source.venue,
      person: {
        name: person.name,
        role: person.role,
        arrival: person.arrival,
        departure: person.departure,
        notes: person.notes,
      },
      version: l.version,
      kind: l.scope === "brief" ? "brief" : "decision",
      stale: isStale(l, e),
      activities: (c ? c.rows : source.activities)
        .filter((a) => a.ownerId === l.person || a.vendorId === l.person)
        .map(({ ownerId, vendorId, ...a }) => a),
      change: c
        ? {
            title: c.title,
            reason: c.reason,
            impact: c.impact.filter((a) =>
              c.rows.some(
                (r) =>
                  r.id === a.id &&
                  (r.ownerId === l.person || r.vendorId === l.person),
              ),
            ),
          }
        : null,
      response:
        rows(e).find(
          (r) =>
            r.person === l.person &&
            r.scope === l.scope &&
            r.version === l.version,
        ) || null,
    });
  });
  app.post("/api/shared/:token/respond", (req, res) => {
    const { l, e } = linkData(req);
    if (isStale(l, e))
      throw new Problem(
        "This version has been superseded. Ask for a current link before responding.",
        409,
      );
    const answer = req.body.answer;
    const allowed =
      l.scope === "brief"
        ? ["Acknowledged", "Correction requested"]
        : ["Approved", "Declined"];
    if (!allowed.includes(answer))
      throw new Problem("Choose a valid response.");
    const note = text(req.body.note || "", "Note", 2000, false);
    if (["Declined", "Correction requested"].includes(answer) && !note)
      throw new Problem(
        "Add a note so the planner knows what needs attention.",
      );
    db.prepare(
      "INSERT INTO responses(event,person,scope,version,answer,note,at,channel,evidence) VALUES(?,?,?,?,?,?,?,'link','') ON CONFLICT(event,person,scope,version) DO UPDATE SET answer=excluded.answer,note=excluded.note,at=excluded.at,channel='link',evidence=''",
    ).run(e.id, l.person, l.scope, l.version, answer, note, now());
    res.json({ ok: true });
  });
  app.use(
    "/api/agent",
    agentRouter({ db, readEvent, save, responsesFor: rows }),
  );
  app.use("/api", (req, res, next) => {
    req.user = session(req);
    if (!req.user)
      return res.status(401).json({ error: "Sign in to continue." });
    next();
  });
  app.patch("/api/account", (req, res) => {
    const chatHandle = handleField(req.body.chatHandle);
    db.prepare("UPDATE users SET chat_handle=? WHERE id=?").run(chatHandle, req.user.id);
    res.json({ user: publicUser({ ...req.user, chat_handle: chatHandle }) });
  });
  const tokenView = (t) => {
    let status = {};
    try {
      status = t.status ? JSON.parse(t.status) : {};
    } catch {
      status = {};
    }
    return {
      id: t.id,
      label: t.label,
      created: t.created,
      lastSeen: t.last_seen ? new Date(t.last_seen).toISOString() : null,
      online: agentOnline(t.last_seen),
      rooms: status.rooms || [],
      model: status.model || "",
    };
  };
  app.get("/api/agent-tokens", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM agent_tokens WHERE user_id=? AND revoked=0 ORDER BY created DESC")
        .all(req.user.id)
        .map(tokenView),
    ),
  );
  app.post("/api/agent-tokens", (req, res) => {
    const raw = newAgentToken();
    const t = {
      id: id(),
      label: text(req.body.label || "Switch agent", "Label", 100),
      created: now(),
    };
    db.prepare(
      "INSERT INTO agent_tokens(id,user_id,label,hash,created) VALUES(?,?,?,?,?)",
    ).run(t.id, req.user.id, t.label, hashAgentToken(raw), t.created);
    res.status(201).json({ ...tokenView(t), token: raw });
  });
  app.delete("/api/agent-tokens/:id", (req, res) => {
    db.prepare("UPDATE agent_tokens SET revoked=1 WHERE id=? AND user_id=?").run(
      req.params.id,
      req.user.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/events", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM events WHERE owner=? ORDER BY json_extract(data,'$.date') ASC",
        )
        .all(req.user.id)
        .map(enriched),
    ),
  );
  app.post("/api/events", (req, res) => {
    const e = req.body.sample
      ? sampleEvent(req.user)
      : newEvent(req.body, req.user);
    db.prepare("INSERT INTO events VALUES(?,?,?,1)").run(
      e.id,
      req.user.id,
      JSON.stringify(e),
    );
    res.status(201).json(enriched(readEvent(e.id)));
  });
  app.use("/api/events/:id", (req, res, next) => {
    const row = readEvent(req.params.id);
    if (row.owner !== req.user.id) throw new Problem("Event not found.", 404);
    req.eventRow = row;
    next();
  });
  app.get("/api/events/:id", (req, res) => res.json(enriched(req.eventRow)));
  app.patch("/api/events/:id", (req, res) => {
    const { expectedVersion, operation, payload = {} } = req.body;
    if (req.eventRow.version !== expectedVersion)
      throw new Problem(
        "This event changed since you opened it. Refresh and review your edit.",
        409,
      );
    const e = JSON.parse(req.eventRow.data);
    res.json(
      save(mutate(e, operation, payload, req.user, rows(e)), expectedVersion),
    );
  });
  app.post("/api/events/:id/duplicate", (req, res) => {
    const old = JSON.parse(req.eventRow.data);
    const e = newEvent(
      {
        ...old,
        name: old.name + " (copy)",
        start: `${String(Math.floor(old.start / 60)).padStart(2, "0")}:${String(old.start % 60).padStart(2, "0")}`,
        end: `${String(Math.floor(old.end / 60)).padStart(2, "0")}:${String(old.end % 60).padStart(2, "0")}`,
        status: "Draft",
      },
      req.user,
    );
    const mapping = new Map(
      [...old.contacts, ...old.activities, ...old.tasks].map((x) => [
        x.id,
        id(),
      ]),
    );
    e.contacts = old.contacts.map((x) => ({
      ...x,
      id: mapping.get(x.id),
      confirmation: "Entered by planner",
      confirmationNote: "",
    }));
    e.activities = old.activities.map((x) => ({
      ...x,
      id: mapping.get(x.id),
      ownerId: mapping.get(x.ownerId) || "",
      vendorId: mapping.get(x.vendorId) || "",
    }));
    e.tasks = old.tasks.map((x) => ({
      ...x,
      id: mapping.get(x.id),
      ownerId: mapping.get(x.ownerId) || "",
      activityId: mapping.get(x.activityId) || "",
      status: "To do",
    }));
    db.prepare("INSERT INTO events VALUES(?,?,?,1)").run(
      e.id,
      req.user.id,
      JSON.stringify(e),
    );
    res.status(201).json(enriched(readEvent(e.id)));
  });
  app.post("/api/events/:id/share", (req, res) => {
    const e = JSON.parse(req.eventRow.data);
    const { personId, changeId } = req.body;
    if (!e.contacts.some((c) => c.id === personId))
      throw new Problem("Choose a contact from this event.");
    let version = e.publications.at(-1)?.version,
      scope = "brief";
    if (changeId) {
      const c = e.changes.find((c) => c.id === changeId);
      if (
        !c ||
        c.status !== "Proposed" ||
        c.base !== e.contentVersion ||
        !c.required.includes(personId)
      )
        throw new Problem(
          "This person has no current decision on that proposal.",
        );
      version = c.base;
      scope = c.id;
    } else if (!version)
      throw new Problem("Publish a brief before creating a share link.");
    if (
      !changeId &&
      !e.publications.at(-1).data.contacts.some((c) => c.id === personId)
    )
      throw new Problem(
        "Publish an updated brief containing this contact first.",
      );
    const raw = token(),
      expires = Date.now() + 14 * 86400000;
    db.prepare(
      "INSERT INTO links(token,event,person,scope,version,expires) VALUES(?,?,?,?,?,?)",
    ).run(hash(raw), e.id, personId, scope, version, expires);
    res.json({
      path: `/share/${raw}`,
      expires: new Date(expires).toISOString(),
      version,
      scope,
    });
  });
  app.post("/api/events/:id/revoke-links", (req, res) => {
    db.prepare("UPDATE links SET revoked=1 WHERE event=?").run(req.eventRow.id);
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  const dist =
    frontendDir || resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist, { index: false }));
  app.get("/{*path}", (req, res) => res.sendFile("index.html", { root: dist }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status >= 500) console.error(err.message);
    res.status(status).json({
      error:
        status >= 500
          ? "Something went wrong saving your request. Please try again."
          : err.message,
    });
  });
  return { app, db, close: () => db.close() };
}
