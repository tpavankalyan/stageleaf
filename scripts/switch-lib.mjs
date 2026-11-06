// Small helpers shared by the setup and demo scripts: read switch/.env, call the
// Switch agent bridge, and call the bundled Mattermost's REST API.
import { readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SWITCH_DIR = resolve(ROOT, "switch");
export const CREDENTIALS = resolve(SWITCH_DIR, "credentials.json");

export function readEnv(file = resolve(SWITCH_DIR, ".env")) {
  if (!existsSync(file))
    throw new Error(`${file} is missing. Run ./switch/up.sh first.`);
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2].trim();
  }
  return values;
}

export function readCredentials() {
  if (!existsSync(CREDENTIALS)) return {};
  return JSON.parse(readFileSync(CREDENTIALS, "utf8"));
}

export function writeCredentials(data) {
  writeFileSync(CREDENTIALS, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(CREDENTIALS, 0o600);
}

async function json(res, what) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok)
    throw new Error(
      `${what} failed: ${res.status} ${JSON.stringify(body).slice(0, 500)}`,
    );
  return body;
}

export function switchApi(base = process.env.SWITCH_API_URL || "http://127.0.0.1:8000") {
  return {
    base,
    async register(registrationToken, agent) {
      const res = await fetch(`${base}/agents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registrationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(agent),
      });
      return json(res, `Registering agent ${agent.name}`);
    },
    async op(agent, name, args = {}, connectionId) {
      const headers = {
        Authorization: `Bearer ${agent.api_key}`,
        "Content-Type": "application/json",
      };
      if (connectionId) headers["X-Switch-Connection-Id"] = connectionId;
      const res = await fetch(`${base}/agents/${agent.id}/ops/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
      return (await json(res, `Switch operation ${name}`)).result;
    },
  };
}

export function mattermost(base = process.env.MATTERMOST_URL || "http://127.0.0.1:8065") {
  const call = async (path, { token, method = "GET", body } = {}) => {
    const res = await fetch(`${base}/api/v4${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { res, body: await json(res, `Mattermost ${method} ${path}`) };
  };
  return {
    base,
    async login(login_id, password) {
      const res = await fetch(`${base}/api/v4/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login_id, password }),
      });
      await json(res, `Mattermost sign-in for ${login_id}`);
      return res.headers.get("token");
    },
    get: (path, token) => call(path, { token }).then((r) => r.body),
    post: (path, token, body) =>
      call(path, { token, method: "POST", body }).then((r) => r.body),
    put: (path, token, body) =>
      call(path, { token, method: "PUT", body }).then((r) => r.body),
    async tryGet(path, token) {
      const res = await fetch(`${base}/api/v4${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok ? res.json() : null;
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
