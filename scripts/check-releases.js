"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isExcludedRelease, normalizeCatalogText } = require("./catalog-policy");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.RELEASE_DESK_DATA_DIR
  ? path.resolve(process.env.RELEASE_DESK_DATA_DIR)
  : path.join(ROOT, "release-desk", "data");
const STATE_FILE = path.join(DATA_DIR, "candidates.json");
const SPOTIFY_ARTIST_ID = "63221ca19GsgTnQISR51xl";
const APPLE_ARTIST_ID = "1729442137";
const YOUTUBE_HANDLE = "BladesBeats";
const MIXCLOUD_USER = "BladesBeats";
const checkedAt = new Date().toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { "user-agent": "BladesBeats Release Desk/1.0", accept: "application/json", ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function stableId(source, sourceId) {
  return crypto.createHash("sha256").update(`${source}:${sourceId}`).digest("hex").slice(0, 24);
}

function candidate(source, sourceId, value) {
  return {
    id: stableId(source, sourceId),
    source,
    sourceId: String(sourceId),
    kind: value.kind || "release",
    title: String(value.title || "").trim(),
    artist: String(value.artist || "BladesBeats").trim(),
    releaseDate: String(value.releaseDate || "").slice(0, 10),
    type: value.type || "single",
    image: value.image || "",
    links: value.links || {},
    platformIds: value.platformIds || {},
    discoveredAt: checkedAt,
    lastSeenAt: checkedAt,
    state: "pending",
    notes: []
  };
}

function inferType(title) {
  const value = normalizeCatalogText(title);
  if (/dj set|club mix|studio club mix|mashup/.test(value)) return "dj set";
  if (/remix/.test(value)) return "remix";
  if (/edit/.test(value)) return "edit";
  if (/beat|instrumental/.test(value)) return "instrumental";
  return "single";
}

async function spotifyCandidates() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { source: "spotify", skipped: "SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET not configured", items: [] };
  const tokenResponse = await fetchJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const headers = { authorization: `Bearer ${tokenResponse.access_token}` };
  let url = `https://api.spotify.com/v1/artists/${SPOTIFY_ARTIST_ID}/albums?include_groups=album,single,appears_on&market=ES&limit=50`;
  const albums = [];
  while (url) {
    const page = await fetchJson(url, { headers });
    albums.push(...(page.items || []));
    url = page.next || "";
  }
  return { source: "spotify", items: albums.map((album) => candidate("spotify", album.id, {
    title: album.name,
    artist: (album.artists || []).map((artist) => artist.name).join(", ") || "BladesBeats",
    releaseDate: album.release_date,
    type: inferType(album.name),
    image: album.images?.[0]?.url || "",
    links: { spotify: album.external_urls?.spotify || "" },
    platformIds: { spotifyId: album.id }
  })) };
}

async function appleCandidates() {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", "BladesBeats");
  url.searchParams.set("entity", "song");
  url.searchParams.set("attribute", "artistTerm");
  url.searchParams.set("country", "ES");
  url.searchParams.set("limit", "200");
  const payload = await fetchJson(url);
  const items = (payload.results || []).filter((item) => String(item.artistId || "") === APPLE_ARTIST_ID);
  return { source: "appleMusic", items: items.map((item) => candidate("appleMusic", item.trackId, {
    title: item.trackName,
    artist: item.artistName,
    releaseDate: item.releaseDate,
    type: inferType(item.trackName),
    image: String(item.artworkUrl100 || "").replace(/\/100x100bb\./, "/1200x1200bb."),
    links: { appleMusic: item.trackViewUrl || "" },
    platformIds: { appleMusicId: String(item.trackId || "") }
  })) };
}

async function youtubeCandidates() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { source: "youtube", skipped: "YOUTUBE_API_KEY not configured", items: [] };
  const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelUrl.searchParams.set("part", "contentDetails");
  channelUrl.searchParams.set("forHandle", YOUTUBE_HANDLE);
  channelUrl.searchParams.set("key", key);
  const channels = await fetchJson(channelUrl);
  const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("official channel uploads playlist was not returned");
  const videos = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", uploads);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", key);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await fetchJson(url);
    videos.push(...(page.items || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return { source: "youtube", items: videos.filter((item) => !/#shorts\b/i.test(item.snippet?.title || "")).map((item) => {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    return candidate("youtube", videoId, {
      title: item.snippet?.title,
      artist: "BladesBeats",
      releaseDate: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
      type: inferType(item.snippet?.title),
      image: item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.high?.url || "",
      links: { youtube: `https://www.youtube.com/watch?v=${videoId}` },
      platformIds: { youtubeId: videoId }
    });
  }) };
}

async function mixcloudCandidates() {
  let url = `https://api.mixcloud.com/${MIXCLOUD_USER}/cloudcasts/?limit=100`;
  const casts = [];
  while (url) {
    const page = await fetchJson(url);
    casts.push(...(page.data || []));
    url = page.paging?.next || "";
  }
  return { source: "mixcloud", items: casts.map((item) => candidate("mixcloud", item.key, {
    kind: "set",
    title: item.name,
    artist: "BladesBeats",
    releaseDate: item.created_time,
    type: "dj set",
    image: item.pictures?.extra_large || item.pictures?.large || "",
    links: { mixcloud: item.url || `https://www.mixcloud.com${item.key}` },
    platformIds: { mixcloudKey: item.key }
  })) };
}

function approvedMatch(item, releases, sets) {
  const approved = item.kind === "set" ? sets : releases;
  return approved.find((record) => {
    const ids = item.platformIds || {};
    if (ids.spotifyId && String(record.spotifyId || "") === ids.spotifyId) return true;
    if (ids.appleMusicId && String(record.appleMusicId || "") === ids.appleMusicId) return true;
    if (ids.youtubeId && String(record.youtubeId || "") === ids.youtubeId) return true;
    if (ids.mixcloudKey && String(record.mixcloudKey || "") === ids.mixcloudKey) return true;
    return normalizeCatalogText(record.title) === normalizeCatalogText(item.title);
  });
}

function mergeCandidate(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    state: existing.state === "ignored" ? "ignored" : (incoming.state || existing.state || "pending"),
    discoveredAt: existing.discoveredAt || incoming.discoveredAt,
    lastSeenAt: checkedAt,
    links: { ...(existing.links || {}), ...(incoming.links || {}) },
    platformIds: { ...(existing.platformIds || {}), ...(incoming.platformIds || {}) },
    notes: Array.from(new Set([...(existing.notes || []), ...(incoming.notes || [])]))
  };
}

function sameCandidate(left, right) {
  if (left.kind !== right.kind) return false;
  const leftIds = Object.values(left.platformIds || {}).map(String).filter(Boolean);
  const rightIds = new Set(Object.values(right.platformIds || {}).map(String).filter(Boolean));
  if (leftIds.some((id) => rightIds.has(id))) return true;
  return normalizeCatalogText(left.title) === normalizeCatalogText(right.title)
    && String(left.releaseDate || "").slice(0, 4) === String(right.releaseDate || "").slice(0, 4);
}

function mergeCrossPlatform(items) {
  const merged = new Map();
  for (const item of items) {
    const key = `${item.kind}:${normalizeCatalogText(item.title)}:${String(item.releaseDate).slice(0, 4)}`;
    const current = merged.get(key);
    if (!current) { merged.set(key, item); continue; }
    const sources = Array.from(new Set([...(current.sources || [current.source]), item.source]));
    merged.set(key, { ...mergeCandidate(current, item), id: current.id, source: sources[0], sources });
  }
  return [...merged.values()];
}

async function main() {
  const releases = readJson(path.join(ROOT, "data", "releases.json"), []);
  const sets = readJson(path.join(ROOT, "data", "dj-sets.json"), []);
  const state = readJson(STATE_FILE, { version: 1, candidates: [], checks: [] });
  const sources = [["spotify", spotifyCandidates()], ["appleMusic", appleCandidates()], ["youtube", youtubeCandidates()], ["mixcloud", mixcloudCandidates()]];
  const results = await Promise.allSettled(sources.map((entry) => entry[1]));
  const diagnostics = [];
  const discovered = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      diagnostics.push({ source: result.value.source, ok: true, count: result.value.items.length, skipped: result.value.skipped || "" });
      discovered.push(...result.value.items);
    } else {
      diagnostics.push({ source: sources[index][0], ok: false, error: String(result.reason?.message || result.reason) });
    }
  }
  const safe = mergeCrossPlatform(discovered.filter((item) => item.title && !isExcludedRelease(item)));
  const existingById = new Map((state.candidates || []).filter((item) => !isExcludedRelease(item)).map((item) => [item.id, item]));
  let pendingNew = 0;
  let pendingUpdates = 0;
  for (const item of safe) {
    const approved = approvedMatch(item, releases, sets);
    if (approved) {
      const approvedLinks = approved.links || {};
      const newLinks = Object.entries(item.links || {}).filter(([key, url]) => url && !approvedLinks[key]);
      if (!newLinks.length) continue;
      item.state = "pending-update";
      item.matchedSlug = approved.slug;
      item.notes.push(`Adds verified ${newLinks.map(([key]) => key).join(", ")} link`);
      pendingUpdates += 1;
    } else {
      pendingNew += 1;
    }
    const current = existingById.get(item.id) || [...existingById.values()].find((candidate) => sameCandidate(candidate, item));
    if (current) {
      existingById.set(current.id, mergeCandidate(current, item));
    } else {
      existingById.set(item.id, item);
    }
  }
  const next = {
    version: 1,
    checkedAt,
    candidates: [...existingById.values()].sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate))),
    checks: [...(state.checks || []).slice(-19), { checkedAt, diagnostics, pendingNew, pendingUpdates }]
  };
  writeJsonAtomic(STATE_FILE, next);
  process.stdout.write(`${JSON.stringify({ ok: true, checkedAt, pendingNew, pendingUpdates, totalCandidates: next.candidates.length, diagnostics }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Release check failed: ${error.message}\n`);
  process.exitCode = 1;
});
