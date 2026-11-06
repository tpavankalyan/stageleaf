import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { createApp } from "../server/app.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Node",
  "MutationObserver",
  "getComputedStyle",
  "FormData",
])
  globalThis[key] =
    key === "getComputedStyle"
      ? dom.window.getComputedStyle.bind(dom.window)
      : dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, within, cleanup } =
  await import("@testing-library/react");
const { default: App } = await import("../src/App.jsx");
const realFetch = globalThis.fetch;
function change(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
test("rendered controls create a real event, save people and schedule, publish and restore state", async (t) => {
  const service = createApp({ dbPath: ":memory:", secureCookies: false });
  const listener = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
  const base = "http://127.0.0.1:" + listener.address().port;
  let cookie = "";
  globalThis.fetch = async (path, opts = {}) => {
    const res = await realFetch(base + path, {
      ...opts,
      headers: { ...opts.headers, ...(cookie ? { cookie } : {}) },
    });
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    return res;
  };
  t.after(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    await new Promise((r) => listener.close(r));
    service.close();
  });
  render(<App />);
  await screen.findByRole("button", { name: "Create workspace" });
  change("Your name", "Actual Planner");
  change("Email", "ui@example.com");
  change("Password", "a-long-test-password");
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  await screen.findByText("Your next event starts here");
  assert.equal(
    (await (await fetch("/api/events")).json()).length,
    0,
    "empty state must not seed demo data",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create your first event" }),
  );
  await screen.findByRole("dialog", { name: "Create an event" });
  change("Event name", "Community dinner");
  change("Event date", "2026-12-01");
  change("Venue", "The gathering room");
  change("Expected guests", "45");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create event",
    }),
  );
  await waitFor(() =>
    assert.ok(!screen.queryByRole("dialog"), "dialog should close after save"),
  );
  await screen.findByRole("heading", { name: "Community dinner" });
  fireEvent.click(screen.getByRole("tab", { name: "Team & vendors" }));
  fireEvent.click(screen.getByRole("button", { name: "Add first person" }));
  change("Full name", "Robin Planner");
  change("Responsibility", "Host");
  fireEvent.click(screen.getByRole("button", { name: "Save person" }));
  await screen.findByRole("button", { name: "Robin Planner" });
  assert.equal(
    screen.getByRole("button", { name: "Brief link" }).disabled,
    true,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Run of show" }));
  fireEvent.click(screen.getByRole("button", { name: "Add first activity" }));
  change("Activity title", "Guests arrive");
  change("Start time", "17:00");
  change("Duration (minutes)", "30");
  change("Location / room", "Foyer");
  const person = (await (await fetch("/api/events")).json())[0].contacts[0];
  change("Responsible person", person.id);
  fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
  await screen.findByRole("button", { name: "Guests arrive" });
  fireEvent.click(screen.getByRole("button", { name: "Edit Guests arrive" }));
  change("Duration (minutes)", "45");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    assert.ok(!screen.queryByRole("dialog"), "dialog should close after save"),
  );
  assert.ok(screen.getByText("45 min"));
  fireEvent.click(screen.getByRole("button", { name: "Publish brief" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Publish brief",
    }),
  );
  await screen.findByText("Published v1");
  fireEvent.click(screen.getByRole("tab", { name: "Team & vendors" }));
  fireEvent.click(screen.getByRole("button", { name: "Brief link" }));
  await screen.findByRole("dialog", { name: "Share a scoped link" });
  const link = screen.getByLabelText("Recipient link").value;
  assert.match(link, /\/share\/[A-Za-z0-9_-]+$/);
  const publicData = await (
    await realFetch(base + "/api/shared/" + link.split("/").at(-1))
  ).json();
  assert.equal(publicData.person.name, "Robin Planner");
  assert.equal(publicData.activities[0].duration, 45);
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
  fireEvent.click(screen.getByRole("button", { name: "Add first task" }));
  change("Task title", "Set out name cards");
  fireEvent.click(screen.getByRole("button", { name: "Save task" }));
  await screen.findByText("Set out name cards");
  fireEvent.click(
    screen.getByRole("button", { name: "Complete Set out name cards" }),
  );
  await screen.findByText("Done");
  cleanup();
  render(<App />);
  await screen.findByRole("heading", { name: "Community dinner" });
  const saved = (await (await fetch("/api/events")).json())[0];
  assert.equal(saved.name, "Community dinner");
  assert.equal(saved.activities.length, 1);
  assert.equal(saved.tasks[0].status, "Done");
  assert.equal(saved.publications.length, 1);
  // A separate browser session opens the scoped link and sends a real response.
  cleanup();
  const plannerCookie = cookie;
  cookie = "";
  dom.window.history.replaceState({}, "", "/share/" + link.split("/").at(-1));
  render(<App />);
  await screen.findByRole("heading", { name: "Robin Planner" });
  change("Note for the planner", "I will be there with the name cards.");
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge brief" }));
  await screen.findByText("Acknowledged");
  const acknowledged = await (
    await realFetch(base + "/api/events/" + saved.id, {
      headers: { cookie: plannerCookie },
    })
  ).json();
  assert.equal(acknowledged.responses[0].answer, "Acknowledged");
  assert.equal(
    acknowledged.responses[0].note,
    "I will be there with the name cards.",
  );
  cleanup();
  dom.window.history.replaceState({}, "", "/");
});
