# BladesBeats website

Source for [bladesbeats.com](https://bladesbeats.com). The current EN/ES site is generated into this checkout by `scripts/build-pages.js`. Production serves only allowlisted public files staged outside the private Git checkout.

## Current site

```text
npm run build:offline
npm test
node scripts/stage-public-site.js . /path/to/new-empty-public-directory
```

`build:offline` merges the approved local catalogue and regenerates the static pages without fetching external sources. `npm run build` also fetches provider data and caches assets. The staging command validates sitemap targets and local links, rejects symbolic links and unexpected files inside public directories, and copies only public pages and assets. The destination must be fresh or empty and outside the checkout.

The active VPS helper is `deploy/deploy-from-github.sh`. It validates a candidate commit, stages a public-only release under `/var/www/bladesbeats-public/releases`, switches `current` atomically, checks the local HTTPS origin, and then advances the private checkout. See [VPS operations](deploy/OPERATIONS.md) for the first-cutover and normal commands.

## Repository layout

- `data/`: approved releases, DJ sets, gigs, and legal data.
- `config/site.json`: profile destinations and feature pins.
- `assets/`: current public media, fonts, CSS, and JavaScript.
- `scripts/build-pages.js`: current static-page generator.
- `scripts/validate-site.js`: full-checkout validator.
- `scripts/stage-public-site.js`: public-only release staging.
- `workers/`: Cloudflare contact-form Worker source.
- `deploy/`: VPS helper, Nginx configuration, and optional Release Desk tools.

The optional Release Desk in `release-desk/` has a separate `dist/` build and publishing workflow. Its release tree is not used by the current direct deployment.
