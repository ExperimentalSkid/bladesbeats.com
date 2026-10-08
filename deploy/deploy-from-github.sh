#!/usr/bin/env bash
set -Eeuo pipefail

SITE_DIR="${BLADESBEATS_SITE_DIR:-/var/www/bladesbeats.com}"
BRANCH="${BLADESBEATS_BRANCH:-agent/launch-overhaul}"
NGINX_CONFIG="${BLADESBEATS_NGINX_CONFIG:-}"
EXPECTED_REPOSITORY="ExperimentalSkid/bladesbeats.com"

[[ "${EUID}" -eq 0 ]] || { echo "Run this deployment with sudo." >&2; exit 1; }

SITE_REAL="$(readlink -f "${SITE_DIR}" 2>/dev/null || true)"
[[ "${SITE_REAL}" == "/var/www/bladesbeats.com" ]] || {
  echo "Refusing to deploy outside /var/www/bladesbeats.com (resolved: ${SITE_REAL:-missing})." >&2
  exit 1
}
[[ -d "${SITE_REAL}/.git" ]] || { echo "${SITE_REAL} is not a Git checkout." >&2; exit 1; }

for command in git node nginx systemctl; do
  command -v "${command}" >/dev/null || { echo "Required command is missing: ${command}" >&2; exit 1; }
done

if [[ -n "$(git -C "${SITE_REAL}" status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked server files have local changes. Deployment stopped without overwriting them." >&2
  git -C "${SITE_REAL}" status --short --untracked-files=no >&2
  exit 1
fi

REMOTE_URL="$(git -C "${SITE_REAL}" remote get-url origin)"
case "${REMOTE_URL}" in
  *github.com[:/]${EXPECTED_REPOSITORY}.git|*github.com[:/]${EXPECTED_REPOSITORY}) ;;
  *) echo "Unexpected origin remote: ${REMOTE_URL}" >&2; exit 1 ;;
esac

git -C "${SITE_REAL}" fetch --prune origin "${BRANCH}"

if git -C "${SITE_REAL}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git -C "${SITE_REAL}" switch "${BRANCH}"
else
  git -C "${SITE_REAL}" switch --track -c "${BRANCH}" "origin/${BRANCH}"
fi

PREVIOUS_SHA="$(git -C "${SITE_REAL}" rev-parse HEAD)"
git -C "${SITE_REAL}" merge --ff-only "origin/${BRANCH}"
DEPLOYED_SHA="$(git -C "${SITE_REAL}" rev-parse HEAD)"

node "${SITE_REAL}/scripts/validate-site.js" "${SITE_REAL}"

if [[ -n "${NGINX_CONFIG}" ]]; then
  NGINX_REAL="$(readlink -f "${NGINX_CONFIG}" 2>/dev/null || true)"
  case "${NGINX_REAL}" in
    /etc/nginx/sites-available/*|/etc/nginx/conf.d/*.conf) ;;
    *) echo "Refusing to replace unexpected Nginx path: ${NGINX_REAL:-missing}" >&2; exit 1 ;;
  esac
  [[ -f "${NGINX_REAL}" ]] || { echo "Nginx site configuration not found: ${NGINX_REAL}" >&2; exit 1; }
  NGINX_BACKUP="${NGINX_REAL}.before-bladesbeats-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "${NGINX_REAL}" "${NGINX_BACKUP}"
  install -m 0644 "${SITE_REAL}/deploy/nginx-bladesbeats.conf" "${NGINX_REAL}"
  if ! nginx -t; then
    cp -a "${NGINX_BACKUP}" "${NGINX_REAL}"
    nginx -t
    echo "Nginx validation failed; the previous configuration was restored." >&2
    exit 1
  fi
  echo "Nginx backup: ${NGINX_BACKUP}"
fi

nginx -t
systemctl reload nginx
node "${SITE_REAL}/scripts/verify-production.js" --origin=https://bladesbeats.com

echo "Deployment verified."
echo "Previous commit: ${PREVIOUS_SHA}"
echo "Deployed commit: ${DEPLOYED_SHA}"
