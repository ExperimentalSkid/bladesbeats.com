const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://bladesbeats.com";
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const SITE_TEMPLATE_LASTMOD = "2026-08-24";
const ARTIST_ID = `${SITE}/#artist`;
const BLOCKED_APPLE_ID_PREFIX = "178307293";
const EXCLUDED_APPLE_IDS = new Set(["0", "3"].map((suffix) => `${BLOCKED_APPLE_ID_PREFIX}${suffix}`));
const EXCLUDED_RELEASE_TITLE_KEYS = new Set(["i ll be there", "ill be there"]);
const EXCLUDED_RELEASE_TEXT = ["gabriela bee"];

const PLATFORM_LINKS = [
  ["Spotify", "https://open.spotify.com/artist/63221ca19GsgTnQISR51xl"],
  ["Apple Music", "https://music.apple.com/us/artist/bladesbeats/1729442137"],
  ["Mixcloud", "https://www.mixcloud.com/BladesBeats/"],
  ["YouTube", "https://youtube.com/@bladesbeats"],
  ["Instagram", "https://www.instagram.com/blades_beats/"],
  ["TikTok", "https://www.tiktok.com/@bladesbeats"]
];

const PAGE_ALTERNATES = {
  home: { en: `${SITE}/`, es: `${SITE}/es/` },
  music: { en: `${SITE}/music/`, es: `${SITE}/es/musica/` },
  sets: { en: `${SITE}/dj-sets/`, es: `${SITE}/es/sesiones/` },
  gigs: { en: `${SITE}/gigs/`, es: `${SITE}/es/eventos/` },
  about: { en: `${SITE}/about/`, es: `${SITE}/es/sobre-bladesbeats/` },
  booking: { en: `${SITE}/booking/`, es: `${SITE}/es/contratar-dj-sevilla/` },
  legalNotice: { en: `${SITE}/legal-notice/`, es: `${SITE}/aviso-legal/` },
  privacy: { en: `${SITE}/privacy-policy/`, es: `${SITE}/politica-privacidad/` },
  cookies: { en: `${SITE}/cookie-policy/`, es: `${SITE}/politica-cookies/` }
};

const skipped = {
  releases: [],
  sets: []
};

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(file, contents) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

function writeGeneratedAsset(file, contents) {
  const target = path.join(ROOT, file);
  const normalized = `${String(contents).replace(/[ \t]+$/gm, "").trim()}\n`;
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== normalized) {
    writeFileAtomic(target, normalized);
  }
  return assetHref(file);
}

function assetVersion(file) {
  const contents = fs.readFileSync(path.join(ROOT, file));
  return crypto.createHash("sha256").update(contents).digest("hex").slice(0, 12);
}

function assetHref(file) {
  return `/${file}?v=${assetVersion(file)}`;
}

function injectAssetVersions(html) {
  return html
    .replace(
      /\/assets\/css\/tokens\.css(?:\?v=[a-f0-9]+)?/g,
      assetHref("assets/css/tokens.css")
    )
    .replace(
      /\/assets\/js\/catalog-hero\.js(?:\?v=[a-f0-9]+)?/g,
      assetHref("assets/js/catalog-hero.js")
    );
}

function simplifyHomepageShell(html) {
  let next = html
    .replace(/\s*<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" async defer><\/script>/, "")
    .replace(
      '<button type="button" class="site-nav-lang" data-lang-switch>EN / ES</button>',
      '<a class="site-nav-lang" href="/es/" hreflang="es" lang="es" aria-label="Ver sitio en español">EN / ES</a>'
    )
    .replace('href="#listen" data-i18n="home_hero_cta"', 'href="/music/" data-i18n="home_hero_cta"')
    .replace(/<section class="page" id="releases"[\s\S]*?<\/main>\s*(?=<footer class="site-footer")/, "</main>\n\n")
    .replace(/\n<script>\s*const COPY = \{[\s\S]*?<\/script>\s*(?=<script defer src="\/assets\/js\/catalog-hero\.js)/, "\n");

  if (/data-page="(?:releases|appearances|story|booking)"/.test(next)) {
    throw new Error("Homepage still contains a hidden duplicate page.");
  }
  if (/data-contact-form|api\.ipify\.org|challenges\.cloudflare\.com\/turnstile/.test(next)) {
    throw new Error("Homepage still contains contact-form dependencies.");
  }
  return next;
}

function updateStandaloneAssetVersions() {
  for (const file of ["404.html"]) {
    const target = path.join(ROOT, file);
    if (!fs.existsSync(target)) continue;
    const current = fs.readFileSync(target, "utf8");
    const next = injectAssetVersions(current);
    if (next !== current) writeFileAtomic(target, next);
  }
}

function readCatalogData() {
  const file = path.join(ROOT, "data", "catalog-events.json");
  if (!fs.existsSync(file)) {
    return { generated: "", start: "2017-01-01", events: [] };
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function renderCatalogDataScript() {
  const json = JSON.stringify(readCatalogData(), null, 2).replace(/</g, "\\u003c");
  return `<script id="catalog-data" type="application/json">\n${json}\n</script>`;
}

function validCatalogEvents(catalog = readCatalogData()) {
  return (Array.isArray(catalog.events) ? catalog.events : [])
    .filter((event) => event && event.kind && event.title && event.date)
    .map((event) => Object.assign({}, event, { dateMs: new Date(`${event.date}T00:00:00`).getTime() }))
    .filter((event) => !Number.isNaN(event.dateMs))
    .sort((a, b) => a.dateMs - b.dateMs);
}

function latestCatalogEvent(events, kind) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind) return events[index];
  }
  return null;
}

function formatCatalogDate(date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function catalogCountKey(kind, count) {
  return `catalog_count_${kind}_${count === 1 ? "one" : "many"}`;
}

function catalogCountText(kind, count, lang = "en") {
  const labels = {
    en: {
      release: ["release", "releases"],
      set: ["set", "sets"],
      gig: ["gig", "gigs"]
    },
    es: {
      release: ["lanzamiento", "lanzamientos"],
      set: ["sesión", "sesiones"],
      gig: ["bolo", "bolos"]
    }
  };
  return labels[lang][kind][count === 1 ? 0 : 1];
}

function renderLatestFallbackCard(kind, event) {
  const fallback = kind === "release"
    ? { href: "/music/", title: "Official releases", label: "Latest release", color: "#E9EEFB" }
    : { href: "/dj-sets/", title: "DJ sets", label: "Latest set", color: "#9D5BFF" };
  const title = event?.title || fallback.title;
  const href = event?.url || fallback.href;
  const date = event?.date ? formatCatalogDate(event.date) : "";
  return `<a class="home-latest-card" href="${escapeAttr(href)}" data-latest-card="${kind}" style="--latest-color:${fallback.color}" aria-label="${escapeAttr(fallback.label)}: ${escapeAttr(title)}${date ? `, ${escapeAttr(date)}` : ""}">
          <span data-i18n="home_latest_${kind === "release" ? "release" : "set"}">${fallback.label}</span>
          <strong data-latest-title>${escapeHtml(title)}</strong>
          <small data-latest-date>${escapeHtml(date)}</small>
        </a>`;
}

const HOMEPAGE_COVER_LIMIT = 24;
const HOMEPAGE_COVER_COLUMNS = 3;

function homepageCoverDate(item, kind) {
  if (kind === "release") return item.releaseDate || item.lastmod || "0000-00-00";
  return item.uploadDate || item.publishedDate || item.lastmod || "0000-00-00";
}

function homepageCoverImageUrl(image) {
  return image.replace(/\/\d+x\d+bb\.(jpg|jpeg|png)$/i, "/600x600bb.$1");
}

function homepageCoverItems(releases, sets) {
  const distributedReleases = releases
    .filter((release) => {
      const links = release.links || {};
      return release.status === "official"
        && release.image
        && (release.appleMusicUrl || links.appleMusic || release.spotifyUrl || links.spotify);
    })
    .map((release) => ({
      id: `release:${release.slug}`,
      kind: "release",
      title: release.title,
      image: homepageCoverImageUrl(release.image),
      date: homepageCoverDate(release, "release")
    }));
  const officialSets = sets
    .filter((set) => {
      const links = set.links || {};
      return set.status === "official" && set.image && (set.mixcloudUrl || links.mixcloud);
    })
    .map((set) => ({
      id: `set:${set.slug}`,
      kind: "set",
      title: set.title,
      image: homepageCoverImageUrl(set.image),
      date: homepageCoverDate(set, "set")
    }));
  const seenImages = new Set();
  return distributedReleases
    .concat(officialSets)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
    .filter((item) => {
      if (seenImages.has(item.image)) return false;
      seenImages.add(item.image);
      return true;
    })
    .slice(0, HOMEPAGE_COVER_LIMIT);
}

function renderHomepageCoverWall(releases, sets) {
  const covers = homepageCoverItems(releases, sets);
  if (covers.length < HOMEPAGE_COVER_COLUMNS) {
    throw new Error(`Homepage cover wall needs at least ${HOMEPAGE_COVER_COLUMNS} catalogue images.`);
  }
  const columns = Array.from({ length: HOMEPAGE_COVER_COLUMNS }, () => []);
  covers.forEach((cover, index) => columns[index % HOMEPAGE_COVER_COLUMNS].push(cover));
  const renderImage = (cover) => `<img src="${escapeAttr(cover.image)}" alt="" width="600" height="600" loading="lazy" decoding="async" data-cover-id="${escapeAttr(cover.id)}">`;
  const renderedColumns = columns.map((column) => {
    const loop = column.concat(column).map(renderImage).join("\n          ");
    return `      <div class="home-cover-column">
        <div class="home-cover-track">
          ${loop}
        </div>
      </div>`;
  }).join("\n");
  return `    <div class="home-cover-wall" aria-hidden="true" data-generated-cover-wall data-cover-count="${covers.length}">
${renderedColumns}
    </div>`;
}

function injectHomepageCoverWall(html, releases, sets) {
  const wall = renderHomepageCoverWall(releases, sets);
  const existing = /    <div class="home-cover-wall"[^>]*>[\s\S]*?<\/div>\n    <div class="home-cover-scrim"/;
  if (!existing.test(html)) throw new Error("Could not find homepage cover wall.");
  return html.replace(existing, `${wall}\n    <div class="home-cover-scrim"`);
}

function renderHomepageFeaturedRelease(event, releases = []) {
  const fallback = {
    title: "Official releases",
    href: "/music/",
    image: `${SITE}/og-card.png`,
    date: ""
  };
  const eventSlug = String(event?.url || "").match(/\/music\/([^/]+)\/?$/)?.[1] || "";
  const release = releases.find((item) => item.slug === eventSlug)
    || releases.find((item) => item.title === event?.title)
    || null;
  const title = event?.title || (release ? displayReleaseTitle(release) : fallback.title);
  const href = event?.url || (release ? releaseDetailPath(release.slug) : fallback.href);
  const image = release?.image || fallback.image;
  const date = event?.date || release?.releaseDate || fallback.date;
  const numericDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date))
    ? String(date).split("-").reverse().join(".")
    : String(date || "");
  return `<a class="home-feature-release" href="${escapeAttr(href)}" data-featured-release aria-label="Latest release: ${escapeAttr(title)}">
      <span class="home-feature-kicker" data-i18n="home_feature_label">New release</span>
      <span class="home-feature-art">
        <img src="${escapeAttr(image)}" alt="${escapeAttr(title)} cover artwork" width="1200" height="1200" loading="eager" decoding="async" fetchpriority="high" data-featured-release-image>
      </span>
      <span class="home-feature-caption">
        <strong data-featured-release-title>${escapeHtml(title)}</strong>
        <small>${escapeHtml(numericDate)}</small>
        <span data-i18n="home_feature_action">Release details &nearr;</span>
      </span>
    </a>`;
}

function injectHomepageCatalogFallback(html, releases = [], catalog = readCatalogData()) {
  const events = validCatalogEvents(catalog);
  const counts = events.reduce((all, event) => {
    all[event.kind] = (all[event.kind] || 0) + 1;
    return all;
  }, {});
  const latestRelease = latestCatalogEvent(events, "release");
  const latestSet = latestCatalogEvent(events, "set");
  const latestReleaseDate = latestRelease?.date ? formatCatalogDate(latestRelease.date) : "2026";
  const latestReleaseUrl = latestRelease?.url || "/music/";
  const latestReleasePlatform = latestRelease?.appleMusicUrl || latestRelease?.spotifyUrl || latestRelease?.youtubeUrl || "https://music.apple.com/us/artist/bladesbeats/1729442137";
  const latestReleasePlatformLabel = latestRelease?.appleMusicUrl ? "Apple Music" : latestRelease?.spotifyUrl ? "Spotify" : latestRelease?.youtubeUrl ? "YouTube" : "Music platform";
  let next = html
    .replace(
      /<a class="home-hero-cta" href="[^"]*" data-i18n="home_hero_cta">/,
      `<a class="home-hero-cta" href="${escapeAttr(latestReleaseUrl)}" data-i18n="home_hero_cta">`
    )
    .replace(
      /<section class="home-latest" data-latest-panel aria-label="Latest catalogue highlights"(?: hidden)?>/,
      `<section class="home-latest" data-latest-panel aria-label="Latest catalogue highlights">`
    )
    .replace(
      /<a class="home-latest-card" href="[^"]*" data-latest-card="release"[\s\S]*?<\/a>/,
      renderLatestFallbackCard("release", latestRelease)
    )
    .replace(
      /<a class="home-latest-card" href="[^"]*" data-latest-card="set"[\s\S]*?<\/a>/,
      renderLatestFallbackCard("set", latestSet)
    )
    .replace(
      /<a class="home-feature-release" href="[^"]*" data-featured-release[\s\S]*?<\/a>/,
      renderHomepageFeaturedRelease(latestRelease, releases)
    );
  const releaseCount = counts.release || 0;
  const setCount = counts.set || 0;
  const gigCount = counts.gig || 0;
  const counter = `<p class="home-hero-foot-meta" id="catalog-counter"><b>${releaseCount} <span data-i18n="${catalogCountKey("release", releaseCount)}">${catalogCountText("release", releaseCount)}</span></b> &middot; ${setCount} <span data-i18n="${catalogCountKey("set", setCount)}">${catalogCountText("set", setCount)}</span> &middot; ${gigCount} <span data-i18n="${catalogCountKey("gig", gigCount)}">${catalogCountText("gig", gigCount)}</span></p>`;
  next = next
    .replace(/<p class="home-hero-foot-meta" id="catalog-counter">[\s\S]*?<\/p>/, counter)
    .replace(/<p class="catalog-card-kind" data-catalog-kind>[\s\S]*?<\/p>/, `<p class="catalog-card-kind" data-catalog-kind data-i18n="catalog_card_release_kind">Release</p>`)
    .replace(/<h2 class="catalog-card-title" data-catalog-title>[\s\S]*?<\/h2>/, `<h2 class="catalog-card-title" data-catalog-title>${escapeHtml(latestRelease?.title || "BladesBeats")}</h2>`)
    .replace(/<p class="catalog-card-meta" data-catalog-meta>[\s\S]*?<\/p>/, `<p class="catalog-card-meta" data-catalog-meta>${escapeHtml(latestReleaseDate)}</p>`)
    .replace(/<a href="[^"]*" data-catalog-page>[\s\S]*?<\/a>/, `<a href="${escapeAttr(latestRelease?.url || "/music/")}" data-catalog-page data-i18n="catalog_card_release_page">Release page</a>`)
    .replace(/<a href="[^"]*" target="_blank" rel="noopener noreferrer" data-catalog-service>[\s\S]*?<\/a>/, `<a href="${escapeAttr(latestReleasePlatform)}" target="_blank" rel="noopener noreferrer" data-catalog-service>${escapeHtml(latestReleasePlatformLabel)}</a>`);
  return next;
}

function injectCatalogDataIntoHomepage(releases, sets) {
  const current = readText("index.html");
  const catalog = readCatalogData();
  const block = renderCatalogDataScript();
  const existing = /<script id="catalog-data" type="application\/json">[\s\S]*?<\/script>/;
  let next;

  if (existing.test(current)) {
    next = current.replace(existing, block);
  } else if (current.includes("\n<script>\nconst COPY = {")) {
    next = current.replace("\n<script>\nconst COPY = {", `\n${block}\n<script>\nconst COPY = {`);
  } else {
    throw new Error("Could not find homepage script insertion point for catalog data.");
  }

  next = injectHomepageCoverWall(next, releases, sets);
  next = simplifyHomepageShell(next);
  next = injectAssetVersions(injectHomepageCatalogFallback(next, releases, catalog));
  if (next !== current) writeFileAtomic(path.join(ROOT, "index.html"), next);
}

function replaceGeneratedDir(name, files) {
  const target = path.join(ROOT, name);
  const safeName = String(name).replace(/[\\/]/g, "-");
  const tmp = path.join(ROOT, `.build-tmp-${safeName}-${Date.now()}`);
  const backup = path.join(ROOT, `.build-backup-${safeName}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  for (const [relative, contents] of files) {
    const full = path.join(tmp, relative);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, contents, "utf8");
  }
  try {
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(tmp, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function compactReleasePageTitle(title, maxLength = 65) {
  const brand = "BladesBeats";
  const separator = " | ";
  const value = String(title || "Release").trim();
  const full = `${value}${separator}${brand}`;
  if ([...full].length <= maxLength) return escapeHtml(full);

  const available = Math.max(12, maxLength - [...`${separator}${brand}`].length - 1);
  let shortened = [...value].slice(0, available).join("").trimEnd();
  const lastSpace = shortened.lastIndexOf(" ");
  if (lastSpace >= Math.floor(available * 0.65)) shortened = shortened.slice(0, lastSpace);
  return escapeHtml(`${shortened.trimEnd()}…${separator}${brand}`);
}

function compactMetaDescription(value, maxLength = 155) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if ([...text].length <= maxLength) return text;
  const available = Math.max(24, maxLength - 1);
  let shortened = [...text].slice(0, available).join("").trimEnd();
  const lastSpace = shortened.lastIndexOf(" ");
  if (lastSpace >= Math.floor(available * .72)) shortened = shortened.slice(0, lastSpace);
  return `${shortened.trimEnd()}…`;
}

function naturalList(items, lang = "en") {
  return new Intl.ListFormat(lang === "es" ? "es-ES" : "en-GB", {
    style: "long",
    type: "conjunction"
  }).format(items.filter(Boolean));
}

function socialImageDimensions(image, fallback = { width: 1200, height: 630 }) {
  const value = String(image || "");
  const apple = value.match(/\/(\d+)x(\d+)bb\.(?:jpe?g|png)(?:\?.*)?$/i);
  if (apple) return { width: Number(apple[1]), height: Number(apple[2]) };

  const mixcloud = value.match(/\/unsafe\/(\d+)x(\d+)\//i);
  if (mixcloud) return { width: Number(mixcloud[1]), height: Number(mixcloud[2]) };

  const youtube = value.match(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(?:jpe?g|webp)(?:\?.*)?$/i);
  if (youtube) {
    const sizes = {
      default: { width: 120, height: 90 },
      mqdefault: { width: 320, height: 180 },
      hqdefault: { width: 480, height: 360 },
      sddefault: { width: 640, height: 480 },
      maxresdefault: { width: 1280, height: 720 }
    };
    return sizes[youtube[1].toLowerCase()] || fallback;
  }

  return fallback;
}

function appleArtworkVariant(image, size) {
  const value = String(image || "");
  if (!/\/\d+x\d+bb\.(?:jpe?g|png)(?:\?.*)?$/i.test(value)) return "";
  return value.replace(/\/\d+x\d+bb\.(jpe?g|png)(\?.*)?$/i, `/${size}x${size}bb.$1$2`);
}

function responsiveImageAttributes(image, sizes) {
  const variants = [480, 800, 1200]
    .map((width) => ({ width, url: appleArtworkVariant(image, width) }))
    .filter((variant) => variant.url);
  if (!variants.length) return "";
  const srcset = variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
  return ` srcset="${escapeAttr(srcset)}" sizes="${escapeAttr(sizes)}"`;
}

function externalImagePreconnect(image) {
  try {
    const origin = new URL(String(image || ""), SITE).origin;
    if (!origin || origin === new URL(SITE).origin) return "";
    return `<link rel="preconnect" href="${escapeAttr(origin)}" crossorigin>`;
  } catch {
    return "";
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateSlug(slug, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${label} has invalid slug: ${slug}`);
  }
}

function validateUniqueSlugs(items, label) {
  const seen = new Set();
  for (const item of items) {
    validateSlug(item.slug, `${label} "${item.title}"`);
    if (seen.has(item.slug)) throw new Error(`${label} has duplicate slug: ${item.slug}`);
    seen.add(item.slug);
  }
}

function cleanLinks(links) {
  return Object.entries(links || {})
    .filter(([, url]) => typeof url === "string" && url.trim())
    .map(([name, url]) => [name, url.trim()]);
}

function hasOfficialLink(item) {
  return cleanLinks(item.links).length > 0;
}

function displayReleaseTitle(release) {
  const featured = Array.isArray(release.featuredArtists) && release.featuredArtists.length
    ? ` (feat. ${release.featuredArtists.join(", ")})`
    : "";
  return `${release.title}${featured}`;
}

function releaseDirectLinks(release) {
  return {
    ...(release.links || {}),
    spotify: release.spotifyUrl || release.links?.spotify || "",
    appleMusic: release.appleMusicUrl || release.links?.appleMusic || "",
    youtube: release.youtubeUrl || release.links?.youtube || ""
  };
}

function platformAllowed(release, service) {
  return !Array.isArray(release.platformAvailability) || release.platformAvailability.includes(service);
}

function dateMax(dates) {
  const valid = dates.filter(Boolean).sort();
  return valid[valid.length - 1] || SITE_TEMPLATE_LASTMOD;
}

function pageLastmod(...dates) {
  return dateMax([SITE_TEMPLATE_LASTMOD, ...dates.flat()].filter(Boolean));
}

function renderJsonLd(data) {
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function renderAlternates(alternates) {
  if (!alternates || !alternates.en || !alternates.es) return "";
  return [
    `<link rel="alternate" hreflang="en" href="${escapeAttr(alternates.en)}">`,
    `<link rel="alternate" hreflang="es" href="${escapeAttr(alternates.es)}">`,
    `<link rel="alternate" hreflang="x-default" href="${escapeAttr(alternates.en)}">`
  ].join("\n");
}

function mailtoLegalLink(legal, label = "correo de contacto de BladesBeats") {
  return `<a href="mailto:${escapeAttr(legal.contactEmail)}">${escapeHtml(label)}</a>`;
}

function languageLink(lang, alternates) {
  if (!alternates || !alternates.en || !alternates.es) return "";
  const href = lang === "es" ? alternates.en : alternates.es;
  return `<a class="site-nav-lang" href="${escapeAttr(href)}" hreflang="${lang === "es" ? "en" : "es"}">${lang === "es" ? "ES / EN" : "EN / ES"}</a>`;
}

function releaseDetailUrl(slug, lang = "en") {
  return `${SITE}${lang === "es" ? "/es/musica" : "/music"}/${slug}/`;
}

function releaseDetailPath(slug, lang = "en") {
  return `${lang === "es" ? "/es/musica" : "/music"}/${slug}/`;
}

function setDetailUrl(slug, lang = "en") {
  return `${SITE}${lang === "es" ? "/es/sesiones" : "/dj-sets"}/${slug}/`;
}

function setDetailPath(slug, lang = "en") {
  return `${lang === "es" ? "/es/sesiones" : "/dj-sets"}/${slug}/`;
}

function gigDetailUrl(slug, lang = "en") {
  return `${SITE}${lang === "es" ? "/es/eventos" : "/gigs"}/${slug}/`;
}

function gigDetailPath(slug, lang = "en") {
  return `${lang === "es" ? "/es/eventos" : "/gigs"}/${slug}/`;
}

function staticNav(lang, activeNav, alternates) {
  const labels = lang === "es"
    ? { music: "Música", sets: "Sesiones", gigs: "Bolos", about: "Sobre mí", booking: "Contacto" }
    : { music: "Music", sets: "Sets", gigs: "Gigs", about: "About", booking: "Contact" };
  const urls = lang === "es"
    ? { music: "/es/musica/", sets: "/es/sesiones/", gigs: "/es/eventos/", about: "/es/sobre-bladesbeats/", booking: "/es/contratar-dj-sevilla/" }
    : { music: "/music/", sets: "/dj-sets/", gigs: "/gigs/", about: "/about/", booking: "/booking/" };
  return `<button class="site-nav-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation">Menu</button>
    <nav class="site-nav-menu" id="primary-navigation" aria-label="${lang === "es" ? "Navegación principal" : "Primary navigation"}">
      ${Object.keys(labels).map((key) => `<a${activeNav === key ? ` class="active" aria-current="page"` : ""} href="${urls[key]}">${labels[key]}</a>`).join("\n      ")}
      ${languageLink(lang, alternates)}
    </nav>`;
}

function siteFooter(lang = "en") {
  const isEs = lang === "es";
  return `<footer class="site-footer" role="contentinfo">
  <div class="site-footer-inner">
    <div class="site-footer-col">
      <p class="site-footer-mark">BladesBeats</p>
      <p class="site-footer-tagline">${isEs ? "Música electrónica nacida entre Oslo y Sevilla, hecha para el movimiento, la conexión y la sala." : "Electronic music shaped between Oslo and Sevilla, made for movement, connection, and the room."}</p>
    </div>
    <div class="site-footer-col">
      <p class="site-footer-label">${isEs ? "Plataformas" : "Music platforms"}</p>
      <ul class="site-footer-list">
        <li><a href="https://open.spotify.com/artist/63221ca19GsgTnQISR51xl" target="_blank" rel="noopener noreferrer">Spotify</a></li>
        <li><a href="https://music.apple.com/us/artist/bladesbeats/1729442137" target="_blank" rel="noopener noreferrer">Apple Music</a></li>
        <li><a href="https://www.mixcloud.com/BladesBeats/" target="_blank" rel="noopener noreferrer">Mixcloud</a></li>
        <li><a href="https://youtube.com/@bladesbeats" target="_blank" rel="noopener noreferrer">YouTube</a></li>
      </ul>
    </div>
    <div class="site-footer-col">
      <p class="site-footer-label">${isEs ? "Redes y contacto" : "Stay connected"}</p>
      <ul class="site-footer-list">
        <li><a href="https://www.instagram.com/blades_beats/" target="_blank" rel="noopener noreferrer">Instagram</a></li>
        <li><a href="https://www.tiktok.com/@bladesbeats" target="_blank" rel="noopener noreferrer">TikTok</a></li>
        <li><a href="${isEs ? "/es/contratar-dj-sevilla/" : "/booking/"}">${isEs ? "Contacto" : "Booking"}</a></li>
      </ul>
    </div>
    <div class="site-footer-col">
      <p class="site-footer-label">${isEs ? "En la web" : "Around the site"}</p>
      <ul class="site-footer-list">
        <li><a href="${isEs ? "/es/musica/" : "/music/"}">${isEs ? "Música" : "Music"}</a></li>
        <li><a href="${isEs ? "/es/sesiones/" : "/dj-sets/"}">${isEs ? "Sesiones" : "DJ sets"}</a></li>
        <li><a href="${isEs ? "/es/eventos/" : "/gigs/"}">${isEs ? "Bolos" : "Gigs"}</a></li>
        <li><a href="${isEs ? "/es/sobre-bladesbeats/" : "/about/"}">${isEs ? "Sobre mí" : "About"}</a></li>
      </ul>
    </div>
    <div class="site-footer-col">
      <p class="site-footer-label">Legal</p>
      <ul class="site-footer-list">
        <li><a href="${isEs ? "/aviso-legal/" : "/legal-notice/"}">${isEs ? "Aviso legal" : "Legal notice"}</a></li>
        <li><a href="${isEs ? "/politica-privacidad/" : "/privacy-policy/"}">${isEs ? "Política de privacidad" : "Privacy policy"}</a></li>
        <li><a href="${isEs ? "/politica-cookies/" : "/cookie-policy/"}">${isEs ? "Política de cookies" : "Cookie policy"}</a></li>
      </ul>
    </div>
  </div>
  <div class="site-footer-base">
    <p>&copy; <span data-current-year>${new Date().getUTCFullYear()}</span> BladesBeats</p>
  </div>
</footer>`;
}

function extractHomepageCss() {
  const html = readText("index.html");
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("Could not extract homepage CSS.");
  return match[1];
}

function staticPageScript() {
  return `document.querySelectorAll('[data-current-year]').forEach(function(el){el.textContent = new Date().getFullYear();});
(function(){
  const nav = document.querySelector(".site-nav");
  const toggle = nav && nav.querySelector(".site-nav-toggle");
  const menu = nav && nav.querySelector(".site-nav-menu");
  if(!nav || !toggle || !menu) return;
  const mobile = window.matchMedia("(max-width: 720px)");
  function closeMenu(restoreFocus){
    menu.removeAttribute("data-open");
    toggle.setAttribute("aria-expanded", "false");
    if(restoreFocus) toggle.focus();
  }
  function syncNavigation(){
    nav.toggleAttribute("data-mobile-nav-ready", mobile.matches);
    if(!mobile.matches) closeMenu(false);
  }
  toggle.addEventListener("click", function(){
    const open = !menu.hasAttribute("data-open");
    menu.toggleAttribute("data-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", function(event){
    const target = event.target instanceof Element ? event.target : false;
    if(mobile.matches && target && target.closest("a")) closeMenu(false);
  });
  document.addEventListener("click", function(event){
    if(mobile.matches && menu.hasAttribute("data-open") && !nav.contains(event.target)) closeMenu(false);
  });
  document.addEventListener("keydown", function(event){
    if(event.key === "Escape" && menu.hasAttribute("data-open")) closeMenu(true);
  });
  if(typeof mobile.addEventListener === "function") mobile.addEventListener("change", syncNavigation);
  syncNavigation();
}());
(function(){
  let lastPlatformFocus = false;
  function closePlatformModal(modal){
    if(!modal) return;
    if(typeof modal.close === "function" && modal.open){
      modal.close();
    } else {
      modal.removeAttribute("open");
    }
    document.documentElement.classList.remove("modal-open");
  }
  document.addEventListener("click", function(event){
    const embedLoader = event.target.closest("[data-embed-load]");
    if(embedLoader){
      const shell = embedLoader.closest("[data-embed-shell]");
      const src = embedLoader.getAttribute("data-src");
      if(!shell || !src) return;
      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.loading = "lazy";
      iframe.title = embedLoader.getAttribute("data-title") || "External media player";
      iframe.allow = "autoplay; encrypted-media; picture-in-picture";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      shell.classList.remove("embed-consent");
      shell.textContent = "";
      shell.appendChild(iframe);
      return;
    }
    const opener = event.target.closest("[data-platform-open]");
    if(opener){
      const modal = document.getElementById(opener.getAttribute("aria-controls"));
      if(!modal) return;
      lastPlatformFocus = opener;
      if(typeof modal.showModal === "function" && !modal.open){
        modal.showModal();
      } else {
        modal.setAttribute("open", "");
      }
      document.documentElement.classList.add("modal-open");
      const focusTarget = modal.querySelector("a,button");
      if(focusTarget) focusTarget.focus({ preventScroll: true });
      return;
    }
    const closer = event.target.closest("[data-platform-close]");
    if(closer) closePlatformModal(closer.closest("dialog"));
  });
  document.querySelectorAll(".platform-modal").forEach(function(modal){
    modal.addEventListener("close", function(){
      document.documentElement.classList.remove("modal-open");
      if(lastPlatformFocus && document.contains(lastPlatformFocus)) lastPlatformFocus.focus({ preventScroll: true });
      lastPlatformFocus = false;
    });
    modal.addEventListener("click", function(event){
      if(event.target === modal) closePlatformModal(modal);
    });
  });
}());`;
}

function basePage({ title, description, canonical, label, h1, intro, body, jsonLd, activeNav, lang = "en", alternates = null, socialImage = `${SITE}/og-card.png`, socialImageWidth = 1200, socialImageHeight = 630, socialImageAlt = "BladesBeats official artist image", bodyClass = "", showPageHead = true }) {
  const css = extractHomepageCss();
  const alternateTags = renderAlternates(alternates);
  const locale = lang === "es" ? "es_ES" : "en_US";
  const alternateLocale = lang === "es" ? "en_US" : "es_ES";
  const hasContactForm = body.includes("data-contact-form");
  const localizedSocialImageAlt = lang === "es" && socialImageAlt === "BladesBeats official artist image"
    ? "Imagen oficial del artista BladesBeats"
    : socialImageAlt;
  const imagePreconnect = externalImagePreconnect(socialImage);
  const extraCss = `
html.modal-open{overflow:hidden}
body.static-page{background:var(--night);color:var(--paper);font-family:var(--font-body)}
body.static-page::before{display:none}
body.static-page .site-shell{min-height:100vh;display:block;background:var(--night)}
body.static-page .page{display:block;min-height:0;padding:0;background:var(--night)}
body.static-page .page-shell{width:100%;max-width:none;margin:0}
body.static-page .site-nav-menu a.active{color:var(--accent-2)}
body.static-page .button{border-color:var(--night-line-2);background:transparent;color:var(--paper);font-family:var(--font-display);font-style:italic;text-transform:none;font-size:17px;letter-spacing:0}
body.static-page .button:hover{color:var(--accent-2);border-color:var(--accent-2);transform:none}
body.static-page .button.primary{background:transparent;color:var(--paper);border-color:var(--paper);box-shadow:none}
body.static-page .button.primary:hover{background:transparent;color:var(--accent-2);border-color:var(--accent-2)}
body.static-page .platform-actions{display:flex;flex-wrap:wrap;gap:12px;margin:0 auto 34px;max-width:1400px;padding:0 var(--pad-page)}
body.static-page .platform-catalog{margin-bottom:clamp(48px,8vw,96px)}
body.static-page .catalog-section-head{max-width:1400px;margin:0 auto clamp(24px,4vw,38px);padding:0 var(--pad-page)}
body.static-page .catalog-section-head span{display:block;margin-bottom:10px;color:var(--accent-2);font-family:var(--font-mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase}
body.static-page .catalog-section-head h2{max-width:760px;margin:0;color:var(--paper);font-family:var(--font-display);font-size:clamp(32px,4.4vw,58px);line-height:1}
body.static-page .catalog-section-head p{max-width:62ch;margin:14px 0 0;color:var(--paper-2);font-size:16px;line-height:1.65}
body.static-page .platform-catalog .catalog-section-head{padding:0}
body.static-page .release-preview .release-grid{padding-bottom:clamp(48px,7vw,78px)}
body.static-page .release-preview .release-card-body{min-height:154px;display:flex;flex-direction:column}
body.static-page .release-preview .release-card-platforms{margin-top:auto;padding-top:12px}
body.static-page .appearances-grid{max-width:1400px;margin:0 auto clamp(48px,8vw,96px);padding:0 var(--pad-page);display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,360px));justify-content:start;gap:16px}
body.static-page .gigs-showcase{max-width:1400px;margin:0 auto clamp(48px,8vw,96px);padding:0 var(--pad-page);display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:18px}
body.static-page .gigs-showcase .appearance-card.featured{height:100%}
body.static-page .gigs-booking-panel{display:grid;align-content:center;padding:clamp(28px,4vw,48px);border:1px solid rgba(61,123,255,.32);background:linear-gradient(145deg,rgba(61,123,255,.12),rgba(157,91,255,.06) 62%,rgba(7,7,9,.45))}
body.static-page .gigs-booking-panel span{color:var(--accent-2);font-family:var(--font-mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase}
body.static-page .gigs-booking-panel h2{margin:14px 0 0;color:var(--paper);font-family:var(--font-display);font-size:clamp(32px,4vw,54px);line-height:.98}
body.static-page .gigs-booking-panel p{margin:18px 0 24px;color:var(--paper-2);font-size:16px;line-height:1.65}
body.static-page .gigs-booking-panel .button{justify-self:start}
body.static-page .meta-row{display:flex;flex-wrap:wrap;gap:8px}
body.static-page .pill{display:inline-flex;min-height:24px;align-items:center;color:var(--paper-3);font-family:var(--font-mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase}
body.static-page .pill:not(:last-child)::after{content:"·";margin-left:8px;color:var(--paper-4)}
body.static-page .mixcloud-chart{margin:18px 0 22px;padding:16px 0;border-top:1px solid var(--night-line);border-bottom:1px solid var(--night-line)}
body.static-page .mixcloud-chart-label{margin:0 0 12px;color:var(--paper-3);font-family:var(--font-mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase}
body.static-page .mixcloud-chart-grid{display:flex;flex-wrap:wrap;gap:9px}
body.static-page .mixcloud-chart-card{display:inline-flex;min-height:34px;align-items:center;gap:8px;padding:0 13px 0 8px;border:1px solid var(--night-line-2);border-radius:999px;background:rgba(233,238,251,.045);color:var(--paper-2);font-family:var(--font-body);font-size:14px;line-height:1;transition:border-color .22s var(--ease),background .22s var(--ease),color .22s var(--ease)}
body.static-page .mixcloud-chart-card:hover{border-color:rgba(61,123,255,.42);background:rgba(61,123,255,.08);color:var(--paper)}
body.static-page .mixcloud-chart-card strong{display:inline-grid;min-width:30px;min-height:24px;place-items:center;padding:0 7px;border-radius:999px;background:rgba(61,123,255,.16);color:var(--accent-2);font-family:var(--font-mono);font-size:11px;font-weight:800;letter-spacing:.02em}
body.static-page .mixcloud-chart-card span{display:inline;color:var(--paper-2);font-size:14px;line-height:1.2}
body.static-page .mixcloud-chart-card.pending strong{background:rgba(125,215,255,.14);color:var(--cyan)}
body.static-page .embed-consent{min-height:220px;display:grid;place-items:center;border:1px solid var(--night-line);background:rgba(7,7,7,.45)}
body.static-page .embed-consent-panel{max-width:520px;padding:26px;text-align:left}
body.static-page .embed-consent-panel p{margin:0 0 14px;color:var(--paper-2)}
body.static-page .embed-consent-panel .button{margin-top:4px}
body.static-page .detail-layout{max-width:1400px;margin:0 auto;padding:0 var(--pad-page) clamp(48px,8vw,96px);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);gap:clamp(28px,4vw,56px)}
body.static-page .detail-main,
body.static-page .detail-side{min-width:0}
body.static-page .detail-main{font-family:var(--font-display);font-size:clamp(17px,1.9vw,20px);line-height:1.7;color:var(--paper-2)}
body.static-page .detail-main p{margin:0 0 1.2em}
body.static-page .detail-side img{width:100%;height:auto;border:1px solid var(--night-line);background:#000}
body.static-page .legal-layout{max-width:1400px;margin:0 auto;padding:0 var(--pad-page) clamp(48px,8vw,96px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.62fr);gap:clamp(26px,4vw,54px)}
body.static-page .legal-main,
body.static-page .legal-side{min-width:0}
body.static-page .legal-main,
body.static-page .legal-flow,
body.static-page .legal-section,
body.static-page .legal-section>div{max-width:100%;min-width:0}
body.static-page .legal-main{border-top:1px solid rgba(61,123,255,.35)}
body.static-page .legal-flow{display:grid}
body.static-page .legal-section{display:grid;grid-template-columns:72px minmax(0,1fr);gap:clamp(16px,3vw,28px);padding:clamp(22px,4vw,34px) 0;border-bottom:1px solid var(--night-line)}
body.static-page .legal-section-kicker{margin:3px 0 0;color:var(--accent-2);font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
body.static-page .legal-section h2{margin:0 0 12px;color:var(--paper);font-family:var(--font-display);font-size:clamp(25px,3vw,38px);line-height:1.04}
body.static-page .legal-section p{max-width:760px;margin:0 0 1em;color:var(--paper-2);font-family:var(--font-body);font-size:15.5px;line-height:1.78}
body.static-page .legal-section p:last-child{margin-bottom:0}
body.static-page .legal-section a{color:var(--accent-2);font-weight:700;text-decoration:none}
body.static-page .legal-section a:hover{color:var(--paper)}
body.static-page .legal-section small{color:var(--paper-3);font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase}
body.static-page .legal-side{display:grid;gap:14px;align-content:start}
body.static-page .legal-panel{padding:18px;border:1px solid var(--night-line);background:rgba(233,238,251,.035)}
body.static-page .legal-panel:first-child{border-color:rgba(61,123,255,.28);background:rgba(61,123,255,.055)}
body.static-page .legal-panel span{display:block;color:var(--accent-2);font-family:var(--font-mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase}
body.static-page .legal-panel strong{display:block;margin:8px 0 10px;color:var(--paper);font-family:var(--font-display);font-size:24px;line-height:1.1}
body.static-page .legal-panel p{margin:0;color:var(--paper-2);font-size:14px;line-height:1.55}
body.static-page .legal-list{display:grid;gap:9px;margin:14px 0 0;padding:0;list-style:none}
body.static-page .legal-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;min-height:42px;align-items:center;gap:3px 14px;padding:9px 12px;border:1px solid var(--night-line);color:var(--paper);font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;line-height:1.2;text-decoration:none;text-transform:uppercase}
body.static-page .legal-list a:hover{border-color:var(--accent-2);color:var(--accent-2)}
body.static-page .legal-list a[aria-current="page"]{border-color:rgba(61,123,255,.42);background:rgba(61,123,255,.075);color:var(--accent-2)}
body.static-page .legal-list a::after{content:"->";grid-column:2;grid-row:1 / span 2;color:var(--accent-2)}
body.static-page .legal-list small{display:block;grid-column:1;margin-top:1px;color:var(--paper-3);font-family:var(--font-body);font-size:12px;letter-spacing:0;text-transform:none}
body.static-page .story-layout{max-width:1400px;margin:0 auto;padding:0 var(--pad-page) clamp(48px,8vw,96px);display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:clamp(28px,4vw,56px)}
body.static-page .booking-layout{width:min(1320px,calc(100% - var(--pad-page) * 2));max-width:1320px;margin:0 auto clamp(48px,8vw,96px);padding:0}
body.static-page .story-copy{font-family:var(--font-display);font-size:clamp(17px,1.9vw,20px);line-height:1.7;color:var(--paper-2)}
body.static-page .story-copy p{margin:0 0 1.2em}
body.static-page .story-copy a{color:var(--accent-2);font-weight:700;text-decoration:none}
body.static-page .timeline,
body.static-page .side-project{background:var(--night-3);border:1px solid var(--night-line);padding:22px}
body.static-page .timeline{display:grid;gap:1px;padding:0;background:var(--night-line)}
body.static-page .timeline-item{display:grid;grid-template-columns:80px 1fr;gap:18px;background:var(--night-3);padding:18px}
body.static-page .timeline-item b,
body.static-page .side-project span,
body.static-page .contact-line span:first-child{font-family:var(--font-mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--paper-3)}
  body.static-page .timeline-item h2{font-family:var(--font-display);font-size:22px;margin:0 0 6px;color:var(--paper)}
body.static-page .timeline-item p,
body.static-page .side-project p{color:var(--paper-2);font-size:14px;line-height:1.55;margin:0}
body.static-page .side-project{margin-top:18px}
body.static-page .side-project strong{display:block;margin:8px 0;color:var(--paper)}
body.static-page .side-project a,
body.static-page .contact-line a{color:var(--paper);text-decoration:none}
body.static-page .booking-side{background:transparent;border:0;padding:clamp(30px,4vw,54px)}
body.static-page .contact-stack{display:grid;gap:10px;margin-bottom:0;background:transparent}
body.static-page .contact-line{display:grid;grid-template-columns:1fr;gap:7px;background:rgba(7,7,7,.54);border:1px solid var(--night-line);padding:16px 18px}
body.static-page .contact-line a:hover{color:var(--accent-2)}
body.static-page .booking-side .button.primary{border-color:var(--paper);background:var(--paper);color:var(--night);box-shadow:0 18px 50px rgba(61,123,255,.16)}
body.static-page .booking-side .button.primary:hover{border-color:var(--accent-2);background:var(--accent-2);color:var(--night)}
body.static-page .contact-form.is-handoff .form-field:not(.contact-type-field),
body.static-page .contact-form.is-handoff .form-meta,
body.static-page .contact-form.is-handoff .turnstile-slot,
body.static-page .contact-form.is-handoff .contact-submit{opacity:.32;filter:saturate(.45);pointer-events:none}
body.static-page .contact-form.is-handoff .form-field:not(.contact-type-field) .bb-input,
body.static-page .contact-form.is-handoff .contact-submit{cursor:not-allowed}
body.static-page .story-layout{max-width:1400px;margin:0 auto;padding:0 var(--pad-page) clamp(48px,8vw,96px);display:grid;grid-template-columns:1fr;gap:clamp(30px,5vw,64px)}
body.static-page .story-feature{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:clamp(28px,4vw,52px);align-items:start}
body.static-page .story-copy{font-family:var(--font-body);font-size:22px;line-height:1.72;color:var(--paper)}
body.static-page .story-intro{font-family:var(--font-display);font-size:clamp(28px,3.3vw,44px);line-height:1.18;color:var(--paper)}
body.static-page .story-flow p{font-family:var(--font-body);font-size:clamp(17px,1.7vw,20px);line-height:1.72;color:var(--paper-2)}
body.static-page .bb-contact-grid{width:min(1320px,calc(100% - var(--pad-page) * 2));max-width:1320px;margin:0 auto clamp(48px,8vw,96px)}
body.release-page{--release-cyan:#1AD9FF;--release-pink:#F25ACD;background:#050713}
body.release-page .site-nav{position:relative;z-index:20;background:rgba(5,7,19,.9);border-color:rgba(233,238,251,.12);backdrop-filter:blur(18px)}
body.release-page .page-shell{overflow:hidden;background:#050713}
body.release-page .release-poster{position:relative;min-height:calc(100svh - 61px);overflow:hidden;isolation:isolate;background:#050713}
body.release-page .release-poster-backdrop{position:absolute;z-index:-3;inset:-12%;width:124%;height:124%;object-fit:cover;filter:blur(86px) saturate(1.2);opacity:.22;transform:scale(1.08)}
body.release-page .release-poster::before{content:"";position:absolute;z-index:-2;inset:0;background:linear-gradient(96deg,rgba(5,7,19,.98) 2%,rgba(5,7,19,.78) 45%,rgba(5,7,19,.9) 100%),radial-gradient(80% 70% at 78% 28%,rgba(242,90,205,.13),transparent 64%)}
body.release-page .release-poster::after{content:"";position:absolute;z-index:-1;inset:0;pointer-events:none;background:linear-gradient(rgba(233,238,251,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(233,238,251,.018) 1px,transparent 1px);background-size:86px 86px;mask-image:linear-gradient(180deg,#000,transparent 92%)}
body.release-page .release-poster-inner{width:min(1400px,100%);min-height:inherit;margin:0 auto;padding:20px var(--pad-page) clamp(54px,7vw,98px);display:grid;align-content:center}
body.release-page .release-poster .breadcrumb{width:100%;max-width:none;margin:0 0 clamp(34px,5vw,64px);padding:0;color:var(--paper-3)}
body.release-page .release-poster-grid{display:grid;grid-template-columns:minmax(300px,.82fr) minmax(0,1.18fr);gap:clamp(42px,7vw,112px);align-items:center}
body.release-page .release-poster-art{position:relative;min-width:0;isolation:isolate}
body.release-page .release-poster-art::before{content:"";position:absolute;z-index:-1;inset:22px -14px -16px 24px;border:1px solid rgba(26,217,255,.7);transform:rotate(2deg)}
body.release-page .release-poster-art::after{content:"";position:absolute;z-index:2;right:-18px;bottom:10%;width:52%;height:2px;background:linear-gradient(90deg,var(--release-pink),transparent);box-shadow:0 0 28px rgba(242,90,205,.72)}
body.release-page .release-poster-art img{width:100%;height:auto;aspect-ratio:1;object-fit:cover;background:#000;border:1px solid rgba(233,238,251,.16);box-shadow:0 42px 110px rgba(0,0,0,.58);transform:rotate(-1deg)}
body.release-page .release-poster-number{position:absolute;z-index:3;top:-16px;left:-16px;display:inline-flex;min-height:36px;align-items:center;padding:0 13px;background:var(--release-pink);color:#090B18;font-family:var(--font-mono);font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;transform:rotate(-4deg)}
body.release-page .release-poster-copy{min-width:0}
body.release-page .release-poster-eyebrow{margin:0 0 22px;color:var(--release-cyan);font-family:var(--font-mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase}
body.release-page .release-poster-title{max-width:900px;margin:0;color:var(--paper);font-family:var(--font-display);font-size:clamp(52px,7.4vw,116px);font-weight:700;letter-spacing:-.058em;line-height:.84;overflow-wrap:anywhere;text-wrap:balance}
body.release-page .release-poster-date{display:flex;align-items:center;gap:14px;margin:24px 0 0;color:var(--paper-3);font-family:var(--font-mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase}
body.release-page .release-poster-date::before{content:"";width:54px;height:1px;background:var(--release-pink)}
body.release-page .release-poster-lead{max-width:58ch;margin:28px 0 0;color:var(--paper-2);font-family:var(--font-body);font-size:clamp(16px,1.5vw,19px);line-height:1.65}
body.release-page .release-poster-actions{display:grid;grid-template-columns:minmax(210px,.7fr) minmax(0,1fr);gap:18px;align-items:stretch;margin-top:34px}
body.release-page .release-poster-primary{display:grid;align-content:center;gap:3px;min-height:76px;padding:14px 20px;background:linear-gradient(105deg,var(--release-cyan),#5FB5FF 72%,var(--release-pink) 150%);clip-path:polygon(0 0,calc(100% - 15px) 0,100% 15px,100% 100%,15px 100%,0 calc(100% - 15px));color:#090B18;text-decoration:none;transition:transform .22s var(--ease),filter .22s var(--ease)}
body.release-page .release-poster-primary:hover,body.release-page .release-poster-primary:focus-visible{transform:translateY(-3px);filter:brightness(1.1)}
body.release-page .release-poster-primary span{font-family:var(--font-mono);font-size:8px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}
body.release-page .release-poster-primary strong{font-family:var(--font-display);font-size:21px;line-height:1.05}
body.release-page .release-poster-services{display:flex;flex-wrap:wrap;align-content:center;gap:8px 16px;border-top:1px solid var(--night-line);border-bottom:1px solid var(--night-line);padding:12px 0}
body.release-page .release-poster-services a{color:var(--paper-2);font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.16em;text-decoration:none;text-transform:uppercase}
body.release-page .release-poster-services a:hover,body.release-page .release-poster-services a:focus-visible{color:var(--release-cyan)}
body.release-page .release-editorial{background:var(--paper);color:#090B18}
body.release-page .release-editorial-inner{width:min(1400px,100%);margin:0 auto;padding:clamp(64px,7vw,92px) var(--pad-page);display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.76fr);gap:clamp(48px,6vw,80px);align-items:center}
body.release-page .release-editorial-kicker{margin:0 0 16px;color:#43506c;font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase}
body.release-page .release-editorial h2{max-width:620px;margin:0;color:#090B18;font-family:var(--font-display);font-size:clamp(40px,4.4vw,58px);font-weight:700;letter-spacing:-.035em;line-height:.98;text-wrap:balance}
body.release-page .release-editorial-copy{max-width:52ch;margin:22px 0 0;color:#30384d;font-size:clamp(16px,1.45vw,18px);line-height:1.68}
body.release-page .release-editorial-meta{margin:22px 0 0;color:#43506c;font-family:var(--font-mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase}
body.release-page .release-editorial-meta span{color:#090B18;font-weight:800}
body.release-page .release-editorial .gig-facts{grid-template-columns:1fr;margin:0;background:rgba(9,11,24,.16);border-color:rgba(9,11,24,.16)}
body.release-page .release-editorial .gig-facts div{display:grid;grid-template-columns:minmax(100px,.55fr) minmax(0,1fr);gap:20px;align-items:baseline;background:var(--paper);padding:16px 18px}
body.release-page .release-editorial .gig-facts dt{color:#5c667e}
body.release-page .release-editorial .gig-facts dd{margin:0;color:#090B18;font-family:var(--font-display);font-size:18px;font-weight:700;text-align:right;overflow-wrap:anywhere}
body.release-page .release-editorial-media{grid-column:1/-1;margin-top:clamp(4px,3vw,30px)}
body.release-page .release-editorial .embed{border-color:#090B18;box-shadow:0 28px 80px rgba(9,11,24,.18)}
body.release-page .release-editorial .embed-consent{background:#090B18;color:var(--paper)}
body.release-page .release-neighbors{background:#050713;border-top:1px solid var(--night-line)}
body.release-page .release-neighbors-inner{width:min(1400px,100%);margin:0 auto;padding:clamp(42px,6vw,74px) var(--pad-page);display:grid;grid-template-columns:1fr auto 1fr;gap:22px;align-items:stretch}
body.release-page .release-neighbor{min-width:0;display:grid;align-content:space-between;gap:14px;padding:18px 0;border-top:1px solid var(--night-line);border-bottom:1px solid var(--night-line);color:var(--paper);text-decoration:none;transition:padding .22s var(--ease),border-color .22s var(--ease)}
body.release-page .release-neighbor:hover,body.release-page .release-neighbor:focus-visible{padding-left:8px;padding-right:8px;border-color:var(--release-cyan)}
body.release-page .release-neighbor.next{text-align:right}
body.release-page .release-neighbor span,body.release-page .release-catalog-link{color:var(--paper-3);font-family:var(--font-mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase}
body.release-page .release-neighbor strong{font-family:var(--font-display);font-size:clamp(18px,2vw,26px);line-height:1.05;overflow-wrap:anywhere}
body.release-page .release-catalog-link{display:inline-flex;align-items:center;justify-content:center;padding:0 18px;color:var(--release-cyan);text-decoration:none;white-space:nowrap}
body.release-page .release-catalog-link:hover{color:var(--paper)}
/* Keep recurring labels and reading text consistent on every generated page. */
body.static-page .catalog-section-head span,
body.static-page .gigs-booking-panel span,
body.static-page .pill,
body.static-page .mixcloud-chart-label,
body.static-page .legal-section-kicker,
body.static-page .legal-panel span,
body.static-page .legal-list a,
body.static-page .timeline-item b,
body.static-page .side-project span,
body.static-page .contact-line span:first-child,
body.release-page .release-poster-number,
body.release-page .release-poster-eyebrow,
body.release-page .release-poster-date,
body.release-page .release-poster-primary span,
body.release-page .release-poster-services a,
body.release-page .release-editorial-kicker,
body.release-page .release-editorial-meta,
body.release-page .release-neighbor span,
body.release-page .release-catalog-link{
  line-height:1.45;
  letter-spacing:.14em;
}
body.static-page .catalog-section-head span,
body.static-page .gigs-booking-panel span,
body.static-page .pill,
body.static-page .mixcloud-chart-label,
body.static-page .legal-section-kicker,
body.static-page .legal-panel span,
body.static-page .timeline-item b,
body.static-page .side-project span,
body.static-page .contact-line span:first-child,
body.release-page .release-poster-eyebrow,
body.release-page .release-poster-date,
body.release-page .release-editorial-kicker,
body.release-page .release-editorial-meta{
  font-size:11px;
}
body.static-page .catalog-section-head h2,
body.static-page .gigs-booking-panel h2,
body.static-page .legal-section h2,
body.static-page .timeline-item h2,
body.release-page .release-editorial h2,
body.release-page .release-neighbor strong{
  text-wrap:balance;
}
body.static-page .catalog-section-head p,
body.static-page .gigs-booking-panel p,
body.static-page .detail-main p,
body.static-page .legal-section p,
body.static-page .legal-panel p,
body.static-page .story-copy p,
body.static-page .timeline-item p,
body.static-page .side-project p,
body.release-page .release-poster-lead,
body.release-page .release-editorial-copy{
  text-wrap:pretty;
}
body.static-page .catalog-section-head p,
body.static-page .detail-main p,
body.static-page .legal-section p,
body.static-page .story-flow p,
body.release-page .release-poster-lead,
body.release-page .release-editorial-copy{
  max-width:68ch;
}
body.static-page .catalog-section-head h2{line-height:1.04}
body.static-page .legal-section h2{line-height:1.12}
body.static-page .legal-section p{font-size:16px;line-height:1.75}
body.static-page .timeline-item h2{line-height:1.18}
body.release-page .release-poster-title{line-height:.9;letter-spacing:-.045em}
body.release-page .release-poster-lead{line-height:1.7}
body.release-page .release-editorial-copy{line-height:1.75}
@media(max-width:980px){
  body.release-page .release-poster-grid{grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr);gap:42px}
  body.release-page .release-poster-title{font-size:clamp(48px,7vw,72px)}
  body.release-page .release-poster-actions{grid-template-columns:1fr}
  body.release-page .release-editorial-inner{grid-template-columns:1fr;gap:44px}
}
@media(max-width:1120px){
  body.static-page .booking-layout{grid-template-columns:minmax(0,1fr) minmax(280px,.72fr)}
  body.static-page .booking-main{border-right:1px solid var(--night-line);border-bottom:0}
  body.static-page .story-feature{grid-template-columns:1fr}
  body.static-page .bb-contact-grid{grid-template-columns:1fr}
  body.static-page .contact-form{border-left:0;border-top:1px solid var(--night-line)}
}
@media(max-width:900px){
  body.static-page .booking-layout{grid-template-columns:1fr}
  body.static-page .booking-main{border-right:0;border-bottom:1px solid var(--night-line)}
  body.static-page .gigs-showcase{grid-template-columns:1fr}
}
@media(max-width:720px){
  body.release-page .release-poster{min-height:0}
  body.release-page .release-poster-inner{padding-top:18px;padding-bottom:70px}
  body.release-page .release-poster .breadcrumb{margin-bottom:42px}
  body.release-page .release-poster-grid{grid-template-columns:1fr;gap:54px}
  body.release-page .release-poster-art{width:calc(100% - 16px);margin-left:16px}
  body.release-page .release-poster-title{font-size:clamp(50px,15vw,76px)}
  body.release-page .release-poster-actions{margin-top:28px}
  body.release-page .release-poster-services{padding:16px 0}
  body.release-page .release-editorial-inner{padding-top:64px;padding-bottom:64px}
  body.release-page .release-editorial h2{font-size:clamp(34px,10vw,46px)}
  body.release-page .release-editorial .gig-facts div{grid-template-columns:1fr;gap:6px}
  body.release-page .release-editorial .gig-facts dd{text-align:left}
  body.release-page .release-neighbors-inner{grid-template-columns:1fr;gap:12px}
  body.release-page .release-neighbor.next{text-align:left}
  body.release-page .release-catalog-link{min-height:48px;justify-content:flex-start;padding:0}
  body.static-page{overflow-x:hidden}
  body.static-page .page,
  body.static-page .page-shell,
  body.static-page .page-head{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:visible}
  body.static-page .detail-layout,
  body.static-page .legal-layout,
  body.static-page .story-layout,
  body.static-page .booking-layout{grid-template-columns:1fr}
  body.static-page .timeline-item,
  body.static-page .legal-section,
  body.static-page .contact-line{grid-template-columns:1fr}
  body.static-page .detail-layout,
  body.static-page .legal-layout,
  body.static-page .story-layout,
  body.static-page .booking-layout{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:visible}
  body.static-page .page-title,
  body.static-page .page-subtitle,
  body.static-page .legal-section h2,
  body.static-page .legal-section p{width:100%;max-width:min(100%,330px);overflow-wrap:anywhere}
  body.static-page .detail-main,
  body.static-page .detail-main p,
  body.static-page .story-copy,
  body.static-page .story-copy p,
  body.static-page .booking-main,
  body.static-page .booking-main p{max-width:100%;min-width:0;overflow-wrap:anywhere}
  body.static-page .appearance-modal{padding:12px}
  body.static-page .appearance-dialog{width:100%;max-height:calc(100dvh - 24px);padding:20px}
  body.static-page .catalog-section-head h2{font-size:clamp(32px,10vw,46px)}
  body.static-page .gigs-showcase .appearance-card.featured{grid-template-columns:1fr}
  body.static-page .gigs-showcase .appearance-card.featured .appearance-mark{min-height:0;aspect-ratio:16/10;border-right:0;border-bottom:1px solid var(--line)}
}`;
  const generatedStylesHref = writeGeneratedAsset("assets/css/generated-pages.css", `${css}\n${extraCss}`);
  const generatedScriptHref = writeGeneratedAsset("assets/js/generated-pages.js", staticPageScript());
  const contactScriptHref = hasContactForm
    ? writeGeneratedAsset("assets/js/contact-form.js", staticContactScript())
    : "";
  const displayH1 = String(h1).replace(/\.$/, "");
  const html = `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta name="theme-color" content="#090B18">
<meta name="author" content="BladesBeats">
<link rel="canonical" href="${escapeAttr(canonical)}">
${alternateTags}
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BladesBeats">
<meta property="og:title" content="${escapeAttr(title.replace(/&mdash;/g, "-"))}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(canonical)}">
<meta property="og:image" content="${escapeAttr(socialImage)}">
<meta property="og:image:width" content="${escapeAttr(socialImageWidth)}">
<meta property="og:image:height" content="${escapeAttr(socialImageHeight)}">
<meta property="og:image:alt" content="${escapeAttr(localizedSocialImageAlt)}">
<meta property="og:locale" content="${locale}">
<meta property="og:locale:alternate" content="${alternateLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title.replace(/&mdash;/g, "-"))}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(socialImage)}">
<meta name="twitter:image:alt" content="${escapeAttr(localizedSocialImageAlt)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${imagePreconnect}
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"></noscript>
<link rel="stylesheet" href="${assetHref("assets/css/tokens.css")}">
${hasContactForm ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
${jsonLd ? renderJsonLd(jsonLd) : ""}
<link rel="stylesheet" href="${generatedStylesHref}">
</head>
<body class="static-page subpage${bodyClass ? ` ${escapeAttr(bodyClass)}` : ""}">
<a class="skip-link" href="#main">${lang === "es" ? "Saltar al contenido" : "Skip to content"}</a>
<div class="site-shell">
  <header class="site-nav" role="banner">
    <div class="site-nav-inner">
      <a class="site-nav-mark" href="${lang === "es" ? "/es/" : "/"}" aria-label="${lang === "es" ? "Inicio de BladesBeats" : "BladesBeats home"}">BladesBeats</a>
      <span class="site-nav-rule" aria-hidden="true"></span>
      ${staticNav(lang, activeNav, alternates)}
    </div>
  </header>
  <main class="page active" id="main">
    <div class="page-shell">
      ${showPageHead ? `<section class="page-head">
        <p class="page-eyebrow">${escapeHtml(label)}</p>
        <div>
          <h1 class="page-title">${escapeHtml(displayH1)}<span class="page-title-dot" aria-hidden="true">.</span></h1>
          <span class="page-rule" aria-hidden="true"></span>
          <p class="page-subtitle">${escapeHtml(intro)}</p>
        </div>
      </section>` : ""}
      ${body}
    </div>
  </main>
  ${siteFooter(lang)}
</div>
<script defer src="${generatedScriptHref}"></script>
${contactScriptHref ? `<script defer src="${contactScriptHref}"></script>` : ""}
</body>
</html>
`;
  return html.replace(/[ \t]+$/gm, "");
}

function platformButtons(links, small = false) {
  return cleanLinks(links)
    .map(([name, url]) => `<a class="button${small ? " small" : ""}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelForLink(name))}</a>`)
    .join("");
}

function mixcloudEmbedPlaceholder(set, lang = "en") {
  if (!set.embedUrl) return "";
  const isEs = lang === "es";
  return `<div class="embed embed-consent" data-embed-shell>
    <div class="embed-consent-panel">
      <p class="mixcloud-chart-label">${isEs ? "Reproductor de Mixcloud" : "Mixcloud player"}</p>
      <p>${isEs ? "El reproductor permanece desconectado hasta que decidas cargarlo. A partir de ese momento se aplican las condiciones de privacidad y cookies de Mixcloud." : "The player stays disconnected until you choose to load it. Mixcloud’s privacy and cookie terms apply from that point."}</p>
      <button class="button primary" type="button" data-embed-load data-src="${escapeAttr(set.embedUrl)}" data-title="${escapeAttr(set.title)} Mixcloud player">${isEs ? "Cargar reproductor" : "Load Mixcloud player"}</button>
    </div>
  </div>`;
}

function labelForLink(name) {
  const labels = {
    spotify: "Spotify",
    appleMusic: "Apple Music",
    youtube: "YouTube",
    deezer: "Deezer",
    amazonMusic: "Amazon Music",
    mixcloud: "Mixcloud"
  };
  return labels[name] || name;
}

function platformList(links) {
  const items = cleanLinks(links)
    .map(([name, url]) => `<li><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelForLink(name))}</a></li>`)
    .join("");
  return items ? `<ul class="release-card-platforms">${items}</ul>` : "";
}

function detailPlatformLinks(links) {
  return cleanLinks(links)
    .map(([name, url]) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelForLink(name))} <span aria-hidden="true">&rarr;</span></a>`)
    .join("");
}

function releasePlatformRoutes(release, lang = "en") {
  const title = displayReleaseTitle(release);
  const directLinks = releaseDirectLinks(release);
  const restricted = Array.isArray(release.platformAvailability);
  const directTrack = lang === "es" ? "Enlace directo" : "Direct track link";
  const directVideo = lang === "es" ? "Enlace directo al vídeo" : "Direct video link";
  const searchTitle = lang === "es" ? "Búsqueda por título" : "Title search";
  const routes = [
    { key: "spotify", href: platformAllowed(release, "spotify") ? directLinks.spotify || (!restricted ? serviceSearchUrl("spotify", title) : "") : "", meta: directLinks.spotify ? directTrack : searchTitle, direct: Boolean(directLinks.spotify) },
    { key: "appleMusic", href: platformAllowed(release, "appleMusic") ? directLinks.appleMusic : "", meta: directTrack, direct: Boolean(directLinks.appleMusic) },
    { key: "youtube", href: platformAllowed(release, "youtube") ? directLinks.youtube || (!restricted ? serviceSearchUrl("youtube", title) : "") : "", meta: directLinks.youtube ? directVideo : searchTitle, direct: Boolean(directLinks.youtube) },
    { key: "deezer", href: platformAllowed(release, "deezer") ? directLinks.deezer : "", meta: directTrack, direct: Boolean(directLinks.deezer) },
    { key: "amazonMusic", href: platformAllowed(release, "amazonMusic") ? directLinks.amazonMusic : "", meta: directTrack, direct: Boolean(directLinks.amazonMusic) }
  ];
  return routes.filter((route) => route.href);
}

function isYoutubeOnlyRelease(release) {
  return Array.isArray(release.platformAvailability)
    && release.platformAvailability.length === 1
    && release.platformAvailability[0] === "youtube";
}

function youtubeEmbedUrl(release) {
  const id = String(release.youtubeId || "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id)
    ? `https://www.youtube-nocookie.com/embed/${id}?rel=0`
    : "";
}

function formatReleaseDate(date, lang = "en") {
  const value = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function releaseSummary(release, lang = "en") {
  const isEs = lang === "es";
  const date = formatReleaseDate(release.releaseDate, lang);
  const type = releaseTypeLabel(release.type, lang);
  if (isYoutubeOnlyRelease(release)) {
    return isEs
      ? `Un ${type} de BladesBeats, publicado${date ? ` el ${date}` : ""} en su canal oficial de YouTube.`
      : `A ${type} from BladesBeats, published${date ? ` on ${date}` : ""} on the official YouTube channel.`;
  }
  return isEs
    ? `Un ${type} de BladesBeats${date ? `, publicado el ${date}` : ""}.`
    : `A ${type} from BladesBeats${date ? `, released on ${date}` : ""}.`;
}

function setSummary(set, lang = "en") {
  const isEs = lang === "es";
  const genres = Array.isArray(set.genres)
    ? set.genres.slice(0, 3).map((genre) => String(genre).toLocaleLowerCase(isEs ? "es-ES" : "en-GB"))
    : [];
  if (genres.length) {
    return isEs
      ? `Una sesión de BladesBeats que recorre ${naturalList(genres, lang)}, disponible completa en Mixcloud.`
      : `A BladesBeats session moving through ${naturalList(genres, lang)}, available in full on Mixcloud.`;
  }
  return isEs
    ? "Una sesión DJ completa de BladesBeats, disponible en Mixcloud."
    : "A full BladesBeats DJ set, available on Mixcloud.";
}

function youtubeEmbedPlaceholder(release, lang = "en") {
  const embedUrl = youtubeEmbedUrl(release);
  if (!embedUrl) return "";
  const isEs = lang === "es";
  const title = displayReleaseTitle(release);
  return `<div class="embed video-embed embed-consent" data-embed-shell>
    <div class="embed-consent-panel">
      <p class="mixcloud-chart-label">YouTube</p>
      <p>${isEs ? `${escapeHtml(title)} puede reproducirse aquí. YouTube permanece desconectado hasta que decidas cargar el vídeo; a partir de ese momento se aplican sus condiciones de privacidad y cookies.` : `${escapeHtml(title)} can play here. YouTube stays disconnected until you choose to load the video; its privacy and cookie terms apply from that point.`}</p>
      <button class="button primary" type="button" data-embed-load data-src="${escapeAttr(embedUrl)}" data-title="${escapeAttr(title)} YouTube player">${isEs ? "Cargar vídeo" : "Load YouTube video"}</button>
    </div>
  </div>`;
}

function releaseTypeLabel(type, lang = "en") {
  const key = String(type || "single").toLowerCase();
  if (lang !== "es") return type || "single";
  const labels = {
    single: "sencillo",
    remix: "remix",
    edit: "edición",
    mashup: "mashup",
    instrumental: "instrumental",
    video: "video",
    "dj set": "sesión DJ"
  };
  return labels[key] || type || "single";
}

function releasePlatformPanel(release, lang = "en", routes = releasePlatformRoutes(release, lang)) {
  const isEs = lang === "es";
  const title = displayReleaseTitle(release);
  if (!routes.length) return "";
  const heading = isYoutubeOnlyRelease(release)
    ? (isEs ? `Vídeo oficial de ${title}` : `${title} official video`)
    : (isEs ? `${title} en las plataformas` : `${title} across the platforms`);
  return `<section class="release-platform-panel" aria-labelledby="release-platforms-title">
    <h2 id="release-platforms-title">${escapeHtml(heading)}</h2>
    <div class="release-platform-list">
      ${routes.map((route) => `<a class="release-platform-link" href="${escapeAttr(route.href)}" target="_blank" rel="noopener noreferrer">
        <strong>${escapeHtml(labelForLink(route.key))}</strong>
        <span>${escapeHtml(route.meta)}</span>
      </a>`).join("\n      ")}
    </div>
  </section>`;
}

function itemYear(item) {
  return item.year || item.releaseDate?.slice(0, 4) || item.uploadDate?.slice(0, 4) || item.publishedDate?.slice(0, 4) || "";
}

function latestByDate(items, dateKey) {
  return [...items]
    .filter((item) => item && item[dateKey])
    .sort((a, b) => String(b[dateKey]).localeCompare(String(a[dateKey])))[0] || null;
}

function metaPill(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`;
}

const CHART_HISTORY_DELAY_DAYS = 8;

function daysUntilChartHistory(set) {
  const raw = String(set.uploadDate || set.publishedDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const uploaded = new Date(`${raw}T00:00:00Z`);
  const build = new Date(`${BUILD_DATE}T00:00:00Z`);
  const age = Math.floor((build.getTime() - uploaded.getTime()) / 86400000);
  return Math.max(0, CHART_HISTORY_DELAY_DAYS - age);
}

function renderMixcloudChartHistory(set, lang = "en") {
  const isEs = lang === "es";
  const entries = Array.isArray(set.chartHistory)
    ? set.chartHistory.filter((entry) => entry?.rank && entry?.chart)
    : [];
  const daysLeft = daysUntilChartHistory(set);
  if (!entries.length && (!daysLeft || daysLeft <= 0)) return "";
  const cards = entries.map((entry) => (
    `<article class="mixcloud-chart-card">
      <strong>${escapeHtml(entry.rank)}</strong>
      <span>${escapeHtml(entry.chart)}</span>
    </article>`
  )).join("");
  const pending = !entries.length && daysLeft > 0
    ? `<article class="mixcloud-chart-card pending">
      <strong>${escapeHtml(daysLeft)}d</strong>
      <span>${isEs ? "ranking pendiente" : "chart history check pending"}</span>
    </article>`
    : "";
  return `<section class="mixcloud-chart" aria-labelledby="mixcloud-chart-${escapeAttr(set.slug)}">
    <p class="mixcloud-chart-label" id="mixcloud-chart-${escapeAttr(set.slug)}">${isEs ? "Historial de rankings en Mixcloud" : "Mixcloud chart history"}</p>
    <div class="mixcloud-chart-grid">${cards || pending}</div>
  </section>`;
}

function officialPlatformActions() {
  return `<div class="platform-actions">
${PLATFORM_LINKS.map(([name, url], index) => `<a class="button${index === 0 ? " primary" : ""}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`).join("\n")}
</div>`;
}

function serviceSearchUrl(service, title) {
  const query = encodeURIComponent(`BladesBeats ${title}`);
  if (service === "spotify") return `https://open.spotify.com/search/${query}`;
  if (service === "youtube") return `https://www.youtube.com/results?search_query=${query}`;
  return "";
}

function releasePlatformEntries(releases, service, lang = "en") {
  return releases.map((release) => {
    if (!platformAllowed(release, service)) return null;
    const title = displayReleaseTitle(release);
    const exact = release.links?.[service] || "";
    const href = exact || serviceSearchUrl(service, title);
    return {
      title,
      href,
      meta: itemYear(release) || (lang === "es" ? "Lanzamiento" : "Release")
    };
  }).filter((entry) => entry && entry.href);
}

function setPlatformEntries(sets) {
  return sets.map((set) => ({
    title: set.title,
    href: set.links?.mixcloud || set.mixcloudUrl || "",
    meta: itemYear(set) || "Set"
  })).filter((entry) => entry.href);
}

function profilePlatformEntries(name, url, lang = "en") {
  return [{
    title: lang === "es" ? `Perfil oficial de ${name}` : `Official ${name} profile`,
    href: url,
    meta: lang === "es" ? "Perfil" : "Profile"
  }];
}

function renderPlatformEntries(entries) {
  return `<div class="platform-entry-grid">
${entries.map((entry) => `<a class="platform-entry" href="${escapeAttr(entry.href)}" target="_blank" rel="noopener noreferrer">
  <span class="platform-entry-title">${escapeHtml(entry.title)}</span>
  <span class="platform-entry-meta">${escapeHtml(entry.meta)}</span>
</a>`).join("\n")}
</div>`;
}

function platformCatalog(releases, sets, lang = "en") {
  const isEs = lang === "es";
  const spotifyUrl = PLATFORM_LINKS.find(([name]) => name === "Spotify")?.[1] || "";
  const appleUrl = PLATFORM_LINKS.find(([name]) => name === "Apple Music")?.[1] || "";
  const mixcloudUrl = PLATFORM_LINKS.find(([name]) => name === "Mixcloud")?.[1] || "";
  const youtubeUrl = PLATFORM_LINKS.find(([name]) => name === "YouTube")?.[1] || "";
  const instagramUrl = PLATFORM_LINKS.find(([name]) => name === "Instagram")?.[1] || "";
  const tiktokUrl = PLATFORM_LINKS.find(([name]) => name === "TikTok")?.[1] || "";
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const appleEntries = releasePlatformEntries(releases, "appleMusic", lang);
  const spotifyEntries = releasePlatformEntries(releases, "spotify", lang);
  const mixcloudEntries = setPlatformEntries(sets);
  const youtubeEntries = releasePlatformEntries(releases, "youtube", lang);
  const platforms = [
    {
      key: "apple-music",
      name: "Apple Music",
      count: countLabel(appleEntries.length, isEs ? "lanzamiento" : "release", isEs ? "lanzamientos" : "releases"),
      copy: isEs ? "Enlaces verificados de Apple Music para los lanzamientos disponibles de BladesBeats." : "Verified Apple Music links for the available BladesBeats releases.",
      profileUrl: appleUrl,
      entries: appleEntries
    },
    {
      key: "spotify",
      name: "Spotify",
      count: countLabel(spotifyEntries.length, isEs ? "lanzamiento" : "release", isEs ? "lanzamientos" : "releases"),
      copy: isEs ? "El perfil de BladesBeats en Spotify, con los lanzamientos localizables por título." : "The BladesBeats profile on Spotify, with releases searchable by title.",
      profileUrl: spotifyUrl,
      entries: spotifyEntries
    },
    {
      key: "mixcloud",
      name: "Mixcloud",
      count: countLabel(mixcloudEntries.length, isEs ? "sesi\u00f3n" : "set", isEs ? "sesiones" : "sets"),
      copy: isEs ? "Sesiones DJ completas desde el perfil oficial de BladesBeats en Mixcloud." : "Full-length DJ sets from the official BladesBeats Mixcloud profile.",
      profileUrl: mixcloudUrl,
      entries: mixcloudEntries
    },
    {
      key: "youtube",
      name: "YouTube",
      count: countLabel(youtubeEntries.length, isEs ? "lanzamiento" : "release", isEs ? "lanzamientos" : "releases"),
      copy: isEs ? "Remixes, edits y sesiones desde el canal oficial de BladesBeats en YouTube." : "Remixes, edits, and sets from the official BladesBeats YouTube channel.",
      profileUrl: youtubeUrl,
      entries: youtubeEntries
    },
    {
      key: "instagram",
      name: "Instagram",
      count: isEs ? "Perfil" : "Profile",
      copy: isEs ? "Música nueva, clips y la actividad más reciente de BladesBeats en Instagram." : "New music, clips, and current BladesBeats activity on Instagram.",
      profileUrl: instagramUrl,
      entries: profilePlatformEntries("Instagram", instagramUrl, lang)
    },
    {
      key: "tiktok",
      name: "TikTok",
      count: isEs ? "Perfil" : "Profile",
      copy: isEs ? "Clips breves de BladesBeats en el perfil oficial de TikTok." : "Short-form BladesBeats clips on the official TikTok profile.",
      profileUrl: tiktokUrl,
      entries: profilePlatformEntries("TikTok", tiktokUrl, lang)
    }
  ];
  const cards = platforms.map((platform) => {
    const modalId = `platform-${platform.key}-modal`;
    return `<button class="platform-card" type="button" data-platform-open aria-haspopup="dialog" aria-controls="${escapeAttr(modalId)}">
  <span class="platform-card-top">
    <span class="platform-name">${escapeHtml(platform.name)}</span>
    <span class="platform-count">${escapeHtml(platform.count)}</span>
  </span>
  <span class="platform-card-copy">${escapeHtml(platform.copy)}</span>
  <span class="platform-card-action">${isEs ? "Música y enlaces" : "Music and links"}</span>
</button>`;
  }).join("\n");
  const modals = platforms.map((platform) => {
    const modalId = `platform-${platform.key}-modal`;
    const profileLabel = isEs ? `BladesBeats en ${platform.name}` : `BladesBeats on ${platform.name}`;
    return `<dialog class="appearance-modal platform-modal" id="${escapeAttr(modalId)}" aria-labelledby="${escapeAttr(modalId)}-title">
  <div class="appearance-dialog platform-dialog">
    <div class="appearance-dialog-head">
      <span class="appearance-label">${escapeHtml(platform.count)}</span>
      <form method="dialog"><button class="appearance-close" type="submit" data-platform-close>${isEs ? "Cerrar" : "Close"}</button></form>
    </div>
    <h2 id="${escapeAttr(modalId)}-title">${escapeHtml(platform.name)}</h2>
    <p>${escapeHtml(platform.copy)}</p>
    ${renderPlatformEntries(platform.entries)}
    ${platform.profileUrl ? `<div class="appearance-modal-links"><a href="${escapeAttr(platform.profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profileLabel)}</a></div>` : ""}
  </div>
</dialog>`;
  }).join("\n");
  return `<section class="platform-catalog" aria-label="${isEs ? "Plataformas oficiales de BladesBeats" : "BladesBeats official platforms"}">
  <div class="catalog-section-head">
    <span>${isEs ? "Música y perfiles" : "Music and profiles"}</span>
    <h2>${isEs ? "BladesBeats en las plataformas" : "BladesBeats across the platforms"}</h2>
    <p>${isEs ? "El catálogo, las sesiones completas, los vídeos y las novedades de BladesBeats, reunidos en un solo lugar." : "The catalog, full DJ sets, videos, and current BladesBeats updates, gathered in one place."}</p>
  </div>
  <div class="platform-catalog-grid">${cards}</div>
  ${modals}
</section>`;
}

function releasePreview(releases, lang = "en") {
  const isEs = lang === "es";
  const latest = [...releases]
    .sort((a, b) => String(b.releaseDate || b.lastmod || "").localeCompare(String(a.releaseDate || a.lastmod || "")))
    .slice(0, 8);
  const cards = latest.map((release) => {
    const href = releaseDetailPath(release.slug, lang);
    const title = displayReleaseTitle(release);
    const image = release.image || "/og-card.png";
    const date = formatReleaseDate(release.releaseDate, lang) || itemYear(release);
    const type = releaseTypeLabel(release.type, lang);
    const coverAlt = isEs ? `Portada de ${title}` : `${title} cover artwork`;
    return `<article class="release-card">
  <a class="release-card-cover" href="${escapeAttr(href)}">
    <img src="${escapeAttr(image)}" alt="${escapeAttr(coverAlt)}" loading="lazy" decoding="async" width="600" height="600">
  </a>
  <div class="release-card-body">
    <p class="release-card-meta">${escapeHtml(date)}${type ? ` &middot; ${escapeHtml(type)}` : ""}</p>
    <h2 class="release-card-title"><a href="${escapeAttr(href)}">${escapeHtml(title)}</a></h2>
    ${platformList(releaseDirectLinks(release))}
  </div>
</article>`;
  }).join("\n");
  return `<section class="release-preview" aria-labelledby="latest-releases-title">
  <div class="catalog-section-head">
    <span>${isEs ? "Catálogo reciente" : "Recent catalog"}</span>
    <h2 id="latest-releases-title">${isEs ? "Últimos lanzamientos" : "Latest releases"}</h2>
    <p>${isEs ? "El catálogo empieza con los temas más recientes; cada página reúne la portada, la fecha y los enlaces disponibles." : "The catalog begins with the newest tracks, with artwork, release dates, and available platform links on every page."}</p>
  </div>
  <div class="release-grid">${cards}</div>
</section>`;
}

function releaseSchema(release, detailUrl = "") {
  const links = cleanLinks(releaseDirectLinks(release)).map(([, url]) => url);
  const schema = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    "@id": detailUrl ? `${detailUrl}#recording` : `${SITE}/music/#${release.slug}`,
    "name": displayReleaseTitle(release),
    "byArtist": {
      "@type": "Person",
      "@id": ARTIST_ID,
      "name": "BladesBeats"
    }
  };
  schema.url = detailUrl || `${SITE}/music/#${release.slug}`;
  if (release.image) schema.image = release.image;
  if (release.releaseDate) schema.datePublished = release.releaseDate;
  if (Array.isArray(release.genres) && release.genres.length) schema.genre = release.genres;
  if (links.length) schema.sameAs = links;
  return schema;
}

function releaseDetailSchema(release, detailUrl, description, lang = "en") {
  const isEs = lang === "es";
  const title = displayReleaseTitle(release);
  const recording = releaseSchema(release, detailUrl);
  delete recording["@context"];
  recording.mainEntityOfPage = { "@id": `${detailUrl}#webpage` };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${detailUrl}#breadcrumb`,
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "BladesBeats", "item": SITE + "/" },
      { "@type": "ListItem", "position": 2, "name": isEs ? "Música" : "Music", "item": isEs ? `${SITE}/es/musica/` : `${SITE}/music/` },
      { "@type": "ListItem", "position": 3, "name": title, "item": detailUrl }
    ]
  };
  const webpage = {
    "@type": "WebPage",
    "@id": `${detailUrl}#webpage`,
    "url": detailUrl,
    "name": `${title} - BladesBeats`,
    "description": description,
    "inLanguage": isEs ? "es" : "en",
    "breadcrumb": { "@id": `${detailUrl}#breadcrumb` },
    "mainEntity": { "@id": `${detailUrl}#recording` }
  };
  if (release.image) webpage.primaryImageOfPage = release.image;
  const graph = [webpage, breadcrumb, recording];
  const embedUrl = youtubeEmbedUrl(release);
  if (embedUrl && release.image && release.releaseDate) {
    const videoId = `${detailUrl}#video`;
    webpage.video = { "@id": videoId };
    graph.push({
      "@type": "VideoObject",
      "@id": videoId,
      "name": title,
      "description": release.longDescription || description,
      "thumbnailUrl": [release.image],
      "uploadDate": `${release.releaseDate}T00:00:00Z`,
      "embedUrl": embedUrl,
      "url": detailUrl,
      "isPartOf": { "@id": `${detailUrl}#webpage` }
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

function setSchema(set, detailUrl, lang = "en") {
  const links = cleanLinks(set.links).map(([, url]) => url);
  const schema = {
    "@context": "https://schema.org",
    "@type": "MusicPlaylist",
    "@id": `${detailUrl}#set`,
    "name": set.title,
    "creator": {
      "@type": "Person",
      "@id": ARTIST_ID,
      "name": "BladesBeats"
    },
    "url": detailUrl,
    "description": setSummary(set, lang)
  };
  if (Array.isArray(set.genres) && set.genres.length) schema.genre = set.genres;
  if (links.length) schema.sameAs = links;
  if (set.publishedDate) schema.datePublished = set.publishedDate;
  return schema;
}

function absoluteSiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function gigSchema(gig, detailUrl, lang = "en") {
  const isEs = lang === "es";
  const description = isEs
    ? (gig.bodyEs || gig.summaryEs || gig.body || gig.summary || `${gig.title} bolo de BladesBeats.`)
    : (gig.body || gig.summary || `${gig.title} appearance for BladesBeats.`);
  const image = absoluteSiteUrl(gig.logoImage || "/og-card.png");
  const organizerUrl = gig.organizer?.url || gig.partners?.[0]?.url || "";
  const organizerName = gig.organizer?.name || gig.partners?.[0]?.name || gig.title;
  const offerUrl = gig.offer?.url || organizerUrl || detailUrl;
  const schema = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "@id": `${detailUrl}#event`,
    "name": gig.title,
    "url": detailUrl,
    "description": description,
    "image": image ? [image] : undefined,
    "eventStatus": "https://schema.org/EventScheduled",
    "startDate": gig.startDate,
    ...(gig.endDate && { "endDate": gig.endDate }),
    "organizer": {
      "@type": "Organization",
      "name": organizerName,
      ...(organizerUrl && { "url": organizerUrl })
    },
    "offers": {
      "@type": "Offer",
      "url": offerUrl,
      ...(gig.offer?.price && { "price": gig.offer.price }),
      ...(gig.offer?.priceCurrency && { "priceCurrency": gig.offer.priceCurrency }),
      ...((gig.offer?.validFrom || gig.startDate) && { "validFrom": gig.offer?.validFrom || gig.startDate }),
      ...(gig.offer?.availability && { "availability": gig.offer.availability })
    },
    "performer": {
      "@type": "Person",
      "@id": ARTIST_ID,
      "name": "BladesBeats"
    },
    "location": {
      "@type": "Place",
      "name": gig.venueName || gig.city,
      "address": {
        "@type": "PostalAddress",
        ...(gig.city && { "addressLocality": gig.city }),
        ...(gig.region && { "addressRegion": gig.region }),
        ...(gig.country && { "addressCountry": gig.country })
      }
    }
  };
  return JSON.parse(JSON.stringify(schema));
}

function buildMusicIndex(releases, generatedReleaseUrls, sets) {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "BladesBeats official releases",
    "itemListElement": releases.map((release, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "item": releaseSchema(release, generatedReleaseUrls.get(release.slug) || "")
    }))
  };
  const spotifyUrl = PLATFORM_LINKS.find(([name]) => name === "Spotify")?.[1] || "";
  const appleUrl = PLATFORM_LINKS.find(([name]) => name === "Apple Music")?.[1] || "";
  return basePage({
    title: "Music and remixes | BladesBeats",
    description: "BladesBeats singles, remixes, instrumentals, and DJ sets, with verified links to Spotify, Apple Music, YouTube, and Mixcloud.",
    canonical: `${SITE}/music/`,
    label: "Music",
    h1: "Music",
    intro: "Original releases, remixes, instrumentals, and DJ sets, gathered with verified links to the platforms where they live.",
    activeNav: "music",
    alternates: PAGE_ALTERNATES.music,
    jsonLd: itemList,
    body: `<div class="platform-actions">
  <a class="button primary" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats on Spotify</a>
  <a class="button" href="${escapeAttr(appleUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats on Apple Music</a>
  <a class="button" href="/dj-sets/">DJ set archive</a>
</div>
${releasePreview(releases, "en")}
${platformCatalog(releases, sets, "en")}`
  });
}

function releaseNeighborNav(release, releases, lang = "en") {
  const isEs = lang === "es";
  const ordered = [...releases].sort((a, b) => (
    String(b.releaseDate || b.lastmod || "").localeCompare(String(a.releaseDate || a.lastmod || ""))
      || displayReleaseTitle(a).localeCompare(displayReleaseTitle(b))
  ));
  const index = ordered.findIndex((item) => item.slug === release.slug);
  const newer = index > 0 ? ordered[index - 1] : null;
  const older = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const neighbor = (item, direction) => {
    if (!item) return `<span class="release-neighbor-space" aria-hidden="true"></span>`;
    const isNewer = direction === "newer";
    const label = isNewer
      ? (isEs ? "Lanzamiento más reciente" : "Newer release")
      : (isEs ? "Lanzamiento anterior" : "Older release");
    return `<a class="release-neighbor ${isNewer ? "previous" : "next"}" href="${escapeAttr(releaseDetailPath(item.slug, lang))}">
      <span>${isNewer ? "&larr; " : ""}${label}${isNewer ? "" : " &rarr;"}</span>
      <strong>${escapeHtml(displayReleaseTitle(item))}</strong>
    </a>`;
  };
  return `<nav class="release-neighbors" aria-label="${isEs ? "Navegación de lanzamientos" : "Release navigation"}">
    <div class="release-neighbors-inner">
      ${neighbor(newer, "newer")}
      <a class="release-catalog-link" href="${isEs ? "/es/musica/" : "/music/"}">${isEs ? "Todo el catálogo" : "Full catalog"}</a>
      ${neighbor(older, "older")}
    </div>
  </nav>`;
}

function buildReleasePage(release, lang = "en", releases = [release]) {
  const isEs = lang === "es";
  const detailUrl = releaseDetailUrl(release.slug, lang);
  const title = displayReleaseTitle(release);
  const year = itemYear(release);
  const routes = releasePlatformRoutes(release, lang);
  const formatLabel = releaseTypeLabel(release.type, lang);
  const factFormatLabel = formatLabel
    ? `${formatLabel.charAt(0).toLocaleUpperCase(isEs ? "es-ES" : "en-GB")}${formatLabel.slice(1)}`
    : formatLabel;
  const publishedDate = formatReleaseDate(release.releaseDate, lang) || year;
  const description = compactMetaDescription(isEs
    ? `${title} de BladesBeats: ${formatLabel}${publishedDate ? ` publicado el ${publishedDate}` : ""}, con enlaces oficiales verificados y datos del lanzamiento.`
    : `${title} by BladesBeats — ${formatLabel}${publishedDate ? ` released ${publishedDate}` : ""}, with verified official links and release details.`);
  const image = release.image || `${SITE}/og-card.png`;
  const socialDimensions = socialImageDimensions(image, { width: 1200, height: 1200 });
  const heroCopy = releaseSummary(release, lang);
  const coverAlt = isEs ? `Portada de ${title}` : `${title} cover artwork`;
  const directPlatformNames = routes.filter((route) => route.direct).map((route) => labelForLink(route.key));
  const searchPlatformNames = routes.filter((route) => !route.direct).map((route) => labelForLink(route.key));
  const releaseFacts = [
    [isEs ? "Publicado" : "Released", publishedDate],
    [isEs ? "Formato" : "Format", factFormatLabel],
    [isEs ? "Artista" : "Artist", release.artist || "BladesBeats"],
    [isEs ? "Enlaces oficiales" : "Official links", directPlatformNames.join(", ")]
  ].filter(([, value]) => value);
  const directLinkCopy = directPlatformNames.length
    ? (isEs
      ? `Este lanzamiento ${directPlatformNames.length === 1 ? "está disponible directamente" : "tiene enlaces directos"} en ${naturalList(directPlatformNames, lang)}`
      : `This release ${directPlatformNames.length === 1 ? "is available directly" : "has direct links"} on ${naturalList(directPlatformNames, lang)}`)
    : "";
  const searchLinkCopy = searchPlatformNames.length
    ? (isEs
      ? `el título exacto también permite encontrarlo en ${naturalList(searchPlatformNames, lang)}`
      : `its exact title also brings it up on ${naturalList(searchPlatformNames, lang)}`)
    : "";
  const platformCopy = isYoutubeOnlyRelease(release)
    ? (isEs ? "El enlace verificado de YouTube lleva a la publicación oficial." : "The verified YouTube link leads to the official upload.")
    : directLinkCopy && searchLinkCopy
      ? `${directLinkCopy}; ${searchLinkCopy}.`
      : directLinkCopy
        ? `${directLinkCopy}.`
        : searchLinkCopy
          ? `${searchLinkCopy.charAt(0).toLocaleUpperCase(isEs ? "es-ES" : "en-GB")}${searchLinkCopy.slice(1)}.`
          : (isEs ? "La portada, la fecha y el formato forman parte del archivo de este lanzamiento." : "The artwork, date, and format are collected here as part of the release archive.");
  const releaseCopy = isEs
    ? platformCopy
    : (release.longDescription || platformCopy);
  const primaryRoute = routes.find((route) => route.direct) || routes[0] || null;
  const primaryLabel = isYoutubeOnlyRelease(release)
    ? (isEs ? "Vídeo oficial en" : "Official video on")
    : (isEs ? "Disponible en" : "Available on");
  const sortedReleases = [...releases].sort((a, b) => (
    String(b.releaseDate || b.lastmod || "").localeCompare(String(a.releaseDate || a.lastmod || ""))
      || displayReleaseTitle(a).localeCompare(displayReleaseTitle(b))
  ));
  const posterIndex = Math.max(0, sortedReleases.findIndex((item) => item.slug === release.slug)) + 1;
  const body = `<article class="release-poster">
  <img class="release-poster-backdrop" src="${escapeAttr(image)}" alt="" aria-hidden="true" width="800" height="800" decoding="async">
  <div class="release-poster-inner">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol>
        <li><a href="${isEs ? "/es/" : "/"}">BladesBeats</a></li>
        <li><a href="${isEs ? "/es/musica/" : "/music/"}">${isEs ? "Música" : "Music"}</a></li>
        <li aria-current="page">${escapeHtml(title)}</li>
      </ol>
    </nav>
    <div class="release-poster-grid">
      <div class="release-poster-art">
        <span class="release-poster-number">BB / ${String(posterIndex).padStart(2, "0")}</span>
        <img src="${escapeAttr(image)}"${responsiveImageAttributes(image, "(max-width: 720px) calc(100vw - 64px), (max-width: 1200px) 38vw, 560px")} alt="${escapeAttr(coverAlt)}" width="800" height="800" loading="eager" decoding="async" fetchpriority="high">
      </div>
      <div class="release-poster-copy">
        <p class="release-poster-eyebrow">${escapeHtml(year || (isEs ? "Lanzamiento" : "Release"))} &middot; ${escapeHtml(releaseTypeLabel(release.type, lang))}</p>
        <h1 class="release-poster-title">${escapeHtml(title)}</h1>
        <p class="release-poster-date">${escapeHtml(publishedDate)}</p>
        <p class="release-poster-lead">${escapeHtml(heroCopy)}</p>
        <div class="release-poster-actions">
          <a class="release-poster-primary" href="${escapeAttr(primaryRoute?.href || (isEs ? "/es/musica/" : "/music/"))}"${primaryRoute ? ' target="_blank" rel="noopener noreferrer"' : ""}>
            <span>${primaryLabel}</span>
            <strong>${escapeHtml(primaryRoute ? labelForLink(primaryRoute.key) : (isEs ? "Todo el catálogo" : "Full catalog"))} &nearr;</strong>
          </a>
          ${routes.length ? `<div class="release-poster-services" aria-label="${isEs ? "Plataformas" : "Platforms"}">
            ${routes.map((route) => `<a href="${escapeAttr(route.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelForLink(route.key))}</a>`).join("\n            ")}
          </div>` : ""}
        </div>
      </div>
    </div>
  </div>
</article>
<section class="release-editorial" aria-labelledby="release-editorial-title">
  <div class="release-editorial-inner">
    <div>
      <p class="release-editorial-kicker">${isEs ? "Detalles del lanzamiento" : "Release details"}</p>
      <h2 id="release-editorial-title">${isYoutubeOnlyRelease(release) ? (isEs ? "Dónde verlo" : "Where to watch") : (isEs ? "Dónde escucharlo" : "Where to listen")}</h2>
      <p class="release-editorial-copy">${escapeHtml(releaseCopy)}</p>
      ${Array.isArray(release.featuredArtists) && release.featuredArtists.length ? `<p class="release-editorial-meta"><span>${isEs ? "Con" : "With"}</span> ${escapeHtml(release.featuredArtists.join(", "))}</p>` : ""}
    </div>
    <dl class="gig-facts">
      ${releaseFacts.map(([factLabel, factValue]) => `<div><dt>${escapeHtml(factLabel)}</dt><dd>${escapeHtml(factValue)}</dd></div>`).join("\n      ")}
    </dl>
    ${youtubeEmbedUrl(release) ? `<div class="release-editorial-media">${youtubeEmbedPlaceholder(release, lang)}</div>` : ""}
  </div>
</section>
${releaseNeighborNav(release, releases, lang)}`;
  return basePage({
    title: compactReleasePageTitle(title),
    description,
    canonical: detailUrl,
    label: isEs ? "Lanzamiento" : "Release",
    h1: title,
    intro: isEs ? `${title}, un ${formatLabel} de BladesBeats.` : `${title}, a ${formatLabel} from BladesBeats.`,
    activeNav: "music",
    lang,
    alternates: { en: releaseDetailUrl(release.slug, "en"), es: releaseDetailUrl(release.slug, "es") },
    jsonLd: releaseDetailSchema(release, detailUrl, description, lang),
    body,
    socialImage: image,
    socialImageWidth: socialDimensions.width,
    socialImageHeight: socialDimensions.height,
    socialImageAlt: coverAlt,
    bodyClass: "release-page",
    showPageHead: false
  });
}

function buildSetIndex(sets, generatedSetUrls, lang = "en") {
  const isEs = lang === "es";
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": isEs ? "Sesiones DJ oficiales de BladesBeats" : "BladesBeats official DJ sets",
    "itemListElement": sets.map((set, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "item": setSchema(set, generatedSetUrls.get(set.slug) || (isEs ? `${SITE}/es/sesiones/` : `${SITE}/dj-sets/`), lang)
    }))
  };
  const cards = sets.map((set) => {
    const detailUrl = generatedSetUrls.get(set.slug);
    const href = detailUrl ? setDetailPath(set.slug, lang) : set.links?.mixcloud || (isEs ? "/es/sesiones/" : "/dj-sets/");
    const image = set.image || "/og-card.png";
    const cardCopy = setSummary(set, lang);
    const coverAlt = isEs ? `${set.title} imagen de portada en Mixcloud` : `${set.title} Mixcloud cover image`;
    return `<article class="release-card">
  <a class="release-card-cover" href="${escapeAttr(href)}">
    <img src="${escapeAttr(image)}" alt="${escapeAttr(coverAlt)}" loading="lazy" decoding="async" width="600" height="600">
  </a>
  <div class="release-card-body">
    <p class="release-card-meta">${escapeHtml(set.uploadDate || set.publishedDate || "Mixcloud")} &middot; ${escapeHtml(set.duration || (isEs ? "Sesión DJ" : "DJ set"))}</p>
    <h2 class="release-card-title"><a href="${escapeAttr(href)}">${escapeHtml(set.title)}</a></h2>
    <p class="release-card-copy">${escapeHtml(cardCopy)}</p>
    ${platformList(set.links)}
  </div>
</article>`;
  }).join("\n");
  return basePage({
    title: isEs ? "Sesiones DJ | BladesBeats" : "DJ Sets | BladesBeats",
    description: isEs
      ? "Sesiones DJ completas de BladesBeats en Mixcloud, con duración, estilos, rankings disponibles y enlaces verificados."
      : "Full-length BladesBeats DJ sets on Mixcloud, with durations, styles, available chart history, and verified links.",
    canonical: isEs ? PAGE_ALTERNATES.sets.es : PAGE_ALTERNATES.sets.en,
    label: isEs ? "Sesiones" : "DJ Sets",
    h1: isEs ? "Sesiones DJ" : "DJ Sets",
    intro: isEs ? "Sesiones completas de BladesBeats, con enlaces de Mixcloud e historial de rankings cuando está disponible." : "Full-length sessions from BladesBeats, with Mixcloud links and chart history where available.",
    activeNav: "sets",
    lang,
    alternates: PAGE_ALTERNATES.sets,
    jsonLd: itemList,
    body: `<div class="platform-actions">
  <a class="button primary" href="https://www.mixcloud.com/BladesBeats/" target="_blank" rel="noopener noreferrer">${isEs ? "BladesBeats en Mixcloud" : "BladesBeats on Mixcloud"}</a>
  <a class="button" href="${isEs ? "/es/musica/" : "/music/"}">${isEs ? "Catálogo musical" : "Music catalog"}</a>
</div>
<section class="release-grid">${cards}</section>`
  });
}

function buildSetPage(set, lang = "en") {
  const isEs = lang === "es";
  const detailUrl = setDetailUrl(set.slug, lang);
  const description = compactMetaDescription(isEs
    ? `${set.title}, una sesión DJ de BladesBeats disponible completa en ${set.platform || "Mixcloud"}, con duración, estilos y datos verificados.`
    : `${set.title}, a full-length BladesBeats DJ set on ${set.platform || "Mixcloud"}, with duration, styles, and verified details.`);
  const image = set.image || `${SITE}/og-card.png`;
  const coverAlt = isEs ? `Portada de ${set.title} en Mixcloud` : `${set.title} Mixcloud cover artwork`;
  const chartHistory = renderMixcloudChartHistory(set, lang);
  const embed = mixcloudEmbedPlaceholder(set, lang);
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb">
  <ol>
    <li><a href="/">BladesBeats</a></li>
    <li><a href="${isEs ? "/es/sesiones/" : "/dj-sets/"}">${isEs ? "Sesiones DJ" : "DJ sets"}</a></li>
    <li aria-current="page">${escapeHtml(set.title)}</li>
  </ol>
</nav>
<article class="release-detail">
  <div class="release-detail-cover">
    <img src="${escapeAttr(image)}" alt="${escapeAttr(coverAlt)}" width="800" height="800" loading="eager" decoding="async" fetchpriority="high">
  </div>
  <div class="release-detail-body">
    <p class="page-eyebrow">${escapeHtml(set.uploadDate || set.publishedDate || "Mixcloud")} &middot; ${escapeHtml(set.duration || (isEs ? "Sesión DJ" : "DJ set"))}</p>
    <p class="release-detail-text">${escapeHtml(isEs ? setSummary(set, lang) : (set.longDescription || setSummary(set, lang)))}</p>
    ${chartHistory}
    ${embed}
    <div class="release-detail-platforms">${detailPlatformLinks(set.links)}</div>
    <p><a class="back-link" href="${isEs ? "/es/sesiones/" : "/dj-sets/"}">&larr; ${isEs ? "Archivo de sesiones DJ" : "DJ set archive"}</a></p>
  </div>
</article>`;
  return basePage({
    title: compactReleasePageTitle(`${set.title} — ${isEs ? "sesión DJ" : "DJ set"}`),
    description,
    canonical: detailUrl,
    label: isEs ? "Sesión DJ" : "DJ Set",
    h1: set.title,
    intro: isEs ? "Una sesión completa de BladesBeats en Mixcloud, con sus datos y rankings disponibles." : "A full-length BladesBeats session on Mixcloud, with available details and chart history.",
    activeNav: "sets",
    lang,
    alternates: { en: setDetailUrl(set.slug, "en"), es: setDetailUrl(set.slug, "es") },
    jsonLd: setSchema(set, detailUrl, lang),
    body
  });
}

function artistSchema(pageUrl, description) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": ARTIST_ID,
    "name": "BladesBeats",
    "url": pageUrl,
    "image": `${SITE}/og-card.png`,
    "description": description,
    "jobTitle": "DJ and music producer",
    "address": { "@type": "PostalAddress", "addressLocality": "Sevilla", "addressCountry": "ES" },
    "knowsLanguage": ["en", "es"],
    "sameAs": PLATFORM_LINKS.map(([, url]) => url)
  };
}

function staticContactScript() {
  return `
(function(){
  const CONTACT_EMAIL = "bladesbeats.opossum156@passinbox.com";
  const CONTACT_ENDPOINT = "/api/contact";
  const FORM_LANGUAGE = document.documentElement.lang === "es" ? "es" : "en";

  function contactType(form){
    const select = form.querySelector("[data-contact-type]");
    return select ? select.value : "booking";
  }

  function updateContactGroups(form){
    const type = contactType(form);
    const isHandoff = type === "mixing" || type === "courses";
    const activeElement = document.activeElement;
    const activeWasHandoff = activeElement instanceof HTMLElement && !!activeElement.closest(".handoff-card");
    const typeSelect = form.querySelector("[data-contact-type]");
    form.classList.toggle("is-handoff", isHandoff);
    form.querySelectorAll("[data-contact-group]").forEach(function(group){
      const active = group.dataset.contactGroup === type;
      group.hidden = !active;
      group.querySelectorAll("input, select, textarea").forEach(function(field){
        field.disabled = !active;
      });
    });
    form.querySelectorAll("input, textarea, button").forEach(function(field){
      if(field.closest("[data-contact-group]")) return;
      field.disabled = isHandoff;
    });
    if(typeSelect) typeSelect.disabled = false;
    const message = form.querySelector("textarea[name='message']");
    const label = form.querySelector("[data-contact-message-label]");
    const key = type.charAt(0).toUpperCase() + type.slice(1);
    if(message) message.setAttribute("placeholder", form.dataset["message" + key] || form.dataset.messageDefault || "");
    if(label) label.textContent = form.dataset["label" + key] || form.dataset.labelDefault || "Message";
    if(isHandoff && activeElement instanceof HTMLElement && form.contains(activeElement) && activeElement !== typeSelect){
      activeElement.blur();
    }
    if(isHandoff){
      const handoffLink = form.querySelector('[data-contact-group="' + type + '"] a');
      if(handoffLink) handoffLink.focus({preventScroll:true});
    } else if(activeWasHandoff && typeSelect){
      typeSelect.focus({preventScroll:true});
    }
  }

  function setStatus(form, message, kind){
    const status = form.querySelector("[data-contact-status]");
    if(!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", kind === "error");
    status.classList.toggle("success", kind === "success");
  }

  function renderTurnstile(tries){
    const el = document.getElementById("bb-turnstile");
    if(!el || el.dataset.rendered) return;
    if(location.hostname === "127.0.0.1" || location.hostname === "localhost"){
      el.dataset.rendered = "local";
      el.textContent = FORM_LANGUAGE === "es" ? "La verificación de seguridad se activa en bladesbeats.com." : "Security verification runs on bladesbeats.com.";
      return;
    }
    if(window.turnstile && typeof window.turnstile.render === "function"){
      try{
        const widgetId = window.turnstile.render(el, {
          sitekey: "0x4AAAAAADoNSCaiKxbVJ44j",
          theme: "dark",
          language: FORM_LANGUAGE,
          callback: function(token){ el.dataset.token = token || ""; },
          "expired-callback": function(){ delete el.dataset.token; },
          "error-callback": function(){ delete el.dataset.token; },
          "timeout-callback": function(){ delete el.dataset.token; }
        });
        if(widgetId) el.dataset.widgetId = widgetId;
        el.dataset.rendered = "1";
      } catch(error){}
    } else if((tries || 0) < 60){
      setTimeout(function(){ renderTurnstile((tries || 0) + 1); }, 250);
    }
  }

  function resetTurnstile(){
    const el = document.getElementById("bb-turnstile");
    if(!el) return;
    delete el.dataset.token;
    if(window.turnstile && typeof window.turnstile.reset === "function"){
      try{
        if(el.dataset.widgetId){
          window.turnstile.reset(el.dataset.widgetId);
        } else {
          window.turnstile.reset();
        }
        return;
      } catch(error){}
    }
    el.dataset.rendered = "";
    delete el.dataset.widgetId;
    el.innerHTML = "";
    renderTurnstile();
  }

  function turnstileToken(form){
    const input = form.querySelector('[name="cf-turnstile-response"]');
    const el = document.getElementById("bb-turnstile");
    return (input && input.value) || (el && el.dataset.token) || "";
  }

  function waitForTurnstileToken(form, deadline){
    return new Promise(function(resolve){
      const started = Date.now();
      function check(){
        const token = turnstileToken(form);
        if(token || Date.now() - started >= deadline){
          resolve(token);
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }

  function formErrorMessage(form, errorCode){
    const base = errorCode === "verification_failed" ? (form.dataset.captchaRequired || form.dataset.formError) : form.dataset.formError;
    return errorCode ? base + " (" + errorCode + ")" : base;
  }

  function fieldLabel(field){
    const fieldLabelEl = field.closest(".form-field") && field.closest(".form-field").querySelector("span");
    const checkLabelEl = field.closest(".form-check") && field.closest(".form-check").querySelector("span");
    return (fieldLabelEl || checkLabelEl)?.textContent?.trim() || field.name;
  }

  async function submitContactForm(event){
    event.preventDefault();
    const form = event.currentTarget;
    const type = contactType(form);
    if(type === "mixing" || type === "courses"){
      setStatus(form, "", "");
      const handoffLink = form.querySelector('[data-contact-group="' + type + '"] a');
      if(handoffLink) handoffLink.focus();
      return;
    }
    const needsCaptcha = location.hostname !== "127.0.0.1" && location.hostname !== "localhost";
    if(needsCaptcha) renderTurnstile();
    const token = needsCaptcha ? await waitForTurnstileToken(form, 8000) : "";
    if(needsCaptcha && !token){
      renderTurnstile();
      setStatus(form, form.dataset.captchaRequired, "error");
      return;
    }
    const data = new FormData(form);
    const submit = form.querySelector("[data-contact-submit]");
    const typeSelect = form.querySelector("[data-contact-type]");
    const typeLabel = typeSelect && typeSelect.selectedOptions[0] ? typeSelect.selectedOptions[0].textContent.trim() : form.dataset.defaultType;
    const skip = new Set(["cf-turnstile-response", "request_type"]);
    const lines = [(form.dataset.typeLabel || "Type") + ": " + typeLabel];
    data.forEach(function(value, key){
      if(skip.has(key) || !value) return;
      const field = form.elements[key];
      lines.push(fieldLabel(field) + ": " + value);
    });
    const subject = "BladesBeats — " + typeLabel;
    const mail = "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\\n"));
    const canSendDirect = needsCaptcha && CONTACT_ENDPOINT;
    if(submit){
      submit.disabled = true;
      submit.textContent = form.dataset.formSending;
    }
    if(canSendDirect){
      try{
        const response = await fetch(CONTACT_ENDPOINT, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            turnstileToken: token,
            subject,
            type: typeLabel,
            fields: lines,
            page: location.href
          })
        });
        const result = await response.json().catch(function(){ return {}; });
        if(result.error === "request_blocked" || result.error === "temporarily_blocked"){
          location.href = "/blocked/";
          return;
        }
        if(!response.ok || !result.ok) throw new Error(result.error || "send_failed");
        setStatus(form, form.dataset.formSuccess, "success");
        form.reset();
        updateContactGroups(form);
        resetTurnstile();
        if(submit){
          submit.disabled = false;
          submit.textContent = form.dataset.formSend;
        }
        return;
      } catch(error){
        console.warn("Contact form failed:", error.message);
        setStatus(form, formErrorMessage(form, error.message), "error");
        resetTurnstile();
        if(submit){
          submit.disabled = false;
          submit.textContent = form.dataset.formSend;
        }
        return;
      }
    }
    setStatus(form, form.dataset.formMailto, "success");
    window.location.href = mail;
    setTimeout(function(){
      if(submit){
        submit.disabled = false;
        submit.textContent = form.dataset.formSend;
      }
    }, 800);
  }

  document.querySelectorAll("[data-contact-form]").forEach(function(form){
    form.querySelectorAll("[data-contact-type]").forEach(function(select){
      select.addEventListener("change", function(){ updateContactGroups(form); });
    });
    form.addEventListener("submit", submitContactForm);
    updateContactGroups(form);
    renderTurnstile();
  });
}());`;
}

function contactBody(lang) {
  const isEs = lang === "es";
  return `<div class="booking-layout">
  <div class="booking-main">
    <h2>${isEs ? "También estoy en Instagram." : "Instagram is always open."}</h2>
    <p>${isEs
      ? "Los mensajes sobre contratación, bolos, remixes y colaboraciones también son bienvenidos por Instagram."
      : "Messages about bookings, gigs, remixes, and collaborations are also welcome on Instagram."}</p>
  </div>
  <aside class="booking-side">
    <div class="contact-stack">
      <div class="contact-line"><span>Instagram</span><a href="https://www.instagram.com/blades_beats/" target="_blank" rel="noopener noreferrer">@blades_beats</a></div>
      <div class="contact-line"><span>${isEs ? "Idiomas" : "Languages"}</span><span class="contact-value">EN / ES</span></div>
      <div class="contact-line"><span>${isEs ? "Base" : "Base"}</span><span class="contact-value">${isEs ? "Sevilla, España" : "Sevilla, Spain"}</span></div>
    </div>
    <a class="button primary" href="https://www.instagram.com/blades_beats/" target="_blank" rel="noopener noreferrer">${isEs ? "Enviar mensaje en Instagram" : "Message on Instagram"}</a>
  </aside>
</div>`;
}

function contactBodyDesign(lang) {
  const isEs = lang === "es";
  const t = isEs ? {
    title: "Unos datos que ayudan",
    detail: "En consultas sobre eventos, la fecha, la ciudad, la sala, la duración del set y el presupuesto ayudan a preparar una respuesta útil. Si todavía faltan detalles, no pasa nada.",
    languages: "Idiomas",
    base: "Base",
    baseValue: "Sevilla, España",
    name: "Nombre",
    namePh: "Tu nombre",
    email: "Email",
    date: "Fecha del evento",
    type: "Motivo de contacto",
    message: "Mensaje",
    messagePh: "Un poco de contexto sobre tu evento o idea",
    send: "Enviar mensaje",
    sending: "Enviando...",
    success: "Gracias. Tu mensaje está en camino y responderé en cuanto pueda.",
    mailto: "Se abrirá tu aplicación de correo con el mensaje preparado para que puedas revisarlo antes de enviarlo.",
    error: "El mensaje no ha podido enviarse. Puedes volver a intentarlo o escribirme por Instagram.",
    captcha: "Hace falta una verificación rápida antes de enviar el mensaje.",
    booking: "Contratación DJ",
    mixing: "Mezcla y mastering",
    courses: "Formación DJ",
    collab: "Colaboración",
    dmca: "Retirada DMCA",
    gdpr: "Solicitud RGPD",
    other: "Otro",
    city: "Ciudad / sala",
    cityPh: "Ciudad y sala, si está confirmada",
    eventType: "Tipo de evento",
    eventTypes: ["Noche de club", "Festival", "Evento privado", "Evento de empresa / marca", "Bar / lounge", "Otro"],
    setLength: "Duración del set",
    setLengthPh: "Por ejemplo, 2 horas",
    startTime: "Hora de inicio",
    audience: "Público estimado",
    audiencePh: "Por ejemplo, 300",
    budget: "Presupuesto (opcional)",
    budgetPh: "Rango aproximado",
    artist: "Tu nombre de artista / proyecto",
    artistPh: "Cómo publicas tu música",
    mmLabel: "Baster Beats / Sevilla",
    mmNote: "Baster Beats en Sevilla se ocupa de mezcla, mastering e ingeniería de estudio.",
    mmLink: "Web de Baster Beats",
    dcLabel: "Impulsa Music Center / Sevilla",
    dcNote: "Impulsa Music Center en Sevilla se ocupa de la formación DJ.",
    dcLink: "Web de Impulsa Music Center",
    mmMessagePh: "Baster Beats es el contacto adecuado para trabajo de estudio. Este espacio es útil si BladesBeats también participa.",
    dcMessagePh: "Impulsa es el contacto adecuado para formación DJ. Este espacio es útil si BladesBeats también participa.",
    prodService: "¿Qué necesitas?",
    prodServices: ["Servicios de estudio con Baster Beats", "Co-producción", "Idea de remix para BladesBeats", "Consulta / dirección de producción", "Otro"],
    prodStage: "Estado del proyecto",
    prodStages: ["Idea / demo inicial", "Demo grabada", "Stems preparados", "Listo para mezcla", "Preparando lanzamiento"],
    collabType: "Tipo de colaboración",
    collabTypes: ["Tema original", "Remix", "Co-producción", "Sesión de estudio", "Otro"],
    link: "Enlace a tu música",
    linkPh: "Spotify, Mixcloud, YouTube, etc.",
    genre: "Género / vibe",
    genrePh: "El sonido o la dirección que tienes en mente",
    remixTrack: "Tema que quieres remezclar",
    remixTrackPh: "Título del tema",
    remixArtist: "Artista original",
    remixArtistPh: "Quién lo publicó",
    remixStyle: "Tu estilo de remix",
    remixStylePh: "p.ej. afro house, tech house",
    deadline: "Fecha objetivo (opcional)",
    prodMessagePh: "Un poco sobre lo que necesitas, lo que ya existe y hacia dónde te gustaría llevar el tema.",
    collabMessagePh: "Un poco sobre la idea, quién participa y el tipo de colaboración que tienes en mente.",
    remixMessagePh: "Un poco sobre el tema, los permisos o stems disponibles y la dirección que buscas.",
    dmcaNote: "Retirada por derechos de autor. Se requieren datos identificables, presentados bajo pena de perjurio — las reclamaciones falsas pueden tener consecuencias legales.",
    legalName: "Nombre legal completo",
    legalNamePh: "Tu nombre legal completo",
    rights: "Titular de derechos al que representas (opcional)",
    rightsPh: "Empresa o artista, si no eres tú",
    infringing: "Dónde retirarlo (URLs / plataformas)",
    infringingPh: "Pega los enlaces / plataformas exactos que alojan el contenido",
    original: "Tu obra original (enlace o prueba de propiedad)",
    originalPh: "Enlace al original, o describe tu propiedad",
    dmcaDecl: "Declaro de buena fe que este uso no está autorizado, que la información anterior es exacta y que soy el propietario o estoy autorizado para actuar en su nombre.",
    dmcaMsg: "Declaración / detalles adicionales",
    dmcaMsgPh: "Cualquier otra cosa relevante para la retirada",
    gdprNote: "Solicitud de datos. Se requieren datos identificables para verificar la solicitud y evitar abusos.",
    gdprType: "Tipo de solicitud",
    gdprTypes: ["Acceder a mis datos", "Supresión / borrado", "Rectificación", "Portabilidad de datos", "Limitación", "Oposición"],
    country: "País de residencia (opcional)",
    countryPh: "p.ej. España",
    gdprDetails: "Detalles de tu solicitud",
    gdprDetailsPh: "Describe lo que solicitas",
    gdprConfirm: "Confirmo que la información anterior es exacta y se refiere a mí, o a alguien a quien estoy autorizado a representar.",
    securityNote: "Protegido por Cloudflare Turnstile. BladesBeats no consulta ni muestra tu dirección IP mediante un servicio del navegador; Cloudflare puede tratar datos técnicos para la seguridad.",
    privacyLink: "Política de privacidad"
  } : {
    title: "A few helpful details",
    detail: "For event inquiries, the date, city, venue, set length, and budget help me give you a useful answer. If some details are still taking shape, that’s completely fine.",
    languages: "Languages",
    base: "Base",
    baseValue: "Sevilla, Spain",
    name: "Name",
    namePh: "Your name",
    email: "Email",
    date: "Event date",
    type: "What brings you here?",
    message: "Message",
    messagePh: "A little context about your event or idea",
    send: "Send message",
    sending: "Sending...",
    success: "Thanks—your message is on its way. I’ll reply as soon as I can.",
    mailto: "Your email app will open with the message ready, so you can review it before sending.",
    error: "That message did not go through. You’re welcome to try again or reach me on Instagram.",
    captcha: "A quick verification is needed before the message can be sent.",
    booking: "DJ booking",
    mixing: "Mixing & mastering",
    courses: "DJ lessons",
    collab: "Collaboration",
    dmca: "DMCA takedown",
    gdpr: "GDPR request",
    other: "Other",
    city: "City / venue",
    cityPh: "City and venue, if confirmed",
    eventType: "Event type",
    eventTypes: ["Club night", "Festival", "Private event", "Corporate / brand event", "Bar / lounge", "Other"],
    setLength: "Set length",
    setLengthPh: "For example, 2 hours",
    startTime: "Start time",
    audience: "Expected audience",
    audiencePh: "For example, 300",
    budget: "Budget (optional)",
    budgetPh: "Approximate range",
    artist: "Your artist / project name",
    artistPh: "How you release music",
    mmLabel: "Baster Beats / Sevilla",
    mmNote: "Baster Beats in Sevilla handles mixing, mastering, and studio engineering.",
    mmLink: "Baster Beats website",
    dcLabel: "Impulsa Music Center / Sevilla",
    dcNote: "Impulsa Music Center in Sevilla handles DJ lessons.",
    dcLink: "Impulsa Music Center website",
    mmMessagePh: "Baster Beats is the right contact for studio work. This space is useful when BladesBeats is also involved.",
    dcMessagePh: "Impulsa is the right contact for DJ lessons. This space is useful when BladesBeats is also involved.",
    prodService: "What do you need?",
    prodServices: ["Studio services with Baster Beats", "Production collaboration with BladesBeats", "Remix idea for BladesBeats", "Production question / direction", "Other"],
    prodStage: "Project stage",
    prodStages: ["Idea / rough demo", "Demo recorded", "Stems ready", "Ready for mix", "Preparing release"],
    collabType: "Collaboration type",
    collabTypes: ["Original track", "Remix", "Co-production", "Studio session", "Other"],
    link: "Link to your music",
    linkPh: "Spotify, Mixcloud, YouTube, etc.",
    genre: "Genre / vibe",
    genrePh: "The sound or direction you have in mind",
    remixTrack: "Track you want to remix",
    remixTrackPh: "Title of the track",
    remixArtist: "Original artist",
    remixArtistPh: "Who released it",
    remixStyle: "Your remix style",
    remixStylePh: "e.g. afro house, tech house",
    deadline: "Target date (optional)",
    prodMessagePh: "A little about what you need, what already exists, and where you hope to take the track.",
    collabMessagePh: "A little about the idea, who is involved, and the kind of collaboration you have in mind.",
    remixMessagePh: "A little about the track, the permissions or stems available, and the direction you have in mind.",
    dmcaNote: "Copyright takedown. Identifiable details are required and submitted under penalty of perjury — false claims may carry legal consequences.",
    legalName: "Full legal name",
    legalNamePh: "Your full legal name",
    rights: "Rights holder you represent (optional)",
    rightsPh: "Company or artist, if not yourself",
    infringing: "Where to take it down (URLs / platforms)",
    infringingPh: "Paste the exact links / platforms hosting the content",
    original: "Your original work (link or proof of ownership)",
    originalPh: "Link to the original, or describe your ownership",
    dmcaDecl: "I have a good-faith belief this use is not authorized, the information above is accurate, and I am the owner or authorized to act on the owner's behalf.",
    dmcaMsg: "Statement / additional details",
    dmcaMsgPh: "Anything else relevant to the takedown",
    gdprNote: "Data request. Identifiable details are required so the request can be verified and not misused.",
    gdprType: "Request type",
    gdprTypes: ["Access my data", "Erasure / deletion", "Rectification", "Data portability", "Restriction", "Objection"],
    country: "Country of residence (optional)",
    countryPh: "e.g. Spain",
    gdprDetails: "Details of your request",
    gdprDetailsPh: "Describe what you are requesting",
    gdprConfirm: "I confirm the information above is accurate and relates to me, or to someone I am authorized to represent.",
    securityNote: "Protected by Cloudflare Turnstile. BladesBeats does not look up or display your IP address through a browser service; Cloudflare may process technical data for security.",
    privacyLink: "Privacy policy"
  };
  const options = (items) => items.map((item) => `<option>${escapeHtml(item)}</option>`).join("");
  return `<div class="bb-contact-grid">
  <aside class="contact-panel">
    <div>
      <h2>${escapeHtml(t.title)}</h2>
      <p>${escapeHtml(t.detail)}</p>
    </div>
    <a class="contact-line" href="https://www.instagram.com/blades_beats/" target="_blank" rel="noopener noreferrer"><span>Instagram</span><span class="contact-value">@blades_beats</span></a>
    <div class="form-split">
      <div class="contact-line"><span>${escapeHtml(t.languages)}</span><span class="contact-value">EN / ES</span></div>
      <div class="contact-line"><span>${escapeHtml(t.base)}</span><span class="contact-value">${escapeHtml(t.baseValue)}</span></div>
    </div>
  </aside>
  <form class="contact-form" data-contact-form data-type-label="${escapeAttr(t.type)}" data-default-type="${escapeAttr(t.booking)}" data-form-send="${escapeAttr(t.send)}" data-form-sending="${escapeAttr(t.sending)}" data-form-success="${escapeAttr(t.success)}" data-form-mailto="${escapeAttr(t.mailto)}" data-form-error="${escapeAttr(t.error)}" data-captcha-required="${escapeAttr(t.captcha)}" data-label-default="${escapeAttr(t.message)}" data-message-default="${escapeAttr(t.messagePh)}" data-message-mixing="${escapeAttr(t.mmMessagePh)}" data-message-courses="${escapeAttr(t.dcMessagePh)}" data-message-collaboration="${escapeAttr(t.collabMessagePh)}" data-message-dmca="${escapeAttr(t.dmcaMsgPh)}" data-message-gdpr="${escapeAttr(t.gdprDetailsPh)}" data-label-dmca="${escapeAttr(t.dmcaMsg)}" data-label-gdpr="${escapeAttr(t.gdprDetails)}">
    <label class="form-field"><span>${escapeHtml(t.name)}</span><input class="bb-input" name="name" type="text" required autocomplete="name" placeholder="${escapeAttr(t.namePh)}"></label>
    <label class="form-field"><span>${escapeHtml(t.email)}</span><input class="bb-input" name="email" type="email" required autocomplete="email" placeholder="you@email.com"></label>
    <label class="form-field contact-type-field"><span>${escapeHtml(t.type)}</span><select class="bb-input" name="request_type" data-contact-type><option value="booking">${escapeHtml(t.booking)}</option><option value="collaboration">${escapeHtml(t.collab)}</option><option value="mixing">${escapeHtml(t.mixing)}</option><option value="courses">${escapeHtml(t.courses)}</option><option value="dmca">${escapeHtml(t.dmca)}</option><option value="gdpr">${escapeHtml(t.gdpr)}</option><option value="other">${escapeHtml(t.other)}</option></select></label>
    <div class="contact-form-group" data-contact-group="booking">
      <label class="form-field"><span>${escapeHtml(t.date)}</span><input class="bb-input" name="event_date" type="date"></label>
      <label class="form-field"><span>${escapeHtml(t.city)}</span><input class="bb-input" name="city_venue" type="text" placeholder="${escapeAttr(t.cityPh)}"></label>
      <label class="form-field"><span>${escapeHtml(t.eventType)}</span><select class="bb-input" name="event_type">${options(t.eventTypes)}</select></label>
      <div class="form-split"><label class="form-field"><span>${escapeHtml(t.setLength)}</span><input class="bb-input" name="set_length" type="text" placeholder="${escapeAttr(t.setLengthPh)}"></label><label class="form-field"><span>${escapeHtml(t.startTime)}</span><input class="bb-input" name="start_time" type="time"></label></div>
      <div class="form-split"><label class="form-field"><span>${escapeHtml(t.audience)}</span><input class="bb-input" name="audience_size" type="text" placeholder="${escapeAttr(t.audiencePh)}"></label><label class="form-field"><span>${escapeHtml(t.budget)}</span><input class="bb-input" name="budget" type="text" placeholder="${escapeAttr(t.budgetPh)}"></label></div>
    </div>
    <div class="contact-form-group handoff-card" data-contact-group="mixing" hidden><span class="handoff-label">${escapeHtml(t.mmLabel)}</span><p>${escapeHtml(t.mmNote)}</p><a class="button" href="https://basterbeats.com/" target="_blank" rel="noopener noreferrer">${escapeHtml(t.mmLink)}</a></div>
    <div class="contact-form-group handoff-card" data-contact-group="courses" hidden><span class="handoff-label">${escapeHtml(t.dcLabel)}</span><p>${escapeHtml(t.dcNote)}</p><a class="button" href="https://impulsamusiccenter.es/" target="_blank" rel="noopener noreferrer">${escapeHtml(t.dcLink)}</a></div>
    <div class="contact-form-group" data-contact-group="collaboration" hidden><label class="form-field"><span>${escapeHtml(t.artist)}</span><input class="bb-input" name="artist_name" type="text" placeholder="${escapeAttr(t.artistPh)}"></label><label class="form-field"><span>${escapeHtml(t.collabType)}</span><select class="bb-input" name="collab_type">${options(t.collabTypes)}</select></label><label class="form-field"><span>${escapeHtml(t.link)}</span><input class="bb-input" name="music_link" type="url" placeholder="${escapeAttr(t.linkPh)}"></label><label class="form-field"><span>${escapeHtml(t.genre)}</span><input class="bb-input" name="collab_genre" type="text" placeholder="${escapeAttr(t.genrePh)}"></label></div>
    <div class="contact-form-group" data-contact-group="dmca" hidden><p class="form-alert">${escapeHtml(t.dmcaNote)}</p><label class="form-field"><span>${escapeHtml(t.legalName)}</span><input class="bb-input" name="legal_name" type="text" placeholder="${escapeAttr(t.legalNamePh)}"></label><label class="form-field"><span>${escapeHtml(t.rights)}</span><input class="bb-input" name="rights_holder" type="text" placeholder="${escapeAttr(t.rightsPh)}"></label><label class="form-field"><span>${escapeHtml(t.infringing)}</span><textarea class="bb-input" name="infringing_urls" rows="3" placeholder="${escapeAttr(t.infringingPh)}"></textarea></label><label class="form-field"><span>${escapeHtml(t.original)}</span><textarea class="bb-input" name="original_work" rows="2" placeholder="${escapeAttr(t.originalPh)}"></textarea></label><label class="form-check"><input type="checkbox" name="dmca_declaration" value="confirmed"><span>${escapeHtml(t.dmcaDecl)}</span></label></div>
    <div class="contact-form-group" data-contact-group="gdpr" hidden><p class="form-alert">${escapeHtml(t.gdprNote)}</p><label class="form-field"><span>${escapeHtml(t.legalName)}</span><input class="bb-input" name="legal_name" type="text" placeholder="${escapeAttr(t.legalNamePh)}"></label><label class="form-field"><span>${escapeHtml(t.gdprType)}</span><select class="bb-input" name="gdpr_request">${options(t.gdprTypes)}</select></label><label class="form-field"><span>${escapeHtml(t.country)}</span><input class="bb-input" name="country" type="text" placeholder="${escapeAttr(t.countryPh)}"></label><label class="form-check"><input type="checkbox" name="gdpr_identity" value="confirmed"><span>${escapeHtml(t.gdprConfirm)}</span></label></div>
    <label class="form-field"><span data-contact-message-label>${escapeHtml(t.message)}</span><textarea class="bb-input" name="message" rows="5" required placeholder="${escapeAttr(t.messagePh)}"></textarea></label>
    <div class="form-meta"><small>${escapeHtml(t.securityNote)}</small><a href="${isEs ? "/politica-privacidad/" : "/privacy-policy/"}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.privacyLink)}</a></div>
    <div id="bb-turnstile" class="turnstile-slot"></div>
    <button class="contact-submit" type="submit" data-contact-submit>${escapeHtml(t.send)}</button>
    <p class="form-status" data-contact-status aria-live="polite"></p>
  </form>
</div>`;
}

function buildBookingPage(lang = "en") {
  const isEs = lang === "es";
  const canonical = isEs ? PAGE_ALTERNATES.booking.es : PAGE_ALTERNATES.booking.en;
  const description = isEs
    ? "Contacto con BladesBeats para bolos, festivales, eventos privados y colaboraciones, con atención en español e inglés."
    : "Contact BladesBeats about club nights, festivals, private events, and collaborations, in English or Spanish.";
  return basePage({
    title: isEs ? "Contacto con BladesBeats | DJ en Sevilla" : "Contact BladesBeats | DJ in Sevilla",
    description,
    canonical,
    label: isEs ? "Contacto" : "Contact",
    h1: isEs ? "Hablemos" : "Let’s connect",
    intro: isEs
      ? "Para contrataciones, colaboraciones o cualquier pregunta sobre la música, puedes escribir en español o en inglés."
      : "For bookings, collaborations, or a question about the music, you’re welcome to get in touch in English or Spanish.",
    activeNav: "booking",
    lang,
    alternates: PAGE_ALTERNATES.booking,
    jsonLd: artistSchema(canonical, description),
    body: contactBodyDesign(lang)
  });
}

function buildAboutPage(lang = "en") {
  const isEs = lang === "es";
  const canonical = isEs ? PAGE_ALTERNATES.about.es : PAGE_ALTERNATES.about.en;
  const description = isEs
    ? "Historia de BladesBeats: DJ y productor con raíces en Oslo y base actual en Sevilla."
    : "About BladesBeats: Norwegian-born DJ and producer with Oslo roots and a current base in Sevilla.";
  const body = `<div class="story-layout">
  <article class="story-copy">
    <p>${isEs
      ? "BladesBeats es un DJ y productor noruego basado en Sevilla, España."
      : "BladesBeats is a Norwegian DJ and producer based in Sevilla, Spain."}</p>
    <p>${isEs
      ? "La música empezó en Oslo a principios de la década de 2010, a través de espacios juveniles y comunitarios alrededor de Holmlia. BUSH y Café Condio le dieron acceso temprano a equipo de estudio, gente haciendo música y la primera oportunidad real de producir. Sin esos espacios, probablemente el proyecto no existiría."
      : "The music started in Oslo in the early 2010s, through youth and community spaces around Holmlia. BUSH and Café Condio gave him early access to studio equipment, music people, and the first real chance to produce. Without those rooms, the project probably would not exist."}</p>
    <p>${isEs
      ? "Después de mudarse a Sevilla en 2017, la música desapareció de su vida durante varios años. Volvió más tarde casi por accidente, primero con beatmaking y sesiones con vocalistas, y después con un movimiento más claro hacia la música electrónica."
      : "After moving to Sevilla in 2017, music disappeared from his life for several years. It came back later almost by accident, first through beatmaking and vocal sessions, then through a stronger move into electronic music."}</p>
    <p>${isEs
      ? "Ese cambio llevó al trabajo de producción con <a href=\"https://basterbeats.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Manuel Ávila / Baster Beats</a> en Sevilla, desarrollando temas originales y remixes mediante trabajo regular de estudio."
      : "That shift led to production work with <a href=\"https://basterbeats.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Manuel Ávila / Baster Beats</a> in Sevilla, developing original tracks and remixes through regular studio work."}</p>
    <p>${isEs
      ? "La parte DJ llegó después, con formación junto a <a href=\"https://impulsamusiccenter.es/quini-rivera/\" target=\"_blank\" rel=\"noopener noreferrer\">Quini Rivera</a> en Impulsa Music Center en 2025, conectando producción, técnica, transiciones y energía de sala."
      : "The DJ side came later, with training from <a href=\"https://impulsamusiccenter.es/quini-rivera/\" target=\"_blank\" rel=\"noopener noreferrer\">Quini Rivera</a> at Impulsa Music Center in 2025, connecting production, technique, transitions, and room energy."}</p>
    <p>${isEs
      ? "Hoy BladesBeats trabaja entre producción de estudio, sesiones DJ y bolos, con un sonido enfocado al club construido alrededor de energía, movimiento y la sala."
      : "Today BladesBeats works across studio production, DJ sets, and live gigs, with a club-focused electronic sound built around energy, movement, and the room."}</p>
    <p>${isEs
      ? "Raíces noruegas, base en Sevilla, inglés y español. Para contratación o contacto directo, Instagram es la vía principal."
      : "Norwegian roots, Sevilla base, English and Spanish. For booking or direct contact, Instagram is the main route."}</p>
  </article>
  <aside class="story-side">
    <figure class="artist-photo-card">
      <img src="/bladesbeats.webp" alt="${isEs ? "BladesBeats, DJ y productor basado en Sevilla" : "BladesBeats, DJ and producer based in Sevilla"}" width="1200" height="800" loading="lazy" decoding="async">
      <figcaption>BladesBeats · Sevilla</figcaption>
    </figure>
    <div class="timeline">
      <div class="timeline-item"><b>${isEs ? "Origen" : "Origin"}</b><div><h3>Oslo</h3><p>${isEs ? "Originario de Oslo, Noruega, donde empezó a experimentar con producción musical a principios de la década de 2010." : "Originally from Oslo, Norway, where he began experimenting with music production in the early 2010s."}</p></div></div>
      <div class="timeline-item"><b>2017</b><div><h3>Sevilla</h3><p>${isEs ? "Se mudó a Sevilla, España, donde la música siguió con él y más tarde tomó una dirección más fuerte." : "Moved to Sevilla, Spain, where the music stayed with him and later developed into a stronger direction."}</p></div></div>
      <div class="timeline-item"><b>2023</b><div><h3>${isEs ? "Enfoque de producción" : "Production focus"}</h3><p>${isEs ? "El perfil artístico de BladesBeats se volvió más enfocado a través del trabajo de producción con Manuel Ávila / Baster Beats." : "The BladesBeats artist profile became more focused through production work with Manuel Ávila / Baster Beats."}</p></div></div>
      <div class="timeline-item"><b>2025</b><div><h3>Impulsa</h3><p>${isEs ? "La formación DJ con Quini Rivera en Impulsa Music Center conectó la parte de producción y la parte DJ del perfil." : "DJ training with Quini Rivera at Impulsa Music Center connected the production and DJ sides of the profile."}</p></div></div>
    </div>
    <div class="side-project">
      <span>${isEs ? "Catálogo oficial" : "Official catalog"}</span>
      <strong>${isEs ? "Música de BladesBeats" : "BladesBeats music"}</strong>
      <p>${isEs ? "Lanzamientos, remixes y sesiones oficiales." : "Official releases, remixes, and DJ sets."}</p>
      <a href="${isEs ? "/es/musica/" : "/music/"}">${isEs ? "Catálogo musical" : "Music catalog"}</a>
    </div>
  </aside>
</div>`;
  return basePage({
    title: isEs ? "Sobre BladesBeats | DJ y productor en Sevilla" : "About BladesBeats | DJ and Producer in Sevilla",
    description,
    canonical,
    label: isEs ? "Sobre mí" : "About",
    h1: isEs ? "Sobre BladesBeats" : "About BladesBeats",
    intro: isEs ? "Raíces en Oslo, base en Sevilla y una dirección electrónica orientada al club." : "Oslo roots, Sevilla base, and an electronic club-focused direction.",
    activeNav: "about",
    lang,
    alternates: PAGE_ALTERNATES.about,
    jsonLd: artistSchema(canonical, description),
    body
  });
}

function buildAboutPageDesign(lang = "en") {
  const isEs = lang === "es";
  const canonical = isEs ? PAGE_ALTERNATES.about.es : PAGE_ALTERNATES.about.en;
  const description = isEs
    ? "La historia de BladesBeats, DJ y productor noruego afincado en Sevilla, desde los espacios musicales comunitarios de Oslo hasta su trabajo actual."
    : "The BladesBeats story, from community music spaces in Oslo to the studios and DJ booths that shape the project in Sevilla today.";
  const bio = isEs ? {
    label: "Sobre mí",
    h1: "Sobre BladesBeats",
    intro: "Una historia musical que empezó en Oslo y encontró su siguiente capítulo en Sevilla.",
    title: "Detrás de BladesBeats",
    base: "Sevilla, España",
    factOrigin: "Origen",
    factBase: "Base actual",
    factLang: "Idiomas",
    lead: "BladesBeats es un DJ y productor noruego afincado en Sevilla, con música electrónica pensada para la noche, el movimiento y la gente que comparte la pista.",
    p2: "El primer capítulo comenzó en Holmlia, Oslo, a principios de la década de 2010. Espacios juveniles y comunitarios como BUSH y Café Condio ofrecieron acceso a estudios, un entorno creativo y la primera oportunidad real de convertir la curiosidad en música.",
    p3: "Tras mudarse a Sevilla en 2017, el proyecto quedó en silencio durante unos años. El beatmaking y las sesiones con vocalistas devolvieron la chispa, seguidos por una inmersión más profunda en la música electrónica.",
    p4: "El trabajo regular de estudio con <a href=\"https://basterbeats.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Manuel Ávila / Baster Beats</a> dio espacio a esa nueva dirección a través de temas originales y remixes.",
    p5: "En 2025, la formación DJ con <a href=\"https://impulsamusiccenter.es/quini-rivera/\" target=\"_blank\" rel=\"noopener noreferrer\">Quini Rivera</a> en Impulsa Music Center acercó el estudio y la cabina: técnica, transiciones y una relación más cercana con la sala.",
    p6: "Hoy, BladesBeats reúne esos hilos en lanzamientos originales, remixes, sesiones DJ y actuaciones: música construida alrededor de la energía, el movimiento y la conexión.",
    p7: "Con base en Sevilla y disponible en español e inglés, BladesBeats recibe con gusto mensajes sobre bolos y colaboraciones a través de la <a href=\"/es/contratar-dj-sevilla/\">página de contacto</a>.",
    timeline: [
      ["Origen", "Oslo", "Las primeras ideas tomaron forma en los espacios musicales juveniles y comunitarios de Holmlia."],
      ["2017", "Sevilla", "El traslado a Sevilla abrió un nuevo capítulo y, con el tiempo, el camino de vuelta a la música."],
      ["2023", "Producción", "El trabajo con Manuel Ávila / Baster Beats dio una dirección más clara a los temas originales y los remixes."],
      ["2025", "Cabina", "La formación con Quini Rivera conectó la producción con la técnica DJ y la energía de una sala en directo."]
    ],
    sideLabel: "Música",
    sideTitle: "El catálogo de BladesBeats",
    sideCopy: "Lanzamientos originales, remixes, instrumentales y sesiones DJ completas, reunidos en un solo lugar.",
    sideLink: "Catálogo musical",
    sideHref: "/es/musica/"
  } : {
    label: "About",
    h1: "About BladesBeats",
    intro: "A music story that began in Oslo and found its next chapter in Sevilla.",
    title: "Behind BladesBeats",
    base: "Sevilla, Spain",
    factOrigin: "Origin",
    factBase: "Current base",
    factLang: "Languages",
    lead: "BladesBeats is a Norwegian DJ and producer based in Sevilla, making electronic music for late nights, moving rooms, and the people in them.",
    p2: "The first chapter began in Holmlia, Oslo, in the early 2010s. Youth and community spaces including BUSH and Café Condio offered studio access, a creative circle, and the first real chance to turn curiosity into music.",
    p3: "After moving to Sevilla in 2017, the project went quiet for a few years. Beatmaking and sessions with vocalists brought the spark back, followed by a deeper move into electronic music.",
    p4: "Regular studio work with <a href=\"https://basterbeats.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Manuel Ávila / Baster Beats</a> gave that new direction room to grow through original tracks and remixes.",
    p5: "In 2025, DJ training with <a href=\"https://impulsamusiccenter.es/quini-rivera/\" target=\"_blank\" rel=\"noopener noreferrer\">Quini Rivera</a> at Impulsa Music Center brought the studio and booth closer together: technique, transitions, and a stronger feel for the room.",
    p6: "Today, BladesBeats brings those threads together across original releases, remixes, DJ sets, and live appearances—music built around energy, movement, and connection.",
    p7: "Based in Sevilla and comfortable in English or Spanish, BladesBeats welcomes messages about gigs and collaborations through the <a href=\"/booking/\">contact page</a>.",
    timeline: [
      ["Origin", "Oslo", "The first ideas took shape in Holmlia’s youth and community music spaces."],
      ["2017", "Sevilla", "A move to Sevilla began a new chapter and, in time, a path back to music."],
      ["2023", "Production", "Work with Manuel Ávila / Baster Beats brought a clearer focus to original tracks and remixes."],
      ["2025", "DJ booth", "Training with Quini Rivera connected production with DJ technique and the feel of a live room."]
    ],
    sideLabel: "Music",
    sideTitle: "The BladesBeats catalog",
    sideCopy: "Original releases, remixes, instrumentals, and full DJ sets, all in one place.",
    sideLink: "Music catalog",
    sideHref: "/music/"
  };
  const timeline = bio.timeline.map(([year, place, note]) => `<article class="timeline-item"><b>${escapeHtml(year)}</b><div><h2>${escapeHtml(place)}</h2><p>${escapeHtml(note)}</p></div></article>`).join("\n");
  const body = `<div class="story-layout">
  <div class="story-feature">
    <figure class="artist-photo-card">
      <img src="/bladesbeats.webp" alt="${isEs ? "BladesBeats, DJ y productor basado en Sevilla" : "BladesBeats, DJ and producer based in Sevilla"}" width="1200" height="800" loading="lazy" decoding="async">
      <figcaption>BladesBeats · Sevilla</figcaption>
    </figure>
    <article class="story-copy">
      <p class="story-intro">${escapeHtml(bio.lead)}</p>
      <div class="story-facts" aria-label="${isEs ? "Datos del artista" : "Artist facts"}">
        <div class="story-fact"><span>${escapeHtml(bio.factOrigin)}</span><strong>${isEs ? "Oslo, Noruega" : "Oslo, Norway"}</strong></div>
        <div class="story-fact"><span>${escapeHtml(bio.factBase)}</span><strong>${escapeHtml(bio.base)}</strong></div>
        <div class="story-fact"><span>${escapeHtml(bio.factLang)}</span><strong>${isEs ? "Inglés / Español" : "English / Spanish"}</strong></div>
      </div>
      <div class="story-flow">
        <p>${escapeHtml(bio.p2)}</p>
        <p>${escapeHtml(bio.p3)}</p>
        <p>${bio.p4}</p>
        <p>${bio.p5}</p>
        <p>${escapeHtml(bio.p6)}</p>
        <p>${bio.p7}</p>
      </div>
    </article>
  </div>
  <div class="story-side">
    <div class="timeline">${timeline}</div>
    <div class="side-project">
      <span>${escapeHtml(bio.sideLabel)}</span>
      <strong>${escapeHtml(bio.sideTitle)}</strong>
      <p>${escapeHtml(bio.sideCopy)}</p>
      <a href="${escapeAttr(bio.sideHref)}">${escapeHtml(bio.sideLink)}</a>
    </div>
  </div>
</div>`;
  return basePage({
    title: isEs ? "Sobre BladesBeats | DJ y productor en Sevilla" : "About BladesBeats | DJ and producer in Sevilla",
    description,
    canonical,
    label: bio.label,
    h1: bio.h1,
    intro: bio.intro,
    activeNav: "about",
    lang,
    alternates: PAGE_ALTERNATES.about,
    jsonLd: artistSchema(canonical, description),
    body
  });
}

function appearanceCard(lang = "en", href = "/#appearances") {
  const isEs = lang === "es";
  return `<div class="appearances-grid">
  <a class="appearance-card" href="${escapeAttr(href)}">
    <div class="appearance-mark"><img class="appearance-logo" src="/gigs/expoestepona/expotattoo-estepona-logo-wide.jpg" alt="${isEs ? "Logotipo de ExpoTattoo Estepona 2026 para la actuación de BladesBeats" : "ExpoTattoo Estepona 2026 logo for the BladesBeats appearance"}" width="1427" height="975" loading="lazy" decoding="async"></div>
    <div>
       <span class="appearance-label">${isEs ? "Actuación anterior" : "Past appearance"}</span>
      <span class="appearance-title">ExpoTattoo Estepona</span>
      <p class="appearance-meta">2026</p>
      <p class="appearance-summary">${isEs ? "Aparición DJ en Estepona, Andalucía." : "DJ appearance in Estepona, Andalucía."}</p>
       <span class="appearance-link">${isEs ? "Detalles del evento" : "Event details"}</span>
    </div>
  </a>
</div>`;
}

function gigSummary(gig, isEs = false) {
  return isEs ? (gig.summaryEs || gig.summary || "") : (gig.summary || "");
}

function buildGigsIndexPage(gigs, lang = "en") {
  const isEs = lang === "es";
  const canonical = isEs ? PAGE_ALTERNATES.gigs.es : PAGE_ALTERNATES.gigs.en;
  const description = isEs
    ? "Actuaciones anteriores de BladesBeats e información de contacto para clubes, festivales, eventos privados y colaboraciones."
    : "Past BladesBeats appearances and contact details for club nights, festivals, private events, and collaborations.";
  const cards = gigs.map((gig, index) => {
    const href = gigDetailPath(gig.slug, lang);
    return `<a class="appearance-card${index === 0 ? " featured" : ""}" href="${escapeAttr(href)}">
    <div class="appearance-mark"><img class="appearance-logo" src="${escapeAttr(gig.logoImage || "/og-card.png")}" alt="${escapeAttr(isEs ? `Logotipo de ${gig.title}` : `${gig.title} logo`)}" width="1427" height="975" loading="lazy" decoding="async"></div>
    <div class="appearance-body">
      <span class="appearance-label">${isEs ? "Actuación" : "Appearance"}</span>
      <span class="appearance-title">${escapeHtml(gig.title)}</span>
      <p class="appearance-meta">${escapeHtml(String(gig.year || gig.startDate?.slice(0, 4) || ""))}${gig.city ? ` · ${escapeHtml(gig.city)}` : ""}</p>
      <p class="appearance-summary">${escapeHtml(gigSummary(gig, isEs))}</p>
      <span class="appearance-link">${isEs ? "Detalles del evento" : "Event details"}</span>
    </div>
  </a>`;
  });
  const featured = cards[0] || "";
  const remaining = cards.slice(1).join("\n");
  const bookingPanel = `<aside class="gigs-booking-panel">
    <span>${isEs ? "Contratación DJ" : "DJ bookings"}</span>
    <h2>${isEs ? "¿Hay un lugar para BladesBeats en tu evento?" : "Could BladesBeats fit your next event?"}</h2>
    <p>${isEs ? "BladesBeats está disponible para noches de club, festivales, eventos privados y otros espacios donde la música encaje." : "BladesBeats is available for club nights, festivals, private events, and other spaces that suit the music."}</p>
    <a class="button primary" href="${isEs ? "/es/contratar-dj-sevilla/" : "/booking/"}">${isEs ? "Contratación y disponibilidad" : "Bookings and availability"}</a>
  </aside>`;
  return basePage({
    title: isEs ? "Actuaciones y contratación | BladesBeats" : "Live appearances and bookings | BladesBeats",
    description,
    canonical,
    label: isEs ? "Bolos" : "Gigs",
    h1: isEs ? "Actuaciones en directo" : "Live appearances",
    intro: isEs ? "Un archivo en crecimiento de bolos y apariciones de BladesBeats, con la historia y los datos de cada evento." : "A growing record of BladesBeats gigs and appearances, with the story and details behind each event.",
    activeNav: "gigs",
    lang,
    alternates: PAGE_ALTERNATES.gigs,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": isEs ? "Bolos anteriores de BladesBeats" : "BladesBeats past appearances",
      "itemListElement": gigs.map((gig, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "item": gigSchema(gig, gigDetailUrl(gig.slug, lang), lang)
      }))
    },
    body: `${featured ? `<section class="gigs-showcase">${featured}${bookingPanel}</section>` : bookingPanel}
${remaining ? `<section class="appearances-grid">${remaining}</section>` : ""}`
  });
}

function buildGigDetailPage(gig, lang = "en") {
  const isEs = lang === "es";
  const detailUrl = gigDetailUrl(gig.slug, lang);
  const description = compactMetaDescription(isEs
    ? `${gig.title} ${gig.year || ""}: actuación de BladesBeats en ${gig.city || "España"}, con fechas, lugar, colaboradores y contexto del evento.`
    : `${gig.title} ${gig.year || ""}: a BladesBeats appearance in ${gig.city || "Spain"}, with dates, venue, partners, and event context.`);
  const partnerLinks = Array.isArray(gig.partners)
    ? gig.partners.map((partner) => `<li><a href="${escapeAttr(partner.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(partner.name)}</a></li>`).join("")
    : "";
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb">
  <ol>
    <li><a href="/">BladesBeats</a></li>
    <li><a href="${isEs ? "/es/eventos/" : "/gigs/"}">${isEs ? "Bolos" : "Gigs"}</a></li>
    <li aria-current="page">${escapeHtml(gig.title)}</li>
  </ol>
</nav>
<article class="release-detail">
  <div class="release-detail-cover">
    <img src="${escapeAttr(gig.logoImage || "/og-card.png")}" alt="${escapeAttr(isEs ? `Logotipo de ${gig.title}` : `${gig.title} logo`)}" width="800" height="548" loading="eager" decoding="async">
  </div>
  <div class="release-detail-body">
    <dl class="gig-facts">
      <div><dt>${isEs ? "Fechas" : "Dates"}</dt><dd>${escapeHtml(gig.startDate || "")}${gig.endDate ? ` ${isEs ? "a" : "to"} ${escapeHtml(gig.endDate)}` : ""}</dd></div>
      <div><dt>${isEs ? "Lugar" : "Venue"}</dt><dd>${escapeHtml(gig.venueName || "")}</dd></div>
      <div><dt>${isEs ? "Ciudad" : "City"}</dt><dd>${escapeHtml(gig.city || "")}</dd></div>
      <div><dt>${isEs ? "País" : "Country"}</dt><dd>${escapeHtml(gig.country || "")}</dd></div>
    </dl>
    <p class="release-detail-text">${escapeHtml(isEs ? (gig.bodyEs || gig.summaryEs || gig.body || gig.summary || "") : (gig.body || gig.summary || ""))}</p>
    ${gig.cause ? `<p class="release-detail-meta gig-cause">${escapeHtml(isEs ? (gig.causeEs || gig.cause) : gig.cause)}</p>` : ""}
    ${partnerLinks ? `<ul class="release-card-platforms">${partnerLinks}</ul>` : ""}
    <div class="release-detail-platforms"><a href="${isEs ? "/es/contratar-dj-sevilla/" : "/booking/"}">${isEs ? "Contratación y disponibilidad" : "Bookings and availability"} <span aria-hidden="true">&rarr;</span></a></div>
    <p><a class="back-link" href="${isEs ? "/es/eventos/" : "/gigs/"}">&larr; ${isEs ? "Actuaciones en directo" : "Live appearances"}</a></p>
  </div>
</article>`;
  return basePage({
    title: compactReleasePageTitle(`${gig.title} ${gig.year || ""} — ${isEs ? "actuación" : "appearance"}`.trim()),
    description,
    canonical: detailUrl,
    label: isEs ? "Bolos" : "Gigs",
    h1: `${gig.title} ${gig.year || ""}`.trim(),
    intro: isEs ? (gig.summaryEs || gig.summary || "Bolo anterior de BladesBeats.") : (gig.summary || "Past BladesBeats appearance."),
    activeNav: "gigs",
    lang,
    alternates: { en: gigDetailUrl(gig.slug, "en"), es: gigDetailUrl(gig.slug, "es") },
    jsonLd: gigSchema(gig, detailUrl, lang),
    body
  });
}

function replaceDataI18nText(html, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const elementPattern = new RegExp(`(<([a-z0-9-]+)(?=[^>]*\\sdata-i18n="${escapedKey}")[^>]*>)([\\s\\S]*?)(<\\/\\2>)`, "gi");
  return html.replace(elementPattern, (match, open, tag, oldValue, close) => `${open}${value}${close}`);
}

const SPANISH_HOMEPAGE_COPY = {
  skip_to_content: "Saltar al contenido",
  nav_releases: "Música",
  nav_sets: "Sesiones",
  nav_appearances: "Bolos",
  nav_story: "Sobre mí",
  nav_booking: "Contacto",
  home_hero_eyebrow: "Raíces en Oslo &middot; Base en Sevilla &middot; <b>Desde 2017</b>",
  home_hero_subtitle: "Música electrónica nacida entre las raíces de Oslo, las noches de Sevilla y la energía compartida de una pista de baile.",
  home_hero_cta: "Último lanzamiento &nearr;",
  home_feature_label: "Último lanzamiento",
  home_feature_action: "Detalles del lanzamiento &nearr;",
  home_latest_label: "Novedades de BladesBeats",
  home_latest_release: "Último lanzamiento",
  home_latest_set: "Última sesión",
  catalog_count_release_one: "lanzamiento",
  catalog_count_release_many: "lanzamientos",
  catalog_count_set_one: "sesión",
  catalog_count_set_many: "sesiones",
  catalog_count_gig_one: "bolo",
  catalog_count_gig_many: "bolos",
  catalog_card_release_kind: "Lanzamiento",
  catalog_card_release_page: "Página del lanzamiento",
  catalog_fallback: "Una línea temporal interactiva de las entradas del catálogo de BladesBeats, con lanzamientos, sesiones DJ y bolos, además de un marcador en la fecha actual.",
  catalog_legend_releases: "Lanzamientos",
  catalog_legend_sets: "Sesiones",
  catalog_legend_gigs: "Bolos",
  catalog_mobile_note: "En móvil aparece una selección reciente.",
  catalog_mobile_link: "Catálogo musical completo",
  footer_tagline: "Música electrónica nacida entre Oslo y Sevilla, hecha para el movimiento, la conexión y la sala.",
  footer_listen: "Plataformas",
  footer_connect: "Redes y contacto",
  footer_booking: "Contacto",
  footer_site: "En la web",
  footer_music: "Música",
  footer_sets: "Sesiones",
  footer_gigs: "Bolos",
  footer_about: "Sobre mí",
  footer_legal: "Legal",
  footer_legal_notice: "Aviso legal",
  footer_privacy: "Política de privacidad",
  footer_cookies: "Política de cookies"
};

function buildSpanishHomePage() {
  let html = readText("index.html");
  Object.entries(SPANISH_HOMEPAGE_COPY).forEach(([key, value]) => {
    html = replaceDataI18nText(html, key, value);
  });
  html = html
    .replace('<html lang="en">', '<html lang="es">')
    .replace("<title>BladesBeats | DJ &amp; Producer in Sevilla</title>", "<title>BladesBeats | DJ y productor en Sevilla</title>")
    .replace('<meta name="description" content="BladesBeats is a Norwegian DJ and producer based in Sevilla, making electronic music shaped by Oslo roots, late nights, and the energy of the dance floor.">', '<meta name="description" content="BladesBeats es un DJ y productor noruego afincado en Sevilla, con música electrónica nacida entre sus raíces en Oslo y la energía de la pista de baile.">')
    .replace('<link rel="canonical" href="https://bladesbeats.com/">', '<link rel="canonical" href="https://bladesbeats.com/es/">')
    .replace('<meta property="og:title" content="BladesBeats | DJ &amp; Producer in Sevilla">', '<meta property="og:title" content="BladesBeats | DJ y productor en Sevilla">')
    .replace('<meta property="og:description" content="Norwegian DJ and producer in Sevilla, with electronic music shaped by Oslo roots and the energy of the dance floor.">', '<meta property="og:description" content="DJ y productor noruego en Sevilla, con música electrónica nacida entre sus raíces en Oslo y la energía de la pista de baile.">')
    .replace('<meta property="og:url" content="https://bladesbeats.com/">', '<meta property="og:url" content="https://bladesbeats.com/es/">')
    .replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="es_ES">')
    .replace('<meta property="og:locale:alternate" content="es_ES">', '<meta property="og:locale:alternate" content="en_US">')
    .replace('<meta name="twitter:title" content="BladesBeats | DJ &amp; Producer in Sevilla">', '<meta name="twitter:title" content="BladesBeats | DJ y productor en Sevilla">')
    .replace('<meta name="twitter:description" content="Norwegian DJ and producer in Sevilla, with electronic music shaped by Oslo roots and the energy of the dance floor.">', '<meta name="twitter:description" content="DJ y productor noruego en Sevilla, con música electrónica nacida entre sus raíces en Oslo y la energía de la pista de baile.">')
    .replaceAll('"description": "Norwegian DJ and producer based in Sevilla, making electronic music shaped by Oslo roots, late nights, and the energy of the dance floor."', '"description": "DJ y productor noruego afincado en Sevilla, con música electrónica nacida entre sus raíces en Oslo y la energía de la pista de baile."')
    .replace('"description": "Music, DJ sets, artist story, live appearances, and contact details for BladesBeats."', '"description": "Música, sesiones DJ, historia, actuaciones y datos de contacto de BladesBeats."')
    .replaceAll('href="/music/"', 'href="/es/musica/"')
    .replaceAll('href="/dj-sets/"', 'href="/es/sesiones/"')
    .replaceAll('href="/gigs/"', 'href="/es/eventos/"')
    .replaceAll('href="/music/', 'href="/es/musica/')
    .replaceAll('href="/dj-sets/', 'href="/es/sesiones/')
    .replaceAll('href="/gigs/', 'href="/es/eventos/')
    .replaceAll('"url": "/music/', '"url": "/es/musica/')
    .replaceAll('"url": "/dj-sets/', '"url": "/es/sesiones/')
    .replaceAll('"url": "/gigs/', '"url": "/es/eventos/')
    .replaceAll('href="/about/"', 'href="/es/sobre-bladesbeats/"')
    .replaceAll('href="/booking/"', 'href="/es/contratar-dj-sevilla/"')
    .replace(/aria-label="Latest release: ([^"]+)"/, 'aria-label="Último lanzamiento: $1"')
    .replaceAll('href="/legal-notice/"', 'href="/aviso-legal/"')
    .replaceAll('href="/privacy-policy/"', 'href="/politica-privacidad/"')
    .replaceAll('href="/cookie-policy/"', 'href="/politica-cookies/"')
    .replace('aria-label="BladesBeats home"', 'aria-label="Inicio de BladesBeats"')
    .replace('aria-label="Primary navigation"', 'aria-label="Navegación principal"')
    .replace(/alt="([^"]+) cover artwork"/, 'alt="Portada de $1"')
    .replace('aria-label="Latest catalogue highlights"', 'aria-label="Novedades del catálogo"')
    .replaceAll('aria-label="Latest release:', 'aria-label="Último lanzamiento:')
    .replaceAll('aria-label="Latest set:', 'aria-label="Última sesión:')
    .replace('aria-label="Catalogue timeline visualisation"', 'aria-label="Visualización cronológica del catálogo"')
    .replace('aria-label="Interactive catalogue entries"', 'aria-label="Entradas interactivas del catálogo"')
    .replace('aria-label="Close catalogue card"', 'aria-label="Cerrar ficha del catálogo"')
    .replace('aria-label="Timeline legend"', 'aria-label="Leyenda de la línea temporal"')
    .replace(
      '<a class="site-nav-lang" href="/es/" hreflang="es" lang="es" aria-label="Ver sitio en español">EN / ES</a>',
      '<a class="site-nav-lang" href="/" hreflang="en" lang="en" aria-label="View site in English">ES / EN</a>'
    );
  return html;
}

function buildSpanishMusicPage(releases, generatedReleaseUrls, sets) {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Lanzamientos oficiales de BladesBeats",
    "itemListElement": releases.map((release, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "item": releaseSchema(release, generatedReleaseUrls.get(release.slug) || "")
    }))
  };
  const spotifyUrl = PLATFORM_LINKS.find(([name]) => name === "Spotify")?.[1] || "";
  const appleUrl = PLATFORM_LINKS.find(([name]) => name === "Apple Music")?.[1] || "";
  return basePage({
    title: "Música y remixes | BladesBeats",
    description: "Singles, remixes, instrumentales y sesiones DJ de BladesBeats, con enlaces verificados a Spotify, Apple Music, YouTube y Mixcloud.",
    canonical: PAGE_ALTERNATES.music.es,
    label: "Música",
    h1: "Música",
    intro: "Lanzamientos originales, remixes, instrumentales y sesiones DJ, reunidos con enlaces verificados a las plataformas donde están disponibles.",
    activeNav: "music",
    lang: "es",
    alternates: PAGE_ALTERNATES.music,
    jsonLd: itemList,
    body: `<div class="platform-actions">
  <a class="button primary" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats en Spotify</a>
  <a class="button" href="${escapeAttr(appleUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats en Apple Music</a>
  <a class="button" href="/es/sesiones/">Archivo de sesiones DJ</a>
</div>
${releasePreview(releases, "es")}
${platformCatalog(releases, sets, "es")}`
  });
}

function legalFlowSection(section, index) {
  return `<section class="legal-section">
    <p class="legal-section-kicker">${String(index + 1).padStart(2, "0")}</p>
    <div>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.html}
    </div>
  </section>`;
}

function legalFlowBody({ lang = "en", current, sections }) {
  const isEs = lang === "es";
  const pageLinks = [
    { key: "notice", href: isEs ? "/aviso-legal/" : "/legal-notice/", title: isEs ? "Aviso legal" : "Legal notice" },
    { key: "privacy", href: isEs ? "/politica-privacidad/" : "/privacy-policy/", title: isEs ? "Privacidad" : "Privacy" },
    { key: "cookies", href: isEs ? "/politica-cookies/" : "/cookie-policy/", title: isEs ? "Cookies" : "Cookies" }
  ];

  return `<div class="legal-layout">
  <article class="legal-main">
    <div class="legal-flow">
      ${sections.map((section, index) => legalFlowSection(section, index)).join("\n      ")}
    </div>
  </article>
  <aside class="legal-side" aria-label="Legal">
    <div class="legal-panel">
      <span>Legal</span>
      <strong>BladesBeats</strong>
      <ul class="legal-list">
        ${pageLinks.map((item) => `<li><a href="${item.href}"${item.key === current ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a></li>`).join("\n        ")}
      </ul>
    </div>
  </aside>
</div>`;
}

function buildLegalNoticePage(lang = "en") {
  const legal = readJson("data/legal.json");
  const isEs = lang === "es";
  const publicLocation = isEs ? "Sevilla, España" : legal.location;
  const body = legalFlowBody({
    lang,
    current: "notice",
    sections: isEs ? [
      {
        title: "Identificación",
        html: `<p><strong>Sitio:</strong> ${escapeHtml(legal.website)}</p>
    <p><strong>Nombre público:</strong> ${escapeHtml(legal.tradeName)}</p>
    <p><strong>Actividad:</strong> música, sesiones DJ, bolos y contacto para contratación o colaboraciones.</p>
    <p><strong>Base pública:</strong> ${escapeHtml(publicLocation)}</p>
    <p><strong>Contacto:</strong> ${mailtoLegalLink(legal)}</p>`
      },
      {
        title: "Datos privados",
        html: `<p>No se publican domicilio privado, identificadores fiscales privados ni datos registrales no verificados.</p>
    <p>Si una contratación requiere datos legales o fiscales, se facilitan de forma privada a la parte contratante.</p>`
      },
      {
        title: "Qué hace este sitio",
        html: `<p>bladesbeats.com es una página artística e informativa. No hay tienda online, precios publicados, pagos dentro del sitio, reservas automáticas ni contratación electrónica.</p>`
      },
      {
        title: "Contenido y derechos",
        html: `<p>El nombre BladesBeats, textos, diseño, imágenes, logotipos, música y referencias musicales están protegidos por sus titulares. BladesBeats está registrado en ${escapeHtml(legal.rightsManagement)} para gestión de derechos cuando corresponda.</p>
    <p>No se permite copiar, reproducir o reutilizar contenido del sitio sin autorización, salvo usos permitidos por la ley.</p>`
      },
      {
        title: "Enlaces externos",
        html: `<p>Spotify, Apple Music, Mixcloud, YouTube, Instagram, TikTok y otros servicios enlazados aplican sus propias condiciones, disponibilidad y políticas.</p>`
      },
      {
        title: "Última actualización",
        html: `<p><small>Última actualización: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ] : [
      {
        title: "Identity",
        html: `<p><strong>Site:</strong> ${escapeHtml(legal.website)}</p>
    <p><strong>Public name:</strong> ${escapeHtml(legal.tradeName)}</p>
    <p><strong>Activity:</strong> music, DJ sets, gigs, and contact for bookings or collaborations.</p>
    <p><strong>Public base:</strong> ${escapeHtml(publicLocation)}</p>
    <p><strong>Contact:</strong> ${mailtoLegalLink(legal, "email BladesBeats")}</p>`
      },
      {
        title: "Private details",
        html: `<p>A private home address, private tax identifiers and unverified registry details are not published.</p>
    <p>If a booking requires legal or tax details, they are provided privately to the contracting party.</p>`
      },
      {
        title: "What this site does",
        html: `<p>bladesbeats.com is an artist and information website. There is no online shop, published price list, site payment, automatic reservation, or electronic contracting flow.</p>`
      },
      {
        title: "Content and rights",
        html: `<p>The BladesBeats name, text, design, images, logos, music and music references are protected by their respective rights holders. BladesBeats is registered with ${escapeHtml(legal.rightsManagement)} for rights management where applicable.</p>
    <p>Copying, reproducing or reusing site content without permission is not allowed, except where permitted by law.</p>`
      },
      {
        title: "External links",
        html: `<p>Spotify, Apple Music, Mixcloud, YouTube, Instagram, TikTok and other linked services apply their own terms, availability and policies.</p>`
      },
      {
        title: "Last updated",
        html: `<p><small>Last updated: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ]
  });
  return basePage({
    title: isEs ? "Aviso legal | BladesBeats" : "Legal notice | BladesBeats",
    description: isEs ? "Información sobre quién gestiona bladesbeats.com, el uso de su contenido y los datos de contacto de BladesBeats." : "Information about who operates bladesbeats.com, how its content may be used, and how to contact BladesBeats.",
    canonical: isEs ? PAGE_ALTERNATES.legalNotice.es : PAGE_ALTERNATES.legalNotice.en,
    label: "Legal",
    h1: isEs ? "Aviso legal" : "Legal notice",
    intro: isEs ? "Quién gestiona este sitio, cómo puede utilizarse su contenido y dónde se encuentra el contacto." : "Who runs this artist website, how its content may be used, and where contact details can be found.",
    activeNav: "",
    lang,
    alternates: PAGE_ALTERNATES.legalNotice,
    body
  });
}

function buildLegalPrivacyPage(lang = "en") {
  const legal = readJson("data/legal.json");
  const isEs = lang === "es";
  const body = legalFlowBody({
    lang,
    current: "privacy",
    sections: isEs ? [
      {
        title: "Responsable",
        html: `<p><strong>Identidad pública:</strong> ${escapeHtml(legal.tradeName)}</p>
    <p><strong>Contacto privacidad:</strong> ${mailtoLegalLink(legal)}</p>`
      },
      {
        title: "Datos tratados",
        html: `<p>El formulario de contacto trata los datos que decides enviar, como nombre, correo electrónico, tipo de solicitud, mensaje y los detalles de contratación, colaboración, derechos o privacidad que completes. También se tratan los datos que envías voluntariamente por correo, Instagram u otra plataforma enlazada.</p>
    <p>El sitio no consulta ni muestra tu dirección IP mediante un servicio del navegador. El alojamiento y Cloudflare pueden tratar datos técnicos, como IP, fecha, navegador y página solicitada, para entregar y proteger el sitio, verificar Turnstile y prevenir abusos.</p>`
      },
      {
        title: "Para qué se utilizan",
        html: `<p>Los datos se utilizan para responder mensajes, gestionar consultas de contratación o colaboración, proteger el sitio y conservar prueba de una comunicación cuando sea necesario.</p>`
      },
      {
        title: "Base jurídica",
        html: `<p>El tratamiento se basa en la solicitud de la persona interesada y, si existe una consulta de contratación, en medidas precontractuales. También puede basarse en el interés legítimo para la seguridad y la prevención de abusos, o en el consentimiento cuando proceda.</p>`
      },
      {
        title: "Destinatarios",
        html: `<p>El sitio está alojado en ${escapeHtml(legal.hostingProvider)}. Cloudflare presta la verificación Turnstile y funciones de seguridad. Resend transmite los formularios al buzón de contacto; el sitio no mantiene una base de datos separada con los mensajes. El correo y las demás plataformas externas aplican sus propias políticas cuando se utilizan.</p>`
      },
      {
        title: "Conservación",
        html: `<p>Los mensajes se eliminan cuando la consulta queda cerrada, salvo que sea necesario conservarlos para seguimiento, prevención de fraude o abuso, defensa ante reclamaciones u obligación aplicable.</p>`
      },
      {
        title: "Derechos",
        html: `<p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación, portabilidad y retirada del consentimiento cuando proceda. También puedes reclamar ante la Agencia Española de Protección de Datos.</p>
    <p><small>Última actualización: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ] : [
      {
        title: "Controller",
        html: `<p><strong>Public identity:</strong> ${escapeHtml(legal.tradeName)}</p>
    <p><strong>Privacy contact:</strong> ${mailtoLegalLink(legal, "email BladesBeats")}</p>`
      },
      {
        title: "Data we handle",
        html: `<p>The contact form handles the information you choose to submit, such as your name, email address, inquiry type, message, and any booking, collaboration, rights, or privacy-request details you complete. Information you voluntarily send by email, Instagram, or another linked platform is also handled.</p>
    <p>The site does not look up or display your IP address through a browser service. The host and Cloudflare may process technical data, such as IP address, date, browser, and requested page, to deliver and protect the site, verify Turnstile, and prevent abuse.</p>`
      },
      {
        title: "Why we use it",
        html: `<p>We use the data to reply to messages, handle booking or collaboration inquiries, protect the site, and keep proof of a communication when needed.</p>`
      },
      {
        title: "Legal basis",
        html: `<p>We process data to respond to the person's request and, for booking inquiries, to take pre-contractual steps. We may also rely on legitimate interests for security and abuse prevention, or on consent where applicable.</p>`
      },
      {
        title: "Recipients",
        html: `<p>The site is hosted by ${escapeHtml(legal.hostingProvider)}. Cloudflare provides Turnstile verification and security functions. Resend transmits form submissions to the contact mailbox; the site does not keep a separate message database. Email and other external platforms apply their own policies when used.</p>`
      },
      {
        title: "Retention",
        html: `<p>Messages are deleted when the inquiry is closed, unless they need to be kept for follow-up, fraud or abuse prevention, defense against claims, or an applicable obligation.</p>`
      },
      {
        title: "Rights",
        html: `<p>You may request access, rectification, deletion, objection, restriction, portability and withdrawal of consent where applicable. You may also complain to the Spanish Data Protection Agency.</p>
    <p><small>Last updated: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ]
  });
  return basePage({
    title: isEs ? "Política de privacidad | BladesBeats" : "Privacy policy | BladesBeats",
    description: isEs ? "Información sobre los datos que trata BladesBeats al recibir mensajes, por qué se utilizan, cuánto tiempo se conservan y los derechos disponibles." : "Information about the data BladesBeats handles for messages, why it is used, how long it is kept, and the rights available.",
    canonical: isEs ? PAGE_ALTERNATES.privacy.es : PAGE_ALTERNATES.privacy.en,
    label: "Legal",
    h1: isEs ? "Política de privacidad" : "Privacy policy",
    intro: isEs ? "Qué ocurre con los datos que envías mediante el formulario, el correo o las plataformas enlazadas." : "What happens to data you send through the contact form, email, or linked platforms.",
    activeNav: "",
    lang,
    alternates: PAGE_ALTERNATES.privacy,
    body
  });
}

function buildLegalCookiePage(lang = "en") {
  const legal = readJson("data/legal.json");
  const isEs = lang === "es";
  const body = legalFlowBody({
    lang,
    current: "cookies",
    sections: isEs ? [
      {
        title: "Analítica y publicidad",
        html: `<p>En la última actualización, bladesbeats.com no carga scripts de Google Analytics, Google Tag Manager, Meta Pixel o TikTok Pixel desde el HTML.</p>
    <p>No hay tienda online ni se instalan deliberadamente cookies publicitarias o de analítica.</p>`
      },
      {
        title: "Contacto y seguridad",
        html: `<p>Las páginas de contacto cargan Cloudflare Turnstile para comprobar que el envío es legítimo. Cloudflare puede tratar datos técnicos y usar almacenamiento estrictamente necesario para la seguridad. El sitio no consulta ni muestra tu dirección IP mediante un servicio del navegador.</p>`
      },
      {
        title: "Mixcloud",
        html: `<p>Los reproductores de Mixcloud no se cargan automáticamente. Se abren solo cuando el visitante pulsa el botón del reproductor. Desde ese momento, Mixcloud aplica sus propias cookies y políticas.</p>`
      },
      {
        title: "Gestión",
        html: `<p>El selector de idioma usa URLs separadas y no guarda una preferencia en el almacenamiento local. Si se añaden analítica, publicidad, píxeles o cookies no esenciales, se deberá actualizar esta política y la gestión de consentimiento antes de usarlos.</p>
    <p>Para consultas sobre cookies o privacidad, utiliza este ${mailtoLegalLink(legal)}.</p>
    <p><small>Última actualización: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ] : [
      {
        title: "Analytics and advertising",
        html: `<p>As of the last update, bladesbeats.com does not load Google Analytics, Google Tag Manager, Meta Pixel or TikTok Pixel scripts from the HTML.</p>
    <p>There is no online shop, and the site does not deliberately set advertising or analytics cookies.</p>`
      },
      {
        title: "Contact and security",
        html: `<p>Contact pages load Cloudflare Turnstile to verify that a submission is legitimate. Cloudflare may process technical data and use storage that is strictly necessary for security. The site does not look up or display your IP address through a browser service.</p>`
      },
      {
        title: "Mixcloud",
        html: `<p>Mixcloud players do not load automatically. They open only when the visitor presses the player button. From that point, Mixcloud applies its own cookies and policies.</p>`
      },
      {
        title: "Control",
        html: `<p>The language selector uses separate URLs and does not save a preference in local storage. If analytics, advertising, pixels or non-essential cookies are added, this policy and consent handling must be updated before they are used.</p>
    <p>For cookie or privacy questions, ${mailtoLegalLink(legal, "email BladesBeats")}.</p>
    <p><small>Last updated: ${escapeHtml(legal.lastUpdated)}</small></p>`
      }
    ]
  });
  return basePage({
    title: isEs ? "Política de cookies | BladesBeats" : "Cookie policy | BladesBeats",
    description: isEs
      ? "Información sobre cuándo bladesbeats.com conecta con Cloudflare o Mixcloud y qué servicios de analítica, publicidad o almacenamiento local utiliza."
      : "Information about when bladesbeats.com connects to Cloudflare or Mixcloud and which analytics, advertising, or local-storage services it uses.",
    canonical: isEs ? PAGE_ALTERNATES.cookies.es : PAGE_ALTERNATES.cookies.en,
    label: "Legal",
    h1: isEs ? "Política de cookies" : "Cookie policy",
    intro: isEs ? "Qué servicios externos pueden almacenar datos, cuándo se conectan y cómo mantiene el sitio el control." : "Which external services may store data, when they connect, and how the site keeps that under control.",
    activeNav: "",
    lang,
    alternates: PAGE_ALTERNATES.cookies,
    body
  });
}

function validatePageHtml(html, label) {
  const checks = [
    [/<title>[^<]+<\/title>/, "title"],
    [/<meta name="description" content="[^"]+">/, "meta description"],
    [/<link rel="canonical" href="https:\/\/bladesbeats\.com\/[^"]*">/, "canonical"],
    [/<h1\b[\s\S]*?<\/h1>/, "h1"]
  ];
  for (const [pattern, name] of checks) {
    if (!pattern.test(html)) throw new Error(`${label} missing ${name}`);
  }
  if (/(undefined|null)/.test(html)) throw new Error(`${label} contains undefined/null`);
  if (/href=""/.test(html)) throw new Error(`${label} contains blank href`);
}

function validateHomepage() {
  const html = readText("index.html");
  const latestReleaseUrl = latestCatalogEvent(validCatalogEvents(), "release")?.url || "/music/";
  if (/data-i18n="cta_spotify"|Listen on Spotify|Escuchar en Spotify/.test(html)) {
    throw new Error("Homepage hero CTA still implies Spotify exclusivity.");
  }
  if (!html.includes(`href="${escapeAttr(latestReleaseUrl)}" data-i18n="home_hero_cta"`)) {
    throw new Error(`Homepage hero CTA does not point to the latest release (${latestReleaseUrl}).`);
  }
  if (!/<a class="site-nav-lang" href="\/es\/" hreflang="es"/.test(html)) {
    throw new Error("Homepage language control does not link to the Spanish URL.");
  }
  if (/data-lang-switch|localStorage|const COPY =|data-page="(?:releases|appearances|story|booking)"/.test(html)) {
    throw new Error("Homepage still contains legacy client-side routing or language code.");
  }
  if (/data-contact-form|api\.ipify\.org|challenges\.cloudflare\.com\/turnstile/.test(html)) {
    throw new Error("Homepage still contains hidden contact-form dependencies.");
  }
  if (!/<canvas id="catalog-canvas"/.test(html)) {
    throw new Error("Homepage catalog canvas missing.");
  }
  if (!/<script id="catalog-data" type="application\/json">/.test(html)) {
    throw new Error("Homepage catalog data block missing.");
  }
  if (!/<script defer src="\/assets\/js\/catalog-hero\.js\?v=[a-f0-9]{12}"><\/script>/.test(html)) {
    throw new Error("Homepage catalog hero script missing.");
  }
  for (const label of ["Spotify", "Apple Music", "Mixcloud", "YouTube", "Instagram", "TikTok"]) {
    if (!html.includes(label)) throw new Error(`Homepage platform section missing ${label}.`);
  }
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!jsonMatch) throw new Error("Homepage JSON-LD missing.");
  const data = JSON.parse(jsonMatch[1]);
  if ((data.sameAs || []).includes("https://dj.bladesbeats.com/")) {
    throw new Error("dj.bladesbeats.com is still in sameAs.");
  }
}

function buildSitemap(entries) {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
  ];
  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${entry.loc}</loc>`);
    lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function main() {
  const releases = readJson("data/releases.json").filter((release) => !isExcludedRelease(release));
  const sets = readJson("data/dj-sets.json");
  const gigs = readJson("data/gigs.json");
  validateUniqueSlugs(releases, "Release");
  validateUniqueSlugs(sets, "DJ set");
  validateUniqueSlugs(gigs, "Gig");

  const generatedReleaseUrls = new Map();
  const generatedReleaseUrlsEs = new Map();
  const generatedSetUrls = new Map();
  const generatedSetUrlsEs = new Map();
  const gigFiles = [];
  const gigFilesEs = [];
  const musicFiles = [];
  const musicFilesEs = [];
  const setFiles = [];
  const setFilesEs = [];
  const catalogLastmod = pageLastmod(
    releases.map((item) => item.lastmod || item.releaseDate),
    sets.map((item) => item.lastmod || item.uploadDate || item.publishedDate),
    gigs.map((item) => item.lastmod || item.startDate)
  );
  const sitemap = [
    { loc: `${SITE}/`, lastmod: catalogLastmod }
  ];

  for (const release of releases) {
    const url = releaseDetailUrl(release.slug, "en");
    const urlEs = releaseDetailUrl(release.slug, "es");
    generatedReleaseUrls.set(release.slug, url);
    generatedReleaseUrlsEs.set(release.slug, urlEs);
    const html = buildReleasePage(release, "en", releases);
    const htmlEs = buildReleasePage(release, "es", releases);
    validatePageHtml(html, `music/${release.slug}`);
    validatePageHtml(htmlEs, `es/musica/${release.slug}`);
    musicFiles.push([path.join(release.slug, "index.html"), html]);
    musicFilesEs.push([path.join(release.slug, "index.html"), htmlEs]);
    const lastmod = pageLastmod(release.lastmod || release.releaseDate);
    sitemap.push({ loc: url, lastmod });
    sitemap.push({ loc: urlEs, lastmod });
  }

  for (const set of sets) {
    if (!hasOfficialLink(set)) {
      skipped.sets.push(`${set.title} (${set.slug})`);
      continue;
    }
    const url = setDetailUrl(set.slug, "en");
    const urlEs = setDetailUrl(set.slug, "es");
    generatedSetUrls.set(set.slug, url);
    generatedSetUrlsEs.set(set.slug, urlEs);
    const html = buildSetPage(set, "en");
    const htmlEs = buildSetPage(set, "es");
    validatePageHtml(html, `dj-sets/${set.slug}`);
    validatePageHtml(htmlEs, `es/sesiones/${set.slug}`);
    setFiles.push([path.join(set.slug, "index.html"), html]);
    setFilesEs.push([path.join(set.slug, "index.html"), htmlEs]);
    const lastmod = pageLastmod(set.lastmod || set.uploadDate || set.publishedDate);
    sitemap.push({ loc: url, lastmod });
    sitemap.push({ loc: urlEs, lastmod });
  }

  for (const gig of gigs) {
    const url = gigDetailUrl(gig.slug, "en");
    const urlEs = gigDetailUrl(gig.slug, "es");
    const html = buildGigDetailPage(gig, "en");
    const htmlEs = buildGigDetailPage(gig, "es");
    validatePageHtml(html, `gigs/${gig.slug}`);
    validatePageHtml(htmlEs, `es/eventos/${gig.slug}`);
    gigFiles.push([path.join("gigs", gig.slug, "index.html"), html]);
    gigFilesEs.push([path.join("es", "eventos", gig.slug, "index.html"), htmlEs]);
    const lastmod = pageLastmod(gig.lastmod || gig.startDate);
    sitemap.push({ loc: url, lastmod });
    sitemap.push({ loc: urlEs, lastmod });
  }

  const musicIndex = buildMusicIndex(releases, generatedReleaseUrls, sets);
  validatePageHtml(musicIndex, "music index");
  musicFiles.unshift(["index.html", musicIndex]);
  const releasesLastmod = pageLastmod(releases.map((item) => item.lastmod || item.releaseDate));
  sitemap.splice(1, 0, { loc: `${SITE}/music/`, lastmod: releasesLastmod });

  const setIndex = buildSetIndex(sets, generatedSetUrls, "en");
  validatePageHtml(setIndex, "dj-sets index");
  setFiles.unshift(["index.html", setIndex]);
  const setsLastmod = pageLastmod(sets.map((item) => item.lastmod || item.uploadDate || item.publishedDate));
  sitemap.splice(2, 0, { loc: `${SITE}/dj-sets/`, lastmod: setsLastmod });

  injectCatalogDataIntoHomepage(releases, sets);
  updateStandaloneAssetVersions();
  validateHomepage();
  const gigsLastmod = pageLastmod(gigs.map((item) => item.lastmod || item.startDate));
  const staticPages = [
    ["about/index.html", buildAboutPageDesign("en"), `${SITE}/about/`, SITE_TEMPLATE_LASTMOD],
    ["booking/index.html", buildBookingPage("en"), `${SITE}/booking/`, SITE_TEMPLATE_LASTMOD],
    ["gigs/index.html", buildGigsIndexPage(gigs, "en"), `${SITE}/gigs/`, gigsLastmod],
    ["legal-notice/index.html", buildLegalNoticePage("en"), `${SITE}/legal-notice/`, SITE_TEMPLATE_LASTMOD],
    ["privacy-policy/index.html", buildLegalPrivacyPage("en"), `${SITE}/privacy-policy/`, SITE_TEMPLATE_LASTMOD],
    ["cookie-policy/index.html", buildLegalCookiePage("en"), `${SITE}/cookie-policy/`, SITE_TEMPLATE_LASTMOD],
    ["aviso-legal/index.html", buildLegalNoticePage("es"), `${SITE}/aviso-legal/`, SITE_TEMPLATE_LASTMOD],
    ["politica-privacidad/index.html", buildLegalPrivacyPage("es"), `${SITE}/politica-privacidad/`, SITE_TEMPLATE_LASTMOD],
    ["politica-cookies/index.html", buildLegalCookiePage("es"), `${SITE}/politica-cookies/`, SITE_TEMPLATE_LASTMOD],
    ["es/index.html", buildSpanishHomePage(releases, generatedReleaseUrls, sets, gigs), `${SITE}/es/`, catalogLastmod],
    ["es/contratar-dj-sevilla/index.html", buildBookingPage("es"), `${SITE}/es/contratar-dj-sevilla/`, SITE_TEMPLATE_LASTMOD],
    ["es/musica/index.html", buildSpanishMusicPage(releases, generatedReleaseUrlsEs, sets), `${SITE}/es/musica/`, releasesLastmod],
    ["es/sesiones/index.html", buildSetIndex(sets, generatedSetUrlsEs, "es"), `${SITE}/es/sesiones/`, setsLastmod],
    ["es/eventos/index.html", buildGigsIndexPage(gigs, "es"), `${SITE}/es/eventos/`, gigsLastmod],
    ["es/sobre-bladesbeats/index.html", buildAboutPageDesign("es"), `${SITE}/es/sobre-bladesbeats/`, SITE_TEMPLATE_LASTMOD]
  ];
  for (const [relative, html, loc, lastmod] of staticPages) {
    validatePageHtml(html, relative);
    sitemap.push({ loc, lastmod });
  }
  const sitemapXml = buildSitemap(sitemap);
  if ((sitemapXml.match(/<loc>/g) || []).length !== sitemap.length) {
    throw new Error("Sitemap location count mismatch.");
  }

  replaceGeneratedDir("music", musicFiles);
  replaceGeneratedDir("dj-sets", setFiles);
  replaceGeneratedDir(path.join("es", "musica"), musicFilesEs);
  replaceGeneratedDir(path.join("es", "sesiones"), setFilesEs);
  for (const [relative, html] of gigFiles) {
    writeFileAtomic(path.join(ROOT, relative), html);
  }
  for (const [relative, html] of gigFilesEs) {
    writeFileAtomic(path.join(ROOT, relative), html);
  }
  for (const [relative, html] of staticPages) {
    writeFileAtomic(path.join(ROOT, relative), html);
  }
  writeFileAtomic(path.join(ROOT, "sitemap.xml"), sitemapXml);

  console.log(`Generated ${musicFiles.length} music file(s) and ${setFiles.length} DJ-set file(s).`);
  if (skipped.releases.length) console.log(`Skipped release detail pages without official links: ${skipped.releases.join("; ")}`);
  if (skipped.sets.length) console.log(`Skipped DJ-set detail pages without official links: ${skipped.sets.join("; ")}`);
}

main();
