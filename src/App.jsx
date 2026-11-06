import React, { useState, useEffect, useRef } from "react";
import {
  Leaf,
  Plus,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Users,
  Check,
  ChevronRight,
  Clock,
  MapPin,
  Search,
  Settings,
  LogOut,
  X,
  Download,
  Upload,
  Lock,
  ExternalLink,
  Copy,
  Send,
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  MoreHorizontal,
  ClipboardList,
  GitBranch,
  Menu,
  MessageSquare,
  Bot,
} from "lucide-react";
import {
  api,
  time,
  date,
  initials,
  parseCSV,
  downloadCSV,
  mustAcknowledge,
} from "./lib.js";
const tabs = [
  ["overview", "Overview"],
  ["schedule", "Run of show"],
  ["contacts", "Team & vendors"],
  ["tasks", "Tasks"],
  ["changes", "Changes"],
];
const EMPTY = {
  name: "",
  date: new Date().toISOString().slice(0, 10),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  venue: "",
  start: "09:00",
  end: "18:00",
  guests: 0,
  status: "Draft",
  notes: "",
};
export const Pill = ({ children, tone = "" }) => (
  <span className={"pill " + tone}>{children}</span>
);
// Where a recorded response came from: a recipient link, or a person's own
// chat account in the event's Switch room.
export function via(r) {
  if (!r) return "";
  if (r.channel !== "switch") return "via brief link";
  try {
    const e = JSON.parse(r.evidence || "{}");
    return `@${e.handle} in #${e.roomName || "team chat"}`;
  } catch {
    return "in team chat";
  }
}
const Button = ({ children, icon: Icon, className = "", ...p }) => (
  <button className={"button " + className} {...p}>
    {Icon && <Icon size={16} />} {children}
  </button>
);
const Empty = ({ icon: Icon = CalendarDays, title, children, action }) => (
  <div className="empty">
    <span className="empty-icon">
      <Icon size={30} />
    </span>
    <h2>{title}</h2>
    <p>{children}</p>
    {action}
  </div>
);
function Field({ label, children, ...props }) {
  return (
    <label className={"field " + (props.wide ? "wide" : "")}>
      <span>{label}</span>
      {children || (
        <input
          {...Object.fromEntries(
            Object.entries(props).filter(([k]) => k !== "wide"),
          )}
        />
      )}
    </label>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const prior = document.activeElement;
    const node = ref.current;
    node?.focus();
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const els = [
          ...node.querySelectorAll(
            'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
          ),
        ];
        if (!els.length) return;
        const first = els[0],
          last = els.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      node.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "modal-wide" : "")}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Auth({ onUser }) {
  const [register, setRegister] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/auth/" + (register ? "register" : "login"),
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      await onUser(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <aside className="auth-story">
        <div className="brand">
          <Leaf />
          Stageleaf
        </div>
        <div>
          <span className="eyebrow">THE SPACE BETWEEN PLAN AND SHOWTIME</span>
          <h1>
            Good events.
            <br />
            Calm teams.
          </h1>
          <p>
            One working plan for the people, timings, and decisions that bring
            your event together.
          </p>
          <div className="auth-example">
            <span className="small-label">A PLAN EVERYONE CAN FOLLOW</span>
            <div>
              <Clock size={18} />
              <strong>14:30</strong>
              <span>Doors open</span>
              <CheckCircle2 size={17} />
            </div>
            <div>
              <Users size={18} />
              <strong>Team</strong>
              <span>Clear on what’s next</span>
              <CheckCircle2 size={17} />
            </div>
          </div>
        </div>
        <small>Built around the way an event actually comes together.</small>
      </aside>
      <section className="auth-form">
        <span className="eyebrow">YOUR EVENT WORKSPACE</span>
        <h2>{register ? "Make room for a better plan." : "Welcome back."}</h2>
        <p>
          {register
            ? "Create your private workspace. Start with your own event or explore an optional sample."
            : "Pick up where you left off."}
        </p>
        <form onSubmit={submit}>
          {register && (
            <Field
              label="Your name"
              name="name"
              required
              autoComplete="name"
              maxLength={100}
            />
          )}
          <Field
            label="Email"
            type="email"
            name="email"
            required
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            name="password"
            minLength={register ? 10 : undefined}
            required
            autoComplete={register ? "new-password" : "current-password"}
          />
          {register && (
            <small>
              At least 10 characters. Use a password you don’t use elsewhere.
            </small>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button className="primary full" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create workspace" : "Sign in"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create a workspace"}
        </button>
      </section>
    </main>
  );
}
function Shared({ token }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const load = () =>
    api("/shared/" + token)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [token]);
  async function respond(answer) {
    setBusy(true);
    setError("");
    try {
      await api("/shared/" + token + "/respond", { answer, note });
      await load();
      setNote("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shared">
      <div className="brand">
        <Leaf />
        Stageleaf <span>EVENT BRIEF</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        !error && <p>Loading your brief…</p>
      ) : (
        <>
          <div className="shared-heading">
            <Pill tone="green">
              {data.kind === "decision"
                ? "Decision requested"
                : `Published brief · v${data.version}`}
            </Pill>
            <h1>{data.name}</h1>
            <p>
              {date(data.date)} · {data.venue}
            </p>
            <small>All times in {data.timezone.replaceAll("_", " ")}</small>
          </div>
          <section className="panel">
            <span className="eyebrow">PREPARED FOR</span>
            <h2>{data.person.name}</h2>
            <p>{data.person.role}</p>
            {data.person.arrival !== null && (
              <p>
                Arrive {time(data.person.arrival)}{" "}
                {data.person.departure !== null &&
                  `· Available until ${time(data.person.departure)}`}
              </p>
            )}
            {data.person.notes && (
              <p className="prewrap">{data.person.notes}</p>
            )}
          </section>
          {data.stale && (
            <div className="notice warning">
              <AlertTriangle size={19} />
              <div>
                <strong>This version is no longer current.</strong>
                <p>
                  Ask your planner for a fresh link. Responses to this version
                  are closed.
                </p>
              </div>
            </div>
          )}
          {data.change && (
            <section className="panel">
              <h2>{data.change.title}</h2>
              <p>{data.change.reason}</p>
              <Impact change={data.change} />
            </section>
          )}
          <h2>Your run of show</h2>
          {data.activities.length ? (
            data.activities
              .sort((a, b) => a.start - b.start)
              .map((a) => (
                <article className="brief-row" key={a.id}>
                  <div className="time">
                    {time(a.start)}
                    <small>{a.duration} min</small>
                  </div>
                  <div>
                    <h3>{a.title}</h3>
                    <p>{a.location}</p>
                    {a.notes && <p className="prewrap">{a.notes}</p>}
                    {a.fileUrl && (
                      <a href={a.fileUrl} target="_blank" rel="noreferrer">
                        Open document ↗
                      </a>
                    )}
                  </div>
                </article>
              ))
          ) : (
            <p>No activities assigned in this version.</p>
          )}
          <section className="panel response-panel">
            <h2>
              {data.kind === "decision"
                ? "Can you work with this change?"
                : "Ready for event day?"}
            </h2>
            {data.response && (
              <div className="notice">
                <CheckCircle2 size={20} />
                <div>
                  <strong>{data.response.answer}</strong>
                  <p>
                    {data.response.note ||
                      "Your response has been saved for the planner."}
                  </p>
                  <small>{new Date(data.response.at).toLocaleString()}</small>
                </div>
              </div>
            )}
            {!data.stale && (
              <>
                <Field label="Note for the planner">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Flag a constraint or add a useful detail…"
                    maxLength={2000}
                  />
                </Field>
                <div className="actions">
                  <Button
                    className="primary"
                    disabled={busy}
                    icon={Check}
                    onClick={() =>
                      respond(
                        data.kind === "decision" ? "Approved" : "Acknowledged",
                      )
                    }
                  >
                    {data.kind === "decision"
                      ? "Approve change"
                      : "Acknowledge brief"}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      respond(
                        data.kind === "decision"
                          ? "Declined"
                          : "Correction requested",
                      )
                    }
                  >
                    {data.kind === "decision"
                      ? "Decline with note"
                      : "Request correction"}
                  </Button>
                </div>
                <small>
                  Your response is attached to this version. Anyone with this
                  link can respond as this recipient.
                </small>
              </>
            )}
          </section>
          <Button icon={Download} onClick={() => window.print()}>
            Print / save PDF
          </Button>
        </>
      )}
    </main>
  );
}
function Impact({ change }) {
  return (
    <div className="impact-list">
      {change.impact.map((a) => (
        <div key={a.id}>
          <strong>{a.title}</strong>
          <span>
            {time(a.before)} · {a.beforeDuration}m <ArrowRight size={14} />{" "}
            <b>
              {time(a.after)} · {a.afterDuration}m
            </b>
          </span>
        </div>
      ))}
    </div>
  );
}
export default function App({ initialData }) {
  const shared =
    typeof location !== "undefined"
      ? location.pathname.match(/^\/share\/([^/]+)/)
      : null;
  if (shared) return <Shared token={shared[1]} />;
  return <Workspace initialData={initialData} />;
}
function TeamChat({ event, agents, onManage }) {
  const online = agents.find((a) => a.online);
  const chat = event.chat;
  return (
    <section className="chat-strip" aria-label="Team chat">
      <span className="chat-strip-icon">
        <MessageSquare size={19} />
      </span>
      <div className="chat-strip-main">
        <span className="eyebrow">TEAM CHAT · VIA SWITCH</span>
        <strong>{chat ? "#" + chat.roomName : "No chat room linked"}</strong>
        <small>
          {chat
            ? "Reports, decisions and acknowledgments made in this room are recorded here, with who made them."
            : "Connect the Stageleaf agent through Switch, then ask it to link your event room."}
        </small>
      </div>
      <div className="chat-strip-agent">
        <span className={"live-dot " + (online ? "" : "off")} />
        <span>
          {online ? "Stageleaf agent online" : "Stageleaf agent offline"}
          <small>
            {online
              ? online.model
              : agents.length
                ? "Start it with npm run agent"
                : "No agent connected yet"}
          </small>
        </span>
      </div>
      <div className="chat-strip-actions">
        {chat?.url && (
          <a
            className="button"
            href={chat.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={15} /> Open room
          </a>
        )}
        <Button icon={Bot} onClick={onManage}>
          Agent access
        </Button>
      </div>
    </section>
  );
}
function AgentAccess({ user, agents, busy, onHandle, onCreate, onRevoke }) {
  const [handle, setHandle] = useState(user.chatHandle || "");
  const [created, setCreated] = useState(null);
  return (
    <div className="modal-body agent-access">
      <p>
        The Stageleaf agent joins your team chat through{" "}
        <strong>Switch</strong>. It reads this workspace and acts in it only
        with an agent token, and every action from chat is checked against the
        sender’s own chat account.
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          onHandle(handle);
        }}
      >
        <Field label="Your chat handle (lead planner)">
          <input
            value={handle}
            placeholder="@alex"
            onChange={(e) => setHandle(e.target.value)}
          />
        </Field>
        <Button disabled={busy} type="submit">
          Save
        </Button>
      </form>
      <small className="field-hint">
        Only this handle can link a room or publish a revision from chat.
        Give each contact their own handle in Team & vendors.
      </small>
      <div className="decision-title">AGENT TOKENS</div>
      {agents.length ? (
        agents.map((a) => (
          <div className="token-row" key={a.id}>
            <span className={"live-dot " + (a.online ? "" : "off")} />
            <div>
              <strong>{a.label}</strong>
              <small>
                {a.online
                  ? `Online · ${a.model}${a.rooms.length ? " · " + a.rooms.map((r) => "#" + (r.name || r.id.slice(0, 6))).join(", ") : ""}`
                  : a.lastSeen
                    ? `Last seen ${new Date(a.lastSeen).toLocaleString()}`
                    : "Not connected yet"}
              </small>
            </div>
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() => onRevoke(a.id)}
            >
              Revoke
            </button>
          </div>
        ))
      ) : (
        <p className="muted">No agent tokens yet.</p>
      )}
      {created ? (
        <>
          <Field label="New agent token (shown once)">
            <input
              readOnly
              value={created}
              onFocus={(e) => e.target.select()}
            />
          </Field>
          <small className="field-hint">
            Start the agent with{" "}
            <code>STAGELEAF_AGENT_TOKEN=… npm run agent</code>. Then, in the
            event’s room, say <code>@stageleaf link this room to</code> and
            the event name.
          </small>
        </>
      ) : (
        <Button
          icon={Plus}
          className="primary"
          disabled={busy}
          onClick={async () => setCreated(await onCreate())}
        >
          Create agent token
        </Button>
      )}
    </div>
  );
}
function Workspace({ initialData }) {
  const [user, setUser] = useState(initialData?.user || null),
    [loading, setLoading] = useState(!initialData),
    [events, setEvents] = useState(initialData?.events || []),
    [selected, setSelected] = useState(initialData?.selected || null),
    [tab, setTab] = useState(initialData?.tab || "overview"),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(false),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [nav, setNav] = useState(false),
    [agents, setAgents] = useState(initialData?.agents || []);
  const event = events.find((e) => e.id === selected),
    eventRef = useRef(event);
  eventRef.current = event;
  const timer = useRef();
  function tell(message) {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  async function refresh() {
    const all = await api("/events");
    setEvents(all);
    setSyncError(false);
    api("/agent-tokens")
      .then(setAgents)
      .catch(() => {});
    return all;
  }
  useEffect(() => {
    if (initialData) return;
    api("/auth/me")
      .then(async (x) => {
        setUser(x.user);
        if (x.user) await refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => setSyncError(true));
    }, 5000);
    return () => clearInterval(timer);
  }, [user]);
  async function action(fn, message, close = true) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (message) tell(message);
      if (close) setModal(null);
      return result;
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await refresh().catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  }
  function put(e) {
    setEvents((all) =>
      all.some((x) => x.id === e.id)
        ? all.map((x) => (x.id === e.id ? e : x))
        : [...all, e],
    );
  }
  async function mutate(operation, payload = {}, version) {
    const e = eventRef.current;
    const result = await api(
      "/events/" + e.id,
      { expectedVersion: version ?? e.version, operation, payload },
      "PATCH",
    );
    put(result);
    return result;
  }
  function open(kind, record = {}) {
    setError("");
    setModal({ kind, record, version: event?.version });
  }
  function choose(e) {
    setSelected(e.id);
    setTab("overview");
    setSearch("");
    setNav(false);
    setError("");
  }
  async function share(personId, changeId) {
    await action(
      async () => {
        const result = await api("/events/" + event.id + "/share", {
          personId,
          changeId,
        });
        setModal({
          kind: "share",
          record: {
            ...result,
            url: location.origin + result.path,
            person: event.contacts.find((c) => c.id === personId),
          },
        });
      },
      "",
      false,
    );
  }
  if (loading)
    return (
      <main className="loading">
        <Leaf />
        <p>Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <>
        {error && <p className="error">{error}</p>}
        <Auth
          onUser={async (u) => {
            await refresh();
            setUser(u);
          }}
        />
      </>
    );
  const latest = event?.publications.at(-1),
    unpublished = event && latest?.contentVersion !== event.contentVersion;
  const filtered = events.filter(
    (e) =>
      (archived ? e.status === "Archived" : e.status !== "Archived") &&
      `${e.name} ${e.venue}`.toLowerCase().includes(search.toLowerCase()),
  );
  const completed = event?.tasks.filter((t) => t.status === "Done").length || 0;
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (nav ? "is-open" : "")}>
        <button
          className="brand"
          onClick={() => {
            setSelected(null);
            setNav(false);
          }}
        >
          <Leaf size={26} />
          Stageleaf
        </button>
        <div className="workspace-label">
          {user.name.split(" ")[0]}’s workspace
        </div>
        <button
          className={"nav-item " + (!event ? "active" : "")}
          onClick={() => {
            setSelected(null);
            setNav(false);
          }}
        >
          <CalendarDays size={18} />
          Events
          <span>{events.filter((e) => e.status !== "Archived").length}</span>
        </button>
        <div className="sidebar-section">
          <span className="small-label">RECENT EVENTS</span>
          {events
            .filter((e) => e.status !== "Archived")
            .slice(-5)
            .reverse()
            .map((e) => (
              <button
                key={e.id}
                className={"event-nav " + (selected === e.id ? "selected" : "")}
                onClick={() => choose(e)}
              >
                <span className="event-dot" />
                {e.name}
              </button>
            ))}
        </div>
        <div className="sidebar-note">
          <Leaf size={19} />
          <p>
            A clear plan.
            <br />A little more breathing room.
          </p>
        </div>
        <div className="user">
          <span className="avatar">{initials(user.name)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>Planner</small>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            className="icon-button"
            onClick={() =>
              action(async () => {
                await api("/auth/logout", {});
                setUser(null);
                setEvents([]);
                setSelected(null);
              }, "")
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setNav(!nav)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            <button onClick={() => setSelected(null)}>Events</button>
            {event && (
              <>
                <ChevronRight size={14} />
                <span>{event.name}</span>
              </>
            )}
          </div>
          <span className="topbar-note">
            <span className="live-dot" />
            Private workspace
          </span>
        </header>
        <main className="workspace">
          {syncError && (
            <div className="notice warning" role="status">
              <AlertTriangle size={18} />
              <span>
                Updates are paused. This is your last loaded plan. Check your
                connection before relying on new responses.
              </span>
              <button
                className="text-button"
                onClick={() => action(refresh, "Plan refreshed", false)}
              >
                Retry
              </button>
            </div>
          )}
          {error && !modal && (
            <div className="notice error" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {!event ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR WORKSPACE</span>
                  <h1>Events</h1>
                  <p>From the first plan to the final cue.</p>
                </div>
                <Button
                  icon={Plus}
                  className="primary"
                  onClick={() => open("event")}
                >
                  Create event
                </Button>
              </div>
              <div className="list-toolbar">
                <div className="segmented">
                  <button
                    className={!archived ? "chosen" : ""}
                    onClick={() => setArchived(false)}
                  >
                    Active events
                  </button>
                  <button
                    className={archived ? "chosen" : ""}
                    onClick={() => setArchived(true)}
                  >
                    Archived
                  </button>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search events"
                    placeholder="Find an event…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              {filtered.length ? (
                <div className="event-list">
                  {filtered.map((e) => (
                    <button
                      className="event-list-row"
                      key={e.id}
                      onClick={() => choose(e)}
                    >
                      <div className="date-tile">
                        <small>
                          {new Date(e.date + "T12:00:00").toLocaleString("en", {
                            month: "short",
                          })}
                        </small>
                        <strong>{e.date.slice(-2)}</strong>
                      </div>
                      <div className="event-row-main">
                        <h2>
                          {e.name} {e.sample && <Pill>Sample</Pill>}
                        </h2>
                        <p>
                          {e.venue || "Venue to be decided"} · {e.guests} guests
                        </p>
                      </div>
                      <div className="event-row-meta">
                        <Pill tone={e.status === "Live" ? "green" : ""}>
                          {e.status}
                        </Pill>
                        <small>
                          {e.activities.length} activities · {e.contacts.length}{" "}
                          people
                        </small>
                      </div>
                      <ChevronRight size={19} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title={
                    search
                      ? "No events match your search"
                      : archived
                        ? "No archived events"
                        : "Your next event starts here"
                  }
                  action={
                    !search &&
                    !archived && (
                      <div className="actions">
                        <Button
                          icon={Plus}
                          className="primary"
                          onClick={() => open("event")}
                        >
                          Create your first event
                        </Button>
                        <Button
                          onClick={() =>
                            action(async () => {
                              const e = await api("/events", { sample: true });
                              put(e);
                              choose(e);
                            }, "Sample event added")
                          }
                        >
                          Explore a sample
                        </Button>
                      </div>
                    )
                  }
                >
                  {search
                    ? "Try a different name or venue."
                    : archived
                      ? "Archive completed events from Event settings."
                      : "Build a run of show, bring in your team, and give everyone a brief they can trust."}
                </Empty>
              )}
              {events.length > 0 && (
                <button
                  className="text-button subtle"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const e = await api("/events", { sample: true });
                      put(e);
                      choose(e);
                    }, "Sample event added")
                  }
                >
                  Add an optional sample event
                </button>
              )}
            </>
          ) : (
            <>
              <div className="page-heading event-heading">
                <div>
                  <div className="heading-kicker">
                    <button
                      className="back"
                      aria-label="Back to events"
                      onClick={() => setSelected(null)}
                    >
                      <ArrowLeft size={17} />
                    </button>
                    <span className="eyebrow">EVENT WORKSPACE</span>
                    <Pill>{event.status}</Pill>
                    {event.sample && <Pill>Sample data</Pill>}
                  </div>
                  <h1>{event.name}</h1>
                  <div className="event-details">
                    <span>
                      <CalendarDays size={15} />
                      {date(event.date)}
                    </span>
                    <span>
                      <MapPin size={15} />
                      {event.venue || "Set a venue"}
                    </span>
                    <span>
                      <Users size={15} />
                      {event.guests} guests
                    </span>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="icon-button outlined"
                    title="Event settings"
                    aria-label="Event settings"
                    onClick={() => open("event", event)}
                  >
                    <Settings size={19} />
                  </button>
                  <Button
                    icon={Send}
                    className="primary"
                    onClick={() => open("publish")}
                  >
                    {latest ? "Publish revision" : "Publish brief"}
                  </Button>
                </div>
              </div>
              <div
                className="event-tabs"
                role="tablist"
                aria-label="Event sections"
              >
                {tabs.map(([key, label]) => (
                  <button
                    role="tab"
                    aria-selected={tab === key}
                    key={key}
                    onClick={() => {
                      setTab(key);
                      setSearch("");
                    }}
                    className={tab === key ? "active" : ""}
                  >
                    {label}
                    {key === "changes" &&
                      event.changes.filter((c) => c.status === "Proposed")
                        .length > 0 && (
                        <span className="count">
                          {
                            event.changes.filter((c) => c.status === "Proposed")
                              .length
                          }
                        </span>
                      )}
                  </button>
                ))}
                <span className="draft-state">
                  <span
                    className={"live-dot " + (unpublished ? "amber" : "")}
                  />
                  {unpublished
                    ? "Unpublished edits"
                    : `Published v${latest?.version}`}
                </span>
              </div>
              {tab === "overview" && (
                <>
                  <div className="overview-intro">
                    <div>
                      <span className="eyebrow">THE BIG PICTURE</span>
                      <h2>
                        {event.conflicts.length
                          ? "A few things need your attention."
                          : "A little clarity before showtime."}
                      </h2>
                      <p>
                        Your working plan, outstanding decisions, and latest
                        published brief.
                      </p>
                    </div>
                    <div className="venue-hours">
                      <Clock size={18} />
                      <span>
                        <strong>
                          {time(event.start)} — {time(event.end)}
                        </strong>
                        <small>{event.timezone.replaceAll("_", " ")}</small>
                      </span>
                    </div>
                  </div>
                  <div className="stats-strip">
                    <div>
                      <span>Run of show</span>
                      <strong>
                        {event.activities.length}
                        <small>activities</small>
                      </strong>
                    </div>
                    <div>
                      <span>People involved</span>
                      <strong>
                        {event.contacts.length}
                        <small>team & vendors</small>
                      </strong>
                    </div>
                    <div>
                      <span>Tasks completed</span>
                      <strong>
                        {completed}
                        <small>of {event.tasks.length}</small>
                      </strong>
                    </div>
                    <div>
                      <span>Current brief</span>
                      <strong>
                        {latest ? "v" + latest.version : "—"}
                        <small>
                          {latest
                            ? date(latest.at.slice(0, 10))
                            : "Not published"}
                        </small>
                      </strong>
                    </div>
                  </div>
                  <TeamChat
                    event={event}
                    agents={agents}
                    onManage={() => open("agent")}
                  />
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="section-title">
                        <h2>Needs attention</h2>
                        <Pill tone="amber">
                          {event.conflicts.length +
                            event.tasks.filter((t) => t.status === "Blocked")
                              .length +
                            event.changes.filter((c) => c.status === "Proposed")
                              .length}
                        </Pill>
                      </div>
                      {event.conflicts.map((c, i) => (
                        <button
                          className="attention-row"
                          key={i}
                          onClick={() => setTab("schedule")}
                        >
                          <AlertTriangle size={18} />
                          <span>{c}</span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                      {event.changes
                        .filter((c) => c.status === "Proposed")
                        .map((c) => (
                          <button
                            key={c.id}
                            className="attention-row"
                            onClick={() => setTab("changes")}
                          >
                            <GitBranch size={18} />
                            <span>
                              {c.title}
                              <small>
                                {c.base !== event.contentVersion
                                  ? "Outdated proposal — review required"
                                  : "Waiting for decisions"}
                              </small>
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      {event.tasks
                        .filter((t) => t.status === "Blocked")
                        .map((t) => (
                          <button
                            key={t.id}
                            className="attention-row"
                            onClick={() => open("task", t)}
                          >
                            <AlertTriangle size={18} />
                            <span>
                              {t.title}
                              <small>Blocked task</small>
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      {!event.conflicts.length &&
                        !event.changes.some((c) => c.status === "Proposed") &&
                        !event.tasks.some((t) => t.status === "Blocked") && (
                          <div className="calm-state">
                            <CheckCircle2 size={25} />
                            <h3>No recorded blockers.</h3>
                            <p>
                              {event.activities.length
                                ? "Check availability and collect confirmations before event day."
                                : "Add your schedule and people to start checking the plan."}
                            </p>
                          </div>
                        )}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h2>The day at a glance</h2>
                        <button
                          className="text-button"
                          onClick={() => setTab("schedule")}
                        >
                          Full schedule <ArrowRight size={14} />
                        </button>
                      </div>
                      {event.activities.length ? (
                        [...event.activities]
                          .sort((a, b) => a.start - b.start)
                          .slice(0, 5)
                          .map((a) => (
                            <button
                              key={a.id}
                              className="timeline-row"
                              onClick={() => open("activity", a)}
                            >
                              <span>{time(a.start)}</span>
                              <i />
                              <div>
                                <strong>{a.title}</strong>
                                <small>
                                  {a.location || "Location not set"}
                                </small>
                              </div>
                            </button>
                          ))
                      ) : (
                        <p className="muted">
                          Your first activity will appear here.
                        </p>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h2>Published brief</h2>
                        <FileText size={18} />
                      </div>
                      <p>
                        {latest
                          ? `Version ${latest.version} is available to share. Edits stay in your working draft until you publish again.`
                          : "Publish a version when your plan is ready. Each person gets only their assigned activities and commitments."}
                      </p>
                      <Button onClick={() => setTab("contacts")} icon={Users}>
                        Manage people & brief links
                      </Button>
                      {event.responses
                        .filter(
                          (r) =>
                            r.scope === "brief" &&
                            r.version === latest?.version,
                        )
                        .map((r) => (
                          <div className="response-summary" key={r.person}>
                            <span>
                              {
                                event.contacts.find((c) => c.id === r.person)
                                  ?.name
                              }
                            </span>
                            <Pill
                              tone={
                                r.answer === "Acknowledged" ? "green" : "amber"
                              }
                            >
                              {r.answer}
                            </Pill>
                            <small className="via">{via(r)}</small>
                            {r.note && <small>{r.note}</small>}
                          </div>
                        ))}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h2>Recent activity</h2>
                        <Clock size={18} />
                      </div>
                      <div className="history">
                        {event.history.slice(0, 4).map((h) => (
                          <div key={h.id}>
                            <span className="history-dot" />
                            <p>
                              {h.text}
                              <small>
                                {h.actor} · {new Date(h.at).toLocaleString()}
                              </small>
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "schedule" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Run of show</h2>
                      <p>
                        The working schedule ·{" "}
                        {event.timezone.replaceAll("_", " ")} ·{" "}
                        {event.activities.length} activities
                      </p>
                    </div>
                    <div className="actions">
                      <Button icon={Upload} onClick={() => open("import")}>
                        Import CSV
                      </Button>
                      <Button
                        icon={Download}
                        disabled={!event.activities.length}
                        onClick={() => downloadCSV(event)}
                      >
                        Export
                      </Button>
                      <Button
                        icon={Plus}
                        className="primary"
                        onClick={() => open("activity")}
                      >
                        Add activity
                      </Button>
                    </div>
                  </div>
                  {event.conflicts.length > 0 && (
                    <div className="notice warning">
                      <AlertTriangle size={20} />
                      <div>
                        <strong>
                          {event.conflicts.length} schedule{" "}
                          {event.conflicts.length === 1
                            ? "conflict"
                            : "conflicts"}{" "}
                          to resolve before publishing
                        </strong>
                        {event.conflicts.map((c, i) => (
                          <p key={i}>{c}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {event.activities.length ? (
                    <div className="table-wrap">
                      <table className="schedule-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Activity</th>
                            <th>Location</th>
                            <th>Responsible</th>
                            <th>Length</th>
                            <th>
                              <span className="sr-only">Edit</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...event.activities]
                            .sort((a, b) => a.start - b.start)
                            .map((a) => (
                              <tr key={a.id}>
                                <td className="time">
                                  {time(a.start)}
                                  <small>{time(a.start + a.duration)}</small>
                                </td>
                                <td>
                                  <button
                                    className="row-title"
                                    onClick={() => open("activity", a)}
                                  >
                                    {a.title}
                                  </button>
                                  <div className="row-tags">
                                    {a.fixed && (
                                      <span>
                                        <Lock size={11} />
                                        Fixed time
                                      </span>
                                    )}
                                    {a.notes && (
                                      <span>
                                        <FileText size={11} />
                                        Instructions
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {a.location || (
                                    <span className="muted">Not set</span>
                                  )}
                                </td>
                                <td>
                                  <span className="person-cell">
                                    {a.ownerId ? (
                                      <>
                                        <span className="avatar tiny">
                                          {initials(
                                            event.contacts.find(
                                              (c) => c.id === a.ownerId,
                                            )?.name || "?",
                                          )}
                                        </span>
                                        {
                                          event.contacts.find(
                                            (c) => c.id === a.ownerId,
                                          )?.name
                                        }
                                      </>
                                    ) : (
                                      <span className="muted">Unassigned</span>
                                    )}
                                  </span>
                                </td>
                                <td>{a.duration} min</td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={"Edit " + a.title}
                                    onClick={() => open("activity", a)}
                                  >
                                    <MoreHorizontal size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={Clock}
                      title="Give the day a shape"
                      action={
                        <Button
                          className="primary"
                          icon={Plus}
                          onClick={() => open("activity")}
                        >
                          Add first activity
                        </Button>
                      }
                    >
                      Start with doors opening, the main sessions, and the
                      commitments that cannot move.
                    </Empty>
                  )}
                  <div className="bottom-note">
                    <Lock size={14} />
                    Fixed activities stay in place when you shift later
                    activities in a change proposal.
                    <button
                      className="text-button"
                      onClick={() => {
                        setTab("changes");
                        open("propose");
                      }}
                      disabled={!event.activities.length}
                    >
                      Propose a timing change <ArrowRight size={13} />
                    </button>
                  </div>
                </>
              )}
              {tab === "contacts" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>The people behind the event</h2>
                      <p>
                        Responsibilities, availability, and a brief for each
                        person.
                      </p>
                    </div>
                    <Button
                      icon={Plus}
                      className="primary"
                      onClick={() => open("contact")}
                    >
                      Add person
                    </Button>
                  </div>
                  {event.contacts.length ? (
                    <div className="people-list">
                      {event.contacts.map((c) => {
                        const response = event.responses.find(
                          (r) =>
                            r.person === c.id &&
                            r.scope === "brief" &&
                            r.version === latest?.version,
                        );
                        return (
                          <article key={c.id} className="person-row">
                            <span className="avatar large">
                              {initials(c.name)}
                            </span>
                            <div className="person-info">
                              <button
                                className="row-title"
                                onClick={() => open("contact", c)}
                              >
                                {c.name}
                              </button>
                              <p>
                                {c.role || c.type}
                                {c.company && " · " + c.company}
                                {c.handle && (
                                  <span className="handle">@{c.handle}</span>
                                )}
                              </p>
                              <small>
                                {c.arrival !== null
                                  ? `Available ${time(c.arrival)}${c.departure !== null ? "–" + time(c.departure) : " onwards"}`
                                  : "Availability not recorded"}{" "}
                                · {c.confirmation}
                              </small>
                              {response?.note && (
                                <p className="response-note">
                                  “{response.note}”
                                </p>
                              )}
                            </div>
                            <div className="person-status">
                              <Pill
                                tone={
                                  response?.answer === "Acknowledged"
                                    ? "green"
                                    : response
                                      ? "amber"
                                      : ""
                                }
                              >
                                {response?.answer ||
                                  (!latest
                                    ? "Not published"
                                    : mustAcknowledge(event).has(c.id)
                                      ? "Not acknowledged"
                                      : `No changes in v${latest.version}`)}
                              </Pill>
                              {response && (
                                <small className="via">{via(response)}</small>
                              )}
                              <small>
                                {
                                  event.activities.filter(
                                    (a) =>
                                      a.ownerId === c.id || a.vendorId === c.id,
                                  ).length
                                }{" "}
                                assigned activities
                              </small>
                            </div>
                            <Button
                              disabled={busy || !latest}
                              icon={ExternalLink}
                              onClick={() => share(c.id)}
                            >
                              Brief link
                            </Button>
                            <button
                              className="icon-button"
                              aria-label={"Edit " + c.name}
                              onClick={() => open("contact", c)}
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty
                      icon={Users}
                      title="Bring the right people into the plan"
                      action={
                        <Button
                          icon={Plus}
                          className="primary"
                          onClick={() => open("contact")}
                        >
                          Add first person
                        </Button>
                      }
                    >
                      Record your team, speakers, and vendors. Assign their
                      activities and keep their constraints close.
                    </Empty>
                  )}
                  <div className="bottom-note">
                    <FileText size={15} />
                    {latest
                      ? "Brief links share the published version, not your working edits. Links expire after 14 days."
                      : "Publish a brief to enable recipient links. No email is sent automatically."}
                    {latest && (
                      <button
                        className="text-button danger"
                        onClick={() => open("revoke")}
                      >
                        Revoke all event links
                      </button>
                    )}
                  </div>
                </>
              )}
              {tab === "tasks" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Make the plan happen</h2>
                      <p>
                        {completed} of {event.tasks.length} tasks complete.
                        Click a task to update its owner, status, or due date.
                      </p>
                    </div>
                    <Button
                      icon={Plus}
                      className="primary"
                      onClick={() => open("task")}
                    >
                      Add task
                    </Button>
                  </div>
                  {event.tasks.length ? (
                    <div className="task-list">
                      {event.tasks.map((t) => (
                        <div
                          className={
                            "task-row " + (t.status === "Done" ? "done" : "")
                          }
                          key={t.id}
                        >
                          <button
                            className="task-check"
                            aria-label={
                              (t.status === "Done" ? "Reopen " : "Complete ") +
                              t.title
                            }
                            disabled={busy}
                            onClick={() =>
                              action(
                                () =>
                                  mutate("task", {
                                    ...t,
                                    status:
                                      t.status === "Done" ? "To do" : "Done",
                                  }),
                                "Task updated",
                                false,
                              )
                            }
                          >
                            {t.status === "Done" && <Check size={15} />}
                          </button>
                          <button
                            className="task-main"
                            onClick={() => open("task", t)}
                          >
                            <strong>{t.title}</strong>
                            <small>
                              {event.contacts.find((c) => c.id === t.ownerId)
                                ?.name || "Unassigned"}
                              {t.activityId &&
                                " · " +
                                  event.activities.find(
                                    (a) => a.id === t.activityId,
                                  )?.title}
                            </small>
                          </button>
                          <span className="task-date">
                            {t.due ? date(t.due) : "No due date"}
                          </span>
                          <Pill
                            tone={
                              t.status === "Done"
                                ? "green"
                                : t.status === "Blocked"
                                  ? "amber"
                                  : ""
                            }
                          >
                            {t.status}
                          </Pill>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={ClipboardList}
                      title="Turn details into done"
                      action={
                        <Button
                          icon={Plus}
                          className="primary"
                          onClick={() => open("task")}
                        >
                          Add first task
                        </Button>
                      }
                    >
                      Add the decisions, handoffs, and follow-ups that make the
                      day run well.
                    </Empty>
                  )}
                </>
              )}
              {tab === "changes" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>When one thing changes</h2>
                      <p>
                        Review the timing impact, collect decisions, then update
                        the working plan.
                      </p>
                    </div>
                    <Button
                      icon={Plus}
                      className="primary"
                      disabled={!event.activities.length}
                      onClick={() => open("propose")}
                    >
                      Propose change
                    </Button>
                  </div>
                  {event.changes.length ? (
                    event.changes.map((c) => {
                      const stale =
                        c.status === "Proposed" &&
                        c.base !== event.contentVersion;
                      const approved = c.required.every((person) =>
                        event.responses.some(
                          (r) =>
                            r.person === person &&
                            r.scope === c.id &&
                            r.version === c.base &&
                            r.answer === "Approved",
                        ),
                      );
                      return (
                        <section className="change-card" key={c.id}>
                          <div className="section-title">
                            <div>
                              <Pill
                                tone={
                                  stale
                                    ? "amber"
                                    : c.status === "Applied"
                                      ? "green"
                                      : ""
                                }
                              >
                                {stale ? "Outdated" : c.status}
                              </Pill>
                              <h2>{c.title}</h2>
                            </div>
                            <small>
                              {new Date(c.createdAt).toLocaleDateString()}
                            </small>
                          </div>
                          <p>{c.reason}</p>
                          {c.source?.channel === "switch" && (
                            <p className="source-line">
                              <MessageSquare size={14} />
                              Reported by {c.source.reportedBy?.name} (@
                              {c.source.reportedBy?.handle}) in #
                              {c.source.roomName} · proposed by the Stageleaf
                              agent via Switch
                            </p>
                          )}
                          <Impact change={c} />
                          {!stale &&
                            c.status === "Proposed" &&
                            c.issues?.length > 0 && (
                              <div className="notice warning">
                                <AlertTriangle size={18} />
                                <div>
                                  <strong>
                                    This proposal has unresolved constraints
                                  </strong>
                                  {c.issues.map((issue, i) => (
                                    <p key={i}>{issue}</p>
                                  ))}
                                  <p>
                                    Cancel this proposal and revise the plan
                                    before requesting decisions.
                                  </p>
                                </div>
                              </div>
                            )}
                          {stale && (
                            <p className="warning-text">
                              The working plan changed after this proposal.
                              Cancel it and create a fresh proposal.
                            </p>
                          )}
                          {c.status === "Proposed" && !stale && (
                            <>
                              <div className="decision-title">
                                DECISIONS NEEDED{" "}
                                <span>{c.required.length} people</span>
                              </div>
                              {c.required.map((id) => {
                                const person = event.contacts.find(
                                    (x) => x.id === id,
                                  ),
                                  response = event.responses.find(
                                    (r) =>
                                      r.person === id &&
                                      r.scope === c.id &&
                                      r.version === c.base,
                                  );
                                return (
                                  <div className="decision-row" key={id}>
                                    <span className="avatar tiny">
                                      {initials(person?.name || "?")}
                                    </span>
                                    <div>
                                      <strong>
                                        {person?.name}
                                        {person?.handle && (
                                          <span className="handle">
                                            @{person.handle}
                                          </span>
                                        )}
                                      </strong>
                                      {response && (
                                        <small className="via">
                                          {response.answer} {via(response)}
                                        </small>
                                      )}
                                      {response?.note && (
                                        <small>“{response.note}”</small>
                                      )}
                                    </div>
                                    <Pill
                                      tone={
                                        response?.answer === "Approved"
                                          ? "green"
                                          : response
                                            ? "amber"
                                            : ""
                                      }
                                    >
                                      {response?.answer || "Awaiting response"}
                                    </Pill>
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() => share(id, c.id)}
                                    >
                                      Get decision link{" "}
                                      <ExternalLink size={13} />
                                    </button>
                                  </div>
                                );
                              })}
                              {!c.required.length && (
                                <p className="muted">
                                  No owners are assigned to affected activities.
                                  The planner can apply this change directly.
                                </p>
                              )}
                            </>
                          )}
                          {c.status === "Proposed" && (
                            <div className="change-actions">
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    () => mutate("cancelChange", { id: c.id }),
                                    "Proposal cancelled",
                                  )
                                }
                              >
                                Cancel proposal
                              </Button>
                              <Button
                                className="primary"
                                disabled={
                                  busy ||
                                  stale ||
                                  !approved ||
                                  !!c.issues?.length
                                }
                                onClick={() =>
                                  action(
                                    () => mutate("applyChange", { id: c.id }),
                                    "Approved change applied. Publish a revision when ready.",
                                  )
                                }
                              >
                                Apply to working plan
                              </Button>
                            </div>
                          )}
                        </section>
                      );
                    })
                  ) : (
                    <Empty
                      icon={GitBranch}
                      title="A change deserves a clear plan"
                      action={
                        event.activities.length > 0 && (
                          <Button
                            icon={Plus}
                            className="primary"
                            onClick={() => open("propose")}
                          >
                            Propose first change
                          </Button>
                        )
                      }
                    >
                      Move a session or adjust its length. See what follows,
                      keep fixed commitments in place, and get decisions from
                      the affected people.
                    </Empty>
                  )}
                  <p className="bottom-note">
                    Checks cover schedule overlaps, venue hours, and recorded
                    availability. Confirm unrecorded commitments with your team.
                  </p>
                </>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Stageleaf · Event operations</span>
          <span>Saved on this server · Refreshes every 5 seconds</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              event: modal.record.id ? "Event settings" : "Create an event",
              activity: modal.record.id
                ? "Activity details"
                : "Add an activity",
              contact: modal.record.id ? "Person details" : "Add a person",
              task: modal.record.id ? "Task details" : "Add a task",
              propose: "Propose a timing change",
              publish: "Publish your event brief",
              import: "Import a run of show",
              share: "Share a scoped link",
              revoke: "Revoke event links",
              agent: "Agent access",
              remove: "Remove this record?",
            }[modal.kind]
          }
          subtitle={
            modal.kind === "event"
              ? "The essentials your working plan will be built around."
              : undefined
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError("");
            }
          }}
          wide={["event", "activity", "contact", "propose"].includes(
            modal.kind,
          )}
        >
          {error && (
            <p className="error modal-error" role="alert">
              {error}
            </p>
          )}
          {["event", "activity", "contact", "task", "propose"].includes(
            modal.kind,
          ) && (
            <RecordForm
              key={modal.kind + modal.record.id}
              kind={modal.kind}
              record={modal.record}
              event={event}
              busy={busy}
              onCancel={() => setModal(null)}
              onDelete={() =>
                setModal({
                  ...modal,
                  kind: "remove",
                  operation: {
                    activity: "deleteActivity",
                    contact: "deleteContact",
                    task: "deleteTask",
                  }[modal.kind],
                })
              }
              onDuplicate={() =>
                action(async () => {
                  const e = await api("/events/" + event.id + "/duplicate", {});
                  put(e);
                  choose(e);
                }, "Event duplicated with fresh records")
              }
              onSubmit={(payload) =>
                action(
                  async () => {
                    if (modal.kind === "event" && !modal.record.id) {
                      const e = await api("/events", payload);
                      put(e);
                      choose(e);
                      return e;
                    }
                    return mutate(
                      modal.kind === "event" ? "settings" : modal.kind,
                      payload,
                      modal.version,
                    );
                  },
                  modal.kind === "propose"
                    ? "Proposal created. The working schedule is unchanged."
                    : "Saved",
                )
              }
            />
          )}
          {modal.kind === "publish" && (
            <div className="modal-body">
              <div className="publication-icon">
                <Send size={24} />
              </div>
              <h3>
                {latest
                  ? `Publish version ${latest.version + 1}`
                  : "Create your first published version"}
              </h3>
              <p>
                Publish a snapshot of the current schedule, people, and
                commitments. You can then create a separate brief link for each
                person.
              </p>
              <div className="publish-summary">
                <span>{event.activities.length} activities</span>
                <span>{event.contacts.length} people</span>
                <span>{event.conflicts.length} conflicts</span>
              </div>
              {latest && (
                <p className="notice warning">
                  Existing links will show an outdated notice. Share new links
                  after publishing this revision.
                </p>
              )}
              {event.conflicts.length > 0 && (
                <div className="error">
                  {event.conflicts.map((c, i) => (
                    <p key={i}>{c}</p>
                  ))}
                </div>
              )}
              {event.changes.some((c) => c.status === "Proposed") && (
                <p className="error">
                  Resolve or cancel all open change proposals first.
                </p>
              )}
              <div className="form-actions">
                <Button onClick={() => setModal(null)}>Keep editing</Button>
                <Button
                  className="primary"
                  disabled={
                    busy ||
                    !unpublished ||
                    !event.activities.length ||
                    !!event.conflicts.length ||
                    event.changes.some((c) => c.status === "Proposed")
                  }
                  onClick={() =>
                    action(
                      () => mutate("publish", {}, modal.version),
                      "Brief published. Create recipient links in Team & vendors.",
                    )
                  }
                >
                  {busy
                    ? "Publishing…"
                    : unpublished
                      ? "Publish brief"
                      : "Already published"}
                </Button>
              </div>
            </div>
          )}
          {modal.kind === "share" && (
            <div className="modal-body">
              <div className="notice">
                <Lock size={18} />
                <p>
                  For <strong>{modal.record.person.name}</strong>. This link
                  shows only their assigned activities, commitments, and
                  relevant timing changes.
                </p>
              </div>
              <p>
                Anyone with the link can view it and respond as this recipient.
                Share it directly with the intended person.
              </p>
              <Field label="Recipient link">
                <input
                  readOnly
                  value={modal.record.url}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <small>
                Expires {date(modal.record.expires.slice(0, 10))}. No message
                has been sent.
              </small>
              <div className="form-actions">
                <Button
                  icon={ExternalLink}
                  onClick={() =>
                    window.open(
                      modal.record.url,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  Open brief
                </Button>
                <Button
                  icon={Copy}
                  className="primary"
                  onClick={() =>
                    action(
                      async () => {
                        await navigator.clipboard.writeText(modal.record.url);
                      },
                      "Link copied",
                      false,
                    )
                  }
                >
                  Copy link
                </Button>
              </div>
            </div>
          )}
          {modal.kind === "agent" && (
            <AgentAccess
              user={user}
              agents={agents}
              busy={busy}
              onHandle={(chatHandle) =>
                action(
                  async () => {
                    const r = await api("/account", { chatHandle }, "PATCH");
                    setUser(r.user);
                  },
                  "Chat handle saved",
                  false,
                )
              }
              onCreate={() =>
                action(
                  async () => {
                    const t = await api("/agent-tokens", {
                      label: "Switch agent",
                    });
                    setAgents(await api("/agent-tokens"));
                    return t.token;
                  },
                  "Agent token created",
                  false,
                )
              }
              onRevoke={(id) =>
                action(
                  async () => {
                    await api("/agent-tokens/" + id, {}, "DELETE");
                    setAgents(await api("/agent-tokens"));
                  },
                  "Agent token revoked",
                  false,
                )
              }
            />
          )}
          {modal.kind === "import" && (
            <ImportForm
              busy={busy}
              onSubmit={(rows) =>
                action(
                  () => mutate("import", { rows }, modal.version),
                  "Activities imported",
                )
              }
            />
          )}
          {modal.kind === "revoke" && (
            <div className="modal-body">
              <p>
                All brief and decision links for this event will stop working.
                Saved responses remain in the event history. You can create new
                links afterwards.
              </p>
              <div className="form-actions">
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  className="danger-fill"
                  disabled={busy}
                  onClick={() =>
                    action(
                      () => api("/events/" + event.id + "/revoke-links", {}),
                      "All event links revoked",
                    )
                  }
                >
                  Revoke all links
                </Button>
              </div>
            </div>
          )}
          {modal.kind === "remove" && (
            <div className="modal-body">
              <p>
                Remove{" "}
                <strong>{modal.record.title || modal.record.name}</strong> from
                the working plan? Existing published snapshots stay unchanged.
              </p>
              <div className="form-actions">
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  className="danger-fill"
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        mutate(
                          modal.operation,
                          { id: modal.record.id },
                          modal.version,
                        ),
                      "Record removed",
                    )
                  }
                >
                  Remove record
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function RecordForm({
  kind,
  record,
  event,
  busy,
  onSubmit,
  onCancel,
  onDelete,
  onDuplicate,
}) {
  const first = event?.activities.find((a) => !a.fixed) || event?.activities[0];
  const defaults =
    kind === "event"
      ? {
          ...EMPTY,
          ...record,
          start:
            typeof record.start === "number" ? time(record.start) : EMPTY.start,
          end: typeof record.end === "number" ? time(record.end) : EMPTY.end,
        }
      : kind === "activity"
        ? {
            title: "",
            start: time(event?.start ?? 540),
            duration: 30,
            location: "",
            ownerId: "",
            vendorId: "",
            fixed: false,
            notes: "",
            fileUrl: "",
            ...record,
            ...(record.id ? { start: time(record.start) } : {}),
          }
        : kind === "contact"
          ? {
              name: "",
              type: "Team",
              role: "",
              company: "",
              email: "",
              phone: "",
              arrival: "",
              departure: "",
              notes: "",
              fileUrl: "",
              confirmation: "Entered by planner",
              confirmationNote: "",
              handle: "",
              ...record,
              arrival: time(record.arrival),
              departure: time(record.departure),
            }
          : kind === "task"
            ? {
                title: "",
                ownerId: "",
                activityId: "",
                due: event?.date || "",
                status: "To do",
                notes: "",
                ...record,
              }
            : {
                title: "",
                activityId: first?.id || "",
                start: time(first?.start ?? 540),
                duration: first?.duration || 30,
                ripple: true,
                reason: "",
              };
  const [values, setValues] = useState(defaults);
  const set = (k, v) => setValues((x) => ({ ...x, [k]: v }));
  const input = (label, name, type = "text", extra = {}) => (
    <Field
      label={label}
      type={type}
      value={values[name] ?? ""}
      onChange={(e) => set(name, e.target.value)}
      {...extra}
    />
  );
  const select = (label, name, options) => (
    <Field label={label}>
      <select
        value={values[name] || ""}
        onChange={(e) => set(name, e.target.value)}
      >
        {options.map((o) => (
          <option
            key={Array.isArray(o) ? o[0] : o}
            value={Array.isArray(o) ? o[0] : o}
          >
            {Array.isArray(o) ? o[1] : o}
          </option>
        ))}
      </select>
    </Field>
  );
  const notes = (label, name = "notes", placeholder = "") => (
    <Field label={label} wide>
      <textarea
        value={values[name]}
        onChange={(e) => set(name, e.target.value)}
        placeholder={placeholder}
        maxLength={name === "reason" ? 2000 : 3000}
        required={name === "reason"}
      />
    </Field>
  );
  const people = [
    ["", "Unassigned"],
    ...(event?.contacts || []).map((c) => [c.id, c.name]),
  ];
  return (
    <form
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="form-grid">
        {kind === "event" && (
          <>
            {input("Event name", "name", "text", {
              required: true,
              wide: true,
              maxLength: 120,
              placeholder: "e.g. Founders’ dinner",
            })}
            {input("Event date", "date", "date", { required: true })}
            {select("Status", "status", [
              "Draft",
              "Planning",
              "Live",
              "Completed",
              "Archived",
            ])}
            {input("Venue", "venue", "text", {
              wide: true,
              placeholder: "Venue name and city",
            })}
            {input("Venue access starts", "start", "time", { required: true })}
            {input("Venue access ends", "end", "time", { required: true })}
            {input("Timezone", "timezone", "text", {
              required: true,
              list: "timezones",
            })}
            <datalist id="timezones">
              {[
                "America/Los_Angeles",
                "America/New_York",
                "Europe/London",
                "Europe/Paris",
                "Asia/Kolkata",
                "Asia/Singapore",
                "Australia/Sydney",
                "UTC",
              ].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {input("Expected guests", "guests", "number", {
              min: 0,
              max: 100000,
            })}
            {notes("Planner notes")}
            <p className="field-hint wide">
              Single-day events. Times throughout the event use this timezone.
            </p>
          </>
        )}
        {kind === "activity" && (
          <>
            {input("Activity title", "title", "text", {
              required: true,
              wide: true,
              maxLength: 160,
            })}
            {input("Start time", "start", "time", { required: true })}
            {input("Duration (minutes)", "duration", "number", {
              required: true,
              min: 1,
              max: 720,
            })}
            {input("Location / room", "location", "text", {
              wide: true,
              placeholder: "Use a consistent room name to check overlaps",
            })}
            {select("Responsible person", "ownerId", people)}
            {select("Supporting vendor / person", "vendorId", people)}
            <label className="checkbox-field wide">
              <input
                type="checkbox"
                checked={values.fixed}
                onChange={(e) => set("fixed", e.target.checked)}
              />
              <span>
                <strong>Fixed time</strong>
                <small>
                  Keep this commitment in place when shifting later activities.
                </small>
              </span>
            </label>
            {notes("Instructions shared with assigned people")}
            {input("Document link", "fileUrl", "url", {
              wide: true,
              placeholder: "https://…",
            })}
            <p className="field-hint wide">
              Direct edits update the draft. For a change needing approval, use
              Changes → Propose change.
            </p>
          </>
        )}
        {kind === "contact" && (
          <>
            {input("Full name", "name", "text", { required: true })}
            {select("Type", "type", ["Team", "Vendor", "Speaker"])}
            {input("Responsibility", "role")}
            {input("Company", "company")}
            {input("Email", "email", "email")}
            {input("Phone", "phone", "tel")}
            {input("Chat handle", "handle", "text", { placeholder: "@sam" })}
            {input("Available from", "arrival", "time")}
            {input("Available until", "departure", "time")}
            {notes("Commitments & instructions shared with this person")}
            {input("Document / agreement link", "fileUrl", "url", {
              wide: true,
            })}
            {select("Information source", "confirmation", [
              "Entered by planner",
              "Recorded from a call",
            ])}
            {values.confirmation === "Recorded from a call" &&
              input("Call confirmation note", "confirmationNote", "text", {
                required: true,
              })}
            <p className="field-hint wide">
              Recorded availability is a planner entry. Acknowledgments come
              only from the recipient: their brief link, or their own chat
              account (the handle above) in the event’s Switch room.
            </p>
          </>
        )}
        {kind === "task" && (
          <>
            {input("Task title", "title", "text", {
              required: true,
              wide: true,
              maxLength: 200,
            })}
            {select("Owner", "ownerId", people)}
            {select("Status", "status", [
              "To do",
              "In progress",
              "Done",
              "Blocked",
            ])}
            {input("Due date", "due", "date")}
            {select("Related activity", "activityId", [
              ["", "None"],
              ...event.activities.map((a) => [a.id, a.title]),
            ])}
            {notes("Task notes")}
          </>
        )}
        {kind === "propose" && (
          <>
            {input("Change title", "title", "text", {
              wide: true,
              placeholder: "e.g. Speaker arrival moved by 15 minutes",
            })}
            <Field label="Activity to change" wide>
              <select
                value={values.activityId}
                onChange={(e) => {
                  const a = event.activities.find(
                    (x) => x.id === e.target.value,
                  );
                  setValues((v) => ({
                    ...v,
                    activityId: a.id,
                    start: time(a.start),
                    duration: a.duration,
                  }));
                }}
              >
                {event.activities.map((a) => (
                  <option value={a.id} key={a.id}>
                    {time(a.start)} · {a.title}
                    {a.fixed ? " (fixed)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {input("Proposed start", "start", "time", { required: true })}
            {input("Proposed duration (minutes)", "duration", "number", {
              required: true,
              min: 1,
              max: 720,
            })}
            <label className="checkbox-field wide">
              <input
                type="checkbox"
                checked={values.ripple}
                onChange={(e) => set("ripple", e.target.checked)}
              />
              <span>
                <strong>
                  Shift later flexible activities by the same amount
                </strong>
                <small>
                  Fixed activities stay in place. Conflicts must be resolved
                  before applying.
                </small>
              </span>
            </label>
            {notes(
              "What changed, and where did the request come from?",
              "reason",
              "e.g. Speaker called at 10:10. Their train is delayed; they can be ready at 11:30.",
            )}
            <p className="field-hint wide">
              This creates a proposal. The saved schedule stays unchanged until
              affected people approve and you apply it.
            </p>
          </>
        )}
      </div>
      <div className="form-actions">
        {record.id && kind !== "event" && (
          <button
            type="button"
            className="text-button danger push-left"
            onClick={onDelete}
          >
            <Trash2 size={14} />
            Remove
          </button>
        )}
        {record.id && kind === "event" && (
          <button
            type="button"
            className="text-button push-left"
            onClick={onDuplicate}
          >
            Duplicate event
          </button>
        )}
        <Button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : kind === "propose"
              ? "Review impact"
              : record.id
                ? "Save changes"
                : kind === "event"
                  ? "Create event"
                  : "Save " +
                    { activity: "activity", contact: "person", task: "task" }[
                      kind
                    ]}
        </Button>
      </div>
    </form>
  );
}
function ImportForm({ busy, onSubmit }) {
  const [text, setText] = useState(""),
    [rows, setRows] = useState(null),
    [error, setError] = useState("");
  function preview(value) {
    setText(value);
    setRows(null);
    setError("");
    try {
      const parsed = parseCSV(value);
      if (!parsed.length) throw new Error("Add at least one activity row.");
      setRows(parsed);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="modal-body">
      <p>
        Required columns: <code>title,start,duration</code>. Optional:{" "}
        <code>location,fixed,notes,fileUrl</code>. Use 24-hour times and
        durations in minutes. Assign people after import.
      </p>
      <Field label="Choose CSV file">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files[0];
            if (file) {
              if (file.size > 500000) {
                setError("Choose a CSV smaller than 500 KB.");
                return;
              }
              preview(await file.text());
            }
          }}
        />
      </Field>
      <Field label="Or paste CSV">
        <textarea
          className="csv-input"
          value={text}
          onChange={(e) => preview(e.target.value)}
          placeholder={
            "title,start,duration,location\nDoors open,09:00,30,Foyer"
          }
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows && (
        <div className="import-preview">
          <strong>{rows.length} activities ready to validate</strong>
          {rows.slice(0, 5).map((r, i) => (
            <p key={i}>
              {r.start} · {r.title} · {r.duration} min
            </p>
          ))}
        </div>
      )}
      <div className="form-actions">
        <Button
          className="primary"
          disabled={busy || !rows}
          onClick={() => onSubmit(rows)}
        >
          Import {rows?.length || ""} activities
        </Button>
      </div>
      <small>
        The entire import is validated before any activity is saved. Existing
        activities remain in place.
      </small>
    </div>
  );
}
