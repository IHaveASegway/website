#!/usr/bin/env bash
# Self-test for check.sh: proves exit 0, 1 and 2 on throwaway fixtures. The only rules besides the
# canary are throwaway ones for nonsense terms, so no real rule is needed, read or revealed.
# It runs in verify (delivery.md); a check that cannot fail proves nothing.
#
# Each case is one way a term could pass unseen or a scan could pass unproven: a file name git
# quotes, a merge, a .gitattributes, an archive, git settings that change git's output, rules left
# in the environment. Every case that finds something runs in both output formats, local and
# GitHub's annotations, and fails if either one prints a term or an address.
set -euo pipefail
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$here/check.sh"
W="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fwtest.XXXXXX")"
trap 'chmod -R u+rwX "$W" 2>/dev/null || true; rm -rf "$W"' EXIT

TERM_X="zq-test-term" # the throwaway terms: they name nothing
TERM_U="zq-tést-term" # the same with a non-ASCII letter, which git quotes in name listings
ok_email="58600977+IHaveASegway@users.noreply.github.com"
floor="$(sed -n 's/^RULE_FLOOR=\([0-9][0-9]*\).*/\1/p' "$check")"
[ -n "$floor" ] || {
  echo "test.sh: cannot read RULE_FLOOR from check.sh" >&2
  exit 2
}

# Fixtures never see the caller's git configuration, hooks, signing keys or private rules file:
# check.sh runs with a scratch HOME, and the gitleaks download cache is passed in explicitly.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 TZ=UTC
export GIT_AUTHOR_NAME=Fixture GIT_COMMITTER_NAME=Fixture GIT_EDITOR=true GIT_MERGE_AUTOEDIT=no
cache="${GITLEAKS_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/ihaveasegway/gitleaks}"
mkdir -p "$W/home"

canary_rule() {
  cat <<'EOF'
[[rules]]
id = "fw-canary"
regex = '''zq-fw-canary-[0-9a-f]{8}'''
keywords = ["zq-fw-canary-"]
EOF
}
throwaway_rules() { # the two throwaway rules, then filler rules up to the floor
  cat <<'EOF'
[[rules]]
id = "fw-test-01"
regex = '''(?i)\bzq-test-term\b'''
keywords = ["zq-test-term"]

[[rules]]
id = "fw-test-02"
regex = '''(?i)\bzq-tést-term\b'''
keywords = ["zq-tést-term"]
EOF
  local i=3
  while [ "$i" -lt "$floor" ]; do
    printf '\n[[rules]]\nid = "fw-test-filler-%s"\nregex = %s\nkeywords = ["zq-test-filler"]\n' \
      "$i" "'''zq-test-filler-$i'''"
    i=$((i + 1))
  done
}
rules() { # the shape the private file must have: the canary last
  throwaway_rules
  echo
  canary_rule
}
RULES="$(rules)"
# Rules that know nothing of the throwaway terms, though they would pass every guard: what a test
# could leave behind in GITLEAKS_CONFIG_TOML.
UNRELATED="$(printf '[[rules]]\nid = "fw-unrelated"\nregex = %s\nkeywords = ["zq-unrelated"]\n\n%s\n' \
  "'''zq-unrelated'''" "$(canary_rule)")"

# The private rules file for the cases that run as a hook does, outside CI.
mkdir -p "$W/hook-home/.config/ihaveasegway"
printf '%s\n' "$RULES" >"$W/hook-home/.config/ihaveasegway/firewall.toml"
chmod 600 "$W/hook-home/.config/ihaveasegway/firewall.toml"

# Git settings a person might have, each of which changed what git prints and hid a term from an
# earlier version of check.sh: colors, -diff and binary attributes, quoted names, one-line and
# abbreviated commit headers, no diff for the first commit, and UTF-16 messages.
hostile="$W/hostile.gitconfig"
printf '*.md -diff\n*.txt binary\n' >"$W/hostile.attributes"
cat >"$hostile" <<EOF
[color]
	ui = always
	diff = always
[core]
	attributesFile = $W/hostile.attributes
	quotePath = true
[diff]
	noprefix = true
	mnemonicPrefix = true
[log]
	showRoot = false
	abbrevCommit = true
	decorate = full
[format]
	pretty = oneline
[i18n]
	logOutputEncoding = UTF-16
EOF

new_repo() { # new_repo <name>: an empty repository, left as the working directory
  mkdir -p "$W/$1"
  cd "$W/$1"
  git init -q -b main .
  git config user.email "$ok_email"
  git config commit.gpgsign false
  git config tag.gpgsign false
}
built_site() { # a built site beside the repository's files, never committed
  mkdir -p apps/web/dist/.well-known
  printf '<!doctype html><title>Fixture</title>\n' >apps/web/dist/index.html
  printf 'Contact: mailto:fixture@example.invalid\n' >apps/web/dist/.well-known/security.txt
}
# fixture <name>: a repository with one clean commit and a built site, left as the working
# directory; BASE holds the first commit.
fixture() {
  new_repo "$1"
  printf 'A fixture.\n' >README.md
  git add README.md
  git commit -qm "Fixture: first commit"
  BASE="$(git rev-parse HEAD)"
  built_site
}
commit() { # commit <message>: commits everything staged and unstaged except the built site
  git add -A -- . ':!apps/web/dist'
  git commit -qm "$1"
}

# What check.sh must never print: either term, git's quoted form of the non-ASCII one, or any part
# of an identity (every identity in these fixtures that is not allowed is "Someone", at an address
# ending in example.invalid).
FORBIDDEN=("$TERM_X" "$TERM_U" 'zq-t\303\251st-term' 'someone' 'example.invalid')

failures=0
expect() { # expect <exit code> <what> [VAR=value ...] [-- check.sh arguments...]
  local want="$1" what="$2" got=0 got_actions=0 leaked="" s
  shift 2
  local vars=()
  while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
    vars+=("$1")
    shift
  done
  [ "$#" -gt 0 ] && shift
  local base=(HOME="$W/home" GITLEAKS_CACHE_DIR="$cache" CI=true GITLEAKS_CONFIG_TOML="$RULES"
    FW_EVENT=push FW_BASE="$BASE" FW_HEAD="$(git rev-parse HEAD)")
  env "${base[@]}" GITHUB_ACTIONS= ${vars[@]+"${vars[@]}"} "$check" "$@" >"$W/out" 2>&1 || got=$?
  if [ "$want" -eq 1 ]; then
    # Findings print paths and commits: check the annotation format too, whose logs go public.
    env "${base[@]}" GITHUB_ACTIONS=true ${vars[@]+"${vars[@]}"} "$check" "$@" >"$W/out-actions" 2>&1 ||
      got_actions=$?
  else
    : >"$W/out-actions"
    got_actions=$got
  fi
  for s in "${FORBIDDEN[@]}"; do
    if grep -Fqi -e "$s" "$W/out" "$W/out-actions"; then leaked="$s"; fi
  done
  if [ -n "$leaked" ]; then
    # The logging rule: output names rule ids, files, lines and commits, never what matched.
    printf 'FAIL  exit %s, and the output printed what it must not  %s\n' "$got" "$what"
    failures=$((failures + 1))
  elif [ "$got" -eq "$want" ] && [ "$got_actions" -eq "$want" ]; then
    printf 'ok    exit %s  %s\n' "$got" "$what"
  else
    printf 'FAIL  exit %s (annotations: %s), expected %s  %s\n' "$got" "$got_actions" "$want" "$what"
    sed 's/^/      /' "$W/out" "$W/out-actions"
    failures=$((failures + 1))
  fi
}

echo "check.sh self-test, rule floor $floor"

# --- Exit 0: clean ----------------------------------------------------------------------------------
fixture clean
printf 'Plain words.\n' >notes.md
commit "Add notes"
git tag -a v1 -m "Release one"
expect 0 "a clean range, tree, built site and identity"
expect 0 "the weekly rebuild: no range, tree and built site only" FW_EVENT=schedule FW_BASE= FW_HEAD=
expect 0 "a pull request with clean text" FW_EVENT=pull_request PR_TITLE="Add notes" PR_BRANCH=notes PR_BODY="Body."
expect 0 "an edited pull request's clean text" PR_TITLE="Add notes" PR_BRANCH=notes PR_BODY="Body." -- --pr-text
expect 0 "pre-push: a clean pushed range and ref name" -- --range "$BASE" HEAD refs/heads/notes
expect 0 "pre-push: a clean annotated tag" -- --range "$BASE" "$(git rev-parse v1)" refs/tags/v1
expect 0 "the full history, after a rule change" -- --history
expect 0 "clean, with git settings that change git's output" GIT_CONFIG_GLOBAL="$hostile"
printf 'Plain words.\n' >staged.md
git add staged.md
expect 0 "pre-commit outside CI, with the rules from the private file" CI= HOME="$W/hook-home" GITLEAKS_CONFIG_TOML= -- --staged

fixture suppressed
printf 'Some %s here.\n' "$TERM_X" >notes.md
printf 'notes.md:fw-test-01:1\n' >.gitleaksignore
commit "Add notes, with a reviewed suppression"
expect 0 "a committed .gitleaksignore suppresses its finding" FW_EVENT=schedule FW_BASE= FW_HEAD=
printf 'Edited, not committed.\n' >.gitleaksignore
expect 2 "pre-push: a .gitleaksignore edited in the working tree and not committed" -- --range "$BASE" HEAD
git checkout -q -- .gitleaksignore

# --- Exit 1: a finding --------------------------------------------------------------------------------
fixture in-file
printf 'Some %s here.\n' "$TERM_X" >notes.md
commit "Add notes"
expect 1 "the term in a committed file"
expect 1 "pre-push: the term in a pushed commit" -- --range "$BASE" HEAD
expect 1 "pre-push, with git settings that change git's output" GIT_CONFIG_GLOBAL="$hostile" -- --range "$BASE" HEAD

new_repo in-root
printf 'Some %s here.\n' "$TERM_X" >notes.txt
commit "The first commit"
BASE="$(git rev-parse HEAD)"
built_site
expect 1 "the full history: the term in the first commit, with log.showRoot off and *.txt binary" \
  GIT_CONFIG_GLOBAL="$hostile" -- --history

fixture removed-in-range
printf 'Some %s here.\n' "$TERM_X" >notes.md
commit "Add notes"
git rm -q notes.md
commit "Remove notes"
expect 1 "the term added and removed inside the range (history holds it)"
expect 1 "the term added and removed inside the range, with git settings that change git's output" \
  GIT_CONFIG_GLOBAL="$hostile"

fixture in-message
printf 'Plain words.\n' >notes.md
commit "Mention $TERM_X in the message"
expect 1 "the term in a commit message"
expect 1 "the term in a commit message, with git set to print messages in UTF-16" GIT_CONFIG_GLOBAL="$hostile"
expect 1 "the full history: the term in a message" -- --history

fixture in-path
printf 'Plain words.\n' >"$TERM_X.md"
commit "Add a page"
expect 1 "the term in a file name"

fixture in-path-unicode
printf 'Plain words.\n' >"notes-$TERM_U.md"
commit "Add a page"
expect 1 "a non-ASCII term in a file name, which git quotes"
expect 1 "pre-push: a non-ASCII term in a file name" -- --range "$BASE" HEAD
expect 1 "the full history: a non-ASCII term in a file name" -- --history
printf 'Plain words.\n' >"staged-$TERM_U.md"
git add "staged-$TERM_U.md"
expect 1 "pre-commit: a non-ASCII term in a staged file name" -- --staged

fixture in-path-newline
printf 'Some %s here.\n' "$TERM_X" >"draft"$'\n'"$TERM_X.md"
commit "Add a draft"
expect 1 "the term in a file name that holds a newline"

fixture in-dist
printf 'Plain words.\n' >notes.md
commit "Add notes"
printf 'Built %s.\n' "$TERM_X" >apps/web/dist/.well-known/extra.txt
expect 1 "the term only in the built site, in a hidden directory"

fixture in-dist-name
printf 'Plain words.\n' >notes.md
commit "Add notes"
mkdir -p "apps/web/dist/$TERM_X"
printf '<!doctype html><title>Built %s</title>\n' "$TERM_X" >"apps/web/dist/$TERM_X/index.html"
expect 1 "the term in a built page's directory name, which no output may print"

fixture in-pr
printf 'Plain words.\n' >notes.md
commit "Add notes"
expect 1 "the term in a pull request title" FW_EVENT=pull_request PR_TITLE="About $TERM_X" PR_BRANCH=notes
expect 1 "the term in a branch name" FW_EVENT=pull_request PR_TITLE="Add notes" PR_BRANCH="$TERM_X"
expect 1 "the term in an edited pull request body" PR_TITLE="Add notes" PR_BRANCH=notes PR_BODY="On $TERM_X." -- --pr-text

fixture merge-only
printf 'Line.\n' >resolution.md
commit "Add resolution"
git checkout -q -b side
printf 'Side.\n' >resolution.md
commit "Side"
git checkout -q main
printf 'Main.\n' >resolution.md
commit "Main"
git merge -q side >/dev/null 2>&1 || true
printf 'Resolved with %s.\n' "$TERM_X" >resolution.md
commit "Merge side"
printf 'Resolved.\n' >resolution.md
commit "Drop it again"
expect 1 "the term only in a merge's conflict resolution, removed after"
expect 1 "pre-push: the term only in a merge's conflict resolution" -- --range "$BASE" HEAD
expect 1 "the full history: the term only in a merge's conflict resolution" -- --history

fixture attributes-tree
printf 'kept.md export-ignore -diff\n' >.gitattributes
printf 'Some %s here.\n' "$TERM_X" >kept.md
commit "Add kept"
expect 1 "a file a committed .gitattributes marks export-ignore, in the weekly rebuild" FW_EVENT=schedule FW_BASE= FW_HEAD=

fixture attributes-range
printf 'kept.md -diff\n' >.gitattributes
printf 'Some %s here.\n' "$TERM_X" >kept.md
commit "Add kept"
printf 'Plain words.\n' >kept.md
commit "Clean kept"
expect 1 "a file a committed .gitattributes marks -diff, in the range"
expect 1 "pre-push: a file a committed .gitattributes marks -diff" -- --range "$BASE" HEAD
expect 1 "the full history: a file a committed .gitattributes marks -diff" -- --history

fixture identity
printf 'Plain words.\n' >notes.md
git add notes.md
git -c user.email=someone@example.invalid commit -qm "Add notes"
expect 1 "an author that is not on the allowlist"

fixture co-author
printf 'Plain words.\n' >notes.md
commit "$(printf 'Add notes\n\nCo-authored-by: Someone <someone@example.invalid>')"
expect 1 "a Co-authored-by address that is not on the allowlist"

fixture co-author-folded
printf 'Plain words.\n' >notes.md
commit "$(printf 'Add notes\n\nCo-authored-by: Someone\n  <someone@example.invalid>')"
expect 1 "a Co-authored-by trailer folded onto a second line"

fixture co-author-two
printf 'Plain words.\n' >notes.md
commit "$(printf 'Add notes\n\nCo-authored-by: Someone <someone@example.invalid> <%s>' "$ok_email")"
expect 1 "a Co-authored-by trailer with two addresses, the allowed one last"

fixture refs
printf 'Plain words.\n' >notes.md
commit "Add notes"
expect 1 "pre-push: the term in the pushed ref name" -- --range "$BASE" HEAD "refs/heads/$TERM_X"
git tag -a v1 -m "Release $TERM_X"
expect 1 "pre-push: the term in an annotated tag's message" -- --range "$BASE" "$(git rev-parse v1)" refs/tags/v1
expect 1 "the full history: the term in an annotated tag" -- --history
git tag -d v1 >/dev/null
git -c user.email=someone@example.invalid tag -a v2 -m "Release two"
expect 1 "pre-push: an annotated tag whose tagger is not on the allowlist" -- --range "$BASE" "$(git rev-parse v2)" refs/tags/v2
git tag -d v2 >/dev/null
git branch "$TERM_X"
expect 1 "the full history: the term in a branch name" -- --history

fixture staged
printf 'Some %s here.\n' "$TERM_X" >staged.md
git add staged.md
expect 1 "pre-commit: the term in the staged changes" -- --staged
expect 1 "pre-commit, with git settings that change git's output" GIT_CONFIG_GLOBAL="$hostile" -- --staged
printf 'staged.md:fw-test-01:1\n' >.gitleaksignore
expect 1 "pre-commit: an untracked .gitleaksignore suppresses nothing" -- --staged
rm .gitleaksignore
expect 1 "pre-commit outside CI: the private file's rules, not an inherited GITLEAKS_CONFIG_TOML" \
  CI= HOME="$W/hook-home" GITLEAKS_CONFIG_TOML="$UNRELATED" -- --staged
git reset -q
printf 'Plain words.\n' >staged.md
git add staged.md
expect 0 "pre-commit: clean staged changes" -- --staged
expect 1 "pre-commit: an identity that is not on the allowlist" GIT_AUTHOR_EMAIL=someone@example.invalid -- --staged

# --- Exit 2: cannot prove clean -------------------------------------------------------------------------
fixture guards
printf 'Plain words.\n' >notes.md
commit "Add notes"
expect 2 "the rules are not set in CI" GITLEAKS_CONFIG_TOML=
expect 2 "fewer rules than the floor" GITLEAKS_CONFIG_TOML="$(canary_rule)"
expect 2 "the canary is not the last rule, so a truncated copy could keep it" \
  GITLEAKS_CONFIG_TOML="$(canary_rule && echo && throwaway_rules)"
expect 2 "no canary rule, so the canary goes unseen" GITLEAKS_CONFIG_TOML="$(rules | sed 's/zq-fw-canary-\[0-9a-f\]{8}/zq-not-the-canary/')"
expect 2 "malformed rules (gitleaks fails to load them)" GITLEAKS_CONFIG_TOML="$(printf '%s\n[[rules\n' "$RULES")"
expect 2 "outside CI with no private rules file" CI= -- --staged
expect 2 "an unknown commit range" FW_BASE=0123456789abcdef0123456789abcdef01234567
expect 2 "a push with no previous commit" FW_BASE=0000000000000000000000000000000000000000
expect 2 "no commit range outside the weekly rebuild" FW_BASE=
expect 2 "the built site is missing" DIST_DIR=apps/web/no-such-dist
expect 2 "a pull request whose text was not passed in" FW_EVENT=pull_request PR_TITLE= PR_BRANCH=
expect 2 "an edited pull request whose text was not passed in" -- --pr-text
if [ "$(id -u)" -ne 0 ]; then
  chmod 000 apps/web/dist/index.html
  expect 2 "an unreadable file in the built site"
  chmod 644 apps/web/dist/index.html
fi
ln -s index.html apps/web/dist/link.html
expect 2 "a symbolic link in the built site"
rm apps/web/dist/link.html
printf '\n' >apps/web/dist/.gitleaksignore
expect 2 "a .gitleaksignore in the built site, which would suppress its scan"
rm apps/web/dist/.gitleaksignore
printf 'Built.\n' | gzip >apps/web/dist/notes.txt.gz
expect 2 "a gzip file in the built site, which no rule can read"
rm apps/web/dist/notes.txt.gz
printf 'PK\003\004 an office document\n' >apps/web/dist/cv.docx
expect 2 "an Office document (a zip inside) in the built site"
rm apps/web/dist/cv.docx

fixture archive
printf 'PK\003\004 not much of a zip\n' >bundle.zip
commit "Add a bundle"
expect 2 "a zip archive in the tracked tree"
printf 'Built.\n' | gzip >staged.gz
git add staged.gz
expect 2 "pre-commit: a staged gzip file" -- --staged

fixture nested-ignore
mkdir -p apps/web/public
printf '\n' >apps/web/public/.gitleaksignore
commit "Add a nested .gitleaksignore"
expect 2 "a .gitleaksignore below the repository root, which the built site would copy"

mkdir -p "$W/empty-cache"
version="$(sed -n 's/^version=//p' "$here/gitleaks.version")"
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) platform=linux_x64 ;;
  *) platform=darwin_arm64 ;;
esac
mkdir -p "$W/mirror/v$version"
printf 'not gitleaks\n' | gzip >"$W/mirror/v$version/gitleaks_${version}_${platform}.tar.gz"
expect 2 "a gitleaks archive whose sha256 does not match the pin" \
  GITLEAKS_CACHE_DIR="$W/empty-cache" GITLEAKS_DOWNLOAD_BASE="file://$W/mirror"
expect 2 "no gitleaks: the download fails" \
  GITLEAKS_CACHE_DIR="$W/empty-cache-2" GITLEAKS_DOWNLOAD_BASE="file://$W/no-such-mirror"

echo
if [ "$failures" -gt 0 ]; then
  echo "test.sh: $failures case(s) did not exit as expected" >&2
  exit 1
fi
echo "test.sh: every case exited as expected"
