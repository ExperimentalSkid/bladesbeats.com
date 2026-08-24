"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FONT_ASSETS = [
  {
    url: "https://fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59A.woff2",
    file: "assets/fonts/hanken-grotesk-latin.woff2"
  },
  {
    url: "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2",
    file: "assets/fonts/jetbrains-mono-latin.woff2"
  },
  {
    url: "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2",
    file: "assets/fonts/space-grotesk-latin.woff2"
  },
  {
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/hankengrotesk/OFL.txt",
    file: "assets/fonts/OFL-Hanken-Grotesk.txt"
  },
  {
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt",
    file: "assets/fonts/OFL-JetBrains-Mono.txt"
  },
  {
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt",
    file: "assets/fonts/OFL-Space-Grotesk.txt"
  }
];

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function catalogAsset(item, kind) {
  const source = String(item.image || "");
  if (!/^https:\/\//i.test(source)) return null;
  let provider = "remote";
  let extension = ".jpg";
  if (/mzstatic\.com/i.test(source)) provider = "apple";
  if (/i\.ytimg\.com/i.test(source)) provider = "youtube";
  if (/thumbnailer\.mixcloud\.com/i.test(source)) {
    provider = "mixcloud";
    extension = ".png";
  }
  return {
    url: source,
    file: `assets/media/catalog/${kind}/${item.slug}-${provider}${extension}`
  };
}

async function download(asset) {
  const target = path.join(ROOT, asset.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(asset.url, {
    headers: { "user-agent": "BladesBeats site asset cache/1.0" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${asset.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Empty response: ${asset.url}`);
  fs.writeFileSync(target, bytes);
  return { file: asset.file, bytes: bytes.length };
}

async function runPool(items, concurrency = 6) {
  let index = 0;
  const results = [];
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      results.push(await download(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const releases = readJson("data/releases.json");
  const sets = readJson("data/dj-sets.json");
  const catalogAssets = [
    ...releases.map((item) => catalogAsset(item, "releases")),
    ...sets.map((item) => catalogAsset(item, "sets"))
  ].filter(Boolean);
  const unique = [...new Map([...FONT_ASSETS, ...catalogAssets].map((asset) => [asset.file, asset])).values()];
  const results = await runPool(unique);
  const totalBytes = results.reduce((total, result) => total + result.bytes, 0);
  console.log(`Cached ${results.length} self-hosted assets (${(totalBytes / 1024 / 1024).toFixed(2)} MiB).`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
