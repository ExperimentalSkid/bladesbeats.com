"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { isExcludedRelease, normalizeCatalogText } = require("../scripts/catalog-policy");

const ROOT = path.resolve(process.env.BLADESBEATS_SOURCE || path.join(__dirname, ".."));
const DATA_DIR = path.resolve(process.env.RELEASE_DESK_DATA_DIR || path.join(ROOT, "release-desk", "data"));
const RELEASES_DIR = path.resolve(process.env.BLADESBEATS_RELEASES_DIR || path.join(ROOT, ".release-desk", "releases"));
const CURRENT_DIR = process.env.BLADESBEATS_CURRENT_DIR ? path.resolve(process.env.BLADESBEATS_CURRENT_DIR) : "";
const PUBLISH_COMMAND = process.env.BLADESBEATS_PUBLISH_COMMAND || "";
const PUBLISH_PREFIX = process.env.BLADESBEATS_PUBLISH_PREFIX || "";
const HOST = process.env.RELEASE_DESK_HOST || "127.0.0.1";
const PORT = Number(process.env.RELEASE_DESK_PORT || 8788);
const DEV = process.env.RELEASE_DESK_DEV === "1";
const INACTIVITY_MS = 20 * 60 * 1000;
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_LIMIT = 5;
const SESSION_COOKIE = DEV ? "bb_release_session" : "__Host-bb_release_session";

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(RELEASES_DIR, { recursive: true, mode: 0o750 });

function readToken() {
  if (process.env.RELEASE_DESK_TOKEN) return process.env.RELEASE_DESK_TOKEN;
  const file = process.env.RELEASE_DESK_TOKEN_FILE;
  if (!file) return "";
  const token = fs.readFileSync(file, "utf8").trim();
  fs.rmSync(file, { force: true });
  return token;
}

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

let oneTimeTokenHash = (() => {
  const token = readToken() || (DEV ? crypto.randomBytes(32).toString("hex") : "");
  if (!token) throw new Error("Release Desk requires a one-time token.");
  return secretHash(token);
})();
const tokenExpiresAt = Date.now() + 10 * 60 * 1000;
let session = null;
let prepared = readJson(path.join(DATA_DIR, "prepared.json"), null);
let lastActivity = Date.now();
const loginAttempts = new Map();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}

function appendAudit(event, detail = {}) {
  const safe = { at: new Date().toISOString(), event, ...detail };
  fs.appendFileSync(path.join(DATA_DIR, "audit.jsonl"), `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
}

function invalidatePrepared(reason) {
  if (!prepared) return;
  const version = prepared.version;
  prepared = null;
  fs.rmSync(path.join(DATA_DIR, "prepared.json"), { force: true });
  appendAudit("prepared_release_invalidated", { version, reason });
}

function publishedState() {
  return readJson(path.join(DATA_DIR, "published.json"), { version: 1, versions: [] });
}

function recordPublishedVersion(version, mode) {
  const state = publishedState();
  state.versions = [{ version, publishedAt: new Date().toISOString(), mode }, ...(state.versions || []).filter((item) => item.version !== version)].slice(0, 12);
  writeJson(path.join(DATA_DIR, "published.json"), state);
}

function launchBlockers() {
  return [];
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function timingEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2));
}

function authenticated(req) {
  if (!session) return false;
  const now = Date.now();
  if (now - session.createdAt > MAX_SESSION_MS || now - session.lastSeenAt > INACTIVITY_MS) return false;
  if (!timingEqual(cookies(req)[SESSION_COOKIE], session.id)) return false;
  session.lastSeenAt = now;
  lastActivity = now;
  return true;
}

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' https: data:; frame-src https://www.youtube-nocookie.com https://www.mixcloud.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    ...(DEV ? {} : { "strict-transport-security": "max-age=31536000" })
  };
}

function send(res, status, value, headers = {}) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  res.writeHead(status, { ...securityHeaders(typeof value === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"), "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function sendFile(res, file, type) {
  const body = fs.readFileSync(path.join(__dirname, file));
  res.writeHead(200, { ...securityHeaders(type), "content-length": body.length });
  res.end(body);
}

function previewPrepared(value = prepared) {
  return value ? { ...value, previewPath: `/preview/${encodeURIComponent(value.version)}/`, confirmationPhrase: `PUBLISH ${value.version}` } : null;
}

function previewMime(file) {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  return types[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function sendPreview(req, res, pathname) {
  if (!authenticated(req)) { send(res, 401, { error: "authentication_required" }); return; }
  const match = pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
  if (!match || !prepared || decodeURIComponent(match[1]) !== prepared.version) { send(res, 404, { error: "preview_not_found" }); return; }
  const root = fs.realpathSync(prepared.directory);
  const requested = decodeURIComponent(match[2] || "/").replace(/\\/g, "/");
  const relative = path.posix.normalize(requested).replace(/^\/+/, "");
  if (relative.startsWith("../") || relative === "release-manifest.json") { send(res, 404, { error: "preview_not_found" }); return; }
  let target = path.join(root, ...relative.split("/").filter(Boolean));
  if (!relative || (fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, "index.html");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { send(res, 404, { error: "preview_not_found" }); return; }
  const real = fs.realpathSync(target);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) { send(res, 404, { error: "preview_not_found" }); return; }
  const mime = previewMime(real);
  let body = fs.readFileSync(real);
  const prefix = `/preview/${encodeURIComponent(prepared.version)}`;
  if (mime.startsWith("text/html")) body = Buffer.from(body.toString("utf8").replace(/((?:href|src|action)=["'])\/(?!\/)/g, `$1${prefix}/`));
  if (mime.startsWith("text/css")) body = Buffer.from(body.toString("utf8").replace(/(url\(\s*["']?)\/(?!\/)/g, `$1${prefix}/`));
  res.writeHead(200, { ...securityHeaders(mime), "content-length": body.length });
  res.end(body);
}

async function requestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sameOrigin(req) {
  if (!req.headers.origin) return false;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

function requireMutationAuth(req, res) {
  if (!authenticated(req)) { send(res, 401, { error: "authentication_required" }); return false; }
  if (!sameOrigin(req)) { send(res, 403, { error: "origin_rejected" }); return false; }
  if (!timingEqual(req.headers["x-csrf-token"], session.csrf)) { send(res, 403, { error: "csrf_rejected" }); return false; }
  return true;
}

function candidateState() {
  return readJson(path.join(DATA_DIR, "candidates.json"), { version: 1, candidates: [], checks: [] });
}

function saveCandidateState(value) {
  writeJson(path.join(DATA_DIR, "candidates.json"), value);
}

function cleanHttpsUrl(value, hosts) {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS destinations are allowed.");
  if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error(`Unexpected destination host: ${url.hostname}`);
  return url.toString();
}

function sanitizeCandidate(input, current) {
  const title = String(input.title ?? current.title).trim();
  const artist = String(input.artist ?? current.artist ?? "BladesBeats").trim();
  const releaseDate = String(input.releaseDate ?? current.releaseDate).slice(0, 10);
  const type = String(input.type ?? current.type).toLowerCase();
  if (!title || title.length > 180) throw new Error("A valid title is required.");
  if (!artist || artist.length > 180) throw new Error("A valid artist is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error("Use a complete YYYY-MM-DD date.");
  if (!["single", "remix", "edit", "instrumental", "dj set"].includes(type)) throw new Error("Choose a supported category.");
  const links = { ...(current.links || {}) };
  const supplied = input.links || {};
  const hostRules = { spotify: ["spotify.com"], appleMusic: ["music.apple.com"], youtube: ["youtube.com", "youtu.be"], mixcloud: ["mixcloud.com"] };
  for (const key of Object.keys(hostRules)) if (key in supplied) links[key] = cleanHttpsUrl(String(supplied[key] || "").trim(), hostRules[key]);
  const image = cleanHttpsUrl(String(input.image ?? current.image ?? "").trim());
  const next = { ...current, title, artist, releaseDate, type, image, links, editedAt: new Date().toISOString() };
  if (isExcludedRelease(next)) throw new Error("This candidate is blocked by the private catalogue policy.");
  return next;
}

function slugify(value) {
  return normalizeCatalogText(value).replace(/\s+/g, "-").replace(/^-|-$/g, "") || "release";
}

function uniqueSlug(base, records, except = "") {
  let slug = base;
  let count = 2;
  while (records.some((item) => item.slug === slug && item.slug !== except)) slug = `${base}-${count++}`;
  return slug;
}

function approveCandidate(item) {
  const dataFile = path.join(ROOT, "data", item.kind === "set" ? "dj-sets.json" : "releases.json");
  const records = readJson(dataFile, []);
  const matched = item.matchedSlug ? records.find((record) => record.slug === item.matchedSlug) : null;
  let record;
  if (matched) {
    matched.links = { ...(matched.links || {}), ...(item.links || {}) };
    matched.image = item.image || matched.image;
    matched.lastmod = new Date().toISOString().slice(0, 10);
    Object.assign(matched, item.platformIds || {});
    record = matched;
  } else {
    const slug = uniqueSlug(slugify(item.title), records);
    record = item.kind === "set" ? {
      title: item.title, slug, artist: item.artist || "BladesBeats", platform: "Mixcloud", status: "official", description: "Official BladesBeats DJ set.", longDescription: "", genres: [], links: item.links || {}, image: item.image || "", publishedDate: item.releaseDate, uploadDate: item.releaseDate, lastmod: new Date().toISOString().slice(0, 10), ...(item.platformIds || {})
    } : {
      title: item.title, slug, artist: item.artist || "BladesBeats", featuredArtists: [], type: item.type, status: "official", year: Number(item.releaseDate.slice(0, 4)), description: "Official BladesBeats release.", longDescription: "", genres: [], links: item.links || {}, image: item.image || "", releaseDate: item.releaseDate, lastmod: new Date().toISOString().slice(0, 10), ...(item.platformIds || {})
    };
    records.unshift(record);
  }
  writeJson(dataFile, records);
  return record.slug;
}

function runNode(script) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, encoding: "utf8", env: { ...process.env, RELEASE_DESK_DATA_DIR: DATA_DIR }, timeout: 120000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${script} failed`).trim());
  return result.stdout.trim();
}

function walk(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

function hashes(dir) {
  const map = {};
  for (const file of walk(dir)) {
    const relative = path.relative(dir, file).replace(/\\/g, "/");
    if (relative === "release-manifest.json") continue;
    map[relative] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return map;
}

function treeDiff(before, after) {
  const added = [], changed = [], removed = [];
  for (const [file, hash] of Object.entries(after)) {
    if (!(file in before)) added.push(file); else if (before[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(before)) if (!(file in after)) removed.push(file);
  return { added, changed, removed, totals: { added: added.length, changed: changed.length, removed: removed.length } };
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
}

function gitRevision() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) return "local";
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf8" });
  return `${result.stdout.trim()}${status.status === 0 && status.stdout.trim() ? "-dirty" : ""}`;
}

function prepareRelease() {
  runNode("scripts/build-launch.js");
  runNode("scripts/validate-build.js");
  const revision = gitRevision();
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const version = `${timestamp}-${revision}`;
  const destination = path.join(RELEASES_DIR, version);
  copyTree(path.join(ROOT, "dist"), destination);
  const nextHashes = hashes(destination);
  const currentHashes = hashes(CURRENT_DIR);
  const diff = treeDiff(currentHashes, nextHashes);
  const manifest = { version, preparedAt: new Date().toISOString(), revision, files: nextHashes, diff };
  writeJson(path.join(destination, "release-manifest.json"), manifest);
  prepared = { version, directory: destination, preparedAt: manifest.preparedAt, treeHash: crypto.createHash("sha256").update(JSON.stringify(nextHashes)).digest("hex"), diff };
  writeJson(path.join(DATA_DIR, "prepared.json"), prepared);
  appendAudit("release_prepared", { version, totals: diff.totals });
  return previewPrepared(prepared);
}

function publishedVersions() {
  const recorded = publishedState().versions || [];
  let current = null;
  if (CURRENT_DIR && fs.existsSync(CURRENT_DIR)) {
    const manifest = readJson(path.join(fs.realpathSync(CURRENT_DIR), "release-manifest.json"), null);
    if (manifest) current = { version: manifest.version, publishedAt: manifest.preparedAt, mode: "existing" };
  }
  const records = [current, ...recorded].filter(Boolean).filter((item, index, all) => all.findIndex((other) => other.version === item.version) === index);
  return records.map((record) => {
    const manifest = readJson(path.join(RELEASES_DIR, record.version, "release-manifest.json"), null);
    return manifest ? { version: manifest.version, preparedAt: manifest.preparedAt, revision: manifest.revision, publishedAt: record.publishedAt, mode: record.mode } : null;
  }).filter(Boolean);
}

function executePublish(args) {
  if (!PUBLISH_COMMAND) throw new Error("Publishing is disabled until the constrained server helper is installed.");
  const finalArgs = PUBLISH_PREFIX ? [PUBLISH_PREFIX, ...args] : args;
  const result = spawnSync(PUBLISH_COMMAND, finalArgs, { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Publish helper failed").trim());
  return result.stdout.trim();
}

async function api(req, res, pathname) {
  if (pathname === "/api/session" && req.method === "POST") {
    const ip = req.socket.remoteAddress || "unknown";
    const attempts = (loginAttempts.get(ip) || []).filter((time) => Date.now() - time < LOGIN_WINDOW_MS);
    if (attempts.length >= LOGIN_LIMIT) { send(res, 429, { error: "too_many_attempts" }); return; }
    attempts.push(Date.now()); loginAttempts.set(ip, attempts);
    const body = await requestBody(req);
    if (Date.now() > tokenExpiresAt || !oneTimeTokenHash || !timingEqual(secretHash(body.token), oneTimeTokenHash)) { appendAudit("login_rejected", { ip }); send(res, 401, { error: "invalid_or_expired_token" }); return; }
    oneTimeTokenHash = "";
    session = { id: randomSecret(), csrf: randomSecret(), createdAt: Date.now(), lastSeenAt: Date.now() };
    lastActivity = Date.now();
    appendAudit("session_started", { ip });
    send(res, 200, { ok: true, csrf: session.csrf, expiresAt: session.createdAt + MAX_SESSION_MS }, { "set-cookie": `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; ${DEV ? "" : "Secure; "}SameSite=Strict; Max-Age=7200` });
    return;
  }
  if (pathname === "/api/state" && req.method === "GET") {
    if (!authenticated(req)) { send(res, 401, { error: "authentication_required" }); return; }
    const state = candidateState();
    const settings = readJson(path.join(ROOT, "config", "site.json"), {});
    const releases = readJson(path.join(ROOT, "data", "releases.json"), []).filter((item) => !isExcludedRelease(item) && !/(?:dj\s*set|session|mix|remix|edit)/i.test(String(item.type || ""))).sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""))).map((item) => ({ slug: item.slug, title: item.title, releaseDate: item.releaseDate || "", type: item.type || "single" }));
    const blockers = launchBlockers();
    send(res, 200, { ok: true, csrf: session.csrf, expiresAt: session.createdAt + MAX_SESSION_MS, inactivityMs: INACTIVITY_MS, checkedAt: state.checkedAt || "", candidates: state.candidates || [], checks: (state.checks || []).slice(-5), featuredReleaseSlugs: settings.featuredReleaseSlugs || [], releases, prepared: previewPrepared(), versions: publishedVersions(), launchBlockers: blockers, publishEnabled: Boolean(PUBLISH_COMMAND) && blockers.length === 0 });
    return;
  }
  if (pathname === "/api/check" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    const output = runNode("scripts/check-releases.js");
    appendAudit("catalog_check_run");
    send(res, 200, { ok: true, result: JSON.parse(output) });
    return;
  }
  if (pathname === "/api/candidate" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    const body = await requestBody(req);
    const state = candidateState();
    const index = (state.candidates || []).findIndex((item) => item.id === body.id);
    if (index < 0) { send(res, 404, { error: "candidate_not_found" }); return; }
    let item = sanitizeCandidate(body.candidate || {}, state.candidates[index]);
    if (body.action === "ignore") item = { ...item, state: "ignored", ignoredAt: new Date().toISOString() };
    else if (body.action === "reopen") item = { ...item, state: item.matchedSlug ? "pending-update" : "pending", ignoredAt: "" };
    else if (body.action === "approve") {
      const slug = approveCandidate(item);
      item = { ...item, state: "approved", approvedAt: new Date().toISOString(), approvedSlug: slug };
      invalidatePrepared("catalogue_approval");
      appendAudit("candidate_approved", { id: item.id, slug, kind: item.kind });
    } else if (body.action !== "save") { send(res, 400, { error: "unsupported_action" }); return; }
    state.candidates[index] = item;
    saveCandidateState(state);
    appendAudit(`candidate_${body.action}`, { id: item.id });
    send(res, 200, { ok: true, candidate: item });
    return;
  }
  if (pathname === "/api/feature" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    const body = await requestBody(req);
    const settingsFile = path.join(ROOT, "config", "site.json");
    const settings = readJson(settingsFile, {});
    const allowed = new Set(readJson(path.join(ROOT, "data", "releases.json"), []).filter((item) => !isExcludedRelease(item) && !/(?:dj\s*set|session|mix|remix|edit)/i.test(String(item.type || ""))).map((item) => item.slug));
    let values;
    if (Array.isArray(body.slugs)) {
      values = [...new Set(body.slugs.map(String))];
    } else {
      const slug = String(body.slug || "");
      values = (settings.featuredReleaseSlugs || []).filter((value) => value !== slug);
      if (body.featured) values.push(slug);
    }
    if (values.length > 4) { send(res, 400, { error: "feature_limit", message: "Choose no more than four homepage release features." }); return; }
    if (values.some((slug) => !allowed.has(slug))) { send(res, 400, { error: "unknown_release", message: "A selected homepage feature is not in the approved catalogue." }); return; }
    const changed = JSON.stringify(values) !== JSON.stringify(settings.featuredReleaseSlugs || []);
    settings.featuredReleaseSlugs = values;
    writeJson(settingsFile, settings);
    if (changed) invalidatePrepared("homepage_features_changed");
    appendAudit("featured_releases_changed", { count: settings.featuredReleaseSlugs.length });
    send(res, 200, { ok: true, featuredReleaseSlugs: settings.featuredReleaseSlugs });
    return;
  }
  if (pathname === "/api/prepare" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    send(res, 200, { ok: true, prepared: prepareRelease() });
    return;
  }
  if (pathname === "/api/publish" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    const body = await requestBody(req);
    if (!prepared || !timingEqual(body.phrase, `PUBLISH ${prepared.version}`)) { send(res, 400, { error: "confirmation_phrase_mismatch" }); return; }
    const blockers = launchBlockers();
    if (blockers.length) { send(res, 409, { error: "launch_requirements_incomplete", message: blockers.join("; ") }); return; }
    if (!fs.existsSync(path.join(prepared.directory, "release-manifest.json"))) { send(res, 409, { error: "prepared_release_missing" }); return; }
    const output = executePublish([prepared.directory]);
    recordPublishedVersion(prepared.version, "publish");
    const state = candidateState();
    state.candidates = (state.candidates || []).map((item) => item.state === "approved" ? { ...item, state: "published", publishedAt: new Date().toISOString(), publishedVersion: prepared.version } : item);
    saveCandidateState(state);
    appendAudit("release_published", { version: prepared.version });
    send(res, 200, { ok: true, version: prepared.version, output });
    return;
  }
  if (pathname === "/api/rollback" && req.method === "POST") {
    if (!requireMutationAuth(req, res)) return;
    const body = await requestBody(req);
    const version = String(body.version || "");
    if (!timingEqual(body.phrase, `ROLLBACK ${version}`)) { send(res, 400, { error: "confirmation_phrase_mismatch" }); return; }
    if (!publishedVersions().some((item) => item.version === version)) { send(res, 404, { error: "version_not_published" }); return; }
    const output = executePublish(["--rollback", version]);
    recordPublishedVersion(version, "rollback");
    appendAudit("release_rolled_back", { version });
    send(res, 200, { ok: true, version, output });
    return;
  }
  send(res, 404, { error: "not_found" });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `${DEV ? "http" : "https"}://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/preview/")) { sendPreview(req, res, url.pathname); return; }
    if (url.pathname === "/") { sendFile(res, "ui.html", "text/html; charset=utf-8"); return; }
    if (url.pathname === "/ui.css") { sendFile(res, "ui.css", "text/css; charset=utf-8"); return; }
    if (url.pathname === "/ui.js") { sendFile(res, "ui.js", "application/javascript; charset=utf-8"); return; }
    if (url.pathname.startsWith("/api/")) { await api(req, res, url.pathname); return; }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    appendAudit("request_error", { message: String(error.message || error).slice(0, 300) });
    send(res, error.message === "request_too_large" ? 413 : 400, { error: "request_failed", message: error.message });
  }
}

const server = DEV
  ? http.createServer(handler)
  : https.createServer({ cert: fs.readFileSync(process.env.RELEASE_DESK_CERT), key: fs.readFileSync(process.env.RELEASE_DESK_KEY), minVersion: "TLSv1.2" }, handler);

server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => process.stdout.write(`Release Desk listening on ${HOST}:${PORT}\n`));

const watchdog = setInterval(() => {
  const now = Date.now();
  const expired = session ? now - session.lastSeenAt > INACTIVITY_MS || now - session.createdAt > MAX_SESSION_MS : now > tokenExpiresAt;
  if (expired || now - lastActivity > MAX_SESSION_MS) shutdown("watchdog_timeout");
}, 15000);
watchdog.unref();

function shutdown(reason) {
  appendAudit("server_stopped", { reason });
  clearInterval(watchdog);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(signal));
