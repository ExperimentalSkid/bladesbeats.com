"use strict";

const fs = require("fs");
const path = require("path");
const { isExcludedRelease } = require("./catalog-policy");

const ROOT = path.resolve(__dirname, "..");
const releases = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "releases.json"), "utf8")).filter((item) => !isExcludedRelease(item));
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "dj-sets.json"), "utf8")).filter((item) => !isExcludedRelease(item));
const gigs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "gigs.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "site.json"), "utf8"));

const urls = new Set();
function collect(value) {
  if (typeof value === "string" && /^https:\/\//.test(value)) urls.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === "object") Object.values(value).forEach(collect);
}
releases.forEach((item) => collect(item.links || {}));
sets.forEach((item) => collect(item.links || {}));
gigs.forEach((item) => collect(item.links || {}));
collect(config.platforms || {});
collect(config.instagramUrl);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  for (const file of walk(dist).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/href="(https:\/\/[^"#]+)"/g)) {
      const url = new URL(match[1].replace(/&amp;/g, "&"));
      if (url.hostname !== "bladesbeats.com") urls.add(url.toString());
    }
  }
}

async function check(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers: { "user-agent": "BladesBeats launch link check/1.0" } });
    if (response.status === 405) response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "user-agent": "BladesBeats launch link check/1.0", range: "bytes=0-0" } });
    return { url, status: response.status, ok: response.status < 400 || [401, 403, 429].includes(response.status) };
  } catch (error) {
    return { url, status: 0, ok: false, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const queue = [...urls];
  const results = [];
  async function worker() {
    while (queue.length) results.push(await check(queue.shift()));
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  results.sort((a, b) => a.url.localeCompare(b.url));
  const failed = results.filter((item) => !item.ok);
  for (const item of results) process.stdout.write(`${item.ok ? "OK" : "FAIL"} ${item.status || item.error} ${item.url}\n`);
  if (failed.length) throw new Error(`${failed.length} of ${results.length} public destinations could not be verified.`);
  process.stdout.write(`Verified ${results.length} public platform destinations.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
