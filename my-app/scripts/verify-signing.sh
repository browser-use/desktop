#!/usr/bin/env bash
# scripts/verify-signing.sh — post-build signing verification.
#
# Asserts that the .app bundle and the nested agent_daemon binary are
# properly signed, that the DMG carries a stapled notarization ticket,
# and that Gatekeeper will accept the app.
#
# Run this after a signed build (scripts/release.sh or npm run make with
# signing env vars set). Exits non-zero on any verification failure.
#
# Usage:
#   ./scripts/verify-signing.sh
#   # or point at a specific app/dmg:
#   APP_PATH="out/My App-darwin-arm64/My App.app" \
#   DMG_PATH="out/make/my-app-1.0.0-arm64.dmg" \
#   ./scripts/verify-signing.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------

if [[ -n "${APP_PATH:-}" ]]; then
    APP="$APP_PATH"
else
    APP=$(find "$REPO_ROOT/out" -name "*.app" -maxdepth 4 | head -1)
fi

if [[ -n "${DMG_PATH:-}" ]]; then
    DMG="$DMG_PATH"
else
    DMG=$(find "$REPO_ROOT/out/make" -name "*.dmg" | head -1)
fi

DAEMON_BIN=""
if [[ -n "$APP" ]]; then
    DAEMON_BIN="$APP/Contents/Resources/agent_daemon"
fi

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

check_pass() {
    echo "[verify-signing.sh] PASS: $1"
    PASS=$((PASS + 1))
}

check_fail() {
    echo "[verify-signing.sh] FAIL: $1"
    FAIL=$((FAIL + 1))
}

section() {
    echo ""
    echo "[verify-signing.sh] --- $1 ---"
}

# ---------------------------------------------------------------------------
# 1. Verify .app bundle exists
# ---------------------------------------------------------------------------

section "App bundle"

if [[ -z "$APP" || ! -d "$APP" ]]; then
    echo "[verify-signing.sh] ERROR: .app bundle not found. Run 'npm run make' first."
    echo "[verify-signing.sh] Searched in: $REPO_ROOT/out"
    exit 1
fi

echo "[verify-signing.sh] App bundle: $APP"
check_pass "App bundle found"

# ---------------------------------------------------------------------------
# 2. codesign -dvvv on the .app bundle
# ---------------------------------------------------------------------------

section "App bundle code signature"

echo "[verify-signing.sh] Running: codesign -dvvv \"$APP\""
if codesign -dvvv "$APP" 2>&1; then
    check_pass "codesign -dvvv on .app bundle"
else
    check_fail "codesign -dvvv on .app bundle — run 'codesign -dvvv \"$APP\"' to see error"
fi

# Deep verify: checks every nested Mach-O
echo "[verify-signing.sh] Running: codesign --verify --deep --strict --verbose=2 \"$APP\""
if codesign --verify --deep --strict --verbose=2 "$APP" 2>&1; then
    check_pass "codesign --deep --strict on .app bundle"
else
    check_fail "codesign --deep --strict on .app bundle — nested binary may be unsigned"
fi

# ---------------------------------------------------------------------------
# 3. codesign -dvvv on the nested daemon binary
# ---------------------------------------------------------------------------

section "Nested agent_daemon binary"

if [[ -z "$DAEMON_BIN" || ! -f "$DAEMON_BIN" ]]; then
    echo "[verify-signing.sh] WARNING: agent_daemon not found at $DAEMON_BIN"
    echo "[verify-signing.sh] This is expected if python/build.sh has not been run."
    check_fail "agent_daemon binary not present"
else
    echo "[verify-signing.sh] Daemon binary: $DAEMON_BIN"
    echo "[verify-signing.sh] Running: codesign -dvvv \"$DAEMON_BIN\""
    if codesign -dvvv "$DAEMON_BIN" 2>&1; then
        check_pass "codesign -dvvv on agent_daemon"
    else
        check_fail "codesign -dvvv on agent_daemon — binary is not signed"
    fi

    # Verify hardened runtime flag is set
    echo "[verify-signing.sh] Checking hardened runtime flag on agent_daemon ..."
    CODESIGN_OUT=$(codesign -dvvv "$DAEMON_BIN" 2>&1 || true)
    if echo "$CODESIGN_OUT" | grep -q "flags=0x10000(runtime)"; then
        check_pass "agent_daemon has hardened runtime flag"
    else
        check_fail "agent_daemon missing hardened runtime flag — re-sign with --options runtime"
    fi
fi

# ---------------------------------------------------------------------------
# 4. spctl Gatekeeper assessment on the .app
# ---------------------------------------------------------------------------

section "Gatekeeper assessment (spctl)"

echo "[verify-signing.sh] Running: spctl --assess --type execute --verbose \"$APP\""
SPCTL_OUT=$(spctl --assess --type execute --verbose "$APP" 2>&1 || true)
echo "$SPCTL_OUT"

if echo "$SPCTL_OUT" | grep -qE "(accepted|source=Notarized Developer ID)"; then
    check_pass "spctl Gatekeeper accepts the .app"
elif echo "$SPCTL_OUT" | grep -q "rejected"; then
    check_fail "spctl Gatekeeper rejected the .app — ensure the app is notarized and ticket is stapled"
else
    check_fail "spctl result unclear — check output above"
fi

# ---------------------------------------------------------------------------
# 5. Notarization ticket stapled to DMG
# ---------------------------------------------------------------------------

section "DMG notarization staple"

if [[ -z "$DMG" || ! -f "$DMG" ]]; then
    echo "[verify-signing.sh] WARNING: no .dmg found in out/make/ — skipping DMG checks"
    echo "[verify-signing.sh] DMG verification requires 'npm run make' to have completed."
else
    echo "[verify-signing.sh] DMG: $DMG"

    echo "[verify-signing.sh] Running: xcrun stapler validate \"$DMG\""
    if xcrun stapler validate "$DMG" 2>&1; then
        check_pass "DMG has a valid stapled notarization ticket"
    else
        check_fail "DMG does not have a stapled notarization ticket — run 'xcrun stapler staple \"$DMG\"'"
    fi

    # Also check the notarization status via spctl on the mounted volume
    echo "[verify-signing.sh] Running: spctl --assess --type open --verbose \"$DMG\""
    DMG_SPCTL=$(spctl --assess --type open --verbose "$DMG" 2>&1 || true)
    echo "$DMG_SPCTL"
    if echo "$DMG_SPCTL" | grep -qE "(accepted|source=Notarized Developer ID)"; then
        check_pass "spctl accepts the DMG"
    else
        check_fail "spctl does not accept the DMG — verify notarization and staple"
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "[verify-signing.sh] =============================="
echo "[verify-signing.sh] Results: $PASS passed, $FAIL failed"
echo "[verify-signing.sh] =============================="

if [[ $FAIL -gt 0 ]]; then
    echo "[verify-signing.sh] One or more checks failed. See output above."
    exit 1
fi

echo "[verify-signing.sh] All checks passed. The build is signed and notarized."
exit 0
