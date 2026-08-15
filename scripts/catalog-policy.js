"use strict";

const BLOCKED_APPLE_ID_PREFIX = "178307293";
const EXCLUDED_APPLE_IDS = new Set(["0", "3"].map((suffix) => `${BLOCKED_APPLE_ID_PREFIX}${suffix}`));
const EXCLUDED_RELEASE_TITLE_KEYS = new Set(["i ll be there", "ill be there"]);
const EXCLUDED_RELEASE_TEXT = ["gabriela bee"];

function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(feat\..*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function displayReleaseTitle(release) {
  const featured = Array.isArray(release?.featuredArtists) && release.featuredArtists.length
    ? ` (feat. ${release.featuredArtists.join(", ")})`
    : "";
  return `${release?.title || ""}${featured}`;
}

function isExcludedRelease(release) {
  if (!release) return false;
  const appleId = String(release.appleMusicId || "");
  const appleUrl = String(release.appleMusicUrl || release.links?.appleMusic || "");
  if (EXCLUDED_APPLE_IDS.has(appleId)) return true;
  if ([...EXCLUDED_APPLE_IDS].some((id) => appleUrl.includes(id))) return true;

  const titleKeys = [normalizeCatalogText(release.title), normalizeCatalogText(displayReleaseTitle(release))].filter(Boolean);
  if (titleKeys.some((key) => EXCLUDED_RELEASE_TITLE_KEYS.has(key))) return true;

  const searchable = normalizeCatalogText([
    release.title,
    displayReleaseTitle(release),
    Array.isArray(release.featuredArtists) ? release.featuredArtists.join(" ") : ""
  ].join(" "));
  return EXCLUDED_RELEASE_TEXT.some((term) => searchable.includes(normalizeCatalogText(term)));
}

function assertNoExcludedContent(value, label = "generated output") {
  const normalized = normalizeCatalogText(value);
  const leaked = EXCLUDED_RELEASE_TEXT.some((term) => normalized.includes(normalizeCatalogText(term)))
    || [...EXCLUDED_RELEASE_TITLE_KEYS].some((term) => normalized.includes(term));
  if (leaked) throw new Error(`${label} violates the private catalogue exclusion policy.`);
}

module.exports = {
  assertNoExcludedContent,
  displayReleaseTitle,
  isExcludedRelease,
  normalizeCatalogText
};
