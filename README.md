# BladesBeats website

Launch-candidate source for [bladesbeats.com](https://bladesbeats.com). The repository is private; only the generated `dist/` directory is public website material.

## Non-negotiable publishing rules

- Source checks create review candidates only. They never edit the live catalogue and never publish.
- Candidate approval edits source data but still does not publish.
- A release must be built, validated, privately previewed and explicitly confirmed with `PUBLISH <version>` before the live symlink can change.
- Rollback is limited to versions that were previously published and requires `ROLLBACK <version>`.
- The temporary Release Desk exists only while the root SSH command is running. Ctrl+C stops it and removes its temporary firewall rule.
- The private catalogue exclusion policy is applied centrally to source checks, approvals and every generated public file.

## Local commands

```text
npm run build
npm run validate
npm test
npm run catalog:check
npm run check:links
```

`npm run build` deterministically writes the approved catalogue to a clean `dist/` directory without contacting third-party services. `npm test` rebuilds the site, validates every generated route and runs the Release Desk integration test. `npm run catalog:check` checks official sources and writes review candidates to ignored private state; it does not approve or publish anything. `npm run check:links` performs the slower network check of public platform destinations.

Use `npm run catalog:refresh` only when intentionally refreshing the approved source data and cached artwork before review. A normal release build never changes catalogue data.

## Structure

- `data/`: approved releases, DJ sets, gigs and legal data.
- `config/site.json`: public profile destinations and homepage feature pins.
- `src/`: public CSS and JavaScript source.
- `scripts/build-launch.js`: clean public-site generator.
- `scripts/check-releases.js`: daily official-source checker with credential-free Apple Music, YouTube and Mixcloud support.
- `release-desk/`: temporary authenticated review, preview, publish and rollback panel.
- `deploy/`: reviewed VPS launcher, constrained publish helper, Nginx reference and systemd timer.
- `dist/`: generated public output; never use the repository root as the Nginx document root.

The reviewed Nginx configuration serves the immutable release selected by `/srv/bladesbeats/current`. A release requires the explicit `PUBLISH <version>` confirmation in the Release Desk.

VPS setup and operating instructions are in `deploy/OPERATIONS.md`.
