// Calls Stageleaf's agent API with a planner-issued agent token.
export class StageleafError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class StageleafClient {
  constructor({ baseUrl, token }) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = token;
  }
  async call(path, body, method = body ? "POST" : "GET") {
    const res = await fetch(`${this.base}/api/agent${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new StageleafError(data.error || `Stageleaf returned ${res.status}.`, res.status);
    return data;
  }
  me = () => this.call("/me");
  heartbeat = (status) => this.call("/heartbeat", status);
  eventForRoom = (roomId) => this.call(`/rooms/${encodeURIComponent(roomId)}`);
  context = (eventId) => this.call(`/events/${eventId}/context`);
  linkRoom = (eventId, body) => this.call(`/events/${eventId}/link-room`, body);
  setDocument = (eventId, documentId) => this.call(`/events/${eventId}/chat`, { documentId }, "PATCH");
  preview = (eventId, changes) => this.call(`/events/${eventId}/preview`, { changes });
  availability = (eventId, body) => this.call(`/events/${eventId}/availability`, body);
  propose = (eventId, body) => this.call(`/events/${eventId}/proposals`, body);
  decide = (eventId, changeId, body) => this.call(`/events/${eventId}/proposals/${changeId}/decision`, body);
  cancel = (eventId, changeId, body) => this.call(`/events/${eventId}/proposals/${changeId}/cancel`, body);
  publish = (eventId, body) => this.call(`/events/${eventId}/publish`, body);
  acknowledge = (eventId, body) => this.call(`/events/${eventId}/acknowledge`, body);
}
