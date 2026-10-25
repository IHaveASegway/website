#!/usr/bin/env bash
# Every check in the README, in order. Run after build/build.sh with
# NATIVE=1 (and SANITIZE=1 for the sanitizer pass).
#
#   test/run-all.sh
#
# Env: WORK (default /tmp/vroom-wasm-build), PLAYWRIGHT, CHROMIUM
# (see browser.mjs). Exits non-zero on the first failure.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIST=$(cd "$HERE/.." && pwd)
WORK=${WORK:-/tmp/vroom-wasm-build}
cd "$DIST"

echo "== fixtures are the recorded ones"
# Generated, not committed: the seeded generator must give the bytes the results were made from.
node test/gen-fixtures.mjs >/dev/null
got=$(cat test/fixtures/*.json | sha256sum | cut -d' ' -f1)
[ "$got" = "$(cat test/fixtures.sha256)" ] || { echo "gen-fixtures.mjs no longer gives the recorded fixtures" >&2; exit 1; }

echo "== wasm vs native g++/libstdc++ (unpatched upstream)"
VROOM_NATIVE="$WORK/vroom-native/bin/vroom" LABEL=gcc node test/verify.mjs | tail -3

if [ -x "$WORK/vroom-native-libcxx/bin/vroom" ]; then
  echo "== wasm vs native clang/libc++, byte for byte"
  VROOM_NATIVE="$WORK/vroom-native-libcxx/bin/vroom" LABEL=clang-libcxx EXACT=1 node test/verify.mjs | tail -3
fi

if [ -f "$WORK/out-sanitize/vroom.wasm" ]; then
  echo "== AddressSanitizer + UBSan + stack-overflow-check build vs native clang/libc++"
  VROOM_DIR="$WORK/out-sanitize" VROOM_NATIVE="$WORK/vroom-native-libcxx/bin/vroom" \
    LABEL=sanitize EXACT=1 SKIP_TIMEOUT_CHECK=1 SANITIZER=1 node test/verify.mjs 2>&1 | grep -v "^EXACT\|^UNORDERED\|^Heap resize"
fi

echo "== headless Chromium, module worker, strict CSP"
node test/browser.mjs | tail -1

echo "== wasm memory over 243 solves"
node test/memory.mjs | tail -2

echo "== sizes"
node test/sizes.mjs

echo "== solve times"
natives=(--native "$WORK/vroom-native/bin/vroom")
if [ -x "$WORK/vroom-native-libcxx/bin/vroom" ]; then
  natives+=(--native "$WORK/vroom-native-libcxx/bin/vroom")
fi
node test/bench.mjs "${natives[@]}"
