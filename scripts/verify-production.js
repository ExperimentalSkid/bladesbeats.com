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

function privateBlockKind(response) {
  if (response.status === 404) return "404 not found";
  if (response.status === 403 && /cloudflare/i.test(response.headers.get("server") || "")) return "403 Cloudflare denied";
  return "";
}

async function verifyPrivatePath(privatePath, requestFn = request, origin = ORIGIN, nonce = Date.now()) {
  const pathErrors = [];
  const statuses = [];
  for (const [label, url] of [
    ["public URL", `${origin}${privatePath}`],
    ["cache-busted URL", `${origin}${privatePath}?deployment-check=${nonce}`]
  ]) {
    try {
      const response = await requestFn(url);
      const kind = privateBlockKind(response);
      statuses.push(kind || String(response.status));
      if (!kind) {
        pathErrors.push(`${privatePath}: ${label} is not blocked (HTTP ${response.status}); check origin rules and purge this exact CDN URL if cached`);
        continue;
      }
      if (label === "cache-busted URL") {
        const cacheControl = response.headers.get("cache-control") || "";
        if (!/\bno-store\b/i.test(cacheControl)) pathErrors.push(`${privatePath}: ${kind} is missing Cache-Control: no-store`);
        if (response.status === 404) {
          const cdnCacheControl = response.headers.get("cdn-cache-control") || response.headers.get("cloudflare-cdn-cache-control") || "";
          if (!/\bno-store\b/i.test(cdnCacheControl)) pathErrors.push(`${privatePath}: ${kind} is missing CDN no-store protection`);
        }
      }
    } catch (error) {
      pathErrors.push(`${privatePath}: ${label} check failed (${error.message})`);
    }
  }
  return { errors: pathErrors, statuses };
}

async function verifyCanonicalRedirect(start, expected = `${EXPECTED_ORIGIN}/`, requestFn = request) {
  const allowedHosts = new Set(["bladesbeats.com", "www.bladesbeats.com"]);
  const seen = new Set();
  let current = start;
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    if (seen.has(current)) return `${start}: redirect loop at ${current}`;
    seen.add(current);
    let response;
    try {
      response = await requestFn(current);
    } catch (error) {
      return `${start}: request failed at ${current} (${error.message})`;
    }
    const location = response.headers.get("location") || "";
    if (response.status === 301 || response.status === 308) {
      if (redirects === 2) return `${start}: more than two permanent redirects (last HTTP ${response.status} to ${location || "nowhere"})`;
      if (!location) return `${start}: HTTP ${response.status} has no Location`;
      let next;
      try { next = new URL(location, current); } catch { return `${start}: invalid redirect Location ${location}`; }
      if (next.protocol !== "https:" || !allowedHosts.has(next.hostname) || next.port || next.username || next.password || next.pathname !== "/" || next.search || next.hash) {
        return `${start}: unsafe redirect from ${current} to ${next.href}`;
      }
      current = next.href;
      continue;
    }
    if (redirects === 0) return `${start}: expected a permanent redirect, received HTTP ${response.status}${location ? ` to ${location}` : ""}`;
    if (current !== expected || response.status !== 200) return `${start}: expected HTTP 200 at ${expected}, received HTTP ${response.status} at ${current}`;
    return "";
  }
  return `${start}: redirect chain did not reach ${expected}`;
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

  const privateStatuses = [];
  for (const privatePath of [
    "/package.json",
    "/scripts/build-pages.js",
    "/data/releases.json",
    "/workers/contact-worker.js",
    "/src/site.js",
    "/deploy/OPERATIONS.md",
    "/.git/config"
  ]) {
    const result = await verifyPrivatePath(privatePath);
    for (const error of result.errors) fail(error);
    privateStatuses.push(`${privatePath}: ${result.statuses.join(" / ")}`);
  }

  if (ORIGIN === EXPECTED_ORIGIN) {
    for (const url of ["http://bladesbeats.com/", "http://www.bladesbeats.com/", "https://www.bladesbeats.com/"]) {
      const error = await verifyCanonicalRedirect(url);
      if (error) fail(error);
    }
  }

  if (errors.length) {
    console.error(`Production verification failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Verified ${expectedUrls.length} production pages, canonical redirects, robots.txt, sitemap parity, and private-path blocking.`);
  for (const status of privateStatuses) console.log(`- ${status}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production verification failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { privateBlockKind, verifyPrivatePath, verifyCanonicalRedirect };
