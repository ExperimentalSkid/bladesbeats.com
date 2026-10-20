"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { privateBlockKind, verifyPrivatePath, verifyCanonicalRedirect } = require("../scripts/verify-production");

function response(status, headers = {}) {
  return { status, headers: new Headers(headers) };
}

function route(responses) {
  return async (url) => {
    assert.ok(url in responses, `unexpected request ${url}`);
    return responses[url];
  };
}

test("private path accepts CDN 403 and origin 404 with uncached no-store headers", async () => {
  const origin = "https://bladesbeats.com";
  const privatePath = "/.git/config";
  const result = await verifyPrivatePath(privatePath, route({
    [`${origin}${privatePath}`]: response(403, { server: "cloudflare" }),
    [`${origin}${privatePath}?deployment-check=123`]: response(404, {
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store"
    })
  }), origin, 123);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.statuses, ["403 Cloudflare denied", "404 not found"]);
});

test("private path rejects an exposed cached URL even if cache-busted URL is blocked", async () => {
  const origin = "https://bladesbeats.com";
  const privatePath = "/data/releases.json";
  const result = await verifyPrivatePath(privatePath, route({
    [`${origin}${privatePath}`]: response(200),
    [`${origin}${privatePath}?deployment-check=123`]: response(404, {
      "cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store"
    })
  }), origin, 123);
  assert.match(result.errors.join("\n"), /public URL is not blocked \(HTTP 200\)/);
});

test("private path rejects an origin 403 and missing cache protection", async () => {
  assert.equal(privateBlockKind(response(403)), "");
  const origin = "https://bladesbeats.com";
  const privatePath = "/package.json";
  const result = await verifyPrivatePath(privatePath, route({
    [`${origin}${privatePath}`]: response(404),
    [`${origin}${privatePath}?deployment-check=123`]: response(404)
  }), origin, 123);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join("\n"), /Cache-Control: no-store/);
  assert.match(result.errors.join("\n"), /CDN no-store/);
});

test("canonical redirect permits Cloudflare HTTPS-www hop, then apex", async () => {
  const start = "http://www.bladesbeats.com/";
  const result = await verifyCanonicalRedirect(start, "https://bladesbeats.com/", route({
    [start]: response(301, { location: "https://www.bladesbeats.com/" }),
    "https://www.bladesbeats.com/": response(301, { location: "https://bladesbeats.com/" }),
    "https://bladesbeats.com/": response(200)
  }));
  assert.equal(result, "");
});

test("canonical redirect rejects loops, temporary redirects, and foreign hosts", async () => {
  const start = "https://www.bladesbeats.com/";
  const loop = await verifyCanonicalRedirect(start, "https://bladesbeats.com/", route({
    [start]: response(301, { location: start })
  }));
  assert.match(loop, /redirect loop/);

  const temporary = await verifyCanonicalRedirect(start, "https://bladesbeats.com/", route({
    [start]: response(302, { location: "https://bladesbeats.com/" })
  }));
  assert.match(temporary, /expected a permanent redirect/);

  const foreign = await verifyCanonicalRedirect(start, "https://bladesbeats.com/", route({
    [start]: response(301, { location: "https://example.com/" })
  }));
  assert.match(foreign, /unsafe redirect/);
});

test("canonical redirect rejects a third hop even when each host is allowed", async () => {
  const start = "http://www.bladesbeats.com/";
  const result = await verifyCanonicalRedirect(start, "https://bladesbeats.com/", route({
    [start]: response(301, { location: "https://www.bladesbeats.com/" }),
    "https://www.bladesbeats.com/": response(301, { location: "https://bladesbeats.com/" }),
    "https://bladesbeats.com/": response(301, { location: "https://www.bladesbeats.com/" })
  }));
  assert.match(result, /more than two permanent redirects/);
});
