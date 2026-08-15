# BladesBeats VPS operations

This runbook preserves the required workflow: SSH in, run one command, receive a temporary HTTPS URL on a randomized port, review a private draft, explicitly publish if correct, and press Ctrl+C to remove the panel and firewall rule.

## Before the first server change

Do not replace the live Nginx configuration until the existing server root, certificates, firewall and backup paths have been inspected on the VPS. The installer deliberately does not change the live Nginx root.

Required server components:

- Node.js 20 or newer
- Nginx
- Git
- OpenSSL
- Certbot with short-lived IP certificate support
- `ufw` or `iptables`
- a checked-out copy of this private repository at `/srv/bladesbeats/source`

If a Hetzner Cloud Firewall filters inbound traffic, it must permit the selected temporary panel port. The launcher only opens and closes the VPS host-firewall rule; it cannot change a separate Hetzner firewall without Hetzner API credentials.

## Install the tools without changing the live site

From a root SSH session, with the private repository already checked out:

```text
cd /srv/bladesbeats/source
bash deploy/install-release-tools.sh
```

The installer creates the unprivileged `bladesbeats-desk` service account, private state directories, the constrained root publish helper and the weekly source-check timer. It validates a bootstrap preview and creates the new `/srv/bladesbeats/current` staging symlink if one does not exist. The active Nginx configuration is untouched, so this staging step does not change the public site.

Store optional source API credentials in `/etc/bladesbeats/release-check.env`, owned by root and mode `0600`:

```text
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
YOUTUBE_API_KEY=...
```

Apple Music and Mixcloud checks do not need credentials. Missing Spotify or YouTube credentials cause those sources to be reported as skipped, not treated as successful empty catalogues.

## Start a temporary session

From any root SSH session:

```text
release-desk
```

The command prints an address like:

```text
https://203.0.113.10:43827/#token=<one-time-token>
```

The token is kept in the URL fragment so it is not sent in the first HTTP request or written to normal access logs. It can be exchanged once, expires after ten minutes, and becomes a Secure, HttpOnly, SameSite=Strict session cookie. The session closes after 20 minutes of inactivity or two hours maximum.

Press Ctrl+C in SSH to stop the process. The launcher trap terminates the panel, deletes the copied short-lived certificate material and removes the exact temporary firewall rule.

## Review and publish

1. Run the official-source check.
2. Review, edit, ignore or approve candidates. Approval changes source data only.
3. Set optional homepage feature pins. Unfilled positions use newest-first fallback.
4. Select **Prepare release**. This builds, validates, hashes and stores an immutable release directory.
5. Open the authenticated private preview and inspect it.
6. Review the added, changed and removed path list.
7. Type the exact phrase `PUBLISH <version>`.
8. Accept the final browser confirmation.

The constrained helper verifies every SHA-256 hash, rejects source/private paths and symbolic links, tests Nginx, switches the `current` symlink atomically, and performs a local HTTPS health check. If that health check fails, the previous symlink is restored automatically.

Publication also remains disabled until `data/legal.json` contains the approved legal operator name, legal address, tax identification number and legal contact email. Instagram remains the public booking route; the email is used for the legal notice and privacy-rights contact.

## Rollback

Only versions recorded as previously published appear in the rollback list. Type `ROLLBACK <version>` and accept the confirmation. Rollback uses the same validation, atomic switch and health check as publication.

## Weekly release checks

The enabled timer runs on Mondays around 05:00 server time with a randomized delay. Inspect it with:

```text
systemctl status bladesbeats-release-check.timer
journalctl -u bladesbeats-release-check.service
```

Candidates and audit records live under `/var/lib/bladesbeats/release-desk`. Deployment history lives in `/var/lib/bladesbeats/deployments.jsonl`. No credentials or temporary access tokens belong in Git.

## Initial Nginx cutover

`deploy/nginx-bladesbeats.conf` is a reviewed reference, not an automatic overwrite. Before the first cutover, compare it with the active virtual host and confirm the existing Let’s Encrypt domain-certificate paths. Back up the active virtual host. The first change to point Nginx at `/srv/bladesbeats/current` is a separate, explicit live approval. If the first cutover must be reversed, restore that backed-up virtual host; after the first successful cutover, future panel publications and rollbacks change only the atomic release symlink.
