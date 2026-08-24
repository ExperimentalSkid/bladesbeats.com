const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const SITE = "https://bladesbeats.com";
const PUBLIC_DIRS = [
  "about",
  "aviso-legal",
  "blocked",
  "booking",
  "cookie-policy",
  "dj-sets",
  "dj-toolkit",
  "es",
  "gigs",
  "legal-notice",
  "music",
  "politica-cookies",
  "politica-privacidad",
  "privacy-policy"
];

const errors = [];
const checkedAssets = new Set();

function fail(message) {
  errors.push(message);
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function walkHtml(relative) {
  const target = path.join(ROOT, relative);
  if (!fs.existsSync(target)) return [];
  const found = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) found.push(...walkHtml(child));
    if (entry.isFile() && entry.name.endsWith(".html")) found.push(child.replace(/\\/g, "/"));
  }
  return found;
}

function urlPathToFile(urlPath) {
  const clean = decodeURIComponent(String(urlPath || "/").split(/[?#]/)[0]);
  if (clean === "/") return "index.html";
  const relative = clean.replace(/^\/+/, "");
  if (path.posix.extname(relative)) return relative;
  return `${relative.replace(/\/+$/, "")}/index.html`;
}

function sha12(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex").slice(0, 12);
}

function validateVersionedAssets(html, label) {
  for (const match of html.matchAll(/(?:href|src)="(\/assets\/[^"?]+)\?v=([a-f0-9]{12})"/g)) {
    const relative = match[1].replace(/^\//, "");
    if (!exists(relative)) {
      fail(`${label}: missing versioned asset ${match[1]}`);
      continue;
    }
    const key = `${relative}?v=${match[2]}`;
    if (checkedAssets.has(key)) continue;
    checkedAssets.add(key);
    const expected = sha12(relative);
    if (match[2] !== expected) fail(`${label}: stale asset version for /${relative}`);
  }
}

function validateLocalTargets(html, label) {
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) {
    const raw = match[1];
    if (raw.startsWith("/api/")) continue;
    const relative = urlPathToFile(raw);
    if (!exists(relative)) fail(`${label}: missing local target ${raw}`);
  }
}

function validateJsonLd(html, label) {
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
}

for (const required of [
  "index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "assets/css/tokens.css",
  "assets/css/generated-pages.css",
  "assets/js/catalog-hero.js",
  "assets/js/generated-pages.js",
  "assets/js/contact-form.js"
]) {
  if (!exists(required)) fail(`Missing required public file: ${required}`);
}

const htmlFiles = ["index.html", "404.html", ...PUBLIC_DIRS.flatMap(walkHtml)].filter((value, index, all) => all.indexOf(value) === index);
for (const relative of htmlFiles) {
  const html = read(relative);
  if (!/^<!DOCTYPE html>/i.test(html)) fail(`${relative}: missing HTML doctype`);
  if (!/<html lang="(?:en|es)">/.test(html)) fail(`${relative}: missing supported language declaration`);
  if (/(?:href|src)=""/.test(html)) fail(`${relative}: contains a blank href/src`);
  if (/\bundefined\b/.test(html)) fail(`${relative}: contains undefined output`);
  validateVersionedAssets(html, relative);
  validateLocalTargets(html, relative);
  validateJsonLd(html, relative);
}

const sitemapXml = exists("sitemap.xml") ? read("sitemap.xml") : "";
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const sitemapLastmods = [...sitemapXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);
if (!sitemapUrls.length) fail("sitemap.xml contains no URLs");
if (sitemapUrls.length !== new Set(sitemapUrls).size) fail("sitemap.xml contains duplicate URLs");
if (sitemapUrls.length !== sitemapLastmods.length) fail("sitemap.xml has missing lastmod values");
if (sitemapUrls.some((url) => /\/llms(?:-full)?\.txt$/.test(url))) fail("sitemap.xml contains non-search llms files");

const today = new Date().toISOString().slice(0, 10);
for (const value of sitemapLastmods) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`sitemap.xml has invalid lastmod: ${value}`);
  if (value > today) fail(`sitemap.xml has future lastmod: ${value}`);
}

for (const url of sitemapUrls) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`sitemap.xml contains invalid URL: ${url}`);
    continue;
  }
  if (parsed.origin !== SITE) fail(`sitemap.xml contains non-canonical origin: ${url}`);
  const relative = urlPathToFile(parsed.pathname);
  if (!exists(relative)) {
    fail(`sitemap URL has no local file: ${url}`);
    continue;
  }
  const html = read(relative);
  if (/<meta[^>]+name="(?:robots|googlebot)"[^>]+content="[^"]*noindex/i.test(html)) {
    fail(`${relative}: sitemap page contains noindex`);
  }
  const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || "";
  if (canonical !== url) fail(`${relative}: canonical mismatch (${canonical || "missing"})`);
  if (!new Set(["index.html", "es/index.html", "blocked/index.html"]).has(relative)) {
    if (!/\/assets\/css\/generated-pages\.css\?v=[a-f0-9]{12}/.test(html)) fail(`${relative}: missing shared generated stylesheet`);
    if (!/\/assets\/js\/generated-pages\.js\?v=[a-f0-9]{12}/.test(html)) fail(`${relative}: missing shared generated script`);
    if (/<style>[\s\S]{1000,}<\/style>/.test(html)) fail(`${relative}: contains a large inline stylesheet`);
  }
}

for (const requiredUrl of [
  `${SITE}/music/waiting-for-the-right-time/`,
  `${SITE}/music/older/`,
  `${SITE}/music/snowgoons-fight-back-ft-watts-bladesbeats-remix-edit/`
]) {
  if (!sitemapUrls.includes(requiredUrl)) fail(`sitemap.xml missing current release: ${requiredUrl}`);
}

for (const relative of htmlFiles.filter((file) => /^music\/.+\/index\.html$/.test(file))) {
  const bytes = fs.statSync(path.join(ROOT, relative)).size;
  if (bytes > 40000) fail(`${relative}: generated detail page exceeds 40 KB (${bytes} bytes)`);
}

if (exists("404.html") && !/<meta name="robots" content="noindex/i.test(read("404.html"))) {
  fail("404.html must remain noindex");
}
if (exists("blocked/index.html") && !/<meta name="robots" content="noindex/i.test(read("blocked/index.html"))) {
  fail("blocked/index.html must remain noindex");
}

if (errors.length) {
  console.error(`Site validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML files, ${sitemapUrls.length} sitemap URLs, and ${checkedAssets.size} versioned assets.`);
