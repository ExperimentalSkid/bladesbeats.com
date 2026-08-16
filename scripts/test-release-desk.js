"use strict";

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TOKEN = "local-integration-token";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Release Desk did not start.")), 10000);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Release Desk listening")) return;
      clearTimeout(timer);
      resolve();
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.once("exit", (code) => { if (code) reject(new Error(`Release Desk exited with ${code}.`)); });
  });
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bladesbeats-release-desk-test-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "release-desk", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, RELEASE_DESK_DEV: "1", RELEASE_DESK_TOKEN: TOKEN, RELEASE_DESK_PORT: String(port), RELEASE_DESK_DATA_DIR: path.join(temp, "data"), BLADESBEATS_RELEASES_DIR: path.join(temp, "releases"), BLADESBEATS_CURRENT_DIR: path.join(ROOT, "dist") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(child);
    const login = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token: TOKEN }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("content-security-policy") || "", /default-src 'none'/);
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    const auth = await login.json();
    assert.ok(cookie && auth.csrf);

    const secondLogin = await fetch(`${origin}/api/session`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token: TOKEN }) });
    assert.equal(secondLogin.status, 401, "one-time token was accepted twice");

    const stateResponse = await fetch(`${origin}/api/state`, { headers: { cookie } });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.releases.length, 42);
    assert.equal(state.publishEnabled, false);
    assert.ok(Array.isArray(state.launchBlockers));

    const unauthorized = await fetch(`${origin}/api/prepare`, { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" });
    assert.equal(unauthorized.status, 401);

    const mutationHeaders = { "content-type": "application/json", origin, cookie, "x-csrf-token": auth.csrf };
    const invalidFeature = await fetch(`${origin}/api/feature`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ slugs: ["not-a-real-release"] }) });
    assert.equal(invalidFeature.status, 400);

    const prepare = await fetch(`${origin}/api/prepare`, { method: "POST", headers: mutationHeaders, body: "{}" });
    assert.equal(prepare.status, 200);
    const prepared = (await prepare.json()).prepared;
    assert.match(prepared.confirmationPhrase, /^PUBLISH /);
    assert.match(prepared.previewPath, /^\/preview\//);

    const anonymousPreview = await fetch(`${origin}${prepared.previewPath}`);
    assert.equal(anonymousPreview.status, 401);
    const preview = await fetch(`${origin}${prepared.previewPath}`, { headers: { cookie } });
    assert.equal(preview.status, 200);
    const previewHtml = await preview.text();
    assert.ok(previewHtml.includes(`${prepared.previewPath}assets/js/catalog-hero.js`));
    const manifest = await fetch(`${origin}${prepared.previewPath}release-manifest.json`, { headers: { cookie } });
    assert.equal(manifest.status, 404);

    const publish = await fetch(`${origin}/api/publish`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ phrase: prepared.confirmationPhrase }) });
    assert.equal(publish.status, state.launchBlockers.length ? 409 : 400, "local test unexpectedly enabled publishing");
    process.stdout.write(`Release Desk integration passed on temporary port ${port}.\n`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    const real = fs.realpathSync(temp);
    if (path.basename(real).startsWith("bladesbeats-release-desk-test-")) fs.rmSync(real, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
