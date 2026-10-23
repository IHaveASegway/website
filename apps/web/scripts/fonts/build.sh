#!/usr/bin/env bash
# Cuts the self-hosted fonts from their pinned upstream sources (design-system.md, "Typography").
#
#   scripts/fonts/build.sh           re-cut everything and prove it matches the committed files
#   scripts/fonts/build.sh --write   re-cut, replace the committed files and record them in the lock
#
# Run from apps/web, on a laptop: the files change about once a year, so CI never runs this. It
# checks the committed files against fonts.lock.json instead (test/fonts.test.ts).
#
# Downloads are untrusted data. Each run downloads into a new, empty temporary directory, and
# cut.py refuses any file whose size or sha256 differs from the lock before a font parser reads
# it. fontTools runs in a throwaway virtual environment, installed only from hash-pinned wheels
# (requirements.txt), with `python -I`, so nothing from the working directory or the environment is
# imported. Nothing is installed globally, and the environment is deleted on exit.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/../.." && pwd)"
lock="$here/fonts.lock.json"
mode="${1:-check}"
case "$mode" in
check | --check) mode=check ;;
--write) mode=write ;;
*)
  echo "usage: scripts/fonts/build.sh [--write]" >&2
  exit 2
  ;;
esac

command -v uv >/dev/null || {
  echo "build.sh: needs uv (https://docs.astral.sh/uv/)" >&2
  exit 2
}

tmp="$(mktemp -d "${TMPDIR:-/tmp}/fonts.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/downloads" "$tmp/stage"

# Wheels only (--only-binary): building from a source archive would run its setup code.
uv venv --quiet --python 3.13 "$tmp/venv"
py="$tmp/venv/bin/python"
uv pip install --quiet --python "$py" --require-hashes --only-binary :all: -r "$here/requirements.txt"

"$py" -I "$here/cut.py" plan "$lock" | while read -r key _sha256 bytes url; do
  case "$url" in
  https://*) ;;
  *)
    echo "build.sh: $key is not an https URL" >&2
    exit 1
    ;;
  esac
  curl --fail --silent --show-error --location --proto '=https' --max-filesize "$bytes" \
    --output "$tmp/downloads/$key" "$url"
done

(cd "$tmp" && "$py" -I "$here/cut.py" cut "$lock" "$tmp/downloads" "$tmp/stage" "$app")
(cd "$tmp" && "$py" -I "$here/cut.py" "$mode" "$lock" "$tmp/stage" "$app")
