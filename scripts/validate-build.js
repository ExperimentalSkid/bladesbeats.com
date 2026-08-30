"use strict";

const fs = require("fs");
const path = require("path");
const { assertNoExcludedContent, isExcludedRelease } = require("./catalog-policy");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SITE = "https://bladesbeats.com";
const errors = [];
const warnings = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function fail(file, message) {
  errors.push(`${path.relative(DIST, file)}: ${message}`);
}

function internalTargetExists(url) {
  const clean = String(url).split(/[?#]/)[0];
  if (!clean || clean === "/") return fs.existsSync(path.join(DIST, "index.html"));
  const relative = clean.replace(/^\//, "");
  const target = path.join(DIST, relative);
  if (clean.endsWith("/")) return fs.existsSync(path.join(target, "index.html"));
  return fs.existsSync(target);
}

if (!fs.existsSync(DIST)) throw new Error("dist does not exist; run the build first.");
const files = walk(DIST);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const textFiles = files.filter((file) => /\.(?:html|css|js|xml|txt)$/i.test(file));

for (const file of textFiles) {
  const value = fs.readFileSync(file, "utf8");
  try { assertNoExcludedContent(value, path.relative(DIST, file)); } catch (error) { fail(file, error.message); }
  if (file.endsWith(".html") && /\b(?:undefined|null)\b/.test(value)) fail(file, "contains an undefined/null token");
  if (/bladesbeats\.opossum|api\.ipify\.org/i.test(value)) fail(file, "contains retired contact or IP lookup data");
}

const canonicals = new Map();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  if (!/^<!doctype html>/i.test(html)) fail(file, "missing HTML doctype");
  if (!/<html lang="(?:en|es)">/.test(html)) fail(file, "missing supported document language");
  if (!/<title>[^<]{3,}[^<]*<\/title>/.test(html)) fail(file, "missing title");
  if (!/<meta name="description" content="[^"]{20,}">/.test(html)) fail(file, "missing useful meta description");
  if (!/<meta name="robots" content="[^"]+">/.test(html)) fail(file, "missing robots directive");
  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/.test(html)) fail(file, "missing h1");
  if (/href=""|src=""/.test(html)) fail(file, "contains a blank href/src");
  if (/<img(?![^>]*\balt=)[^>]*>/i.test(html)) fail(file, "contains an image without alt text");
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(match[1]); } catch (error) { fail(file, `invalid JSON-LD: ${error.message}`); }
  }
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  if (!canonical || !canonical.startsWith(SITE)) fail(file, "missing first-party canonical URL");
  else if (!/noindex/.test(html.match(/<meta name="robots" content="([^"]+)">/)?.[1] || "")) {
    if (canonicals.has(canonical)) fail(file, `duplicate canonical also used by ${canonicals.get(canonical)}`);
    canonicals.set(canonical, path.relative(DIST, file));
    if (!/<link rel="alternate" hreflang="en" href="[^"]+">/.test(html) || !/<link rel="alternate" hreflang="es" href="[^"]+">/.test(html) || !/<link rel="alternate" hreflang="x-default" href="[^"]+">/.test(html)) fail(file, "indexable page is missing complete language alternates");
  }
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("/") && !url.startsWith("//") && !internalTargetExists(url)) fail(file, `broken internal target ${url}`);
  }
  for (const match of html.matchAll(/<a\b([^>]*target="_blank"[^>]*)>/g)) {
    if (!/rel="[^"]*noopener/.test(match[1])) fail(file, "external target=_blank link is missing noopener");
  }
  if (/\/search(?:[/?"]|$)|open\.spotify\.com\/search/i.test(html)) fail(file, "contains a platform search fallback presented as a destination");
  if (Buffer.byteLength(html) > 300000) warnings.push(`${path.relative(DIST, file)} exceeds 300 KB`);
}

for (const blocked of ["scripts", "data", "workers", "package.json", ".git", ".gitignore", "config", "release-desk", "deploy"]) {
  if (fs.existsSync(path.join(DIST, blocked))) errors.push(`public output contains private/source path: ${blocked}`);
}

const sitemapFile = path.join(DIST, "sitemap.xml");
if (!fs.existsSync(sitemapFile)) errors.push("sitemap.xml is missing");
else {
  const sitemap = fs.readFileSync(sitemapFile, "utf8");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const unique = new Set(locations);
  if (unique.size !== locations.length) errors.push("sitemap contains duplicate URLs");
  for (const location of unique) {
    const pathname = new URL(location).pathname;
    if (!internalTargetExists(pathname)) errors.push(`sitemap target is missing: ${pathname}`);
    if (!canonicals.has(location)) errors.push(`sitemap URL is not an indexable canonical: ${location}`);
  }
  for (const canonical of canonicals.keys()) {
    if (!unique.has(canonical)) errors.push(`indexable canonical is missing from sitemap: ${canonical}`);
  }
}

const releases = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "releases.json"), "utf8"));
const approved = releases.filter((release) => !isExcludedRelease(release) && ["official", "published"].includes(release.status || "official"));
for (const release of approved) {
  for (const route of [`music/${release.slug}/index.html`, `es/musica/${release.slug}/index.html`]) {
    if (!fs.existsSync(path.join(DIST, route))) errors.push(`approved release page missing: ${route}`);
  }
}

if (errors.length) {
  process.stderr.write(`Build validation failed with ${errors.length} error(s):\n- ${errors.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Build validation passed: ${htmlFiles.length} HTML files, ${canonicals.size} indexable pages, ${approved.length} approved releases.\n`);
  if (warnings.length) process.stdout.write(`Warnings:\n- ${warnings.join("\n- ")}\n`);
}
