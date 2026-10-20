"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "workers", "contact-worker.js"), "utf8");
const workerPromise = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

async function submit(body, extraHeaders = {}) {
  const worker = (await workerPromise).default;
  const request = new Request("https://bladesbeats.com/api/contact", {
    method: "POST",
    headers: { origin: "https://bladesbeats.com", "content-type": "application/json", ...extraHeaders },
    body
  });
  return worker.fetch(request, {});
}

test("contact worker rejects oversized body before Turnstile", async () => {
  const response = await submit(JSON.stringify({ fields: ["x".repeat(17000)] }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "request_too_large" });
});

test("contact worker rejects excessive fields before Turnstile", async () => {
  const response = await submit(JSON.stringify({ turnstileToken: "test", fields: Array(33).fill("field") }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "bad_request" });
});

test("contact worker rejects announced oversized body without reading it", async () => {
  const response = await submit("{}", { "content-length": "999999" });
  assert.equal(response.status, 413);
});
