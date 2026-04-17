#!/usr/bin/env bash
# scripts/build-dmg.sh — orchestrate the full DMG build sequence.
#
# Sequence:
#   1. Build PyInstaller daemon binary (python/build.sh)
#   2. Sign the daemon binary (scripts/sign-python.sh)  [skipped if no credentials]
#   3. Run electron-forge make (produces .dmg via @electron-forge/maker-dmg)
#
# Usage:
#   ./scripts/build-dmg.sh
#
# Environment variables:
#   SIGNING_IDENTITY   — Developer ID Application identity (optional; skips signing if unset)
#   SKIP_PYTHON_BUILD  — set to "1" to skip PyInstaller (use existing dist/agent_daemon)
#   ARCH               — passed through to python/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "[build-dmg.sh] Starting DMG build sequence"
echo "[build-dmg.sh] Working directory: $REPO_ROOT"

# Step 1 — PyInstaller build
if [[ "${SKIP_PYTHON_BUILD:-0}" != "1" ]]; then
    echo "[build-dmg.sh] Step 1: Building PyInstaller daemon ..."
    bash python/build.sh
else
    echo "[build-dmg.sh] Step 1: Skipping PyInstaller build (SKIP_PYTHON_BUILD=1)"
fi

# Step 2 — Sign daemon binary (no-ops gracefully if credentials unavailable)
echo "[build-dmg.sh] Step 2: Signing daemon binary ..."
bash scripts/sign-python.sh python/dist/agent_daemon

# Step 3 — Electron Forge make
echo "[build-dmg.sh] Step 3: Running electron-forge make ..."
npm run make

echo "[build-dmg.sh] Build complete."
echo "[build-dmg.sh] DMG output location: out/make/"
ls -lh out/make/ 2>/dev/null || echo "[build-dmg.sh] out/make/ not found — check forge make output above"
