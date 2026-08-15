const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "releases.json");
const CHANNEL_HANDLE = "@BladesBeats";
const CHANNEL_URL = `https://www.youtube.com/${CHANNEL_HANDLE}/videos`;
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const FETCH_HEADERS = {
  "user-agent": "BladesBeats metadata updater",
  "accept-language": "en-US,en;q=0.9",
  "cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAI"
};
const EXCLUDED_RELEASE_TITLE_KEYS = new Set(["i ll be there", "ill be there"]);
const EXCLUDED_RELEASE_TEXT = ["gabriela bee"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(feat\..*?\)/g, "")
    .replace(/\s+-\s+single$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeTitle(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayReleaseTitle(release) {
  const featured = Array.isArray(release.featuredArtists) && release.featuredArtists.length
    ? ` (feat. ${release.featuredArtists.join(", ")})`
    : "";
  return `${release.title}${featured}`;
}

function releaseKeys(release) {
  return new Set([
    normalizeTitle(release.title),
    normalizeTitle(displayReleaseTitle(release))
  ].filter(Boolean));
}

function isExcludedReleaseTitle(title) {
  const key = normalizeTitle(title);
  const haystack = String(title || "").toLowerCase();
  return EXCLUDED_RELEASE_TITLE_KEYS.has(key) || EXCLUDED_RELEASE_TEXT.some((term) => haystack.includes(term));
}

function isShort(title) {
  return /(^|\s)#shorts\b/i.test(String(title || ""));
}

function isCatalogueVideo(title) {
  const value = String(title || "").toLowerCase();
  if (isShort(value)) return false;
  if (value.includes("bladesbeats") || value.includes("blades beats")) return true;
  return [
    "remix",
    "edit",
    "mashup",
    "club mix",
    "studio club mix",
    "beat",
    "instrumental"
  ].some((term) => value.includes(term));
}

function inferType(title) {
  const value = String(title || "").toLowerCase();
  if (value.includes("dj set") || value.includes("club mix") || value.includes("studio club mix")) return "dj set";
  if (value.includes("mashup")) return "mashup";
  if (value.includes("remix")) return "remix";
  if (value.includes("edit")) return "edit";
  if (value.includes("beat") || value.includes("instrumental")) return "instrumental";
  return "video";
}

function youtubeDescription(type) {
  const labels = {
    "dj set": "Official BladesBeats DJ set on YouTube.",
    mashup: "BladesBeats mashup on the official YouTube channel.",
    remix: "BladesBeats remix on the official YouTube channel.",
    edit: "BladesBeats club edit on the official YouTube channel.",
    instrumental: "BladesBeats instrumental on the official YouTube channel.",
    video: "Official BladesBeats video on YouTube."
  };
  return labels[type] || labels.video;
}

function youtubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function decodeEscaped(value) {
  return String(value || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

async function fetchText(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function extractVideoIds(channelHtml) {
  const ids = new Set();
  for (const match of String(channelHtml || "").matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

function extractWatchMetadata(html) {
  const titleMatch =
    html.match(/"title":"([^"]+)"/) ||
    html.match(/<title>(.*?)<\/title>/i);
  const dateMatch =
    html.match(/"datePublished":"([^"]+)"/) ||
    html.match(/"uploadDate":"([^"]+)"/) ||
    html.match(/"publishDate":"([^"]+)"/);
  const title = titleMatch
    ? decodeEscaped(titleMatch[1]).replace(/\s+-\s+YouTube$/i, "").trim()
    : "";
  const date = dateMatch ? dateMatch[1].slice(0, 10) : "";
  return { title, date };
}

async function fetchVideo(videoId) {
  const url = youtubeUrl(videoId);
  let title = "";
  let image = thumbnailUrl(videoId);

  try {
    const payload = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (payload.author_name && payload.author_name !== "BladesBeats") return null;
    title = payload.title || title;
    image = payload.thumbnail_url || image;
  } catch {
    // Some public videos do not expose oEmbed. Watch-page metadata still gives title/date.
  }

  let date = "";
  try {
    const html = await fetchText(url);
    const metadata = extractWatchMetadata(html);
    title = title || metadata.title;
    date = metadata.date;
  } catch (error) {
    console.warn(`YouTube watch metadata skipped for ${videoId}: ${error.message}`);
  }

  if (!title || !date || isExcludedReleaseTitle(title) || !isCatalogueVideo(title)) return null;

  return {
    videoId,
    title,
    date,
    image,
    url
  };
}

function applyYoutubeVideo(releases, video) {
  const titleKey = normalizeTitle(video.title);
  const existingByVideo = releases.find((release) => release.youtubeId === video.videoId || release.youtubeUrl === video.url || release.links?.youtube === video.url);
  const existingByTitle = releases.find((release) => releaseKeys(release).has(titleKey));
  const release = existingByVideo || existingByTitle;

  if (release) {
    const type = inferType(video.title);
    const youtubeOnly = Array.isArray(release.platformAvailability)
      && release.platformAvailability.length === 1
      && release.platformAvailability[0] === "youtube";
    const nextLinks = {
      spotify: release.links?.spotify || "",
      appleMusic: release.links?.appleMusic || "",
      youtube: video.url,
      deezer: release.links?.deezer || "",
      amazonMusic: release.links?.amazonMusic || ""
    };
    const next = {
      ...release,
      links: nextLinks,
      youtubeUrl: video.url,
      youtubeId: video.videoId,
      lastmod: BUILD_DATE
    };
    if (youtubeOnly) {
      next.type = type;
      next.description = youtubeDescription(type);
      next.longDescription = "";
      next.platformAvailability = ["youtube"];
    }
    if (!next.image) next.image = video.image;
    if (JSON.stringify(next) !== JSON.stringify(release)) {
      Object.assign(release, next);
      return "updated";
    }
    return "unchanged";
  }

  const type = inferType(video.title);
  const description = youtubeDescription(type);
  releases.push({
    title: video.title,
    slug: slugify(video.title),
    artist: "BladesBeats",
    featuredArtists: [],
    type,
    status: "official",
    year: Number(video.date.slice(0, 4)),
    description,
    longDescription: "",
    genres: [],
    platformAvailability: ["youtube"],
    links: {
      spotify: "",
      appleMusic: "",
      youtube: video.url,
      deezer: "",
      amazonMusic: ""
    },
    image: video.image,
    spotifyId: "",
    appleMusicId: "",
    youtubeId: video.videoId,
    lastmod: BUILD_DATE,
    releaseDate: video.date,
    youtubeUrl: video.url
  });
  return "added";
}

async function main() {
  const releases = readJson(DATA_FILE);
  const channelHtml = await fetchText(CHANNEL_URL);
  const videoIds = extractVideoIds(channelHtml);
  if (!videoIds.length) throw new Error(`No YouTube videos found at ${CHANNEL_URL}`);

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const videoId of videoIds) {
    const video = await fetchVideo(videoId);
    if (!video) {
      skipped += 1;
      continue;
    }
    const result = applyYoutubeVideo(releases, video);
    if (result === "added") added += 1;
    if (result === "updated") updated += 1;
  }

  releases.sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || String(a.title || "").localeCompare(String(b.title || "")));
  if (added || updated) writeJsonAtomic(DATA_FILE, releases);

  console.log(`YouTube catalogue checked: ${videoIds.length} videos, ${added} added, ${updated} updated, ${skipped} skipped.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
