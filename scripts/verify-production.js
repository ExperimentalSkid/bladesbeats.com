const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const originArg = process.argv.find((arg) => arg.startsWith("--origin="));
const ORIGIN = new URL(originArg ? originArg.slice("--origin=".length) : "https://bladesbeats.com").origin;
const EXPECTED_ORIGIN = "https://bladesbeats.com";
const USER_AGENT = "BladesBeats deployment verifier (+https://bladesbeats.com/)";
const errors = [];

function fail(message) {
  errors.push(message);
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const response = await request(url);
  const text = await response.text();
  return { response, text };
}

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

async function verifyPage(canonicalUrl) {
  const canonical = new URL(canonicalUrl);
  const target = new URL(canonical.pathname + canonical.search, ORIGIN).href;
  try {
    const { response, text } = await fetchText(target);
    if (response.status !== 200) {
      fail(`${canonical.pathname}: expected 200, received ${response.status}`);
      return;
    }
    const robots = (text.match(/<meta[^>]+name=["'](?:robots|googlebot)["'][^>]+content=["']([^"']+)["']/i) || [])[1] || response.headers.get("x-robots-tag") || "";
    if (/noindex/i.test(robots)) fail(`${canonical.pathname}: production page contains noindex`);
    const declaredCanonical = (text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1] || "";
    if (declaredCanonical !== canonicalUrl) {
      fail(`${canonical.pathname}: canonical mismatch (${declaredCanonical || "missing"})`);
    }
  } catch (error) {
    fail(`${canonical.pathname}: request failed (${error.message})`);
  }
}

async function runBatches(items, size, callback) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(callback));
  }
}

async function main() {
  const expectedXml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const expectedUrls = sitemapUrls(expectedXml);
  const { response: sitemapResponse, text: liveXml } = await fetchText(`${ORIGIN}/sitemap.xml`);
  if (sitemapResponse.status !== 200) fail(`/sitemap.xml: expected 200, received ${sitemapResponse.status}`);
  const liveUrls = sitemapUrls(liveXml);
  const expectedPaths = new Set(expectedUrls.map((url) => new URL(url).pathname));
  const livePaths = new Set(liveUrls.map((url) => new URL(url).pathname));
  for (const item of expectedPaths) if (!livePaths.has(item)) fail(`Live sitemap is missing ${item}`);
  for (const item of livePaths) if (!expectedPaths.has(item)) fail(`Live sitemap has unexpected URL ${item}`);

  const { response: robotsResponse, text: robots } = await fetchText(`${ORIGIN}/robots.txt`);
  if (robotsResponse.status !== 200) fail(`/robots.txt: expected 200, received ${robotsResponse.status}`);
  if (!robots.includes(`Sitemap: ${EXPECTED_ORIGIN}/sitemap.xml`)) fail("robots.txt is missing the canonical sitemap declaration");

  await runBatches(expectedUrls, 10, verifyPage);

  for (const privatePath of [
    "/package.json",
    "/scripts/build-pages.js",
    "/data/releases.json",
    "/workers/contact-worker.js",
    "/src/site.js",
    "/deploy/OPERATIONS.md",
    "/.git/config"
  ]) {
    try {
      const response = await request(`${ORIGIN}${privatePath}`);
      if (response.status !== 404) fail(`${privatePath}: expected 404, received ${response.status}`);
    } catch (error) {
      fail(`${privatePath}: privacy check failed (${error.message})`);
    }
  }

  if (ORIGIN === EXPECTED_ORIGIN) {
    for (const [url, expectedLocation] of [
      ["http://bladesbeats.com/", `${EXPECTED_ORIGIN}/`],
      ["http://www.bladesbeats.com/", `${EXPECTED_ORIGIN}/`],
      ["https://www.bladesbeats.com/", `${EXPECTED_ORIGIN}/`]
    ]) {
      const response = await request(url);
      const location = response.headers.get("location") || "";
      if (response.status !== 301 || location !== expectedLocation) {
        fail(`${url}: expected 301 to ${expectedLocation}, received ${response.status} to ${location || "nowhere"}`);
      }
    }
  }

  if (errors.length) {
    console.error(`Production verification failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Verified ${expectedUrls.length} production pages, canonical redirects, robots.txt, sitemap parity, and private-path blocking.`);
}

main().catch((error) => {
  console.error(`Production verification failed: ${error.message}`);
  process.exit(1);
});
