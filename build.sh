#!/usr/bin/env bash
#
# build.sh — package the Vision Miner Heating Test DWC plugin.
#
# DWC plugins are compiled inside a DuetWebControl checkout and share that
# checkout's webpack module registry at runtime, so a plugin MUST be built
# against the SAME DWC version that runs on the printer (3.5.4 here). Building
# against a different version yields a bundle that references host modules the
# printer lacks and fails to start ("can't access property call, … undefined").
#
# This script reuses the debug plugin's throwaway DWC 3.5.4 checkout (.dwc-build/)
# so your working DuetWebControl tree is never touched, builds the plugin, and
# copies the packaged .zip into ./dist.
#
#   ./build.sh            build (clones + installs on first run, then cached)
#   ./build.sh clean      remove the .dwc-build checkout and ./dist, then exit
#   DWC_VERSION=v3.5.3 ./build.sh    build against a different DWC tag
#
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Config (override via environment) --------------------------------------
DWC_VERSION="${DWC_VERSION:-v3.5.4}"                                   # must match the printer's DWC version
DWC_REPO="${DWC_REPO:-https://github.com/Duet3D/DuetWebControl.git}"
DWC_DIR="${DWC_DIR:-${PLUGIN_DIR}/../dwc-plugin-debug-tools/.dwc-build}"  # shared pinned checkout of the debug plugin

# --- Pretty logging ---------------------------------------------------------
if [ -t 1 ]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'
else
    C_RESET=""; C_BOLD=""; C_BLUE=""; C_GREEN=""; C_RED=""
fi
log()  { printf '\n%s==> %s%s\n' "${C_BOLD}${C_BLUE}" "$*" "${C_RESET}"; }
ok()   { printf '%s  ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
die()  { printf '\n%s✗ %s%s\n' "${C_BOLD}${C_RED}" "$*" "$C_RESET" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# --- clean subcommand -------------------------------------------------------
if [ "${1:-}" = "clean" ]; then
    log "Removing build checkout and artifacts"
    rm -rf "${DWC_DIR}" "${PLUGIN_DIR}/dist"
    ok "Clean."
    exit 0
fi

# --- Preconditions ----------------------------------------------------------
have git  || die "git not found on PATH."
have node || die "node not found on PATH."
have npm  || die "npm not found on PATH."
[ -f "${PLUGIN_DIR}/plugin.json" ] || die "plugin.json not found in ${PLUGIN_DIR}."

PLUGIN_ID="$(node -p "require('${PLUGIN_DIR}/plugin.json').id")"
PLUGIN_VER="$(node -p "require('${PLUGIN_DIR}/plugin.json').version")"

# --- 1. Dedicated DWC checkout, pinned to the printer's version -------------
if [ ! -d "${DWC_DIR}/.git" ]; then
    log "Cloning DuetWebControl ${DWC_VERSION} (one-time, shallow)…"
    git clone --quiet --depth 1 --branch "${DWC_VERSION}" "${DWC_REPO}" "${DWC_DIR}" \
        || die "Failed to clone ${DWC_REPO} at ${DWC_VERSION}."
    ok "Cloned to ${DWC_DIR#${PLUGIN_DIR}/}"
else
    # Ensure the pinned version is checked out and the tree is pristine, so the
    # auto-generated src/plugins/imports.ts never drifts between builds.
    log "Reusing DWC checkout (${DWC_VERSION})"
    if ! git -C "${DWC_DIR}" rev-parse --verify --quiet "refs/tags/${DWC_VERSION}" >/dev/null; then
        git -C "${DWC_DIR}" fetch --quiet --depth 1 origin tag "${DWC_VERSION}" 2>/dev/null || true
    fi
    git -C "${DWC_DIR}" checkout --quiet --force "${DWC_VERSION}" 2>/dev/null \
        || die "Could not check out ${DWC_VERSION} in ${DWC_DIR} (try: ./build.sh clean)."
    git -C "${DWC_DIR}" reset --hard --quiet "${DWC_VERSION}"
    git -C "${DWC_DIR}" clean -fdq -- src/plugins 2>/dev/null || true
    ok "Checkout is pristine"
fi

# --- 2. Install DWC build dependencies (cached) -----------------------------
if [ ! -d "${DWC_DIR}/node_modules" ]; then
    log "Installing DWC dependencies (one-time, a few minutes)…"
    ( cd "${DWC_DIR}" && npm install --no-audit --no-fund ) || die "npm install failed in ${DWC_DIR}."
    ok "Dependencies installed"
fi

# --- 3. Build the plugin against this DWC -----------------------------------
log "Building '${PLUGIN_ID}' v${PLUGIN_VER} against DWC ${DWC_VERSION}…"
( cd "${DWC_DIR}" && npm run build-plugin -- "${PLUGIN_DIR}" ) || die "Plugin build failed."

# --- 4. Publish the artifact into the plugin's own dist/ --------------------
zip="$(ls -t "${DWC_DIR}/dist/${PLUGIN_ID}"-*.zip 2>/dev/null | head -1)"
[ -n "${zip}" ] || die "Build reported success but no ${PLUGIN_ID}-*.zip was produced."
mkdir -p "${PLUGIN_DIR}/dist"
cp "${zip}" "${PLUGIN_DIR}/dist/"

log "Done"
ok "Built against DWC ${DWC_VERSION}"
ok "Artifact: dist/$(basename "${zip}")"
