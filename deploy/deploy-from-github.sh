#!/usr/bin/env bash
set -Eeuo pipefail

SITE_DIR="${BLADESBEATS_SITE_DIR:-/var/www/bladesbeats.com}"
BRANCH="${BLADESBEATS_BRANCH:-agent/launch-overhaul}"
NGINX_CONFIG="${BLADESBEATS_NGINX_CONFIG:-}"
PUBLIC_BASE="/var/www/bladesbeats-public"
RELEASES_DIR="${PUBLIC_BASE}/releases"
CURRENT_LINK="${PUBLIC_BASE}/current"
EXPECTED_REPOSITORY="ExperimentalSkid/bladesbeats.com"

[[ "${EUID}" -eq 0 ]] || { echo "Run this deployment with sudo." >&2; exit 1; }
umask 022

SITE_REAL="$(readlink -f "${SITE_DIR}" 2>/dev/null || true)"
[[ "${SITE_REAL}" == "/var/www/bladesbeats.com" ]] || {
  echo "Refusing to deploy outside /var/www/bladesbeats.com (resolved: ${SITE_REAL:-missing})." >&2
  exit 1
}
[[ -d "${SITE_REAL}/.git" ]] || { echo "${SITE_REAL} is not a Git checkout." >&2; exit 1; }
[[ ! -L "${PUBLIC_BASE}" && ! -L "${RELEASES_DIR}" ]] || {
  echo "The public release directories must not be symbolic links." >&2
  exit 1
}
[[ ! -e "${CURRENT_LINK}" || -L "${CURRENT_LINK}" ]] || {
  echo "${CURRENT_LINK} exists but is not a symbolic link." >&2
  exit 1
}
[[ -n "${NGINX_CONFIG}" ]] || {
  echo "Set BLADESBEATS_NGINX_CONFIG to the active site file for the public-root cutover." >&2
  exit 1
}
for command in git node nginx systemctl curl cmp mktemp flock; do
  command -v "${command}" >/dev/null || { echo "Required command is missing: ${command}" >&2; exit 1; }
done
exec 9>/run/bladesbeats-deploy.lock
flock -n 9 || { echo "Another BladesBeats deployment is running." >&2; exit 1; }

NGINX_REAL="$(readlink -f "${NGINX_CONFIG}" 2>/dev/null || true)"
case "${NGINX_REAL}" in
  /etc/nginx/sites-available/*|/etc/nginx/conf.d/*.conf) ;;
  *) echo "Refusing to replace unexpected Nginx path: ${NGINX_REAL:-missing}" >&2; exit 1 ;;
esac
[[ -f "${NGINX_REAL}" ]] || { echo "Nginx site configuration not found: ${NGINX_REAL}" >&2; exit 1; }
if [[ -n "$(git -C "${SITE_REAL}" status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked server files have local changes. Deployment stopped without overwriting them." >&2
  git -C "${SITE_REAL}" status --short --untracked-files=no >&2
  exit 1
fi
[[ "$(git -C "${SITE_REAL}" symbolic-ref --quiet --short HEAD || true)" == "${BRANCH}" ]] || {
  echo "The source checkout must be on ${BRANCH}." >&2
  exit 1
}
REMOTE_URL="$(git -C "${SITE_REAL}" remote get-url origin)"
case "${REMOTE_URL}" in
  *github.com[:/]${EXPECTED_REPOSITORY}.git|*github.com[:/]${EXPECTED_REPOSITORY}) ;;
  *) echo "Unexpected origin remote: ${REMOTE_URL}" >&2; exit 1 ;;
esac

git -C "${SITE_REAL}" fetch --prune origin "${BRANCH}"
PREVIOUS_SHA="$(git -C "${SITE_REAL}" rev-parse HEAD)"
TARGET_SHA="$(git -C "${SITE_REAL}" rev-parse "refs/remotes/origin/${BRANCH}^{commit}")"
git -C "${SITE_REAL}" merge-base --is-ancestor "${PREVIOUS_SHA}" "${TARGET_SHA}" || {
  echo "The remote branch cannot fast-forward the local checkout. No public files changed." >&2
  exit 1
}

mkdir -p "${RELEASES_DIR}"
chmod 0755 "${PUBLIC_BASE}" "${RELEASES_DIR}"
CANDIDATE_DIR="$(mktemp -d /var/www/bladesbeats-candidate.XXXXXXXX)"
STAGE_DIR="$(mktemp -d "${PUBLIC_BASE}/.staging.XXXXXXXX")"
HEALTH_FILE="$(mktemp /tmp/bladesbeats-origin.XXXXXXXX)"
RELEASE_DIR="${RELEASES_DIR}/${TARGET_SHA}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
NEXT_LINK="${PUBLIC_BASE}/.current-next.$$"
NGINX_BACKUP=""
PREVIOUS_TARGET=""
HAD_CURRENT=0
SWITCHED=0
ORIGIN_VERIFIED=0
WORKTREE_ADDED=0

rollback() {
  set +e
  if [[ "${SWITCHED}" -eq 1 && "${ORIGIN_VERIFIED}" -eq 0 ]]; then
    echo "Origin verification failed; restoring the previous public site and Nginx configuration." >&2
    rm -f "${NEXT_LINK}"
    if [[ "${HAD_CURRENT}" -eq 1 ]]; then
      ln -s "${PREVIOUS_TARGET}" "${NEXT_LINK}"
      mv -Tf "${NEXT_LINK}" "${CURRENT_LINK}"
    else
      rm -f "${CURRENT_LINK}"
    fi
    if [[ -n "${NGINX_BACKUP}" ]]; then
      cp -a "${NGINX_BACKUP}" "${NGINX_REAL}"
    fi
    nginx -t && systemctl reload nginx || echo "Automatic Nginx rollback needs manual inspection." >&2
  fi
}

cleanup() {
  local status=$?
  rollback
  rm -f "${NEXT_LINK}" "${HEALTH_FILE}"
  if [[ "${WORKTREE_ADDED}" -eq 1 ]]; then
    git -C "${SITE_REAL}" worktree remove --force "${CANDIDATE_DIR}" || true
  fi
  [[ ! -d "${CANDIDATE_DIR}" ]] || rmdir "${CANDIDATE_DIR}" 2>/dev/null || true
  [[ ! -d "${STAGE_DIR}" ]] || rm -rf -- "${STAGE_DIR}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

git -C "${SITE_REAL}" worktree add --detach "${CANDIDATE_DIR}" "${TARGET_SHA}"
WORKTREE_ADDED=1
node "${CANDIDATE_DIR}/scripts/validate-site.js" "${CANDIDATE_DIR}"
node "${CANDIDATE_DIR}/scripts/stage-public-site.js" "${CANDIDATE_DIR}" "${STAGE_DIR}"
chmod 0755 "${STAGE_DIR}"
mv "${STAGE_DIR}" "${RELEASE_DIR}"

if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS_TARGET="$(readlink "${CURRENT_LINK}")"
  HAD_CURRENT=1
fi
NGINX_BACKUP="${NGINX_REAL}.before-bladesbeats-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "${NGINX_REAL}" "${NGINX_BACKUP}"
echo "Nginx backup: ${NGINX_BACKUP}"

ln -s "${RELEASE_DIR}" "${NEXT_LINK}"
SWITCHED=1
mv -Tf "${NEXT_LINK}" "${CURRENT_LINK}"
install -m 0644 "${CANDIDATE_DIR}/deploy/nginx-bladesbeats.conf" "${NGINX_REAL}"
nginx -t
systemctl reload nginx
ACTIVE_NGINX="$(nginx -T 2>&1)"
[[ "${ACTIVE_NGINX}" == *"root ${CURRENT_LINK};"* ]] || {
  echo "The active Nginx configuration does not use the public-only release root." >&2
  exit 1
}

# Bypass Cloudflare and require the exact staged bytes from the local Nginx origin.
curl --fail --silent --show-error --max-time 20 --noproxy '*' \
  --resolve bladesbeats.com:443:127.0.0.1 \
  https://bladesbeats.com/ --output "${HEALTH_FILE}"
cmp "${RELEASE_DIR}/index.html" "${HEALTH_FILE}"
curl --fail --silent --show-error --max-time 20 --noproxy '*' \
  --resolve bladesbeats.com:443:127.0.0.1 \
  https://bladesbeats.com/sitemap.xml --output "${HEALTH_FILE}"
cmp "${RELEASE_DIR}/sitemap.xml" "${HEALTH_FILE}"
PRIVATE_STATUS="$(curl --silent --show-error --max-time 20 --noproxy '*' \
  --resolve bladesbeats.com:443:127.0.0.1 \
  https://bladesbeats.com/.git/config --output /dev/null --write-out '%{http_code}')"
[[ "${PRIVATE_STATUS}" == "404" ]] || {
  echo "The local origin returned HTTP ${PRIVATE_STATUS} for /.git/config; expected 404." >&2
  exit 1
}
ORIGIN_VERIFIED=1

# Update the now-private source checkout only after the public release is healthy.
if ! git -C "${SITE_REAL}" merge --ff-only "${TARGET_SHA}"; then
  echo "The origin is serving ${TARGET_SHA}, but the private source checkout did not advance. Resolve the checkout error before the next deployment." >&2
  exit 3
fi
echo "Origin release verified. Checking the Cloudflare-facing site."
if ! node "${CANDIDATE_DIR}/scripts/verify-production.js" --origin=https://bladesbeats.com; then
  echo "The origin is serving the new release, but Cloudflare-facing verification failed. The release remains live; inspect CDN cache or rules." >&2
  exit 2
fi
echo "Deployment verified."
echo "Previous commit: ${PREVIOUS_SHA}"
echo "Deployed commit: ${TARGET_SHA}"
echo "Public release: ${RELEASE_DIR}"
