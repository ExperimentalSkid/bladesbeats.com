# BladesBeats VPS operations

## Direct GitHub deployment to `/var/www/bladesbeats.com`

The public checkout can be updated from the reviewed GitHub branch with the guarded deployment helper. It refuses to overwrite tracked server changes, verifies the repository origin, allows only a fast-forward update, validates the generated site, tests Nginx, reloads it, and then crawls the production sitemap and canonical URLs.

For the first deployment that introduces the helper, run:

```bash
sudo git -C /var/www/bladesbeats.com fetch origin agent/launch-overhaul && \
sudo git -C /var/www/bladesbeats.com switch agent/launch-overhaul && \
sudo git -C /var/www/bladesbeats.com merge --ff-only origin/agent/launch-overhaul && \
sudo env BLADESBEATS_NGINX_CONFIG=/etc/nginx/sites-available/bladesbeats.com \
  bash /var/www/bladesbeats.com/deploy/deploy-from-github.sh
```

For later deployments, the command is:

```bash
sudo env BLADESBEATS_NGINX_CONFIG=/etc/nginx/sites-available/bladesbeats.com \
  bash /var/www/bladesbeats.com/deploy/deploy-from-github.sh
```

If the active virtual-host file has a different name, replace `/etc/nginx/sites-available/bladesbeats.com` with its exact path. The helper accepts only files inside `/etc/nginx/sites-available/` or `/etc/nginx/conf.d/`, saves a timestamped backup, installs the reviewed configuration, and automatically restores the backup if `nginx -t` fails. The verifier deliberately fails if source data, scripts, worker code, Git metadata, or deployment documentation are publicly reachable.

This runbook preserves the required workflow: SSH in, run one command, receive a temporary HTTPS URL and random one-time password, review a private draft, explicitly publish if correct, and press Ctrl+C to remove the panel and host-firewall rule.

## Before the first server change

Do not replace the live Nginx configuration until the existing server root, certificates, firewall and backup paths have been inspected on the VPS. The installer deliberately does not change the live Nginx root.

Required server components:

- Node.js 20 or newer
- Nginx
- Git
- OpenSSL
- Certbot 5.4 or newer, with short-lived IP certificate support
- `ufw` or `iptables`
- a checked-out copy of this private repository at `/srv/bladesbeats/source`

If a Hetzner Cloud Firewall filters inbound traffic, permit TCP port `43827` there. That network rule can remain in place: the launcher still opens the VPS host-firewall rule only while the panel runs and removes it on shutdown. Override the port with `RELEASE_DESK_PUBLIC_PORT` only if the same port is allowed in the Hetzner firewall.

## Install the tools without changing the live site

From a root SSH session, with the private repository already checked out:

```text
cd /srv/bladesbeats/source
bash deploy/install-release-tools.sh
```

The installer creates the unprivileged `bladesbeats-desk` service account, private state directories, the constrained root publish helper and the daily source-check timer. It validates a bootstrap preview and creates the new `/srv/bladesbeats/current` staging symlink if one does not exist. The active Nginx configuration is untouched, so this staging step does not change the public site.

Store optional source API credentials in `/etc/bladesbeats/release-check.env`, owned by root and mode `0600`:

```text
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
YOUTUBE_API_KEY=...
```

Apple Music, Mixcloud and the YouTube channel feed do not need credentials. A YouTube API key is optional and enables the API-based check. Spotify needs developer credentials; when they are absent, only Spotify is reported as skipped rather than treated as an empty catalogue.

## Start a temporary session

From any root SSH session:

```text
release-desk
```

The command prints a temporary address and a separate one-time password:

```text
URL:      https://203.0.113.10:43827/
Password: <random-one-time-password>
```

The password is printed only in the SSH terminal. It is exchanged once through the HTTPS login form, expires after ten minutes, and becomes a Secure, HttpOnly, SameSite=Strict session cookie. The raw password is not stored after server startup. The session closes after 20 minutes of inactivity or two hours maximum.

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

## Daily release checks

The enabled timer runs every day around 05:00 server time with a randomized delay. Inspect it with:

```text
systemctl status bladesbeats-release-check.timer
journalctl -u bladesbeats-release-check.service
```

Candidates and audit records live under `/var/lib/bladesbeats/release-desk`. Deployment history lives in `/var/lib/bladesbeats/deployments.jsonl`. No credentials or temporary access tokens belong in Git.

## Initial Nginx cutover

`deploy/nginx-bladesbeats.conf` is a reviewed reference, not an automatic overwrite. Before the first cutover, compare it with the active virtual host and confirm the existing Let’s Encrypt domain-certificate paths. Back up the active virtual host. The first change to point Nginx at `/srv/bladesbeats/current` is a separate, explicit live approval. If the first cutover must be reversed, restore that backed-up virtual host; after the first successful cutover, future panel publications and rollbacks change only the atomic release symlink.
