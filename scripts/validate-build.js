"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

function sha12(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
}

function validateStructuredImageUrls(value, file) {
  if (Array.isArray(value)) {
    value.forEach((item) => validateStructuredImageUrls(item, file));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["image", "thumbnailUrl", "primaryImageOfPage"].includes(key) && typeof item === "string" && !/^https:\/\//.test(item)) {
      fail(file, `structured-data ${key} must use an absolute HTTPS URL`);
    }
    validateStructuredImageUrls(item, file);
  }
}

function collectStructuredTypes(value, types = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStructuredTypes(item, types));
    return types;
  }
  if (!value || typeof value !== "object") return types;
  const declared = value["@type"];
  if (Array.isArray(declared)) declared.forEach((type) => types.add(type));
  else if (declared) types.add(declared);
  Object.values(value).forEach((item) => collectStructuredTypes(item, types));
  return types;
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
  if (/api\.ipify\.org/i.test(value)) fail(file, "contains retired client-side IP lookup data");
}

const canonicals = new Map();
const descriptions = new Map();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const relative = path.relative(DIST, file).replace(/\\/g, "/");
  if (!/^<!doctype html>/i.test(html)) fail(file, "missing HTML doctype");
  if (!/<html lang="(?:en|es)">/.test(html)) fail(file, "missing supported document language");
  if (!/<title>[^<]{3,}[^<]*<\/title>/.test(html)) fail(file, "missing title");
  const description = html.match(/<meta name="description" content="([^"]{20,})">/)?.[1] || "";
  if (!description) fail(file, "missing useful meta description");
  if (!/<meta name="robots" content="[^"]+">/.test(html)) fail(file, "missing robots directive");
  if (/<meta name="keywords"/i.test(html)) fail(file, "contains obsolete keyword metadata");
  if (!/<meta name="referrer" content="no-referrer">/.test(html)) fail(file, "missing privacy-preserving referrer policy");
  if (!/<meta property="og:image:alt" content="[^"]+">/.test(html)) fail(file, "missing Open Graph image alt text");
  if (!/<meta name="twitter:image:alt" content="[^"]+">/.test(html)) fail(file, "missing social image alt text");
  if (!/<link rel="icon" type="image\/png" sizes="48x48" href="\/favicon-48\.png">/.test(html)) fail(file, "missing stable 48px search favicon");
  const h1Count = (html.match(/<h1\b/g) || []).length;
  if (h1Count !== 1) fail(file, `expected exactly one h1, found ${h1Count}`);
  if (!/<a class="skip-link" href="#main">/.test(html) || !/<main id="main">/.test(html)) fail(file, "missing skip-link/main landmark pair");
  if (/href=""|src=""/.test(html)) fail(file, "contains a blank href/src");
  if (/<img(?![^>]*\balt=)[^>]*>/i.test(html)) fail(file, "contains an image without alt text");
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (/\balt=""/.test(attributes) && !/\baria-hidden="true"/.test(attributes) && !/\brole="(?:presentation|none)"/.test(attributes)) {
      fail(file, "contains an image with empty alt text that is not explicitly decorative");
    }
  }
  if (/<img(?![^>]*\bwidth="\d+")(?![^>]*\bheight="\d+")[^>]*>/i.test(html) || /<img(?![^>]*\bwidth="\d+")[^>]*>/i.test(html) || /<img(?![^>]*\bheight="\d+")[^>]*>/i.test(html)) fail(file, "contains an image without explicit dimensions");
  const eagerImages = (html.match(/<img\b[^>]*\bloading="eager"/g) || []).length;
  if (eagerImages > 1) fail(file, `contains ${eagerImages} eager-loaded images`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) fail(file, "contains duplicate element IDs");
  const versionedAssets = [...html.matchAll(/(?:href|src)="(\/assets\/(?:css|js)\/[^"?]+)\?v=([a-f0-9]{12})"/g)];
  for (const match of versionedAssets) {
    const target = path.join(DIST, match[1].slice(1));
    if (!fs.existsSync(target)) fail(file, `missing versioned asset ${match[1]}`);
    else if (sha12(target) !== match[2]) fail(file, `stale version hash for ${match[1]}`);
  }
  for (const coreAsset of ["/assets/css/fonts.css", "/assets/css/tokens.css", "/assets/css/site.css", "/assets/js/site.js"]) {
    if (!html.includes(`${coreAsset}?v=`)) fail(file, `missing versioned reference to ${coreAsset}`);
  }
  const structuredTypes = new Set();
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      validateStructuredImageUrls(data, file);
      collectStructuredTypes(data, structuredTypes);
    } catch (error) { fail(file, `invalid JSON-LD: ${error.message}`); }
  }
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  const robots = html.match(/<meta name="robots" content="([^"]+)">/)?.[1] || "";
  if (!canonical || !canonical.startsWith(SITE)) fail(file, "missing first-party canonical URL");
  else if (!/noindex/.test(robots)) {
    if (descriptions.has(description)) fail(file, `duplicate meta description also used by ${descriptions.get(description)}`);
    else descriptions.set(description, path.relative(DIST, file));
    for (const preview of ["max-image-preview:large", "max-snippet:-1", "max-video-preview:-1"]) {
      if (!robots.includes(preview)) fail(file, `indexable page is missing ${preview}`);
    }
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
  if (/data-catalog-card[\s\S]*?<h2 class="release-name">/.test(html)) fail(file, "catalogue cards use h2 instead of h3 beneath their group heading");
  if (/data-catalog-count/.test(html) && !/<span role="status" aria-live="polite" aria-atomic="true"><b data-catalog-count>/.test(html)) fail(file, "dynamic catalogue count is not announced to assistive technology");
  if (relative === "index.html" && (!["WebSite", "Person", "WebPage"].every((type) => structuredTypes.has(type)) || !/DJ in Sevilla/.test(html))) fail(file, "English homepage is missing core local entity signals");
  if (relative === "es/index.html" && (!["Person", "WebPage"].every((type) => structuredTypes.has(type)) || !/DJ en Sevilla/.test(html))) fail(file, "Spanish homepage is missing core local entity signals");
  if (["about/index.html", "es/sobre-bladesbeats/index.html"].includes(relative) && !structuredTypes.has("ProfilePage")) fail(file, "artist biography is missing ProfilePage structured data");
  if (["booking/index.html", "es/contratar-dj-sevilla/index.html"].includes(relative) && (!["ContactPage", "Service", "Person"].every((type) => structuredTypes.has(type)))) fail(file, "booking page is missing local service structured data");
  const isIndexableSubpage = !/noindex/.test(robots) && !["index.html", "es/index.html"].includes(relative);
  if (isIndexableSubpage && !structuredTypes.has("BreadcrumbList")) fail(file, "indexable subpage is missing BreadcrumbList structured data");
  if (isIndexableSubpage && !/<nav class="breadcrumb"[^>]*>[\s\S]*?aria-current="page"/.test(html)) fail(file, "indexable subpage is missing visible breadcrumb navigation");
  if (/^(?:music|es\/musica)\/[^/]+\/index\.html$/.test(relative) && !structuredTypes.has("MusicRecording")) fail(file, "release page is missing MusicRecording structured data");
  if (/data-player-type="video"/.test(html) && !structuredTypes.has("VideoObject")) fail(file, "video release page is missing VideoObject structured data");
  if (/^(?:dj-sets|es\/sesiones)\/[^/]+\/index\.html$/.test(relative) && !structuredTypes.has("AudioObject")) fail(file, "DJ set page is missing AudioObject structured data");
  if (/^(?:gigs|es\/eventos)\/[^/]+\/index\.html$/.test(relative) && !structuredTypes.has("Event")) fail(file, "gig page is missing Event structured data");
  if (Buffer.byteLength(html) > 300000) warnings.push(`${path.relative(DIST, file)} exceeds 300 KB`);
}

const siteCssFile = path.join(DIST, "assets", "css", "site.css");
if (fs.existsSync(siteCssFile) && /@import\b/.test(fs.readFileSync(siteCssFile, "utf8"))) errors.push("assets/css/site.css contains a render-blocking @import");

for (const blocked of ["scripts", "data", "workers", "package.json", ".git", ".gitignore", "config", "release-desk", "deploy"]) {
  if (fs.existsSync(path.join(DIST, blocked))) errors.push(`public output contains private/source path: ${blocked}`);
}

const sitemapFile = path.join(DIST, "sitemap.xml");
if (!fs.existsSync(sitemapFile)) errors.push("sitemap.xml is missing");
else {
  const sitemap = fs.readFileSync(sitemapFile, "utf8");
  if (!/xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/.test(sitemap)) errors.push("sitemap is missing the Google image namespace");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const imageLocations = [...sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
  if (imageLocations.length < 80) errors.push(`sitemap exposes too few image landing signals: ${imageLocations.length}`);
  for (const location of imageLocations) {
    if (!location.startsWith(`${SITE}/`)) errors.push(`image sitemap contains a non-first-party URL: ${location}`);
    else if (!internalTargetExists(new URL(location).pathname)) errors.push(`image sitemap target is missing: ${location}`);
  }
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
  const legacySitemapFile = path.join(ROOT, "sitemap.xml");
  if (fs.existsSync(legacySitemapFile)) {
    const legacy = new Set([...fs.readFileSync(legacySitemapFile, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    for (const location of legacy) if (!unique.has(location)) errors.push(`previously published sitemap URL was dropped without a redirect plan: ${location}`);
  }
}

const releases = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "releases.json"), "utf8"));
const approved = releases.filter((release) => !isExcludedRelease(release) && ["official", "published"].includes(release.status || "official"));
for (const release of approved) {
  for (const route of [`music/${release.slug}/index.html`, `es/musica/${release.slug}/index.html`]) {
    if (!fs.existsSync(path.join(DIST, route))) errors.push(`approved release page missing: ${route}`);
  }
}

const nginxFile = path.join(ROOT, "deploy", "nginx-bladesbeats.conf");
if (!fs.existsSync(nginxFile)) errors.push("deploy/nginx-bladesbeats.conf is missing");
else {
  const nginx = fs.readFileSync(nginxFile, "utf8");
  if (!/root \/srv\/bladesbeats\/current;/.test(nginx)) errors.push("Nginx does not serve the reviewed current-release symlink");
  if (/Content-Security-Policy-Report-Only/.test(nginx) || !/add_header Content-Security-Policy /.test(nginx)) errors.push("Nginx Content Security Policy is not enforced");
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
    if (!nginx.includes(`add_header ${header} `)) errors.push(`Nginx is missing ${header}`);
  }
}

if (errors.length) {
  process.stderr.write(`Build validation failed with ${errors.length} error(s):\n- ${errors.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Build validation passed: ${htmlFiles.length} HTML files, ${canonicals.size} indexable pages, ${approved.length} approved releases.\n`);
  if (warnings.length) process.stdout.write(`Warnings:\n- ${warnings.join("\n- ")}\n`);
}
