"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SITE_ORIGIN = "https://bladesbeats.com";
const PUBLIC_ROOT_FILES = Object.freeze([
  "404.html",
  "apple-touch-icon.png",
  "bladesbeats.jpg",
  "bladesbeats.png",
  "bladesbeats.webp",
  "favicon-16.png",
  "favicon-32.png",
  "favicon-48.png",
  "favicon.ico",
  "index.html",
  "llms-full.txt",
  "llms.txt",
  "og-card.png",
  "robots.txt",
  "sitemap.xml"
]);
const PUBLIC_DIRS = Object.freeze([
  "about",
  "assets",
  "aviso-legal",
  "blocked",
  "booking",
  "cookie-policy",
  "dj-sets",
  "es",
  "gigs",
  "legal-notice",
  "music",
  "politica-cookies",
  "politica-privacidad",
  "privacy-policy"
]);
const FORBIDDEN_SEGMENTS = new Set([
  ".git", "config", "data", "deploy", "dist", "release-desk", "scripts", "src", "workers"
]);
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requiredEntry(full, kind) {
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${full}`);
  if (kind === "file" && !stat.isFile()) throw new Error(`expected a regular file: ${full}`);
  if (kind === "directory" && !stat.isDirectory()) throw new Error(`expected a directory: ${full}`);
  return stat;
}

function lstatIfPresent(full) {
  try { return fs.lstatSync(full); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function publicFileAllowed(relative) {
  const parts = relative.split(path.sep);
  if (parts.some((part) => !part || part.startsWith(".") || FORBIDDEN_SEGMENTS.has(part.toLowerCase()))) return false;
  if (parts.length === 1) return PUBLIC_ROOT_FILES.includes(parts[0]);
  if (!PUBLIC_DIRS.includes(parts[0])) return false;

  const extension = path.extname(parts.at(-1)).toLowerCase();
  if (parts[0] === "assets") {
    if (parts.length < 3) return false;
    const kind = parts[1];
    if (kind === "css") return extension === ".css";
    if (kind === "js") return extension === ".js";
    if (kind === "fonts") return extension === ".woff2" || extension === ".txt";
    if (kind === "media") return IMAGE_EXTENSIONS.has(extension);
    return false;
  }
  if (parts[0] === "gigs" && IMAGE_EXTENSIONS.has(extension)) return true;
  return parts.at(-1) === "index.html";
}

function collectPublicFiles(sourceRoot) {
  const files = [];
  for (const name of PUBLIC_ROOT_FILES) {
    requiredEntry(path.join(sourceRoot, name), "file");
    files.push(name);
  }
  function visit(relativeDir) {
    const fullDir = path.join(sourceRoot, relativeDir);
    requiredEntry(fullDir, "directory");
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(relativeDir, entry.name);
      const full = path.join(sourceRoot, relative);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${relative}`);
      if (entry.name.startsWith(".") || FORBIDDEN_SEGMENTS.has(entry.name.toLowerCase())) {
        throw new Error(`private path inside public directory: ${relative}`);
      }
      if (stat.isDirectory()) visit(relative);
      else if (stat.isFile()) {
        if (!publicFileAllowed(relative)) throw new Error(`unexpected file inside public directory: ${relative}`);
        files.push(relative);
      } else throw new Error(`special file is forbidden: ${relative}`);
    }
  }
  for (const directory of PUBLIC_DIRS) visit(directory);
  return files;
}

function checkedDestination(destination, sourceRoot) {
  const absolute = path.resolve(destination);
  // Refuse symlinks anywhere in the destination path, including an existing empty destination.
  for (let current = absolute; ; current = path.dirname(current)) {
    if (lstatIfPresent(current)?.isSymbolicLink()) {
      throw new Error(`symbolic link in destination path: ${current}`);
    }
    if (current === path.dirname(current)) break;
  }
  let ancestor = absolute;
  const missing = [];
  while (!lstatIfPresent(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  requiredEntry(ancestor, "directory");
  const resolved = path.resolve(fs.realpathSync(ancestor), ...missing);
  if (isWithin(sourceRoot, resolved)) throw new Error("destination must be outside the source checkout");
  if (lstatIfPresent(absolute)) {
    requiredEntry(absolute, "directory");
    if (fs.readdirSync(absolute).length) throw new Error("destination must be empty");
  }
  return absolute;
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi, (match, decimal, hex) => {
    if (decimal || hex) {
      const point = Number.parseInt(decimal || hex, hex ? 16 : 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" }[match.toLowerCase()] || match;
  });
}

function fileForSiteUrl(destination, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { throw new Error(`invalid URL encoding: ${url.href}`); }
  if (pathname.includes("\\") || pathname.includes("\0")) throw new Error(`invalid local path: ${url.href}`);
  const parts = pathname.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || FORBIDDEN_SEGMENTS.has(part.toLowerCase()))) {
    throw new Error(`private or invalid local path: ${url.href}`);
  }
  const base = path.resolve(destination, ...parts);
  if (!isWithin(destination, base)) throw new Error(`local path escapes staging: ${url.href}`);
  if (pathname.endsWith("/") || fs.existsSync(base) && fs.lstatSync(base).isDirectory()) return path.join(base, "index.html");
  return base;
}

function validateStagedSite(destination, files) {
  const sitemap = fs.readFileSync(path.join(destination, "sitemap.xml"), "utf8");
  const locations = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => decodeEntities(match[1]));
  if (!locations.length || locations.length !== new Set(locations).size) {
    throw new Error("sitemap must contain unique URLs");
  }
  for (const location of locations) {
    let url;
    try { url = new URL(location); }
    catch { throw new Error(`invalid sitemap URL: ${location}`); }
    if (url.origin !== SITE_ORIGIN || url.search || url.hash || url.username || url.password) {
      throw new Error(`non-canonical sitemap URL: ${location}`);
    }
    const target = fileForSiteUrl(destination, url);
    if (!target.endsWith(".html") || !fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
      throw new Error(`missing sitemap target: ${location}`);
    }
  }

  for (const relative of files.filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(destination, relative), "utf8");
    const pagePath = relative === "index.html" ? "/" : relative.endsWith(`${path.sep}index.html`)
      ? `/${relative.slice(0, -"index.html".length).split(path.sep).join("/")}` : `/${relative.split(path.sep).join("/")}`;
    const pageUrl = new URL(pagePath, SITE_ORIGIN);
    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
      const reference = decodeEntities(match[2].trim());
      if (!reference) throw new Error(`empty href/src in ${relative}`);
      if (reference.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(reference) && !/^(?:https?|mailto|tel|sms):/i.test(reference)) {
        throw new Error(`unsafe href/src in ${relative}: ${reference}`);
      }
      let url;
      try { url = new URL(reference, pageUrl); }
      catch { throw new Error(`invalid href/src in ${relative}: ${reference}`); }
      if (url.origin !== SITE_ORIGIN) continue;
      const target = fileForSiteUrl(destination, url);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
        throw new Error(`missing local href/src in ${relative}: ${reference}`);
      }
    }
  }
}

function stagePublicSite(sourceCheckout, destinationPath) {
  if (!sourceCheckout || !destinationPath) throw new Error("usage: node scripts/stage-public-site.js <source-checkout> <fresh-destination>");
  const source = path.resolve(sourceCheckout);
  requiredEntry(source, "directory");
  const sourceRoot = fs.realpathSync(source);
  const destination = checkedDestination(destinationPath, sourceRoot);
  const files = collectPublicFiles(sourceRoot);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const existedEmpty = Boolean(lstatIfPresent(destination));
  fs.mkdirSync(destination, { recursive: true });
  try {
    for (const relative of files) {
      const sourceFile = path.join(sourceRoot, relative);
      const outputFile = path.join(destination, relative);
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      requiredEntry(sourceFile, "file");
      const descriptor = fs.openSync(sourceFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        if (!fs.fstatSync(descriptor).isFile()) throw new Error(`special file is forbidden: ${relative}`);
        fs.writeFileSync(outputFile, fs.readFileSync(descriptor), { flag: "wx" });
      } finally { fs.closeSync(descriptor); }
    }
    validateStagedSite(destination, files);
  } catch (error) {
    if (lstatIfPresent(destination) && !fs.lstatSync(destination).isSymbolicLink()) {
      const resolved = fs.realpathSync(destination);
      if (isWithin(parent, resolved) && resolved !== parent) {
        fs.rmSync(destination, { recursive: true, force: true });
        if (existedEmpty) fs.mkdirSync(destination);
      }
    }
    throw error;
  }
  return { destination, fileCount: files.length };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error("usage: node scripts/stage-public-site.js <source-checkout> <fresh-destination>");
    const result = stagePublicSite(process.argv[2], process.argv[3]);
    process.stdout.write(`Staged ${result.fileCount} public files.\n`);
  } catch (error) {
    process.stderr.write(`Public staging failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { stagePublicSite, PUBLIC_ROOT_FILES, PUBLIC_DIRS };
