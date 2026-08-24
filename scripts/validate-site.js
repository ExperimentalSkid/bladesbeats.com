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

function renderedTextLength(value) {
  return [...String(value || "").replace(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi, "x")].length;
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

function coverWallDate(item, kind) {
  if (kind === "release") return item.releaseDate || item.lastmod || "0000-00-00";
  return item.uploadDate || item.publishedDate || item.lastmod || "0000-00-00";
}

function coverWallImageUrl(image) {
  return image.replace(/\/\d+x\d+bb\.(jpg|jpeg|png)$/i, "/600x600bb.$1");
}

function expectedCoverWallItems() {
  const releases = JSON.parse(read("data/releases.json"));
  const sets = JSON.parse(read("data/dj-sets.json"));
  const releaseCovers = releases
    .filter((release) => {
      const links = release.links || {};
      return release.status === "official"
        && release.image
        && (release.appleMusicUrl || links.appleMusic || release.spotifyUrl || links.spotify);
    })
    .map((release) => ({
      id: `release:${release.slug}`,
      title: release.title,
      image: coverWallImageUrl(release.image),
      date: coverWallDate(release, "release")
    }));
  const setCovers = sets
    .filter((set) => {
      const links = set.links || {};
      return set.status === "official" && set.image && (set.mixcloudUrl || links.mixcloud);
    })
    .map((set) => ({
      id: `set:${set.slug}`,
      title: set.title,
      image: coverWallImageUrl(set.image),
      date: coverWallDate(set, "set")
    }));
  const seenImages = new Set();
  return releaseCovers
    .concat(setCovers)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
    .filter((item) => {
      if (seenImages.has(item.image)) return false;
      seenImages.add(item.image);
      return true;
    })
    .slice(0, 24);
}

function validateHomepageCoverWall(relative) {
  const homepage = read(relative);
  const match = homepage.match(/<div class="home-cover-wall"[^>]*data-generated-cover-wall[^>]*data-cover-count="(\d+)"[^>]*>([\s\S]*?)<\/div>\s*<div class="home-cover-scrim"/);
  if (!match) {
    fail(`${relative}: missing generated homepage cover wall`);
    return;
  }
  const expected = expectedCoverWallItems();
  const ids = [...match[2].matchAll(/data-cover-id="([^"]+)"/g)].map((entry) => entry[1]);
  const uniqueIds = [...new Set(ids)];
  const declaredCount = Number(match[1]);
  const columnCount = (match[2].match(/class="home-cover-column"/g) || []).length;
  if (columnCount !== 3) fail(`${relative}: homepage cover wall has ${columnCount} columns instead of 3`);
  if (declaredCount !== uniqueIds.length) fail(`${relative}: homepage cover count is stale (${declaredCount} declared, ${uniqueIds.length} found)`);
  if (uniqueIds.length > 24) fail(`${relative}: homepage cover wall exceeds the 24-cover limit (${uniqueIds.length})`);
  if (ids.length !== uniqueIds.length * 2) fail(`${relative}: homepage cover wall does not contain exactly two animation loops`);
  for (const id of uniqueIds) {
    if (ids.filter((value) => value === id).length !== 2) fail(`${relative}: homepage cover ${id} is not duplicated exactly once`);
  }
  const expectedColumns = Array.from({ length: 3 }, () => []);
  expected.forEach((item, index) => expectedColumns[index % 3].push(item.id));
  const expectedIds = expectedColumns.flat();
  if (uniqueIds.join("|") !== expectedIds.join("|")) {
    fail(`${relative}: homepage cover wall does not match the latest distributed releases and DJ sets`);
  }
}

function expectedFeaturedRelease() {
  return JSON.parse(read("data/releases.json"))
    .filter((release) => {
      const links = release.links || {};
      return release.status === "official"
        && release.image
        && (release.appleMusicUrl || links.appleMusic || release.spotifyUrl || links.spotify);
    })
    .sort((a, b) => String(b.releaseDate || b.lastmod || "").localeCompare(String(a.releaseDate || a.lastmod || "")))[0] || null;
}

function validateHomepageFeaturedRelease(relative, languagePath) {
  const homepage = read(relative);
  const release = expectedFeaturedRelease();
  if (!release) {
    fail(`${relative}: no eligible featured release found in release data`);
    return;
  }
  const href = `${languagePath}${release.slug}/`;
  const match = homepage.match(/<a class="home-feature-release" href="([^"]+)" data-featured-release[\s\S]*?data-featured-release-title>([^<]+)<\/strong>[\s\S]*?<\/a>/);
  if (!match) {
    fail(`${relative}: missing featured release block`);
    return;
  }
  if (match[1] !== href) fail(`${relative}: featured release points to ${match[1]} instead of ${href}`);
  if (match[2] !== release.title) fail(`${relative}: featured release title is stale`);
  if (!homepage.includes(`src="${release.image}"`) || !homepage.includes("data-featured-release-image")) {
    fail(`${relative}: featured release artwork is missing or stale`);
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
  if (/https:\/\/dj\.bladesbeats\.com\/?/i.test(html)) fail(`${relative}: contains the unavailable DJ subdomain`);
  validateVersionedAssets(html, relative);
  validateLocalTargets(html, relative);
  validateJsonLd(html, relative);
}

validateHomepageCoverWall("index.html");
validateHomepageCoverWall("es/index.html");
validateHomepageFeaturedRelease("index.html", "/music/");
validateHomepageFeaturedRelease("es/index.html", "/es/musica/");

const featuredRelease = expectedFeaturedRelease();
for (const [relative, expectedCta, expectedLanguage] of [
  ["index.html", featuredRelease ? `/music/${featuredRelease.slug}/` : "/music/", /<a class="site-nav-lang" href="\/es\/" hreflang="es"/],
  ["es/index.html", featuredRelease ? `/es/musica/${featuredRelease.slug}/` : "/es/musica/", /<a class="site-nav-lang" href="\/" hreflang="en"/]
]) {
  const homepage = read(relative);
  if (!homepage.includes(`href="${expectedCta}" data-i18n="home_hero_cta"`)) {
    fail(`${relative}: homepage CTA does not use the latest language-specific release URL`);
  }
  if (!expectedLanguage.test(homepage)) fail(`${relative}: homepage language link uses the wrong URL`);
  if (/data-lang-switch|localStorage|const COPY =|data-page="(?:releases|appearances|story|booking)"/.test(homepage)) {
    fail(`${relative}: legacy hidden-page or client-side language code remains`);
  }
  if (/data-contact-form|api\.ipify\.org|challenges\.cloudflare\.com\/turnstile/.test(homepage)) {
    fail(`${relative}: hidden contact-form dependency remains`);
  }
}

for (const relative of htmlFiles.filter((file) => /^(?:music|es\/musica)\/[^/]+\/index\.html$/.test(file))) {
  const html = read(relative);
  const pageTitle = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
  const h1Count = (html.match(/<h1\b/g) || []).length;
  if (!/<body class="static-page subpage release-page">/.test(html)) fail(`${relative}: release poster body class is missing`);
  if (!/<h1 class="release-poster-title">/.test(html)) fail(`${relative}: release poster title is missing`);
  if (h1Count !== 1) fail(`${relative}: release page has ${h1Count} h1 elements instead of 1`);
  if (!/<section class="release-editorial"/.test(html)) fail(`${relative}: release editorial section is missing`);
  if (!/<nav class="release-neighbors"/.test(html)) fail(`${relative}: adjacent-release navigation is missing`);
  if (renderedTextLength(pageTitle) > 65) fail(`${relative}: release title exceeds 65 displayed characters`);
  if (!/\| BladesBeats$/.test(pageTitle)) fail(`${relative}: release title is missing the concise BladesBeats suffix`);
}

for (const relative of ["assets/js/contact-form.js", "workers/contact-worker.js", "scripts/build-pages.js"]) {
  const source = read(relative);
  if (/api\.ipify\.org|contactIpDetected|data-contact-ip|Detected IP/.test(source)) {
    fail(`${relative}: client-side IP collection remains`);
  }
}

const nginxConfig = read("deploy/nginx-bladesbeats.conf");
if ((nginxConfig.match(/add_header Cache-Control "no-store" always;/g) || []).length < 3) {
  fail("deploy/nginx-bladesbeats.conf: blocked source locations must return Cache-Control: no-store");
}
if (!/location = \/404\.html \{[\s\S]*?Cache-Control "no-store, max-age=0" always;[\s\S]*?(?:CDN-Cache-Control|Cloudflare-CDN-Cache-Control) "no-store" always;[\s\S]*?\}/.test(nginxConfig)) {
  fail("deploy/nginx-bladesbeats.conf: 404 responses must prevent browser and CDN caching");
}

for (const relative of ["llms.txt", "llms-full.txt"]) {
  if (exists(relative) && /https:\/\/dj\.bladesbeats\.com\/?/i.test(read(relative))) {
    fail(`${relative}: contains the unavailable DJ subdomain`);
  }
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
