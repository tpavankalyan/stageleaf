// A small client for the Switch agent protocol (agent-protocol 6):
//   down: one server-sent event stream per connection
//   up:   HTTP operations, plus a heartbeat every couple of seconds
// See https://docs.switchagents.ai/switch-rooms/internals/agent-protocol
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SwitchError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class SwitchClient {
  constructor({
    baseUrl,
    agentId,
    apiKey,
    statePath,
    clientName = "stageleaf-agent",
    clientVersion = "0.3.0",
    log = console,
  }) {
    this.base = baseUrl.replace(/\/$/, "");
    this.agentId = agentId;
    this.apiKey = apiKey;
    this.statePath = statePath;
    this.clientName = clientName;
    this.clientVersion = clientVersion;
    this.log = log;
    this.state = this.#load();
    // A connection id is ours for the life of this process. Reopening the
    // stream with the same id survives a dropped socket; a fresh process gets
    // a fresh id so it never fights an old one.
    this.connectionId = randomUUID();
    this.heartbeatMs = 2000;
    this.stopped = false;
    this.connected = false;
    this.rooms = [];
  }

  #load() {
    try {
      if (this.statePath && existsSync(this.statePath))
        return JSON.parse(readFileSync(this.statePath, "utf8"));
    } catch {}
    return { lastEventId: null, handled: [] };
  }
  #save() {
    if (!this.statePath) return;
    this.state.handled = this.state.handled.slice(-300);
    writeFileSync(this.statePath, JSON.stringify(this.state), { mode: 0o600 });
  }

  /** Mark a message as handled so a replay after a reconnect or restart is skipped. */
  markHandled(messageId, eventId) {
    if (messageId && !this.state.handled.includes(messageId)) this.state.handled.push(messageId);
    if (eventId) this.state.lastEventId = eventId;
    this.#save();
  }
  wasHandled(messageId) {
    return !!messageId && this.state.handled.includes(messageId);
  }

  #headers(extra = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async #waitConnected(ms) {
    const until = Date.now() + ms;
    while (!this.connected && Date.now() < until) await sleep(200);
    return this.connected;
  }

  /** Call an operation from the registry, bound to this connection. */
  async op(name, args = {}, retried = false) {
    if (!this.connected) await this.#waitConnected(10000);
    const res = await fetch(`${this.base}/agents/${this.agentId}/ops/${name}`, {
      method: "POST",
      headers: this.#headers({
        "Content-Type": "application/json",
        "X-Switch-Connection-Id": this.connectionId,
      }),
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    // The connection dropped between reading an event and acting on it: wait
    // for the stream to come back, then try once more.
    if (res.status === 409 && !retried && /not open|reconnect/i.test(JSON.stringify(body))) {
      this.connected = false;
      if (await this.#waitConnected(10000)) return this.op(name, args, true);
    }
    if (!res.ok)
      throw new SwitchError(
        `Switch ${name} failed (${res.status}): ${JSON.stringify(body.detail ?? body).slice(0, 300)}`,
        res.status,
        body,
      );
    return body.result;
  }

  async #beat() {
    const res = await fetch(`${this.base}/agents/${this.agentId}/connection/beat`, {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      // agent-protocol 6 fences each tick on the connection's incarnation,
      // which the server sends as `generation` on connection_state.
      body: JSON.stringify({ connection_id: this.connectionId, generation: this.generation ?? null }),
    });
    await res.arrayBuffer();
    return res.status;
  }

  /**
   * Hold the event stream open forever, reconnecting with backoff. Calls
   * onEvent(frame) for every domain event; control frames are handled here.
   */
  async run(onEvent) {
    let backoff = 1000;
    while (!this.stopped) {
      const controller = new AbortController();
      try {
        const params = new URLSearchParams({
          connection_id: this.connectionId,
          scope: "all",
          filter: "all",
          start_from: "head",
          client: this.clientName,
          client_version: this.clientVersion,
          protocol: "6",
          protocol_accepts: "6",
        });
        const headers = this.#headers({ Accept: "text/event-stream" });
        if (this.state.lastEventId) headers["Last-Event-ID"] = this.state.lastEventId;
        const res = await fetch(`${this.base}/agents/${this.agentId}/events?${params}`, {
          headers,
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403)
          throw new SwitchError(`Switch refused the agent's credentials (${res.status}).`, res.status);
        if (!res.ok) throw new SwitchError(`Event stream returned ${res.status}: ${await res.text()}`, res.status);
        this.controller = controller;
        backoff = 1000;
        await this.#read(res.body, onEvent);
      } catch (error) {
        if (this.stopped) break;
        if (error.status === 401 || error.status === 403) throw error;
        if (error.name !== "AbortError") this.log.warn(`Switch stream interrupted: ${error.message}`);
      } finally {
        clearInterval(this.beater);
        controller.abort();
        if (this.connected) this.log.info("Disconnected from Switch.");
        this.connected = false;
      }
      if (this.stopped) break;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  async #read(body, onEvent) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const frame = { id: null, event: null, data: [] };
        for (const line of raw.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          const i = line.indexOf(":");
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
          if (field === "id") frame.id = value;
          else if (field === "event") frame.event = value;
          else if (field === "data") frame.data.push(value);
        }
        if (!frame.data.length) continue;
        let data;
        try {
          data = JSON.parse(frame.data.join("\n"));
        } catch {
          continue;
        }
        await this.#frame(frame, data, onEvent);
      }
    }
  }

  // Beat on the interval the server asked for, from the moment it confirms the
  // connection. Refusals mean reopen, but only once the stream has had time to
  // attach, and only after a few in a row.
  #startBeats() {
    clearInterval(this.beater);
    const controller = this.controller;
    const startedAt = Date.now();
    let misses = 0;
    this.beater = setInterval(async () => {
      try {
        const status = await this.#beat();
        if (status === 200) misses = 0;
        else if ((status === 404 || status === 409) && Date.now() - startedAt > 3 * this.heartbeatMs && ++misses >= 3) {
          this.log.warn(`Heartbeat refused (${status}); reopening the stream.`);
          controller?.abort();
        }
      } catch {}
    }, this.heartbeatMs);
  }

  async #frame(frame, data, onEvent) {
    const kind = frame.event || data.type;
    if (kind === "connection_state") {
      this.connected = true;
      this.generation = data.generation ?? null;
      this.rooms = data.rooms || [];
      if (data.heartbeat_interval_seconds)
        this.heartbeatMs = Math.max(100, data.heartbeat_interval_seconds * 1000);
      this.#startBeats();
      this.log.info(
        `Connected to Switch ${data.server?.version || ""} as agent ${this.agentId} (protocol ${data.protocol}).`,
      );
      return;
    }
    if (kind === "gap") {
      this.log.warn(`Switch reported a gap in the event stream (${data.reason}). Room history will be re-read.`);
      this.gap = true;
      return;
    }
    if (kind === "evicted") {
      this.log.warn(`Switch evicted this connection: ${data.reason}`);
      throw Object.assign(new Error("evicted"), { name: "AbortError" });
    }
    if (kind === "subscription_changed") {
      this.rooms = data.rooms || [];
      return;
    }
    if (kind === "room_released") return;
    try {
      await onEvent({ ...data, eventId: frame.id });
    } catch (error) {
      this.log.error(`Handling a ${kind} event failed: ${error.stack || error.message}`);
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.beater);
    this.controller?.abort();
  }
}
