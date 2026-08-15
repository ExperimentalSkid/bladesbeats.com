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
```

`npm run build` writes a clean static site to `dist/`. `npm test` validates all generated routes and runs the Release Desk integration test. `npm run catalog:check` checks official sources and writes review candidates to ignored private state; it does not approve or publish anything.

## Structure

- `data/`: approved releases, DJ sets, gigs and legal data.
- `config/site.json`: public profile destinations and homepage feature pins.
- `src/`: public CSS and JavaScript source.
- `scripts/build-launch.js`: clean public-site generator.
- `scripts/check-releases.js`: weekly official-source checker.
- `release-desk/`: temporary authenticated review, preview, publish and rollback panel.
- `deploy/`: reviewed VPS launcher, constrained publish helper, Nginx reference and systemd timer.
- `dist/`: generated public output; never use the repository root as the Nginx document root.

VPS setup and operating instructions are in `deploy/OPERATIONS.md`.
