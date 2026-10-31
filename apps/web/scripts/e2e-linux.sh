#!/usr/bin/env bash
# The site's Playwright suite in CI's own Linux image, against the local build on wrangler dev.
#
#   pnpm --filter web e2e:linux                         every spec of the site project
#   pnpm --filter web e2e:linux e2e/fold.spec.ts        one spec; any Playwright argument passes on
#
# Why it exists: macOS and Linux set the same web fonts differently, so a layout check can pass on
# a Mac and fail in CI. On 2026-10-31 two did: the hero's height at 390 px (fold.spec.ts) and the
# résumé fitting one sheet (about-print.spec.ts). CI runs e2e in mcr.microsoft.com/playwright at
# the version the lockfile installs; this runs the same image, so a Linux font difference shows up
# before the push rather than after it (delivery.md, "Local checks").
#
# The page loads from http://host.docker.internal:<port>, which is not a secure context (only
# https, localhost and 127.0.0.1 are), so three tests fail here that pass in CI, and are left out:
# the clipboard copy (palette.spec.ts), the known answer for the worker's WebAssembly policy
# (lab.spec.ts) and the known answer for a font file no text uses (glyphs.spec.ts). CI serves the
# preview over https, or wrangler dev on 127.0.0.1 inside the container, so it runs all three.
# E2E_LINUX_ALL=1 runs them anyway.
#
# Needs Docker and a build: pnpm build first, as for pnpm e2e. E2E_LINUX_PORT picks the port
# (default 8789, beside pnpm serve's 8787 and serve:fixture's 8788). E2E_LINUX_INSPECTOR_PORT picks
# the port wrangler dev's inspector takes beside it; unset, it is wrangler's default, as before:
# the first free port from 9229. Two runs started together can probe the same free port, and a
# sandbox may allow only the ports it names, so a run beside another is given both.
set -euo pipefail

web="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$web/../.." && pwd)"
port="${E2E_LINUX_PORT:-8789}"
inspector=()
[ -z "${E2E_LINUX_INSPECTOR_PORT:-}" ] || inspector=(--inspector-port "$E2E_LINUX_INSPECTOR_PORT")

command -v docker >/dev/null || {
  echo "e2e-linux: docker is not installed" >&2
  exit 2
}
[ -f "$web/dist/index.html" ] || {
  echo "e2e-linux: no build in apps/web/dist. Run pnpm build first" >&2
  exit 2
}

# The Playwright version the lockfile installs, read as CI's verify job reads it, so the image is
# the one CI's e2e job runs.
version="$(cd "$repo" && node -p "require('./apps/web/node_modules/@playwright/test/package.json').version")"
printf '%s' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' || {
  echo "e2e-linux: cannot read the Playwright version the lockfile installs (pnpm install first)" >&2
  exit 2
}

# Docker Desktop (macOS) delivers host.docker.internal to the host's loopback, so wrangler dev can
# stay on 127.0.0.1. On Linux, host-gateway is the bridge's address, which a server on loopback
# never hears: there it listens on every address, for as long as the run lasts.
ip=127.0.0.1
[ "$(uname -s)" = Darwin ] || ip=0.0.0.0

log="$(mktemp "${TMPDIR:-/tmp}/e2e-linux.XXXXXX")"
server=""
# shellcheck disable=SC2317,SC2329 # invoked by the EXIT trap below
stop() {
  # wrangler dev starts workerd under it: stop the whole process group, not just wrangler.
  if [ -n "$server" ]; then kill -TERM -- "-$server" 2>/dev/null || kill -TERM "$server" 2>/dev/null || true; fi
  rm -f "$log"
}
trap stop EXIT

set -m # the server gets a process group of its own, which stop() ends
(cd "$web" && exec node_modules/.bin/wrangler dev --local --ip "$ip" --port "$port" \
  ${inspector[@]+"${inspector[@]}"} --show-interactive-dev-session=false) >"$log" 2>&1 &
server=$!
set +m

# 60 s, as playwright.config.ts gives wrangler dev in CI.
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then break; fi
  if ! kill -0 "$server" 2>/dev/null; then
    echo "e2e-linux: wrangler dev exited before it served the build:" >&2
    cat "$log" >&2
    exit 2
  fi
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$port/" || {
  echo "e2e-linux: wrangler dev did not answer on port $port within a minute" >&2
  exit 2
}

# The three tests that need a secure context (above), by title.
skip=()
if [ "${E2E_LINUX_ALL:-}" != 1 ]; then
  skip=(--grep-invert 'Copy email address copies it|a worker whose policy refuses WebAssembly|a font file fetched for a face that draws no text')
fi

echo "e2e-linux: Playwright $version in mcr.microsoft.com/playwright:v$version-noble, against wrangler dev on port $port"
rc=0
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$repo:/work" -w /work/apps/web \
  -e BASE_URL="http://host.docker.internal:$port" \
  "mcr.microsoft.com/playwright:v$version-noble" \
  node node_modules/@playwright/test/cli.js test --project=site ${skip[@]+"${skip[@]}"} "$@" || rc=$?
exit "$rc"
