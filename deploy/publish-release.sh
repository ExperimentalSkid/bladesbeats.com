#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${BLADESBEATS_SOURCE:-/srv/bladesbeats/source}"
RELEASES_DIR="${BLADESBEATS_RELEASES_DIR:-/srv/bladesbeats/releases}"
CURRENT_LINK="${BLADESBEATS_CURRENT_LINK:-/srv/bladesbeats/current}"
LOG_DIR="${BLADESBEATS_LOG_DIR:-/var/lib/bladesbeats}"
NODE_BIN="${RELEASE_DESK_NODE:-$(command -v node || true)}"

[[ "${EUID}" -eq 0 ]] || { echo "Publish helper must run as root." >&2; exit 1; }
[[ -x "${NODE_BIN}" ]] || { echo "Node.js is not installed." >&2; exit 1; }
mkdir -p "${LOG_DIR}"

MODE="publish"
if [[ "${1:-}" == "--rollback" ]]; then
  MODE="rollback"
  VERSION="${2:-}"
  [[ "${VERSION}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid rollback version." >&2; exit 1; }
  TARGET="${RELEASES_DIR}/${VERSION}"
else
  TARGET="${1:-}"
fi
[[ -n "${TARGET}" && -d "${TARGET}" ]] || { echo "Release directory not found." >&2; exit 1; }

RELEASES_REAL="$(readlink -f "${RELEASES_DIR}")"
TARGET_REAL="$(readlink -f "${TARGET}")"
case "${TARGET_REAL}" in "${RELEASES_REAL}"/*) ;; *) echo "Release target is outside the approved directory." >&2; exit 1;; esac

VERSION="$("${NODE_BIN}" "${SOURCE_DIR}/deploy/verify-release.js" "${TARGET_REAL}")"
nginx -t >/dev/null
PREVIOUS="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
NEXT_LINK="${CURRENT_LINK}.next.$$"
ln -s "${TARGET_REAL}" "${NEXT_LINK}"
mv -Tf "${NEXT_LINK}" "${CURRENT_LINK}"

if ! curl --silent --show-error --fail --max-time 15 --resolve bladesbeats.com:443:127.0.0.1 https://bladesbeats.com/ --insecure >/dev/null; then
  if [[ -n "${PREVIOUS}" && -d "${PREVIOUS}" ]]; then
    RECOVERY_LINK="${CURRENT_LINK}.recovery.$$"
    ln -s "${PREVIOUS}" "${RECOVERY_LINK}"
    mv -Tf "${RECOVERY_LINK}" "${CURRENT_LINK}"
  fi
  echo "Health check failed; previous release restored." >&2
  exit 1
fi

printf '{"at":"%s","mode":"%s","version":"%s","previous":"%s"}\n' "$(date -u +%FT%TZ)" "${MODE}" "${VERSION}" "${PREVIOUS}" >> "${LOG_DIR}/deployments.jsonl"
echo "${MODE} complete: ${VERSION}"
