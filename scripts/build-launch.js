"use strict";

const fs = require("fs");
const path = require("path");
const { assertNoExcludedContent, displayReleaseTitle, isExcludedRelease } = require("./catalog-policy");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const config = readJson("config/site.json");
const SITE = config.siteUrl;
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(relative, contents) {
  const target = path.join(DIST, relative);
  ensureDir(path.dirname(target));
  assertNoExcludedContent(contents, relative);
  fs.writeFileSync(target, contents, "utf8");
}

function copy(relative, destination = relative) {
  const target = path.join(DIST, destination);
  ensureDir(path.dirname(target));
  fs.copyFileSync(path.join(ROOT, relative), target);
}

function releaseDate(item) {
  return item.releaseDate || item.publishedDate || item.uploadDate || `${item.year || ""}-01-01`;
}

function sortNewest(items) {
  return [...items].sort((a, b) => releaseDate(b).localeCompare(releaseDate(a)));
}

function typeKey(type) {
  const key = String(type || "single").toLowerCase();
  if (key.includes("instrumental") || key.includes("beat")) return "instrumental";
  if (key.includes("remix")) return "remix";
  if (key.includes("edit")) return "edit";
  if (key.includes("set") || key.includes("mix")) return "dj-set";
  return "original";
}

function typeLabel(type, lang = "en") {
  const labels = {
    en: { original: "Original", remix: "Remix", edit: "Edit", instrumental: "Instrumental", "dj-set": "DJ set" },
    es: { original: "Original", remix: "Remix", edit: "Edit", instrumental: "Instrumental", "dj-set": "Sesión DJ" }
  };
  return labels[lang][typeKey(type)];
}

function detailPath(release, lang = "en") {
  return `${lang === "es" ? "/es/musica" : "/music"}/${release.slug}/`;
}

function setPath(set, lang = "en") {
  return `${lang === "es" ? "/es/sesiones" : "/dj-sets"}/${set.slug}/`;
}

function imageUrl(url, size = 700) {
  const value = String(url || "/og-card.png");
  if (/mzstatic\.com/.test(value)) return value.replace(/\/\d+x\d+bb\.jpg(?:\?.*)?$/, `/${size}x${size}bb.webp`);
  return value;
}

function directLinks(release) {
  const links = release.links || {};
  return {
    spotify: release.spotifyUrl || links.spotify || "",
    appleMusic: release.appleMusicUrl || links.appleMusic || "",
    youtube: release.youtubeUrl || links.youtube || ""
  };
}

function preferredLink(release) {
  const links = directLinks(release);
  if (links.spotify) return ["Spotify", links.spotify];
  if (links.appleMusic) return ["Apple Music", links.appleMusic];
  if (links.youtube) return ["YouTube", links.youtube];
  return ["Release page", detailPath(release)];
}

function formatDate(value, lang = "en") {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function navigation(lang = "en", active = "home") {
  const es = lang === "es";
  const items = es
    ? [["music", "Música", "/es/musica/"], ["sets", "Sesiones", "/es/sesiones/"], ["gigs", "Bolos", "/es/eventos/"], ["about", "Sobre mí", "/es/sobre-bladesbeats/"], ["contact", "Contacto", "/es/contratar-dj-sevilla/"]]
    : [["music", "Music", "/music/"], ["sets", "Sets", "/dj-sets/"], ["gigs", "Gigs", "/gigs/"], ["about", "About", "/about/"], ["contact", "Contact", "/booking/"]];
  return `<header class="topbar"><div class="site-frame topbar-inner">
    <a class="brand" href="${es ? "/es/" : "/"}" aria-label="BladesBeats home">BladesBeats<span class="brand-dot">.</span></a>
    <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-menu" data-menu-button>${es ? "Menú" : "Menu"}</button>
    <nav class="site-menu" id="site-menu" aria-label="${es ? "Navegación principal" : "Primary navigation"}" data-site-menu>
      ${items.map(([key, label, href]) => `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      <a class="lang-link" href="${es ? "/" : "/es/"}" hreflang="${es ? "en" : "es"}">${es ? "EN" : "ES"}</a>
    </nav>
  </div></header>`;
}

function footer(lang = "en") {
  const es = lang === "es";
  return `<footer class="footer"><div class="site-frame footer-inner">
    <p>© <span data-current-year>${new Date().getFullYear()}</span> BladesBeats · Oslo → Sevilla</p>
    <nav class="footer-links" aria-label="${es ? "Enlaces del pie" : "Footer links"}">
      <a href="${config.instagramUrl}" target="_blank" rel="noopener noreferrer">Instagram</a>
      <a href="${es ? "/politica-privacidad/" : "/privacy-policy/"}">${es ? "Privacidad" : "Privacy"}</a>
      <a href="${es ? "/aviso-legal/" : "/legal-notice/"}">${es ? "Aviso legal" : "Legal"}</a>
    </nav>
  </div></footer>`;
}

function htmlDocument({ lang, title, description, canonical, alternates, active, body, schema, socialImage = `${SITE}/og-card.png`, ogType = "website", robots = "index,follow,max-image-preview:large" }) {
  const es = lang === "es";
  const image = socialImage.startsWith("http") ? socialImage : `${SITE}${socialImage}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="robots" content="${escapeAttr(robots)}">
  <meta name="theme-color" content="#090B18">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <link rel="alternate" hreflang="en" href="${escapeAttr(alternates.en)}">
  <link rel="alternate" hreflang="es" href="${escapeAttr(alternates.es)}">
  <link rel="alternate" hreflang="x-default" href="${escapeAttr(alternates.en)}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:type" content="${escapeAttr(ogType)}"><meta property="og:site_name" content="BladesBeats">
  <meta property="og:title" content="${escapeAttr(title)}"><meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}"><meta property="og:image" content="${image}">
  <meta property="og:locale" content="${es ? "es_ES" : "en_US"}"><meta property="og:locale:alternate" content="${es ? "en_US" : "es_ES"}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeAttr(title)}"><meta name="twitter:description" content="${escapeAttr(description)}"><meta name="twitter:image" content="${image}">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=optional" media="print" data-font-styles>
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=optional"></noscript>
  <link rel="stylesheet" href="/assets/css/site.css">
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
  <script defer src="/assets/js/site.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">${es ? "Saltar al contenido" : "Skip to content"}</a>
  ${navigation(lang, active)}
  <main id="main">${body}</main>
  ${footer(lang)}
</body>
</html>`;
}

function releaseCards(releases, lang) {
  return releases.map((release, index) => {
    const title = displayReleaseTitle(release);
    return `<article class="release-card">
      <a class="release-art" href="${detailPath(release, lang)}"><img src="${escapeAttr(imageUrl(release.image, 480))}" alt="${escapeAttr(title)} artwork" width="480" height="480" loading="${index < 4 ? "eager" : "lazy"}" decoding="async"><span class="release-index">${String(index + 1).padStart(2, "0")}</span></a>
      <div class="release-info"><p class="release-type">${typeLabel(release.type, lang)}</p><h3 class="release-name"><a href="${detailPath(release, lang)}">${escapeHtml(title)}</a></h3><p class="release-date">${escapeHtml(formatDate(releaseDate(release), lang))}</p></div>
    </article>`;
  }).join("");
}

function buildHome(lang, releases, sets, gigs) {
  const es = lang === "es";
  const newest = releases[0];
  const pinned = config.featuredReleaseSlugs.map((slug) => releases.find((item) => item.slug === slug)).filter(Boolean);
  const featured = [...pinned, ...releases.filter((item) => !pinned.includes(item))].slice(0, 8);
  const wall = releases.slice(0, 9);
  const latestSet = sets[0];
  const preferred = preferredLink(newest);
  const counts = releases.reduce((all, item) => {
    const key = typeKey(item.type);
    all[key] = (all[key] || 0) + 1;
    return all;
  }, {});
  const categoryText = es ? {
    original: ["Originales", "Lanzamientos propios y trabajos originales."], remix: ["Remixes", "Reinterpretaciones oficiales y publicadas."], edit: ["Edits", "Edits de club y versiones de DJ."], instrumental: ["Instrumentales", "Beats y piezas instrumentales."], "dj-set": ["Sesiones DJ", "Mezclas largas y sesiones de estudio."]
  } : {
    original: ["Originals", "Original releases and artist-led productions."], remix: ["Remixes", "Officially published reinterpretations."], edit: ["Edits", "Club edits and DJ-focused versions."], instrumental: ["Instrumentals", "Beats and instrumental productions."], "dj-set": ["DJ sets", "Long-form mixes and studio sessions."]
  };
  const categories = ["original", "remix", "edit", "instrumental", "dj-set"];
  const timeline = [
    ...releases.slice(0, 9).map((item) => ({ date: releaseDate(item), title: displayReleaseTitle(item), kind: typeLabel(item.type, lang), href: detailPath(item, lang) })),
    ...sets.slice(0, 2).map((item) => ({ date: releaseDate(item), title: item.title, kind: es ? "Sesión Mixcloud" : "Mixcloud set", href: setPath(item, lang) })),
    ...gigs.slice(0, 1).map((item) => ({ date: item.startDate, title: item.title, kind: es ? "Bolo" : "Gig", href: `${es ? "/es/eventos" : "/gigs"}/${item.slug}/` }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const schema = {
    "@context": "https://schema.org", "@type": "Person", "@id": `${SITE}/#artist`, name: "BladesBeats", url: es ? `${SITE}/es/` : `${SITE}/`, image: `${SITE}/og-card.png`, jobTitle: es ? "DJ y productor musical" : "DJ and music producer", address: { "@type": "PostalAddress", addressLocality: "Sevilla", addressCountry: "ES" }, sameAs: Object.values(config.platforms)
  };
  const body = `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy"><p class="eyebrow">Oslo · Sevilla · 2017—${new Date().getFullYear()}</p><h1 id="hero-title"><span>Blades</span><span>Beats<b>.</b></span></h1>
      <p class="hero-lead">${es ? "DJ y productor en Sevilla, con raíces en Oslo. Lanzamientos, remixes, instrumentales y sesiones creados para el movimiento." : "DJ and producer in Sevilla, with Oslo roots. Releases, remixes, instrumentals and sets built for movement."}</p>
      <div class="hero-actions"><a class="button primary" href="${detailPath(newest, lang)}">${es ? "Último lanzamiento" : "Latest release"} →</a><a class="button" href="${es ? "/es/musica/" : "/music/"}">${es ? "Explorar música" : "Explore music"}</a></div>
    </div>
    <div class="hero-stage" aria-label="${es ? "Selección de portadas de BladesBeats" : "BladesBeats artwork selection"}"><div class="art-wall" aria-hidden="true">${wall.map((item) => `<div class="art-tile"><img src="${escapeAttr(imageUrl(item.image, 360))}" alt="" width="360" height="360" loading="lazy" fetchpriority="low" decoding="async"></div>`).join("")}</div>
      <article class="now-playing"><p class="now-playing-label">${es ? "Ahora · último lanzamiento" : "Now · latest release"}</p><h2>${escapeHtml(displayReleaseTitle(newest))}</h2><p class="now-playing-meta"><span>${typeLabel(newest.type, lang)}</span><span>${formatDate(releaseDate(newest), lang)}</span></p><a href="${escapeAttr(preferred[1])}"${preferred[1].startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${es ? "Abrir en" : "Open on"} ${escapeHtml(preferred[0])} ↗</a></article>
    </div>
  </section>
  <section class="signal-strip" aria-label="${es ? "Archivo de BladesBeats" : "BladesBeats archive"}"><div class="site-frame signal-grid"><div class="signal-item"><strong>${releases.length}</strong><span>${es ? "Lanzamientos" : "Releases"}</span></div><div class="signal-item"><strong>${sets.length}</strong><span>${es ? "Sesiones Mixcloud" : "Mixcloud sets"}</span></div><div class="signal-item"><strong>${gigs.length}</strong><span>${es ? "Apariciones" : "Appearances"}</span></div><div class="signal-item"><strong>2</strong><span>${es ? "Ciudades base" : "Cities in the story"}</span></div></div></section>
  <section class="section" aria-labelledby="recent-title"><div class="site-frame"><div class="section-head"><div><p class="section-kicker">01 · ${es ? "Escuchar" : "Listen"}</p><h2 class="section-title" id="recent-title">${es ? "Lanzamientos recientes" : "Recent releases"}</h2></div><p class="section-intro">${es ? "La música primero. Cada portada abre su propia página con enlaces verificados a las plataformas donde está disponible." : "Music first. Every artwork opens a dedicated release page with verified links to the platforms where it is available."}</p></div><div class="release-rail">${releaseCards(featured, lang)}</div><div class="section-action"><a class="button text" href="${es ? "/es/musica/" : "/music/"}">${es ? "Ver el catálogo completo" : "View the complete catalogue"} →</a></div></div></section>
  <section class="section" aria-labelledby="routes-title"><div class="site-frame"><div class="section-head"><div><p class="section-kicker">02 · ${es ? "Rutas" : "Routes"}</p><h2 class="section-title" id="routes-title">${es ? "Encuentra tu sonido" : "Find your route in"}</h2></div><p class="section-intro">${es ? "Las categorías siguen separadas. Los filtros te llevan directamente al tipo de música que buscas." : "The categories stay distinct. Filters take you directly to the kind of music you came for."}</p></div><div class="category-list">${categories.map((key, index) => `<a class="category-row" href="${es ? "/es/musica/" : "/music/"}?type=${key}"><span class="category-no">${String(index + 1).padStart(2, "0")}</span><strong class="category-name">${categoryText[key][0]}</strong><span class="category-copy">${categoryText[key][1]}</span><span class="category-count">${counts[key] || 0} ${es ? "piezas" : "pieces"} →</span></a>`).join("")}</div></div></section>
  ${latestSet ? `<section class="section" aria-labelledby="set-title"><div class="site-frame"><div class="section-head"><div><p class="section-kicker">03 · ${es ? "Sesión destacada" : "Featured set"}</p><h2 class="section-title" id="set-title">${es ? "Más allá del single" : "Beyond the single"}</h2></div><p class="section-intro">${es ? "Las sesiones viven en Mixcloud: mezclas largas, energía de sala y selección sin recortar." : "Sets live on Mixcloud: longer blends, room energy and selection without the edit."}</p></div></div><div class="set-feature"><a class="set-art" href="${setPath(latestSet, lang)}"><img src="${escapeAttr(imageUrl(latestSet.image, 900))}" alt="${escapeAttr(latestSet.title)} artwork" width="900" height="900" loading="lazy" decoding="async"></a><div class="set-copy"><p class="set-meta">Mixcloud · ${formatDate(releaseDate(latestSet), lang)}${latestSet.duration ? ` · ${escapeHtml(latestSet.duration)}` : ""}</p><h3>${escapeHtml(latestSet.title)}</h3><p class="set-description">${escapeHtml(es ? "Sesión oficial de BladesBeats publicada en Mixcloud." : (latestSet.description || "Official BladesBeats session on Mixcloud."))}</p><div class="set-actions"><a class="button primary" href="${setPath(latestSet, lang)}">${es ? "Abrir sesión" : "Open set"} →</a><a class="button" href="${es ? "/es/sesiones/" : "/dj-sets/"}">${es ? "Todas las sesiones" : "All sets"}</a></div></div></div></section>` : ""}
  <section class="section" aria-labelledby="archive-title"><div class="site-frame"><div class="section-head"><div><p class="section-kicker">04 · ${es ? "Archivo" : "Archive"}</p><h2 class="section-title" id="archive-title">${es ? "Línea de actividad" : "Activity line"}</h2></div><p class="section-intro">${es ? "Una versión más clara de la cronología: lanzamientos, sesiones y bolos en una sola secuencia, con cada categoría identificada." : "A clearer version of the timeline: releases, sets and gigs in one sequence, with every category identified."}</p></div><div class="timeline">${timeline.map((item) => `<a class="timeline-row" href="${item.href}"><time class="timeline-date" datetime="${item.date}">${formatDate(item.date, lang)}</time><span class="timeline-dot" aria-hidden="true"></span><span class="timeline-main"><strong class="timeline-title">${escapeHtml(item.title)}</strong><span class="timeline-kind">${escapeHtml(item.kind)}</span></span><span class="timeline-arrow" aria-hidden="true">→</span></a>`).join("")}</div></div></section>
  <section class="follow"><div class="site-frame follow-inner"><h2>${es ? "Escucha. Sigue. Vuelve." : "Listen. Follow. Return."}</h2><div class="follow-links">${Object.entries(config.platforms).map(([key, url]) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(key === "appleMusic" ? "Apple Music" : key.charAt(0).toUpperCase() + key.slice(1))}</span><span>↗</span></a>`).join("")}</div></div></section>
  <section class="contact-band"><div class="site-frame contact-band-inner"><div><p class="section-kicker">05 · ${es ? "Contacto" : "Contact"}</p><h2>${es ? "Hablemos del próximo <span>set.</span>" : "Let’s talk about the next <span>set.</span>"}</h2></div><a class="button" href="${es ? "/es/contratar-dj-sevilla/" : "/booking/"}">${es ? "Booking y colaboración" : "Booking & collaboration"} →</a></div></section>`;

  return htmlDocument({
    lang,
    title: es ? "BladesBeats | DJ y productor en Sevilla" : "BladesBeats | DJ and Producer in Sevilla",
    description: es ? "Sitio oficial de BladesBeats: lanzamientos, remixes, instrumentales, sesiones DJ y bolos." : "Official BladesBeats site: releases, remixes, instrumentals, DJ sets and gigs.",
    canonical: es ? `${SITE}/es/` : `${SITE}/`,
    alternates: { en: `${SITE}/`, es: `${SITE}/es/` },
    active: "home",
    body,
    schema
  });
}

function pageHero(lang, kicker, title, intro) {
  return `<section class="page-hero"><div class="site-frame page-hero-grid"><div><p class="section-kicker">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1></div><p class="page-hero-copy">${escapeHtml(intro)}</p></div></section>`;
}

function platformName(key) {
  return { spotify: "Spotify", appleMusic: "Apple Music", youtube: "YouTube", mixcloud: "Mixcloud", instagram: "Instagram", tiktok: "TikTok" }[key] || key;
}

function profileStrip() {
  return `<nav class="platform-strip" aria-label="Official BladesBeats profiles"><div class="site-frame platform-strip-inner">${Object.entries(config.platforms).map(([key, url]) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span>${platformName(key)}</span><span aria-hidden="true">↗</span></a>`).join("")}</div></nav>`;
}

function platformButtons(links, lang = "en") {
  const es = lang === "es";
  return Object.entries(links).filter(([, url]) => url).map(([key, url]) => `<a class="button" data-platform="${escapeAttr(key)}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${es ? "Abrir" : "Open"} ${platformName(key)} ↗</a>`).join("");
}

function compactPlatformLinks(links) {
  return `<div class="catalog-platforms">${Object.entries(links).filter(([, url]) => url).map(([key, url]) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open on ${escapeAttr(platformName(key))}">${platformName(key)} ↗</a>`).join("")}</div>`;
}

function catalogCards(releases, lang = "en") {
  return releases.map((release, index) => {
    const title = displayReleaseTitle(release);
    const links = directLinks(release);
    return `<article class="catalog-card" data-catalog-card data-type="${typeKey(release.type)}" data-date="${escapeAttr(releaseDate(release))}" data-search="${escapeAttr(`${title} ${release.artist || "BladesBeats"}`.toLocaleLowerCase())}">
      <a class="release-art" href="${detailPath(release, lang)}"><img src="${escapeAttr(imageUrl(release.image, 480))}" alt="${escapeAttr(title)} artwork" width="480" height="480" loading="${index < 8 ? "eager" : "lazy"}" decoding="async"><span class="release-index">${String(index + 1).padStart(2, "0")}</span></a>
      <div class="release-info"><p class="release-type">${typeLabel(release.type, lang)}</p><h2 class="release-name"><a href="${detailPath(release, lang)}">${escapeHtml(title)}</a></h2><p class="release-date">${escapeHtml(formatDate(releaseDate(release), lang))}</p>${compactPlatformLinks(links)}</div>
    </article>`;
  }).join("");
}

function buildMusicIndex(lang, releases) {
  const es = lang === "es";
  const canonical = es ? `${SITE}/es/musica/` : `${SITE}/music/`;
  const title = es ? "Música | BladesBeats" : "Music | BladesBeats";
  const description = es ? "Catálogo completo de BladesBeats: originales, remixes, edits, instrumentales y sesiones DJ con enlaces verificados." : "The complete BladesBeats catalogue: originals, remixes, edits, instrumentals and DJ sets with verified listening links.";
  const filterLabels = es ? { all: "Todo", original: "Originales", remix: "Remixes", edit: "Edits", instrumental: "Instrumentales", "dj-set": "Sesiones DJ" } : { all: "All", original: "Originals", remix: "Remixes", edit: "Edits", instrumental: "Instrumentals", "dj-set": "DJ sets" };
  const body = `${pageHero(lang, es ? "Catálogo oficial" : "Official catalogue", es ? "Música" : "Music", es ? "Todo el catálogo, directamente visible. Filtra por categoría y abre solo enlaces de plataforma verificados." : "The entire catalogue, immediately visible. Filter by category and open only verified platform destinations.")}
  ${profileStrip()}
  <section class="catalog-section"><div class="site-frame" data-catalog>
    <div class="catalog-toolbar">
      <label class="control-label">${es ? "Buscar" : "Search"}<input class="catalog-search" type="search" placeholder="${es ? "Título o artista" : "Title or artist"}" autocomplete="off" data-catalog-search></label>
      <div class="control-label"><span>${es ? "Categoría" : "Category"}</span><div class="filter-list">${Object.entries(filterLabels).map(([key, label]) => `<button class="filter-button" type="button" data-catalog-filter="${key}" aria-pressed="${key === "all"}">${label}</button>`).join("")}</div></div>
      <label class="control-label">${es ? "Orden" : "Order"}<select class="catalog-sort" data-catalog-sort><option value="newest">${es ? "Más reciente" : "Newest first"}</option><option value="oldest">${es ? "Más antiguo" : "Oldest first"}</option></select></label>
    </div>
    <p class="catalog-status"><span><b data-catalog-count>${releases.length}</b> ${es ? "resultados" : "results"}</span><span>${es ? "Enlaces directos verificados" : "Verified direct links"}</span></p>
    <div class="catalog-grid">${catalogCards(releases, lang)}</div>
    <p class="catalog-empty" data-catalog-empty hidden>${es ? "No hay resultados para esta búsqueda." : "No releases match this search."}</p>
  </div></section>`;
  const schema = { "@context": "https://schema.org", "@type": "ItemList", name: es ? "Catálogo de BladesBeats" : "BladesBeats catalogue", numberOfItems: releases.length, itemListElement: releases.map((release, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE}${detailPath(release, lang)}`, name: displayReleaseTitle(release) })) };
  return htmlDocument({ lang, title, description, canonical, alternates: { en: `${SITE}/music/`, es: `${SITE}/es/musica/` }, active: "music", body, schema });
}

function youtubeEmbed(release) {
  const id = release.youtubeId || String(directLinks(release).youtube).match(/[?&]v=([\w-]+)/)?.[1] || String(directLinks(release).youtube).match(/youtu\.be\/([\w-]+)/)?.[1];
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0` : "";
}

function buildReleasePage(release, releases, lang = "en") {
  const es = lang === "es";
  const title = displayReleaseTitle(release);
  const canonical = `${SITE}${detailPath(release, lang)}`;
  const links = directLinks(release);
  const player = youtubeEmbed(release);
  const related = releases.filter((item) => item.slug !== release.slug && typeKey(item.type) === typeKey(release.type)).slice(0, 3);
  const description = es ? `${title}: lanzamiento oficial de BladesBeats con enlaces verificados para escuchar o ver.`.slice(0, 158) : `${title}: official BladesBeats release page with verified destinations to listen or watch.`.slice(0, 158);
  const copy = release.longDescription || release.description || (es ? "Lanzamiento oficial de BladesBeats." : "Official BladesBeats release.");
  const body = `<section class="detail"><div class="site-frame"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="${es ? "/es/" : "/"}">BladesBeats</a></li><li><a href="${es ? "/es/musica/" : "/music/"}">${es ? "Música" : "Music"}</a></li><li aria-current="page">${escapeHtml(title)}</li></ol></nav>
    <article class="detail-grid"><figure class="detail-cover"><img src="${escapeAttr(imageUrl(release.image, 1000))}" alt="${escapeAttr(title)} artwork" width="1000" height="1000" decoding="async"></figure><div class="detail-copy"><p class="section-kicker">${escapeHtml(typeLabel(release.type, lang))}</p><h1${title.length > 58 ? ' class="long-title"' : ""}>${escapeHtml(title)}</h1><p class="detail-meta">${formatDate(releaseDate(release), lang)} · BladesBeats</p><p class="detail-description">${escapeHtml(copy)}</p><div class="detail-actions">${platformButtons(links, lang)}</div>
      ${player ? `<div class="player-shell" data-player-shell data-player-source="${escapeAttr(player)}" data-player-title="${escapeAttr(title)}" data-player-type="video"><div class="player-placeholder"><div><p>${es ? "El reproductor de YouTube se carga solo cuando lo solicitas." : "The YouTube player loads only when you choose to play it."}</p><button class="button" type="button" data-load-player>${es ? "Cargar reproductor" : "Load player"}</button></div></div></div>` : ""}
    </div></article></div></section>
    ${related.length ? `<section class="related"><div class="site-frame"><div class="related-head"><h2>${es ? "Más de esta categoría" : "More in this category"}</h2><a class="button text" href="${es ? "/es/musica/" : "/music/"}?type=${typeKey(release.type)}">${es ? "Ver categoría" : "View category"} →</a></div><div class="related-grid">${releaseCards(related, lang)}</div></div></section>` : ""}`;
  const schema = { "@context": "https://schema.org", "@type": "MusicRecording", name: title, url: canonical, image: release.image || `${SITE}/og-card.png`, datePublished: releaseDate(release), byArtist: { "@type": "MusicGroup", "@id": `${SITE}/#artist`, name: "BladesBeats" }, sameAs: Object.values(links).filter(Boolean) };
  return htmlDocument({ lang, title: `${title} | BladesBeats`, description, canonical, alternates: { en: `${SITE}${detailPath(release, "en")}`, es: `${SITE}${detailPath(release, "es")}` }, active: "music", body, schema, socialImage: release.image || `${SITE}/og-card.png`, ogType: "music.song" });
}

function setCard(set, lang = "en") {
  const es = lang === "es";
  return `<article class="release-card"><a class="release-art" href="${setPath(set, lang)}"><img src="${escapeAttr(imageUrl(set.image, 700))}" alt="${escapeAttr(set.title)} artwork" width="700" height="700" loading="lazy" decoding="async"></a><div class="release-info"><p class="release-type">Mixcloud · ${escapeHtml(set.duration || (es ? "Sesión DJ" : "DJ set"))}</p><h2 class="release-name"><a href="${setPath(set, lang)}">${escapeHtml(set.title)}</a></h2><p class="release-date">${formatDate(releaseDate(set), lang)}</p></div></article>`;
}

function buildSetIndex(lang, sets) {
  const es = lang === "es";
  const featured = sets[0];
  const rest = sets.slice(1);
  const canonical = es ? `${SITE}/es/sesiones/` : `${SITE}/dj-sets/`;
  const body = `${pageHero(lang, "Mixcloud", es ? "Sesiones DJ" : "DJ sets", es ? "Mezclas largas, selección de club y sesiones oficiales de BladesBeats. Mixcloud es la fuente principal." : "Long-form mixes, club selection and official BladesBeats sessions. Mixcloud is the authoritative source.")}
  ${featured ? `<section class="sets-lead"><div class="site-frame"><div class="sets-feature"><a class="sets-feature-art" href="${setPath(featured, lang)}"><img src="${escapeAttr(imageUrl(featured.image, 1000))}" alt="${escapeAttr(featured.title)} artwork" width="1000" height="1000" decoding="async"></a><div class="sets-feature-copy"><p class="section-kicker">${es ? "Última sesión" : "Latest session"}</p><h2>${escapeHtml(featured.title)}</h2><p class="detail-description">${escapeHtml(es ? "Sesión oficial de BladesBeats publicada en Mixcloud." : (featured.description || "Official BladesBeats session on Mixcloud."))}</p><p class="detail-meta">${formatDate(releaseDate(featured), lang)}${featured.duration ? ` · ${escapeHtml(featured.duration)}` : ""}</p><div class="detail-actions"><a class="button primary" href="${setPath(featured, lang)}">${es ? "Abrir sesión" : "Open set"} →</a><a class="button" href="${escapeAttr(featured.links?.mixcloud || config.platforms.mixcloud)}" target="_blank" rel="noopener noreferrer">Mixcloud ↗</a></div></div></div></div></section>` : ""}
  ${rest.length ? `<section class="sets-archive"><div class="site-frame"><div class="section-head"><div><p class="section-kicker">${es ? "Archivo" : "Archive"}</p><h2 class="section-title">${es ? "Más sesiones" : "More sessions"}</h2></div><p class="section-intro">${es ? "Cada sesión mantiene su portada, fecha, duración y enlace directo a Mixcloud." : "Every session keeps its artwork, date, duration and direct Mixcloud destination."}</p></div><div class="sets-grid">${rest.map((set) => setCard(set, lang)).join("")}</div></div></section>` : ""}`;
  const schema = { "@context": "https://schema.org", "@type": "ItemList", name: es ? "Sesiones DJ de BladesBeats" : "BladesBeats DJ sets", itemListElement: sets.map((set, index) => ({ "@type": "ListItem", position: index + 1, name: set.title, url: `${SITE}${setPath(set, lang)}` })) };
  return htmlDocument({ lang, title: es ? "Sesiones DJ | BladesBeats" : "DJ Sets | BladesBeats", description: es ? "Sesiones DJ oficiales de BladesBeats en Mixcloud." : "Official BladesBeats DJ sets and Mixcloud sessions.", canonical, alternates: { en: `${SITE}/dj-sets/`, es: `${SITE}/es/sesiones/` }, active: "sets", body, schema });
}

function mixcloudEmbed(set) {
  if (set.embedUrl) return set.embedUrl;
  const key = set.mixcloudKey || String(set.links?.mixcloud || "").replace(/^https?:\/\/(?:www\.)?mixcloud\.com/, "");
  return key ? `https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=0&feed=${encodeURIComponent(key)}` : "";
}

function buildSetPage(set, sets, lang = "en") {
  const es = lang === "es";
  const canonical = `${SITE}${setPath(set, lang)}`;
  const embed = mixcloudEmbed(set);
  const related = sets.filter((item) => item.slug !== set.slug).slice(0, 3);
  const description = es ? `${set.title}: sesión DJ oficial de BladesBeats en Mixcloud.` : `${set.title}: official BladesBeats DJ set on Mixcloud.`;
  const body = `<section class="detail"><div class="site-frame"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="${es ? "/es/" : "/"}">BladesBeats</a></li><li><a href="${es ? "/es/sesiones/" : "/dj-sets/"}">${es ? "Sesiones DJ" : "DJ sets"}</a></li><li aria-current="page">${escapeHtml(set.title)}</li></ol></nav><article class="detail-grid"><figure class="detail-cover"><img src="${escapeAttr(imageUrl(set.image, 1000))}" alt="${escapeAttr(set.title)} artwork" width="1000" height="1000" decoding="async"></figure><div class="detail-copy"><p class="section-kicker">Mixcloud · ${es ? "Sesión DJ" : "DJ set"}</p><h1>${escapeHtml(set.title)}</h1><p class="detail-meta">${formatDate(releaseDate(set), lang)}${set.duration ? ` · ${escapeHtml(set.duration)}` : ""}</p><p class="detail-description">${escapeHtml(es ? "Sesión oficial de BladesBeats publicada en Mixcloud." : (set.longDescription || set.description || "Official BladesBeats session."))}</p>${Array.isArray(set.chartHistory) && set.chartHistory.length ? `<p class="detail-meta">${set.chartHistory.map((item) => `${escapeHtml(item.rank)} ${escapeHtml(item.chart)}`).join(" · ")}</p>` : ""}<div class="detail-actions">${platformButtons({ mixcloud: set.links?.mixcloud || set.mixcloudUrl || "", youtube: set.links?.youtube || "" }, lang)}</div>${embed ? `<div class="player-shell" data-player-shell data-player-source="${escapeAttr(embed)}" data-player-title="${escapeAttr(set.title)}" data-player-type="mixcloud"><div class="player-placeholder"><div><p>${es ? "El reproductor de Mixcloud se carga solo cuando lo solicitas." : "The Mixcloud player loads only when you choose to play it."}</p><button class="button" type="button" data-load-player>${es ? "Cargar reproductor" : "Load player"}</button></div></div></div>` : ""}</div></article></div></section>${related.length ? `<section class="related"><div class="site-frame"><div class="related-head"><h2>${es ? "Más sesiones" : "More sets"}</h2><a class="button text" href="${es ? "/es/sesiones/" : "/dj-sets/"}">${es ? "Archivo completo" : "Complete archive"} →</a></div><div class="related-grid">${related.map((item) => setCard(item, lang)).join("")}</div></div></section>` : ""}`;
  const schema = { "@context": "https://schema.org", "@type": "AudioObject", name: set.title, url: canonical, contentUrl: set.links?.mixcloud || set.mixcloudUrl, thumbnailUrl: set.image, uploadDate: releaseDate(set), duration: set.durationSeconds ? `PT${set.durationSeconds}S` : undefined, creator: { "@type": "Person", "@id": `${SITE}/#artist`, name: "BladesBeats" } };
  return htmlDocument({ lang, title: `${set.title} | BladesBeats`, description, canonical, alternates: { en: `${SITE}${setPath(set, "en")}`, es: `${SITE}${setPath(set, "es")}` }, active: "sets", body, schema, socialImage: set.image || `${SITE}/og-card.png`, ogType: "music.radio_station" });
}

function gigPath(gig, lang = "en") {
  return `${lang === "es" ? "/es/eventos" : "/gigs"}/${gig.slug}/`;
}

function buildGigsIndex(lang, gigs) {
  const es = lang === "es";
  const gig = gigs[0];
  const canonical = es ? `${SITE}/es/eventos/` : `${SITE}/gigs/`;
  const body = `${pageHero(lang, es ? "Directo" : "Live", es ? "Bolos" : "Gigs", es ? "Apariciones y actuaciones de BladesBeats. Los próximos eventos aparecerán aquí cuando estén confirmados." : "BladesBeats appearances and performances. Upcoming dates will appear here once they are confirmed.")}${gig ? `<section class="gig-feature"><div class="site-frame"><p class="section-kicker">${es ? "Aparición anterior" : "Past appearance"}</p><article class="gig-card-wide"><a class="gig-art" href="${gigPath(gig, lang)}"><img src="${escapeAttr(gig.logoImage)}" alt="${escapeAttr(gig.title)} logo" width="1427" height="975" decoding="async"></a><div class="gig-copy"><p class="detail-meta">${formatDate(gig.startDate, lang)}${gig.city ? ` · ${escapeHtml(gig.city)}` : ""}</p><h2>${escapeHtml(gig.title)}</h2><p>${escapeHtml(es ? (gig.summaryEs || gig.summary) : gig.summary)}</p><div><a class="button" href="${gigPath(gig, lang)}">${es ? "Ver aparición" : "View appearance"} →</a></div></div></article></div></section>` : `<section class="section"><div class="site-frame"><p class="section-intro">${es ? "No hay bolos anunciados actualmente." : "No gigs are currently announced."}</p></div></section>`}`;
  const schema = { "@context": "https://schema.org", "@type": "CollectionPage", name: es ? "Bolos de BladesBeats" : "BladesBeats gigs", url: canonical };
  return htmlDocument({ lang, title: es ? "Bolos | BladesBeats" : "Gigs | BladesBeats", description: es ? "Bolos y apariciones de BladesBeats." : "Gigs and appearances by BladesBeats.", canonical, alternates: { en: `${SITE}/gigs/`, es: `${SITE}/es/eventos/` }, active: "gigs", body, schema });
}

function buildGigPage(gig, lang = "en") {
  const es = lang === "es";
  const canonical = `${SITE}${gigPath(gig, lang)}`;
  const summary = es ? (gig.bodyEs || gig.summaryEs || gig.summary) : (gig.body || gig.summary);
  const body = `<section class="detail"><div class="site-frame"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="${es ? "/es/" : "/"}">BladesBeats</a></li><li><a href="${es ? "/es/eventos/" : "/gigs/"}">${es ? "Bolos" : "Gigs"}</a></li><li aria-current="page">${escapeHtml(gig.title)}</li></ol></nav><article class="detail-grid"><figure class="detail-cover gig-art"><img src="${escapeAttr(gig.logoImage)}" alt="${escapeAttr(gig.title)} logo" width="1427" height="975" decoding="async"></figure><div class="detail-copy"><p class="section-kicker">${es ? "Aparición anterior" : "Past appearance"}</p><h1>${escapeHtml(gig.title)}</h1><p class="detail-meta">${formatDate(gig.startDate, lang)}${gig.endDate && gig.endDate !== gig.startDate ? ` — ${formatDate(gig.endDate, lang)}` : ""}</p><p class="detail-description">${escapeHtml(summary)}</p><p class="detail-description">${escapeHtml([gig.venueName, gig.city, gig.region].filter(Boolean).join(" · "))}</p>${gig.organizer?.url ? `<div class="detail-actions"><a class="button" href="${escapeAttr(gig.organizer.url)}" target="_blank" rel="noopener noreferrer">${es ? "Sitio del evento" : "Event website"} ↗</a></div>` : ""}</div></article></div></section>`;
  const schema = { "@context": "https://schema.org", "@type": "Event", name: gig.title, startDate: gig.startDate, endDate: gig.endDate, eventStatus: "https://schema.org/EventCompleted", performer: { "@type": "Person", "@id": `${SITE}/#artist`, name: "BladesBeats" }, location: { "@type": "Place", name: gig.venueName, address: { "@type": "PostalAddress", addressLocality: gig.city, addressRegion: gig.region, addressCountry: gig.country } }, url: canonical, image: gig.logoImage ? `${SITE}${gig.logoImage}` : `${SITE}/og-card.png` };
  return htmlDocument({ lang, title: `${gig.title} | BladesBeats`, description: String(summary).slice(0, 158), canonical, alternates: { en: `${SITE}${gigPath(gig, "en")}`, es: `${SITE}${gigPath(gig, "es")}` }, active: "gigs", body, schema, socialImage: gig.logoImage || `${SITE}/og-card.png`, ogType: "article" });
}

function buildAbout(lang = "en") {
  const es = lang === "es";
  const canonical = es ? `${SITE}/es/sobre-bladesbeats/` : `${SITE}/about/`;
  const copy = es ? [
    "BladesBeats es un DJ y productor noruego basado en Sevilla, España.",
    "La música empezó en Oslo a principios de la década de 2010, a través de espacios juveniles y comunitarios alrededor de Holmlia. BUSH y Café Condio dieron acceso temprano a equipo de estudio, gente haciendo música y la primera oportunidad real de producir.",
    "Después de mudarse a Sevilla en 2017, la música desapareció durante varios años. Volvió casi por accidente, primero con beatmaking y sesiones con vocalistas, y después con un movimiento más claro hacia la música electrónica.",
    "Ese cambio llevó al trabajo de producción con Manuel Ávila / Baster Beats en Sevilla, desarrollando temas originales y remixes mediante trabajo regular de estudio.",
    "La parte DJ llegó después, con formación junto a Quini Rivera en Impulsa Music Center en 2025, conectando producción, técnica, transiciones y energía de sala.",
    "Hoy BladesBeats trabaja entre producción de estudio, sesiones DJ y bolos, con un sonido enfocado al club construido alrededor de energía, movimiento y la sala."
  ] : [
    "BladesBeats is a Norwegian DJ and producer based in Sevilla, Spain.",
    "The music started in Oslo in the early 2010s, through youth and community spaces around Holmlia. BUSH and Café Condio gave him early access to studio equipment, people making music, and the first real opportunity to produce.",
    "After moving to Sevilla in 2017, music disappeared for several years. It returned almost by accident, first through beatmaking and vocal sessions, then through a clearer move into electronic music.",
    "That shift led to production work with Manuel Ávila / Baster Beats in Sevilla, developing original tracks and remixes through regular studio work.",
    "The DJ side came later, with training from Quini Rivera at Impulsa Music Center in 2025, connecting production, technique, transitions, and room energy.",
    "Today BladesBeats works across studio production, DJ sets, and live gigs, with a club-focused sound built around energy, movement, and the room."
  ];
  const milestones = es ? [["2010s", "Oslo", "Primer acceso a producción musical a través de BUSH y Café Condio."], ["2017", "Sevilla", "Traslado a España y comienzo de una nueva etapa."], ["2023", "Producción", "Trabajo regular de estudio con Manuel Ávila / Baster Beats."], ["2025", "Impulsa", "Formación DJ con Quini Rivera y conexión entre estudio y cabina."]] : [["2010s", "Oslo", "First access to music production through BUSH and Café Condio."], ["2017", "Sevilla", "Moved to Spain and began a new chapter."], ["2023", "Production", "Regular studio work with Manuel Ávila / Baster Beats."], ["2025", "Impulsa", "DJ training with Quini Rivera connected studio and booth."]];
  const body = `${pageHero(lang, es ? "Historia" : "Story", es ? "Sobre BladesBeats" : "About BladesBeats", es ? "Raíces en Oslo, base en Sevilla y una dirección electrónica orientada al club." : "Oslo roots, a Sevilla base, and an electronic direction built for the club.")}<section class="story"><div class="site-frame story-lead"><figure class="story-photo"><img src="/bladesbeats.webp" alt="${es ? "BladesBeats, DJ y productor basado en Sevilla" : "BladesBeats, DJ and producer based in Sevilla"}" width="1200" height="800" decoding="async"><figcaption>BladesBeats · Sevilla</figcaption></figure><article class="story-copy-large">${copy.map((paragraph, index) => index === 3 ? `<p>${es ? "Ese cambio llevó al trabajo de producción con" : "That shift led to production work with"} <a href="https://basterbeats.com/" target="_blank" rel="noopener noreferrer">Manuel Ávila / Baster Beats</a> ${es ? "en Sevilla, desarrollando temas originales y remixes mediante trabajo regular de estudio." : "in Sevilla, developing original tracks and remixes through regular studio work."}</p>` : index === 4 ? `<p>${es ? "La parte DJ llegó después, con formación junto a" : "The DJ side came later, with training from"} <a href="https://impulsamusiccenter.es/quini-rivera/" target="_blank" rel="noopener noreferrer">Quini Rivera</a> ${es ? "en Impulsa Music Center en 2025, conectando producción, técnica, transiciones y energía de sala." : "at Impulsa Music Center in 2025, connecting production, technique, transitions, and room energy."}</p>` : `<p>${escapeHtml(paragraph)}</p>`).join("")}<div class="detail-actions"><a class="button primary" href="${es ? "/es/musica/" : "/music/"}">${es ? "Escuchar música" : "Listen to the music"} →</a><a class="button" href="${es ? "/es/contratar-dj-sevilla/" : "/booking/"}">${es ? "Contacto" : "Contact"}</a></div></article></div><div class="site-frame story-milestones">${milestones.map(([year, label, note]) => `<article class="story-milestone"><time>${year}</time><h3>${escapeHtml(label)}</h3><p>${escapeHtml(note)}</p></article>`).join("")}</div></section>`;
  const schema = { "@context": "https://schema.org", "@type": "Person", "@id": `${SITE}/#artist`, name: "BladesBeats", url: canonical, image: `${SITE}/bladesbeats.webp`, jobTitle: es ? "DJ y productor musical" : "DJ and music producer", birthPlace: { "@type": "Place", name: "Oslo, Norway" }, homeLocation: { "@type": "Place", name: "Sevilla, Spain" }, knowsLanguage: ["en", "es"], sameAs: Object.values(config.platforms) };
  return htmlDocument({ lang, title: es ? "Sobre BladesBeats | DJ y productor" : "About BladesBeats | DJ and Producer", description: es ? "Historia de BladesBeats: DJ y productor noruego basado en Sevilla." : "The story of BladesBeats, a Norwegian DJ and producer based in Sevilla.", canonical, alternates: { en: `${SITE}/about/`, es: `${SITE}/es/sobre-bladesbeats/` }, active: "about", body, schema });
}

function buildContact(lang = "en") {
  const es = lang === "es";
  const canonical = es ? `${SITE}/es/contratar-dj-sevilla/` : `${SITE}/booking/`;
  const options = es ? [["Booking", "Bolos, clubes y eventos", "Incluye ciudad, fecha, tipo de evento, horario aproximado y cualquier requisito técnico."], ["Colaboración", "Producción y proyectos", "Describe el proyecto, el papel que buscas y comparte enlaces relevantes."], ["Derechos y privacidad", "Solicitudes legales o de datos", "Identifica claramente la obra, enlace o solicitud para poder revisarla correctamente."]] : [["Booking", "Gigs, clubs and events", "Include the city, date, event type, approximate schedule and any technical requirements."], ["Collaboration", "Production and projects", "Describe the project, the role you are looking for and include relevant links."], ["Rights & privacy", "Legal or data requests", "Clearly identify the work, link or request so it can be reviewed correctly."]];
  const body = `${pageHero(lang, es ? "Contacto directo" : "Direct contact", es ? "Contacto" : "Contact", es ? "Instagram es actualmente el canal oficial para booking, colaboraciones y solicitudes relacionadas con el sitio." : "Instagram is currently the official channel for booking, collaborations and website-related requests.")}<section class="contact-page"><div class="site-frame"><div class="contact-intro"><h2>${es ? "Un canal.<br>El contexto <span class=\"brand-dot\">correcto.</span>" : "One channel.<br>The <span class=\"brand-dot\">right context.</span>"}</h2><p>${es ? "No hay un buzón de correo público todavía. Usa el perfil oficial de Instagram y añade los detalles indicados para recibir una respuesta útil." : "There is no public email inbox yet. Use the official Instagram profile and include the requested details for a useful response."}</p></div><div class="contact-options">${options.map(([label, title, note], index) => `<article class="contact-option"><span class="contact-option-no">${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(title)}</h3><p><strong>${escapeHtml(label)}.</strong> ${escapeHtml(note)}</p><a class="button${index === 0 ? " primary" : ""}" href="${escapeAttr(config.instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram ↗</a></article>`).join("")}</div><p class="legal-note">${es ? "Al abrir Instagram, se aplican las condiciones y la política de privacidad de Meta. Para información sobre este sitio, consulta la" : "When you open Instagram, Meta’s terms and privacy policy apply. For information about this website, read the"} <a href="${es ? "/politica-privacidad/" : "/privacy-policy/"}">${es ? "política de privacidad" : "privacy policy"}</a>.</p></div></section>`;
  const schema = { "@context": "https://schema.org", "@type": "ContactPage", name: es ? "Contacto BladesBeats" : "Contact BladesBeats", url: canonical, mainEntity: { "@type": "Person", "@id": `${SITE}/#artist`, name: "BladesBeats", sameAs: [config.instagramUrl] } };
  return htmlDocument({ lang, title: es ? "Contacto y booking | BladesBeats" : "Contact and Booking | BladesBeats", description: es ? "Contacta con BladesBeats por Instagram para booking, colaboraciones y solicitudes del sitio." : "Contact BladesBeats on Instagram for booking, collaborations and website-related requests.", canonical, alternates: { en: `${SITE}/booking/`, es: `${SITE}/es/contratar-dj-sevilla/` }, active: "contact", body, schema });
}

function legalPaths(kind) {
  return {
    notice: { en: "/legal-notice/", es: "/aviso-legal/" },
    privacy: { en: "/privacy-policy/", es: "/politica-privacidad/" },
    cookies: { en: "/cookie-policy/", es: "/politica-cookies/" }
  }[kind];
}

function buildLegal(kind, lang, legal) {
  const es = lang === "es";
  const paths = legalPaths(kind);
  const canonical = `${SITE}${paths[lang]}`;
  const titles = {
    notice: es ? "Aviso legal" : "Legal notice",
    privacy: es ? "Política de privacidad" : "Privacy policy",
    cookies: es ? "Política de cookies" : "Cookie policy"
  };
  const intros = {
    notice: es ? "Información sobre el responsable, el propósito del sitio y las condiciones generales de uso." : "Information about the operator, the purpose of the site and its general conditions of use.",
    privacy: es ? "Qué datos técnicos pueden tratarse, por qué y qué opciones tienes como visitante." : "What technical data may be processed, why it is processed and the choices available to visitors.",
    cookies: es ? "Este sitio no instala cookies de analítica o publicidad. Los reproductores externos solo se cargan al solicitarlos." : "This site does not set analytics or advertising cookies. External players load only when requested."
  };
  const identity = [legal.legalName, legal.taxId ? `${es ? "NIF" : "Tax ID"}: ${legal.taxId}` : "", legal.legalAddress].filter(Boolean).map(escapeHtml).join(" · ");
  const commonContact = legal.contactEmail
    ? (es ? `Para cuestiones legales y de privacidad, escribe a <a href="mailto:${escapeAttr(legal.contactEmail)}">${escapeHtml(legal.contactEmail)}</a>. Para booking y colaboraciones, utiliza el perfil oficial de <a href="${escapeAttr(legal.contactUrl || config.instagramUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats en Instagram</a>.` : `For legal and privacy matters, email <a href="mailto:${escapeAttr(legal.contactEmail)}">${escapeHtml(legal.contactEmail)}</a>. For booking and collaborations, use the official <a href="${escapeAttr(legal.contactUrl || config.instagramUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats Instagram profile</a>.`)
    : (es ? `Para consultas relacionadas con este sitio, contacta con el perfil oficial de <a href="${escapeAttr(legal.contactUrl || config.instagramUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats en Instagram</a>.` : `For enquiries relating to this website, contact the official <a href="${escapeAttr(legal.contactUrl || config.instagramUrl)}" target="_blank" rel="noopener noreferrer">BladesBeats Instagram profile</a>.`);
  const sections = kind === "notice" ? (es ? [
    ["Responsable del sitio", `<p>Este sitio es operado bajo el nombre artístico <strong>${escapeHtml(legal.tradeName)}</strong>, con actividad profesional en ${escapeHtml(legal.location)}. El sitio oficial es <a href="${escapeAttr(legal.website)}">${escapeHtml(legal.website)}</a>.</p>${identity ? `<p>${identity}</p>` : ""}<p>${commonContact}</p>`],
    ["Finalidad", `<p>El sitio presenta el perfil artístico, música, sesiones DJ, apariciones, información profesional y vías de contacto de BladesBeats.</p>`],
    ["Propiedad intelectual", `<p>La marca, el diseño y el contenido original de BladesBeats están protegidos. Las referencias, nombres, portadas y enlaces de terceros conservan los derechos de sus respectivos titulares y se muestran para identificar obras y destinos oficiales.</p>`],
    ["Enlaces externos", `<p>Los enlaces a plataformas musicales, redes sociales, organizadores y colaboradores llevan a servicios independientes. Sus propias condiciones y políticas se aplican al abandonar este sitio.</p>`],
    ["Responsabilidad", `<p>Se procura mantener la información correcta y disponible, pero no se garantiza la disponibilidad permanente de plataformas o enlaces externos. Los errores confirmados se corregirán razonablemente.</p>`]
  ] : [
    ["Website operator", `<p>This site is operated under the artist name <strong>${escapeHtml(legal.tradeName)}</strong>, with professional activity in ${escapeHtml(legal.location)}. The official website is <a href="${escapeAttr(legal.website)}">${escapeHtml(legal.website)}</a>.</p>${identity ? `<p>${identity}</p>` : ""}<p>${commonContact}</p>`],
    ["Purpose", `<p>The website presents the BladesBeats artist profile, music, DJ sets, appearances, professional information and contact routes.</p>`],
    ["Intellectual property", `<p>The BladesBeats name, website design and original content are protected. Third-party names, artwork and links remain the property of their respective rights holders and are shown to identify works and official destinations.</p>`],
    ["External links", `<p>Links to music platforms, social networks, organisers and collaborators lead to independent services. Their own terms and policies apply after leaving this website.</p>`],
    ["Liability", `<p>Reasonable care is taken to keep information correct and available, but permanent availability of external platforms or links cannot be guaranteed. Confirmed errors will be corrected reasonably.</p>`]
  ]) : kind === "privacy" ? (es ? [
    ["Responsable y contacto", `<p>El responsable de este sitio opera como <strong>${escapeHtml(legal.tradeName)}</strong> en ${escapeHtml(legal.location)}.${identity ? ` ${identity}.` : ""} ${commonContact}</p>`],
    ["Datos tratados", `<p>El sitio no utiliza un formulario de contacto ni solicita cuentas. El servidor y sus proveedores de red pueden tratar temporalmente datos técnicos como dirección IP, fecha, recurso solicitado, navegador y eventos de seguridad para entregar y proteger el sitio.</p>`],
    ["Finalidad y base", `<p>Los datos técnicos se utilizan para seguridad, prevención de abuso, diagnóstico y funcionamiento del sitio, sobre la base del interés legítimo en operar un servicio seguro y fiable.</p>`],
    ["Proveedores y enlaces", `<p>El alojamiento se presta mediante ${escapeHtml(legal.hostingProvider)}. Las fuentes web pueden solicitarse a Google. Las portadas oficiales pueden servirse desde redes de entrega de Apple, YouTube o Mixcloud, que reciben la solicitud técnica necesaria para entregar la imagen. Los enlaces externos solo se abren cuando los eliges y los reproductores se cargan únicamente después de tu acción.</p>`],
    ["Conservación", `<p>Los registros técnicos se conservan únicamente durante el tiempo necesario para seguridad, diagnóstico y cumplimiento de obligaciones aplicables, y después se eliminan o agregan.</p>`],
    ["Tus derechos", `<p>Puedes solicitar acceso, rectificación, supresión, limitación u oposición cuando resulte aplicable. Identifica claramente la solicitud y la página o interacción relacionada al contactar.</p>`]
  ] : [
    ["Controller and contact", `<p>The operator of this website trades as <strong>${escapeHtml(legal.tradeName)}</strong> in ${escapeHtml(legal.location)}.${identity ? ` ${identity}.` : ""} ${commonContact}</p>`],
    ["Data processed", `<p>The site has no contact form and does not request user accounts. The server and network providers may temporarily process technical information such as IP address, time, requested resource, browser details and security events in order to deliver and protect the site.</p>`],
    ["Purpose and basis", `<p>Technical data is used for security, abuse prevention, diagnostics and website operation, based on the legitimate interest in operating a secure and reliable service.</p>`],
    ["Providers and links", `<p>Hosting is provided by ${escapeHtml(legal.hostingProvider)}. Web fonts may be requested from Google. Official cover artwork may be delivered from Apple, YouTube or Mixcloud content networks, which receive the technical request needed to deliver the image. External destinations open only when selected, and players load only after a visitor chooses to load them.</p>`],
    ["Retention", `<p>Technical logs are kept only for as long as needed for security, diagnostics and applicable obligations, after which they are deleted or aggregated.</p>`],
    ["Your rights", `<p>You may request access, correction, erasure, restriction or objection where applicable. Clearly identify the request and the relevant page or interaction when making contact.</p>`]
  ]) : (es ? [
    ["Cookies del sitio", `<p>BladesBeats.com no instala cookies de analítica, publicidad o personalización. La preferencia de idioma se elige mediante enlaces separados y no requiere una cookie.</p>`],
    ["Contenido externo", `<p>Las portadas oficiales pueden solicitarse a las redes de Apple, YouTube o Mixcloud cuando se abre una página. Los reproductores de YouTube y Mixcloud no se cargan al abrirla; esa conexión adicional solo se crea cuando pulsas el botón para cargar el reproductor.</p>`],
    ["Enlaces externos", `<p>Si abres Spotify, Apple Music, YouTube, Mixcloud, Instagram, TikTok u otro sitio externo, ese servicio puede utilizar sus propias cookies según su política.</p>`],
    ["Cambios", `<p>Si en el futuro se añade una función que requiera cookies no esenciales, se actualizará esta información y se solicitará consentimiento cuando sea necesario.</p>`]
  ] : [
    ["Website cookies", `<p>BladesBeats.com does not set analytics, advertising or personalisation cookies. Language is selected through separate links and does not require a cookie.</p>`],
    ["External content", `<p>Official artwork may be requested from Apple, YouTube or Mixcloud content networks when a page opens. YouTube and Mixcloud players do not load at that point; that additional connection is made only after the visitor presses the player button.</p>`],
    ["External links", `<p>If you open Spotify, Apple Music, YouTube, Mixcloud, Instagram, TikTok or another external site, that service may use its own cookies under its policy.</p>`],
    ["Changes", `<p>If a future feature requires non-essential cookies, this information will be updated and consent will be requested where required.</p>`]
  ]);
  const navItems = [["notice", es ? "Aviso legal" : "Legal notice"], ["privacy", es ? "Privacidad" : "Privacy"], ["cookies", es ? "Cookies" : "Cookies"]];
  const body = `${pageHero(lang, es ? "Información del sitio" : "Website information", titles[kind], intros[kind])}<section class="prose"><div class="site-frame prose-grid"><aside class="prose-nav"><p>${es ? "Documentos" : "Documents"}</p>${navItems.map(([key, label]) => `<a href="${legalPaths(key)[lang]}"${key === kind ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</aside><article class="prose-content">${sections.map(([heading, html], index) => `<section id="section-${index + 1}"><h2>${escapeHtml(heading)}</h2>${html}</section>`).join("")}<p class="legal-note">${es ? "Última actualización" : "Last updated"}: ${escapeHtml(BUILD_DATE)}</p></article></div></section>`;
  const schema = { "@context": "https://schema.org", "@type": "WebPage", name: titles[kind], url: canonical, dateModified: BUILD_DATE };
  return htmlDocument({ lang, title: `${titles[kind]} | BladesBeats`, description: intros[kind], canonical, alternates: { en: `${SITE}${paths.en}`, es: `${SITE}${paths.es}` }, active: "", body, schema });
}

function buildUtilityPage(lang, type) {
  const es = lang === "es";
  const is404 = type === "404";
  const canonical = is404 ? `${SITE}/404.html` : `${SITE}/blocked/`;
  const body = `<section class="error-page"><div><p class="error-code">${is404 ? "404" : "REQUEST PAUSED"}</p><h1>${is404 ? (es ? "No está aquí." : "Not here.") : (es ? "Solicitud pausada." : "Request paused.")}</h1><p>${is404 ? (es ? "La página que buscas no existe o se ha movido." : "The page you are looking for does not exist or has moved.") : (es ? "La solicitud no se pudo completar. Vuelve al sitio principal e inténtalo más tarde." : "The request could not be completed. Return to the main site and try again later.")}</p><a class="button primary" href="${es ? "/es/" : "/"}">${es ? "Volver al inicio" : "Back to home"}</a></div></section>`;
  return htmlDocument({ lang, title: is404 ? "Page not found | BladesBeats" : "Request paused | BladesBeats", description: is404 ? "The requested BladesBeats page could not be found." : "The request could not be completed.", canonical, alternates: { en: canonical, es: canonical }, active: "", body, schema: { "@context": "https://schema.org", "@type": "WebPage", name: is404 ? "Page not found" : "Request paused" }, robots: "noindex,nofollow" });
}

function buildSitemap(pairs) {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`];
  for (const pair of pairs) {
    for (const [lang, route] of [["en", pair.en], ["es", pair.es]]) {
      lines.push("  <url>", `    <loc>${SITE}${route}</loc>`, `    <lastmod>${pair.lastmod || BUILD_DATE}</lastmod>`, `    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${pair.en}"/>`, `    <xhtml:link rel="alternate" hreflang="es" href="${SITE}${pair.es}"/>`, `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pair.en}"/>`, "  </url>");
    }
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function buildLlms(releases, sets, gigs, full = false) {
  const lines = ["# BladesBeats", "", "> Official website for BladesBeats, a Norwegian DJ and producer based in Sevilla, Spain.", "", "## Primary pages", "", `- [Music](${SITE}/music/): Complete verified catalogue`, `- [DJ sets](${SITE}/dj-sets/): Official Mixcloud sessions`, `- [Gigs](${SITE}/gigs/): Performances and appearances`, `- [About](${SITE}/about/): Artist biography`, `- [Contact](${SITE}/booking/): Official Instagram contact route`, "", "## Official profiles", "", ...Object.entries(config.platforms).map(([key, url]) => `- [${platformName(key)}](${url})`)];
  if (full) {
    lines.push("", "## Releases", "", ...releases.map((release) => `- [${displayReleaseTitle(release)}](${SITE}${detailPath(release, "en")}) — ${typeLabel(release.type, "en")}, ${releaseDate(release)}`), "", "## DJ sets", "", ...sets.map((set) => `- [${set.title}](${SITE}${setPath(set, "en")}) — ${releaseDate(set)}`), "", "## Gigs", "", ...gigs.map((gig) => `- [${gig.title}](${SITE}${gigPath(gig, "en")}) — ${gig.startDate}`));
  }
  return `${lines.join("\n")}\n`;
}

function build() {
  const releases = sortNewest(readJson("data/releases.json").filter((item) => !isExcludedRelease(item) && ["official", "published"].includes(item.status || "official")));
  const sets = sortNewest(readJson("data/dj-sets.json").filter((item) => ["official", "published"].includes(item.status || "official")));
  const gigs = [...readJson("data/gigs.json")].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const legal = readJson("data/legal.json");
  if (!releases.length) throw new Error("No approved releases are available for the homepage.");
  ensureDir(DIST);
  for (const entry of fs.readdirSync(DIST)) {
    fs.rmSync(path.join(DIST, entry), { recursive: true, force: true });
  }
  write("index.html", fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
  write(path.join("es", "index.html"), buildHome("es", releases, sets, gigs));
  write(path.join("music", "index.html"), buildMusicIndex("en", releases));
  write(path.join("es", "musica", "index.html"), buildMusicIndex("es", releases));
  for (const release of releases) {
    write(path.join("music", release.slug, "index.html"), buildReleasePage(release, releases, "en"));
    write(path.join("es", "musica", release.slug, "index.html"), buildReleasePage(release, releases, "es"));
  }
  write(path.join("dj-sets", "index.html"), buildSetIndex("en", sets));
  write(path.join("es", "sesiones", "index.html"), buildSetIndex("es", sets));
  for (const set of sets) {
    write(path.join("dj-sets", set.slug, "index.html"), buildSetPage(set, sets, "en"));
    write(path.join("es", "sesiones", set.slug, "index.html"), buildSetPage(set, sets, "es"));
  }
  write(path.join("gigs", "index.html"), buildGigsIndex("en", gigs));
  write(path.join("es", "eventos", "index.html"), buildGigsIndex("es", gigs));
  for (const gig of gigs) {
    write(path.join("gigs", gig.slug, "index.html"), buildGigPage(gig, "en"));
    write(path.join("es", "eventos", gig.slug, "index.html"), buildGigPage(gig, "es"));
  }
  write(path.join("about", "index.html"), buildAbout("en"));
  write(path.join("es", "sobre-bladesbeats", "index.html"), buildAbout("es"));
  write(path.join("booking", "index.html"), buildContact("en"));
  write(path.join("es", "contratar-dj-sevilla", "index.html"), buildContact("es"));
  for (const kind of ["notice", "privacy", "cookies"]) {
    write(path.join(legalPaths(kind).en.slice(1), "index.html"), buildLegal(kind, "en", legal));
    write(path.join(legalPaths(kind).es.slice(1), "index.html"), buildLegal(kind, "es", legal));
  }
  write("404.html", buildUtilityPage("en", "404"));
  write(path.join("blocked", "index.html"), buildUtilityPage("en", "blocked"));
  write("llms.txt", buildLlms(releases, sets, gigs, false));
  write("llms-full.txt", buildLlms(releases, sets, gigs, true));
  const sitemapPairs = [
    { en: "/", es: "/es/", lastmod: BUILD_DATE },
    { en: "/music/", es: "/es/musica/", lastmod: releaseDate(releases[0]) },
    ...releases.map((release) => ({ en: detailPath(release, "en"), es: detailPath(release, "es"), lastmod: release.lastmod || releaseDate(release) })),
    { en: "/dj-sets/", es: "/es/sesiones/", lastmod: releaseDate(sets[0]) },
    ...sets.map((set) => ({ en: setPath(set, "en"), es: setPath(set, "es"), lastmod: set.lastmod || releaseDate(set) })),
    { en: "/gigs/", es: "/es/eventos/", lastmod: gigs[0]?.startDate || BUILD_DATE },
    ...gigs.map((gig) => ({ en: gigPath(gig, "en"), es: gigPath(gig, "es"), lastmod: gig.startDate || BUILD_DATE })),
    { en: "/about/", es: "/es/sobre-bladesbeats/", lastmod: BUILD_DATE },
    { en: "/booking/", es: "/es/contratar-dj-sevilla/", lastmod: BUILD_DATE },
    ...["notice", "privacy", "cookies"].map((kind) => ({ en: legalPaths(kind).en, es: legalPaths(kind).es, lastmod: BUILD_DATE }))
  ];
  write("sitemap.xml", buildSitemap(sitemapPairs));
  copy("src/site.css", "assets/css/site.css");
  copy("src/site.js", "assets/js/site.js");
  copy("assets/js/catalog-hero.js");
  copy("assets/css/tokens.css");
  ["favicon.ico", "favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png", "og-card.png", "bladesbeats.webp"].forEach((file) => copy(file));
  copy("gigs/expoestepona/expotattoo-estepona-logo-wide.jpg");
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Built ${sitemapPairs.length * 2} indexable URLs with ${releases.length} approved releases, ${sets.length} sets and ${gigs.length} gigs.`);
}

build();
