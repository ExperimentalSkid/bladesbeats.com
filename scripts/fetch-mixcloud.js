const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "dj-sets.json");
const API_URL = "https://api.mixcloud.com/BladesBeats/cloudcasts/";
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const CHART_HISTORY_DELAY_DAYS = 8;
const FETCH_HEADERS = {
  "user-agent": "BladesBeats metadata updater",
  "accept-language": "en-US,en;q=0.9"
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function hms(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function embedUrl(key) {
  return `https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=0&feed=${encodeURIComponent(key)}`;
}

function utcDate(value) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return new Date(`${raw}T00:00:00Z`);
}

function daysBetween(startDate, endDate) {
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  if (!start || !end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function isChartHistoryEligible(set) {
  return daysBetween(set.uploadDate || set.publishedDate, BUILD_DATE) >= CHART_HISTORY_DELAY_DAYS;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseChartHistory(html) {
  const sectionMatch = String(html || "").match(/<section[^>]+data-testid=["']chart-history["'][\s\S]*?<\/section>/i);
  if (!sectionMatch) return null;
  const seen = new Set();
  const entries = [];
  for (const match of sectionMatch[0].matchAll(/aria-label=["'](\d+(?:st|nd|rd|th)\s+[^"']+)["']/gi)) {
    const label = decodeHtml(match[1]).replace(/\s+/g, " ").trim();
    const parsed = label.match(/^(\d+(?:st|nd|rd|th))\s+(.+)$/i);
    if (!parsed) continue;
    const rank = parsed[1];
    const chart = parsed[2].trim();
    const key = `${rank} ${chart}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ rank, chart });
  }
  return entries;
}

async function fetchChartHistory(set) {
  const url = set.mixcloudUrl || set.links?.mixcloud;
  if (!url) return null;
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      console.warn(`Mixcloud chart history skipped for ${set.title}: ${response.status}`);
      return null;
    }
    return parseChartHistory(await response.text());
  } catch (error) {
    console.warn(`Mixcloud chart history skipped for ${set.title}: ${error.message}`);
    return null;
  }
}

function setFromCloudcast(match) {
  const slug = match.slug || slugify(match.name);
  const uploadDate = match.created_time ? match.created_time.slice(0, 10) : "";
  const durationSeconds = Number(match.audio_length || 0) || null;
  return {
    title: match.name,
    slug,
    artist: "BladesBeats",
    platform: "Mixcloud",
    status: "official",
    description: match.description || "Official BladesBeats DJ set on Mixcloud.",
    longDescription: "",
    genres: Array.isArray(match.tags) ? match.tags.map((tag) => tag.name).filter(Boolean) : [],
    locationContext: "Sevilla",
    links: {
      mixcloud: match.url || "",
      youtube: "",
      spotify: ""
    },
    mixcloudUrl: match.url || "",
    mixcloudKey: match.key || "",
    embedUrl: match.key ? embedUrl(match.key) : "",
    image: match.pictures?.extra_large || match.pictures?.["640wx640h"] || match.pictures?.large || "",
    duration: durationSeconds ? hms(durationSeconds) : "",
    durationSeconds,
    uploadDate,
    publishedDate: uploadDate,
    lastmod: match.updated_time ? match.updated_time.slice(0, 10) : (uploadDate || BUILD_DATE)
  };
}

async function main() {
  const sets = readJson(DATA_FILE);
  let changed = false;
  let cloudcasts = [];

  try {
    const response = await fetch(API_URL, { headers: FETCH_HEADERS });
    if (response.ok) {
      const payload = await response.json();
      cloudcasts = Array.isArray(payload.data) ? payload.data : [];
    } else {
      console.warn(`Mixcloud API metadata skipped with ${response.status}.`);
    }
  } catch (error) {
    console.warn(`Mixcloud API metadata skipped: ${error.message}`);
  }

  const bySlug = new Map(cloudcasts.map((item) => [item.slug, item]));
  const existingSlugs = new Set(sets.map((set) => set.slug));

  if (cloudcasts.length) {
    for (const set of sets) {
      const match = bySlug.get(set.slug);
      if (!match) continue;
      const durationSeconds = Number(match.audio_length || 0) || null;
      const uploadDate = match.created_time ? match.created_time.slice(0, 10) : set.uploadDate || set.publishedDate;
      const next = {
        ...set,
        slug: set.slug || slugify(set.title),
        title: set.title || match.name,
        genres: Array.isArray(match.tags) ? match.tags.map((tag) => tag.name).filter(Boolean) : set.genres,
        links: {
          ...set.links,
          mixcloud: match.url || set.links?.mixcloud || ""
        },
        mixcloudUrl: match.url || set.mixcloudUrl || "",
        mixcloudKey: match.key || set.mixcloudKey || "",
        embedUrl: match.key ? embedUrl(match.key) : set.embedUrl,
        image: match.pictures?.extra_large || match.pictures?.["640wx640h"] || match.pictures?.large || set.image || "",
        duration: durationSeconds ? hms(durationSeconds) : set.duration,
        durationSeconds: durationSeconds || set.durationSeconds || null,
        uploadDate,
        publishedDate: uploadDate,
        lastmod: match.updated_time ? match.updated_time.slice(0, 10) : (set.lastmod || BUILD_DATE)
      };
      if (JSON.stringify(next) !== JSON.stringify(set)) {
        Object.assign(set, next);
        changed = true;
      }
    }

    for (const match of cloudcasts) {
      const slug = match.slug || slugify(match.name);
      if (!slug || existingSlugs.has(slug)) continue;
      sets.push(setFromCloudcast(match));
      existingSlugs.add(slug);
      changed = true;
    }
  }

  for (const set of sets) {
    if (!isChartHistoryEligible(set)) {
      if (set.chartHistory) {
        delete set.chartHistory;
        set.lastmod = BUILD_DATE;
        changed = true;
      }
      continue;
    }
    const chartHistory = await fetchChartHistory(set);
    if (!chartHistory) continue;
    const next = chartHistory.length ? chartHistory : undefined;
    if (JSON.stringify(set.chartHistory || undefined) !== JSON.stringify(next)) {
      if (next) set.chartHistory = next;
      else delete set.chartHistory;
      set.lastmod = BUILD_DATE;
      changed = true;
    }
  }

  if (changed) {
    writeJsonAtomic(DATA_FILE, sets);
    console.log("Updated data/dj-sets.json from Mixcloud API.");
  } else {
    console.log("Mixcloud data already current.");
  }
}

main().catch((error) => {
  console.warn(`Mixcloud update skipped: ${error.message}`);
});
