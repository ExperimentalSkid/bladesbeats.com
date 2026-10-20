"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const target = fs.realpathSync(process.argv[2] || "");
const manifestFile = path.join(target, "release-manifest.json");
if (!fs.existsSync(manifestFile)) throw new Error("release-manifest.json is missing");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
if (!/^[A-Za-z0-9._-]+$/.test(String(manifest.version || ""))) throw new Error("release manifest version is invalid");
if (manifest.version !== path.basename(target)) throw new Error("release manifest version does not match its directory");
const forbidden = ["scripts", "data", "workers", "config", "release-desk", "deploy", "package.json", ".git", ".gitignore"];
for (const name of forbidden) if (fs.existsSync(path.join(target, name))) throw new Error(`forbidden public path: ${name}`);
if (!fs.existsSync(path.join(target, "index.html"))) throw new Error("index.html is missing");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symbolic links are forbidden in a release: ${path.relative(target, entryPath)}`);
    if (entry.isDirectory()) return walk(entryPath);
    if (!entry.isFile()) throw new Error(`special files are forbidden in a release: ${path.relative(target, entryPath)}`);
    return [entryPath];
  });
}

const actual = {};
for (const file of walk(target)) {
  const relative = path.relative(target, file).replace(/\\/g, "/");
  if (relative === "release-manifest.json") continue;
  actual[relative] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
const expected = manifest.files || {};
if (Object.keys(actual).length !== Object.keys(expected).length) throw new Error("release file count differs from the prepared manifest");
for (const [file, hash] of Object.entries(expected)) if (actual[file] !== hash) throw new Error(`release hash mismatch: ${file}`);
process.stdout.write(`${manifest.version}\n`);
