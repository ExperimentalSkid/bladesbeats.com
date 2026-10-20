"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { stagePublicSite, PUBLIC_ROOT_FILES, PUBLIC_DIRS } = require("../scripts/stage-public-site");

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bladesbeats-stage-test-"));
  t.after(() => {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const resolved = fs.realpathSync(temporary);
    assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolved).startsWith("bladesbeats-stage-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const source = path.join(temporary, "source");
  const destination = path.join(temporary, "stage");
  fs.mkdirSync(source);
  for (const directory of PUBLIC_DIRS) fs.mkdirSync(path.join(source, directory));
  for (const filename of PUBLIC_ROOT_FILES) fs.writeFileSync(path.join(source, filename), `public:${filename}`);
  fs.mkdirSync(path.join(source, "assets", "css"));
  fs.mkdirSync(path.join(source, "assets", "media"));
  fs.writeFileSync(path.join(source, "assets", "css", "site.css"), "body { color: #fff }\n");
  fs.writeFileSync(path.join(source, "assets", "media", "art.png"), Buffer.from([0, 1, 2, 255]));
  fs.writeFileSync(path.join(source, "index.html"), '<!doctype html><link href="/assets/css/site.css?v=1"><a href="/es/">Spanish</a><img src="/assets/media/art.png"><a href="https://example.org/">External</a>');
  fs.writeFileSync(path.join(source, "es", "index.html"), '<!doctype html><a href="../">English</a><a href="mailto:book@example.org">Email</a>');
  fs.writeFileSync(path.join(source, "404.html"), '<!doctype html><a href="/">Home</a>');
  fs.writeFileSync(path.join(source, "sitemap.xml"), '<?xml version="1.0"?><urlset><url><loc>https://bladesbeats.com/</loc></url><url><loc>https://bladesbeats.com/es/</loc></url></urlset>');
  for (const privateDirectory of ["data", "scripts", "config", "deploy", "release-desk", ".git", "src", "workers"]) {
    fs.mkdirSync(path.join(source, privateDirectory));
    fs.writeFileSync(path.join(source, privateDirectory, "secret.txt"), "private");
  }
  fs.writeFileSync(path.join(source, "data", "secret.json"), '{"private":true}');
  return { source, destination };
}

test("CLI stages only allowlisted files, byte-for-byte, and accepts an empty destination", (t) => {
  const { source, destination } = fixture(t);
  fs.mkdirSync(destination);
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "stage-public-site.js"), source, destination], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Staged \d+ public files\.\n$/);
  assert.deepEqual(fs.readFileSync(path.join(destination, "assets", "media", "art.png")), Buffer.from([0, 1, 2, 255]));
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), fs.readFileSync(path.join(source, "index.html"), "utf8"));
  for (const privateDirectory of ["data", "scripts", "config", "deploy", "release-desk", ".git", "src", "workers"]) {
    assert.equal(fs.existsSync(path.join(destination, privateDirectory)), false, `${privateDirectory} must remain private`);
  }
});

test("refuses the checkout itself and any nonempty destination", (t) => {
  const { source, destination } = fixture(t);
  assert.throws(() => stagePublicSite(source, source), /outside the source checkout/);
  assert.throws(() => stagePublicSite(source, path.join(source, "new-stage")), /outside the source checkout/);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, "preexisting.txt"), "leave me alone");
  assert.throws(() => stagePublicSite(source, destination), /destination must be empty/);
  assert.equal(fs.readFileSync(path.join(destination, "preexisting.txt"), "utf8"), "leave me alone");
});

test("rejects broken local href/src and missing sitemap URLs", (t) => {
  const one = fixture(t);
  fs.writeFileSync(path.join(one.source, "index.html"), '<a href="/assets/media/missing.png">Broken</a>');
  assert.throws(() => stagePublicSite(one.source, one.destination), /missing local href\/src/);
  assert.equal(fs.existsSync(one.destination), false, "a failed validation must not leave a publishable tree");

  const two = fixture(t);
  fs.writeFileSync(path.join(two.source, "sitemap.xml"), '<urlset><url><loc>https://bladesbeats.com/ghost/</loc></url></urlset>');
  assert.throws(() => stagePublicSite(two.source, two.destination), /missing sitemap target/);
  assert.equal(fs.existsSync(two.destination), false);
});

test("rejects a reference to private source even when that source file exists", (t) => {
  const { source, destination } = fixture(t);
  fs.writeFileSync(path.join(source, "index.html"), '<a href="https://bladesbeats.com/data/secret.json">Private</a>');
  assert.throws(() => stagePublicSite(source, destination), /private or invalid local path/);
});

test("rejects local filesystem and script URL schemes", (t) => {
  for (const reference of ["file:///etc/passwd", "javascript:alert(1)", "C:\\private\\file.txt"]) {
    const { source, destination } = fixture(t);
    fs.writeFileSync(path.join(source, "index.html"), `<a href="${reference}">Unsafe</a>`);
    assert.throws(() => stagePublicSite(source, destination), /unsafe href\/src/);
  }
});

test("rejects unexpected private files inside a public directory", (t) => {
  const { source, destination } = fixture(t);
  fs.writeFileSync(path.join(source, "assets", ".env"), "secret");
  assert.throws(() => stagePublicSite(source, destination), /private path inside public directory/);
});

test("rejects symbolic links in public input and destination", (t) => {
  const { source, destination } = fixture(t);
  const link = path.join(source, "assets", "css", "linked.css");
  try { fs.symlinkSync(path.join(source, "data", "secret.json"), link); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }
  assert.throws(() => stagePublicSite(source, destination), /symbolic link is forbidden/);
  fs.unlinkSync(link);
  fs.symlinkSync(source, destination, "dir");
  assert.throws(() => stagePublicSite(source, destination), /symbolic link in destination path/);
});
