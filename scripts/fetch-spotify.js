const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "releases.json");
const ARTIST_ID = "63221ca19GsgTnQISR51xl";
const APPLE_ARTIST_ID = "1729442137";
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const APPLE_SEARCH_URL = "https://itunes.apple.com/search";
const APPLE_LOOKUP_URL = "https://itunes.apple.com/lookup";
const BLOCKED_APPLE_ID_PREFIX = "178307293";
const EXCLUDED_APPLE_IDS = new Set(["0", "3"].map((suffix) => `${BLOCKED_APPLE_ID_PREFIX}${suffix}`));
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

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return "";
}

function appleArtwork(url) {
  return String(url || "").replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/1200x1200bb.$1");
}

function releaseDisplayTitle(release) {
  const featured = Array.isArray(release.featuredArtists) && release.featuredArtists.length
    ? ` (feat. ${release.featuredArtists.join(", ")})`
    : "";
  return `${release.title}${featured}`;
}

function splitFeaturedTitle(value) {
  const title = String(value || "").trim();
  const match = title.match(/^(.*?)\s+\(feat\.\s*([^)]+)\)$/i);
  if (!match) return { title, featuredArtists: [] };
  return {
    title: match[1].trim(),
    featuredArtists: match[2].split(/\s*,\s*/).map((name) => name.trim()).filter(Boolean)
  };
}

function releaseKeys(release) {
  return new Set([
    normalizeTitle(release.title),
    normalizeTitle(releaseDisplayTitle(release))
  ].filter(Boolean));
}

function isExcludedRelease(release) {
  if (!release) return false;
  if (EXCLUDED_APPLE_IDS.has(String(release.appleMusicId || ""))) return true;
  const appleUrl = String(release.appleMusicUrl || release.links?.appleMusic || "");
  if ([...EXCLUDED_APPLE_IDS].some((id) => appleUrl.includes(id))) return true;
  if ([...releaseKeys(release)].some((key) => EXCLUDED_RELEASE_TITLE_KEYS.has(key))) return true;
  const haystack = [
    release.title,
    releaseDisplayTitle(release),
    Array.isArray(release.featuredArtists) ? release.featuredArtists.join(" ") : ""
  ].join(" ").toLowerCase();
  return EXCLUDED_RELEASE_TEXT.some((term) => haystack.includes(term));
}

function isExcludedAppleItem(item) {
  if (!item) return false;
  if (EXCLUDED_APPLE_IDS.has(String(item.trackId || ""))) return true;
  if (EXCLUDED_APPLE_IDS.has(String(item.collectionId || ""))) return true;
  const appleUrl = String(item.trackViewUrl || item.collectionViewUrl || "");
  if ([...EXCLUDED_APPLE_IDS].some((id) => appleUrl.includes(id))) return true;
  const titleKey = normalizeTitle(item.trackName || item.collectionName);
  if (EXCLUDED_RELEASE_TITLE_KEYS.has(titleKey)) return true;
  const haystack = [item.trackName, item.collectionName, item.artistName].join(" ").toLowerCase();
  return EXCLUDED_RELEASE_TEXT.some((term) => haystack.includes(term));
}

function isExcludedSpotifyAlbum(album) {
  if (!album) return false;
  const titleKey = normalizeTitle(album.name);
  if (EXCLUDED_RELEASE_TITLE_KEYS.has(titleKey)) return true;
  const haystack = [
    album.name,
    Array.isArray(album.artists) ? album.artists.map((artist) => artist.name).join(" ") : ""
  ].join(" ").toLowerCase();
  return EXCLUDED_RELEASE_TEXT.some((term) => haystack.includes(term));
}

async function getToken(clientId, clientSecret) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`Spotify token request failed with ${response.status}`);
  const payload = await response.json();
  return payload.access_token;
}

async function fetchAlbums(token) {
  let nextUrl = new URL(`https://api.spotify.com/v1/artists/${ARTIST_ID}/albums`);
  nextUrl.searchParams.set("include_groups", "album,single");
  nextUrl.searchParams.set("market", "ES");
  nextUrl.searchParams.set("limit", "50");
  const albums = [];
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Spotify albums request failed with ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload.items)) albums.push(...payload.items);
    nextUrl = payload.next ? new URL(payload.next) : null;
  }
  return albums;
}

async function fetchAppleResults(entity) {
  const url = new URL(APPLE_SEARCH_URL);
  url.searchParams.set("term", "BladesBeats");
  url.searchParams.set("entity", entity);
  url.searchParams.set("limit", "100");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Apple Music search failed with ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

async function fetchAppleMatches() {
  const results = [
    ...(await fetchAppleResults("song")),
    ...(await fetchAppleResults("album"))
  ];
  const byTitle = new Map();
  for (const item of results) {
    if (normalizeTitle(item.artistName) !== "bladesbeats") continue;
    const keys = [
      normalizeTitle(item.trackName),
      normalizeTitle(item.collectionName)
    ].filter(Boolean);
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, item);
    }
  }
  return byTitle;
}

async function fetchAppleSongReleases() {
  const url = new URL(APPLE_LOOKUP_URL);
  url.searchParams.set("id", APPLE_ARTIST_ID);
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", "ES");
  url.searchParams.set("limit", "200");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Apple Music lookup failed with ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  const byTrack = new Map();
  for (const item of results) {
    if (String(item.artistId || "") !== APPLE_ARTIST_ID) continue;
    if (item.wrapperType !== "track" || item.kind !== "song" || !item.trackName) continue;
    const key = String(item.trackId || normalizeTitle(item.trackName));
    if (!byTrack.has(key)) byTrack.set(key, item);
  }
  return [...byTrack.values()];
}

function releaseFromAppleSong(item) {
  const parsed = splitFeaturedTitle(item.trackName);
  const releaseDate = normalizeDate(item.releaseDate ? item.releaseDate.slice(0, 10) : "");
  const appleUrl = item.trackViewUrl || item.collectionViewUrl || "";
  return {
    title: parsed.title,
    slug: slugify(parsed.title),
    artist: "BladesBeats",
    featuredArtists: parsed.featuredArtists,
    type: "single",
    status: "official",
    year: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined,
    description: parsed.featuredArtists.length
      ? `Official BladesBeats release featuring ${parsed.featuredArtists.join(", ")}.`
      : "Official BladesBeats release listed in Apple Music catalog.",
    longDescription: "",
    genres: [],
    links: {
      spotify: "",
      appleMusic: appleUrl,
      youtube: "",
      deezer: "",
      amazonMusic: ""
    },
    image: appleArtwork(item.artworkUrl100),
    spotifyId: "",
    appleMusicId: String(item.trackId || item.collectionId || ""),
    youtubeId: "",
    lastmod: BUILD_DATE,
    releaseDate,
    appleMusicUrl: appleUrl
  };
}

function releaseFromSpotifyAlbum(album) {
  const parsed = splitFeaturedTitle(album.name);
  const releaseDate = normalizeDate(album.release_date);
  const spotifyUrl = album.external_urls?.spotify || "";
  return {
    title: parsed.title,
    slug: slugify(parsed.title),
    artist: "BladesBeats",
    featuredArtists: parsed.featuredArtists,
    type: album.album_type === "album" ? "album" : "single",
    status: "official",
    year: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined,
    description: "Official BladesBeats release listed on Spotify.",
    longDescription: "",
    genres: [],
    links: {
      spotify: spotifyUrl,
      appleMusic: "",
      youtube: "",
      deezer: "",
      amazonMusic: ""
    },
    image: album.images?.[0]?.url || "",
    spotifyId: album.id || "",
    appleMusicId: "",
    youtubeId: "",
    lastmod: BUILD_DATE,
    releaseDate,
    spotifyUrl
  };
}

function addDiscoveredAppleReleases(releases, appleSongs) {
  let changed = false;
  const existingKeys = new Set();
  const existingAppleIds = new Set();
  for (const release of releases) {
    for (const key of releaseKeys(release)) existingKeys.add(key);
    if (release.appleMusicId) existingAppleIds.add(String(release.appleMusicId));
  }

  for (const item of appleSongs) {
    if (isExcludedAppleItem(item)) continue;
    const draft = releaseFromAppleSong(item);
    if (isExcludedRelease(draft)) continue;
    const keys = releaseKeys(draft);
    const appleId = String(item.trackId || item.collectionId || "");
    if (appleId && existingAppleIds.has(appleId)) continue;
    if ([...keys].some((key) => existingKeys.has(key))) continue;
    releases.push(draft);
    for (const key of keys) existingKeys.add(key);
    if (appleId) existingAppleIds.add(appleId);
    changed = true;
  }

  releases.sort((a, b) => {
    const dateOrder = String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""));
    if (dateOrder) return dateOrder;
    return releaseDisplayTitle(a).localeCompare(releaseDisplayTitle(b));
  });
  return changed;
}

function addDiscoveredSpotifyReleases(releases, albums) {
  let changed = false;
  const existingKeys = new Set();
  const existingSpotifyIds = new Set();
  for (const release of releases) {
    for (const key of releaseKeys(release)) existingKeys.add(key);
    if (release.spotifyId) existingSpotifyIds.add(String(release.spotifyId));
  }

  for (const album of albums) {
    if (isExcludedSpotifyAlbum(album)) continue;
    const draft = releaseFromSpotifyAlbum(album);
    if (!draft.releaseDate || !draft.spotifyUrl) continue;
    if (isExcludedRelease(draft)) continue;
    const keys = releaseKeys(draft);
    const spotifyId = String(album.id || "");
    if (spotifyId && existingSpotifyIds.has(spotifyId)) continue;
    if ([...keys].some((key) => existingKeys.has(key))) continue;
    releases.push(draft);
    for (const key of keys) existingKeys.add(key);
    if (spotifyId) existingSpotifyIds.add(spotifyId);
    changed = true;
  }

  releases.sort((a, b) => {
    const dateOrder = String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""));
    if (dateOrder) return dateOrder;
    return releaseDisplayTitle(a).localeCompare(releaseDisplayTitle(b));
  });
  return changed;
}

function applyAppleData(release, byTitle) {
  const keys = releaseKeys(release);
  let match = null;
  for (const key of keys) {
    if (byTitle.has(key)) {
      match = byTitle.get(key);
      break;
    }
  }
  if (!match) return release;

  const appleUrl = match.trackViewUrl || match.collectionViewUrl || "";
  const releaseDate = normalizeDate(match.releaseDate ? match.releaseDate.slice(0, 10) : "");
  return {
    ...release,
    slug: release.slug || slugify(release.title),
    year: release.year || (releaseDate ? Number(releaseDate.slice(0, 4)) : release.year),
    releaseDate: release.releaseDate || releaseDate,
    appleMusicUrl: release.appleMusicUrl || appleUrl,
    links: {
      ...release.links,
      appleMusic: release.links?.appleMusic || appleUrl
    },
    image: release.image || appleArtwork(match.artworkUrl100),
    appleMusicId: release.appleMusicId || String(match.trackId || match.collectionId || ""),
    lastmod: release.lastmod || BUILD_DATE
  };
}

function applySpotifyData(release, byTitle) {
  const keys = releaseKeys(release);
  let match = null;
  for (const key of keys) {
    if (byTitle.has(key)) {
      match = byTitle.get(key);
      break;
    }
  }
  if (!match) return release;
  const spotifyUrl = match.external_urls?.spotify || "";
  const releaseDate = normalizeDate(match.release_date);
  return {
    ...release,
    slug: release.slug || slugify(release.title),
    title: release.title || match.name,
    year: release.year || (releaseDate ? Number(releaseDate.slice(0, 4)) : release.year),
    releaseDate: release.releaseDate || releaseDate,
    spotifyUrl: release.spotifyUrl || spotifyUrl,
    links: {
      ...release.links,
      spotify: release.links?.spotify || spotifyUrl
    },
    image: release.image || match.images?.[0]?.url || "",
    spotifyId: release.spotifyId || match.id || "",
    lastmod: BUILD_DATE
  };
}

async function main() {
  const releases = readJson(DATA_FILE);
  let changed = false;

  for (let index = releases.length - 1; index >= 0; index -= 1) {
    if (isExcludedRelease(releases[index])) {
      releases.splice(index, 1);
      changed = true;
    }
  }

  for (const release of releases) {
    if (!release.slug) {
      release.slug = slugify(release.title);
      changed = true;
    }
  }

  try {
    const appleMatches = await fetchAppleMatches();
    for (const release of releases) {
      const next = applyAppleData(release, appleMatches);
      if (JSON.stringify(next) !== JSON.stringify(release)) {
        Object.assign(release, next);
        changed = true;
      }
    }
    if (addDiscoveredAppleReleases(releases, await fetchAppleSongReleases())) {
      changed = true;
    }
  } catch (error) {
    console.warn(`Apple Music lookup skipped: ${error.message}`);
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log("SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET not set; skipping Spotify refresh.");
  } else {
    let albums;
    try {
      const token = await getToken(clientId, clientSecret);
      albums = await fetchAlbums(token);
    } catch (error) {
      console.warn(`Spotify refresh skipped: ${error.message}`);
      albums = [];
    }
    if (addDiscoveredSpotifyReleases(releases, albums)) {
      changed = true;
    }
    const byTitle = new Map(albums.map((album) => [normalizeTitle(album.name), album]));
    for (const release of releases) {
      const next = applySpotifyData(release, byTitle);
      if (JSON.stringify(next) !== JSON.stringify(release)) {
        Object.assign(release, next);
        changed = true;
      }
    }
  }

  if (changed) {
    writeJsonAtomic(DATA_FILE, releases);
    console.log("Updated data/releases.json with release metadata.");
  } else {
    console.log("Release metadata already current.");
  }
}

main().catch((error) => {
  console.warn(`Spotify update skipped: ${error.message}`);
});
