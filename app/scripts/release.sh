#!/usr/bin/env bash
# scripts/release.sh — local release helper: build, sign, notarize, staple, verify.
#
# This is the single command that produces a signed+notarized DMG once Apple
# Developer credentials are configured. Set the required env vars (see
# .env.example or SIGNING.md at the repo root), then run:
#
#   VERSION=1.0.0 bash scripts/release.sh
#
# Required env vars for a signed release:
#   SIGNING_IDENTITY              — "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID                      — Apple ID email (e.g. you@example.com)
#   APPLE_APP_SPECIFIC_PASSWORD   — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID                 — 10-char Team ID from developer.apple.com/account
#
# Without those vars the script still runs but produces an unsigned DMG and
# skips notarization/stapling (safe for local dev iteration).

set -euxo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

VERSION="${VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0-dev")}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

SHOULD_SIGN=false
if [[ -n "$SIGNING_IDENTITY" && "$SIGNING_IDENTITY" != TODO* ]]; then
    SHOULD_SIGN=true
fi

SHOULD_NOTARIZE=false
if [[ "$SHOULD_SIGN" == true && -n "$APPLE_ID" && -n "$APPLE_APP_SPECIFIC_PASSWORD" && -n "$APPLE_TEAM_ID" ]]; then
    SHOULD_NOTARIZE=true
fi

echo "[release.sh] ============================================================"
echo "[release.sh] Release build: version=$VERSION"
echo "[release.sh] Signing enabled: $SHOULD_SIGN"
echo "[release.sh] Notarization enabled: $SHOULD_NOTARIZE"
echo "[release.sh] ============================================================"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

echo "[release.sh] Checking prerequisites ..."
command -v python3 >/dev/null 2>&1 || { echo "[release.sh] ERROR: python3 not found"; exit 1; }
command -v npm    >/dev/null 2>&1 || { echo "[release.sh] ERROR: npm not found"; exit 1; }

if [[ "$SHOULD_SIGN" == true ]]; then
    command -v codesign >/dev/null 2>&1 || { echo "[release.sh] ERROR: codesign not found — run on macOS with Xcode CLI tools"; exit 1; }
fi

if [[ "$SHOULD_NOTARIZE" == true ]]; then
    command -v xcrun >/dev/null 2>&1 || { echo "[release.sh] ERROR: xcrun not found — Xcode CLI tools required"; exit 1; }
fi

echo "[release.sh] Prerequisites OK"

# ---------------------------------------------------------------------------
# Step 1 — Build Python daemon
# ---------------------------------------------------------------------------

echo "[release.sh] Step 1/6: Building Python daemon ..."
bash python/build.sh
echo "[release.sh] Step 1/6 done: daemon binary at python/dist/agent_daemon"

# ---------------------------------------------------------------------------
# Step 2 — Sign the daemon binary (must happen BEFORE forge packages the .app)
# ---------------------------------------------------------------------------

echo "[release.sh] Step 2/6: Signing Python daemon binary ..."
bash scripts/sign-python.sh python/dist/agent_daemon
echo "[release.sh] Step 2/6 done"

# ---------------------------------------------------------------------------
# Step 3 — Build Electron app + sign via Electron Forge (osxSign)
# ---------------------------------------------------------------------------

echo "[release.sh] Step 3/6: Building Electron app (npm run make) ..."

if [[ "$SHOULD_SIGN" == true ]]; then
    npm run make
else
    SKIP_SIGNING=1 npm run make
fi

echo "[release.sh] Step 3/6 done"

# List produced artifacts
echo "[release.sh] Artifacts in out/make/:"
find "$REPO_ROOT/out/make" -name "*.dmg" 2>/dev/null | while read -r dmg; do
    echo "  $dmg ($(du -sh "$dmg" | cut -f1))"
done

# ---------------------------------------------------------------------------
# Step 4 — Notarize (requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
# ---------------------------------------------------------------------------

echo "[release.sh] Step 4/6: Notarization ..."

if [[ "$SHOULD_NOTARIZE" == true ]]; then
    for DMG in "$REPO_ROOT"/out/make/*.dmg; do
        echo "[release.sh] Submitting $DMG to Apple notarization service ..."
        xcrun notarytool submit "$DMG" \
            --apple-id     "$APPLE_ID" \
            --password     "$APPLE_APP_SPECIFIC_PASSWORD" \
            --team-id      "$APPLE_TEAM_ID" \
            --wait
        echo "[release.sh] Notarization accepted for $DMG"
    done
else
    echo "[release.sh] Step 4/6 SKIPPED — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to enable"
fi

# ---------------------------------------------------------------------------
# Step 5 — Staple notarization ticket to the DMG
# ---------------------------------------------------------------------------

echo "[release.sh] Step 5/6: Stapling notarization ticket ..."

if [[ "$SHOULD_NOTARIZE" == true ]]; then
    for DMG in "$REPO_ROOT"/out/make/*.dmg; do
        echo "[release.sh] Stapling $DMG ..."
        xcrun stapler staple "$DMG"
        echo "[release.sh] Stapled $DMG"
    done
else
    echo "[release.sh] Step 5/6 SKIPPED — notarization must complete before stapling"
fi

# ---------------------------------------------------------------------------
# Step 6 — Verify with spctl
# ---------------------------------------------------------------------------

echo "[release.sh] Step 6/6: Verification ..."

if [[ "$SHOULD_SIGN" == true ]]; then
    bash scripts/verify-signing.sh
else
    echo "[release.sh] Step 6/6 SKIPPED — unsigned build, run verify-signing.sh after signing"
fi

echo "[release.sh] ============================================================"
echo "[release.sh] Release complete: version=$VERSION"
echo "[release.sh] ============================================================"

if [[ "$SHOULD_NOTARIZE" != true ]]; then
    echo ""
    echo "[release.sh] To produce a signed+notarized DMG, set these env vars and re-run:"
    echo "  export SIGNING_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
    echo "  export APPLE_ID=\"you@example.com\""
    echo "  export APPLE_APP_SPECIFIC_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\""
    echo "  export APPLE_TEAM_ID=\"XXXXXXXXXX\""
    echo "  bash scripts/release.sh"
    echo ""
    echo "[release.sh] See SIGNING.md at the repo root for the full setup guide."
fi
