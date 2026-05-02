#!/usr/bin/env bash
# scripts/sign-python.sh — codesign the PyInstaller daemon binary with hardened runtime.
#
# Must be run BEFORE `npm run make` / Electron Forge signing so that the nested
# binary is individually signed. Apple's notarization scanner verifies every
# Mach-O in the bundle; an unsigned nested binary causes notarization rejection.
#
# Usage:
#   SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
#     ./scripts/sign-python.sh python/dist/agent_daemon
#
# In CI (release.yml) SIGNING_IDENTITY is populated from repository secrets.
#
# TODO (requires Apple Developer credentials — not available in this session):
#   1. Set SIGNING_IDENTITY to your "Developer ID Application: ..." identity.
#      List available identities with: security find-identity -v -p codesigning
#   2. Ensure the signing certificate is imported into the CI keychain.
#      Use `security import cert.p12 -k ~/Library/Keychains/login.keychain-db`
#   3. For CI: set secrets.APPLE_DEVELOPER_CERTIFICATE_P12_BASE64 and
#      secrets.APPLE_DEVELOPER_CERTIFICATE_PASSWORD in GitHub repo settings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BINARY="${1:-$REPO_ROOT/python/dist/agent_daemon}"
ENTITLEMENTS="$REPO_ROOT/entitlements.plist"

# TODO: replace with real Developer ID identity when Apple credentials are available.
SIGNING_IDENTITY="${SIGNING_IDENTITY:-TODO_REPLACE_WITH_DEVELOPER_ID_APPLICATION_IDENTITY}"

if [[ "$SIGNING_IDENTITY" == TODO_* ]]; then
    echo "[sign-python.sh] WARNING: SIGNING_IDENTITY is a placeholder."
    echo "[sign-python.sh] Set the SIGNING_IDENTITY env var to your Developer ID Application identity."
    echo "[sign-python.sh] Skipping signing — binary will be unsigned (local dev only)."
    exit 0
fi

if [[ ! -f "$BINARY" ]]; then
    echo "[sign-python.sh] ERROR: binary not found at $BINARY"
    echo "[sign-python.sh] Run python/build.sh first."
    exit 1
fi

if [[ ! -f "$ENTITLEMENTS" ]]; then
    echo "[sign-python.sh] ERROR: entitlements.plist not found at $ENTITLEMENTS"
    exit 1
fi

echo "[sign-python.sh] Signing $BINARY"
echo "[sign-python.sh] Identity: $SIGNING_IDENTITY"
echo "[sign-python.sh] Entitlements: $ENTITLEMENTS"

codesign \
    --force \
    --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    "$BINARY"

echo "[sign-python.sh] Verifying signature ..."
codesign --verify --verbose=2 "$BINARY"

echo "[sign-python.sh] Checking Gatekeeper acceptance ..."
spctl --assess --type execute --verbose "$BINARY" 2>&1 || {
    echo "[sign-python.sh] spctl assessment failed — expected without notarization on the binary itself."
    echo "[sign-python.sh] The outer .app notarization covers nested binaries."
}

echo "[sign-python.sh] Done. Binary is signed with hardened runtime."
