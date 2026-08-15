const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const OUT = path.join(DATA, "catalog-events.json");
const BLOCKED_APPLE_ID_PREFIX = "178307293";
const EXCLUDED_APPLE_IDS = new Set(["0", "3"].map((suffix) => `${BLOCKED_APPLE_ID_PREFIX}${suffix}`));
const EXCLUDED_RELEASE_TITLE_KEYS = new Set(["i ll be there", "ill be there"]);
const EXCLUDED_RELEASE_TEXT = ["gabriela bee"];

function read(file) {
  const fullPath = path.join(DATA, file);
  if (!fs.existsSync(fullPath)) return [];
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function displayReleaseTitle(release) {
  const featured = Array.isArray(release.featuredArtists) && release.featuredArtists.length
    ? ` (feat. ${release.featuredArtists.join(", ")})`
    : "";
  return `${release.title}${featured}`;
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(feat\..*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function releaseSource(release) {
  if (release.spotifyUrl || release.links?.spotify) return "spotify";
  if (release.appleMusicUrl || release.links?.appleMusic) return "appleMusic";
  if (release.youtubeUrl || release.links?.youtube) return "youtube";
  return "manual";
}

function isExcludedRelease(release) {
  if (!release) return false;
  if (EXCLUDED_APPLE_IDS.has(String(release.appleMusicId || ""))) return true;
  const appleUrl = String(release.appleMusicUrl || release.links?.appleMusic || "");
  if ([...EXCLUDED_APPLE_IDS].some((id) => appleUrl.includes(id))) return true;
  const titleKeys = [normalizeTitle(release.title), normalizeTitle(displayReleaseTitle(release))].filter(Boolean);
  if (titleKeys.some((key) => EXCLUDED_RELEASE_TITLE_KEYS.has(key))) return true;
  const haystack = [
    release.title,
    displayReleaseTitle(release),
    Array.isArray(release.featuredArtists) ? release.featuredArtists.join(" ") : ""
  ].join(" ").toLowerCase();
  return EXCLUDED_RELEASE_TEXT.some((term) => haystack.includes(term));
}

const releases = read("releases.json");
const sets = read("dj-sets.json");
const gigs = read("gigs.json");
const events = [];

for (const release of releases) {
  if (!release.slug || !release.releaseDate) continue;
  if (isExcludedRelease(release)) continue;
  events.push(compactObject({
    id: `release-${release.slug}`,
    date: release.releaseDate,
    kind: "release",
    title: displayReleaseTitle(release),
    url: `/music/${release.slug}/`,
    source: releaseSource(release),
    spotifyUrl: release.spotifyUrl || release.links?.spotify,
    appleMusicUrl: release.appleMusicUrl || release.links?.appleMusic,
    youtubeUrl: release.youtubeUrl || release.links?.youtube
  }));
}

for (const set of sets) {
  const date = set.uploadDate || set.publishedDate;
  if (!set.slug || !date) continue;
  events.push(compactObject({
    id: `set-${set.slug}`,
    date,
    kind: "set",
    title: set.title,
    url: `/dj-sets/${set.slug}/`,
    source: "mixcloud",
    mixcloudUrl: set.mixcloudUrl || set.links?.mixcloud
  }));
}

for (const gig of gigs) {
  if (!gig.slug || !gig.startDate) continue;
  events.push(compactObject({
    id: `gig-${gig.slug}`,
    date: gig.startDate,
    endDate: gig.endDate,
    kind: "gig",
    title: gig.title,
    url: `/gigs/${gig.slug}/`,
    source: "manual",
    venue: gig.venueName,
    city: gig.city
  }));
}

events.sort((a, b) => a.date.localeCompare(b.date));

const output = {
  generated: new Date().toISOString(),
  start: "2017-01-01",
  events
};

fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${events.length} events to ${OUT}`);
