#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${BLADESBEATS_SOURCE:-/srv/bladesbeats/source}"
DESK_USER="bladesbeats-desk"

[[ "${EUID}" -eq 0 ]] || { echo "Run this installer as root." >&2; exit 1; }
[[ -f "${SOURCE_DIR}/release-desk/server.js" ]] || { echo "Source checkout missing at ${SOURCE_DIR}." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 20 or newer is required." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node.js 20 or newer is required." >&2; exit 1; }
command -v certbot >/dev/null || { echo "Certbot 5.4 or newer is required for IP certificates." >&2; exit 1; }
CERTBOT_VERSION="$(certbot --version 2>&1 | awk '{print $2}')"
[[ "$(printf '%s\n' '5.4' "${CERTBOT_VERSION}" | sort -V | head -n 1)" == "5.4" ]] || { echo "Certbot 5.4 or newer is required; found ${CERTBOT_VERSION:-unknown}." >&2; exit 1; }
command -v nginx >/dev/null || { echo "Nginx is required." >&2; exit 1; }

id "${DESK_USER}" >/dev/null 2>&1 || useradd --system --home-dir /var/lib/bladesbeats --create-home --shell /usr/sbin/nologin "${DESK_USER}"
install -d -o "${DESK_USER}" -g "${DESK_USER}" -m 0750 /var/lib/bladesbeats/release-desk
install -d -o "${DESK_USER}" -g "${DESK_USER}" -m 0755 /srv/bladesbeats/releases
chgrp -R "${DESK_USER}" "${SOURCE_DIR}"
chmod -R u=rwX,g=rX,o= "${SOURCE_DIR}"
install -d -o "${DESK_USER}" -g "${DESK_USER}" -m 0750 "${SOURCE_DIR}/dist"
chown -R "${DESK_USER}:${DESK_USER}" "${SOURCE_DIR}/data" "${SOURCE_DIR}/config" "${SOURCE_DIR}/dist"
chmod -R u=rwX,g=rX,o= "${SOURCE_DIR}/data" "${SOURCE_DIR}/config" "${SOURCE_DIR}/dist"

runuser -u "${DESK_USER}" -- node "${SOURCE_DIR}/scripts/build-launch.js"
runuser -u "${DESK_USER}" -- node "${SOURCE_DIR}/scripts/validate-build.js"
if [[ ! -e /srv/bladesbeats/current ]]; then
  BOOTSTRAP="/srv/bladesbeats/releases/bootstrap-preview-$(date -u +%Y%m%d%H%M%S)"
  install -d -o "${DESK_USER}" -g "${DESK_USER}" -m 0755 "${BOOTSTRAP}"
  cp -a "${SOURCE_DIR}/dist/." "${BOOTSTRAP}/"
  chown -R "${DESK_USER}:${DESK_USER}" "${BOOTSTRAP}"
  ln -s "${BOOTSTRAP}" /srv/bladesbeats/current
fi

install -o root -g root -m 0755 "${SOURCE_DIR}/deploy/release-desk" /usr/local/bin/release-desk
install -o root -g root -m 0755 "${SOURCE_DIR}/deploy/publish-release.sh" /usr/local/sbin/bladesbeats-publish
install -o root -g root -m 0644 "${SOURCE_DIR}/deploy/bladesbeats-release-check.service" /etc/systemd/system/bladesbeats-release-check.service
install -o root -g root -m 0644 "${SOURCE_DIR}/deploy/bladesbeats-release-check.timer" /etc/systemd/system/bladesbeats-release-check.timer
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/bladesbeats-publish *\n' "${DESK_USER}" > /etc/sudoers.d/bladesbeats-publish
chmod 0440 /etc/sudoers.d/bladesbeats-publish
visudo -cf /etc/sudoers.d/bladesbeats-publish >/dev/null
systemctl daemon-reload
systemctl enable --now bladesbeats-release-check.timer

echo "Release tools installed. The public Nginx root has not been changed."
echo "After the first release is prepared and approved, install the reviewed Nginx configuration separately."
