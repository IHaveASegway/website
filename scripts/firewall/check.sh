#!/usr/bin/env bash
# The content firewall (ADR 0007). The design, with its surfaces and exit codes, is in
# security.md, "Content firewall design"; this script is its only bespoke code.
#
#   check.sh                    CI: every surface for this event. Needs the built site and, except
#                               on the weekly rebuild, the commit range in FW_BASE..FW_HEAD.
#   check.sh --staged           pre-commit: the staged files, their names, and the identity that
#                               will commit them.
#   check.sh --range B H [REF]  pre-push: the commits in B..H with their messages, paths and
#                               identities; REF, the ref name being pushed; and H itself when it is
#                               an annotated tag.
#   check.sh --history          after a rule change: every commit, tag and ref name on every ref.
#   check.sh --pr-text          a pull request's title, body and branch name (pr-text.yml).
#
# Exit 0: clean. 1: a finding. 2: cannot prove clean. Output names a rule id, a file, a line and a
# commit; never a match, a matched line, an address, or anything derived from them.
#
# Environment: in CI (CI is set), GITLEAKS_CONFIG_TOML holds the rules, from the FIREWALL_RULES
# secret. Anywhere else the rules come only from ~/.config/ihaveasegway/firewall.toml, and a
# GITLEAKS_CONFIG_TOML left in the environment is ignored. FW_EVENT is the GitHub event; FW_BASE
# and FW_HEAD bound the commit range; PR_TITLE, PR_BODY and PR_BRANCH carry the pull request's
# text; DIST_DIR is the built site (default apps/web/dist).
set -euo pipefail
umask 077
export LC_ALL=C # names and messages are bytes here: no locale may reject or reinterpret them

# The rules hold at least this many, the canary included. The number is not a secret: raise it to
# the real count whenever rules are added. The canary must also be the last rule, so a truncated
# copy always loses it, whatever the count.
RULE_FLOOR=51

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fw.XXXXXX")"
in_actions=false
[ "${GITHUB_ACTIONS:-}" = true ] && in_actions=true

# Any exit that is not a deliberate 0, 1 or 2 becomes 2: an error is never read as clean, and
# never read as a finding either.
final=""
# shellcheck disable=SC2329 # invoked by the EXIT trap below
on_exit() {
  local rc=$?
  rm -rf "$T"
  if [ -z "$final" ] && [ "$rc" -ne 2 ]; then
    report_error "unexpected error (status $rc)"
    exit 2
  fi
}
trap on_exit EXIT

# Control characters (a newline in a file name, a terminal escape) become "?", so no value can
# start a new log line or a new workflow command.
printable() { printf '%s' "$1" | tr '\000-\037\177' '?'; }
# GitHub's workflow commands: "%" is escaped everywhere, and ":" and "," in a property. printable()
# has already replaced CR and LF, which would otherwise end the command.
data() { printable "$1" | sed -e 's/%/%25/g'; }
prop() { printable "$1" | sed -e 's/%/%25/g' -e 's/:/%3A/g' -e 's/,/%2C/g'; }

report_error() {
  if $in_actions; then
    echo "::error::$(data "content-firewall: cannot prove clean: $1")"
  else
    echo "content-firewall: cannot prove clean: $(printable "$1")" >&2
  fi
}
cannot_prove() {
  report_error "$1"
  exit 2
}

mkdir "$T/empty"           # the working directory of stdin scans, which read a .gitleaksignore from it
: >"$T/gitleaksignore"     # the suppressions every scan reads: none until a mode names the reviewed ones
mkdir "$T/tree" "$T/staged" # committed and staged files, byte for byte

is_sha() {
  local re='^[0-9a-f]{40}$'
  [[ $1 =~ $re ]]
}

findings=0
hide_paths=false # set when a file name itself matched: from then on, no path is printed
finding() {      # finding <rule> <surface> [file] [line] [commit]
  local rule="$1" surface="$2" file="${3:-}" line="${4:-}" commit="${5:-}" re='^[A-Za-z0-9_-]+$'
  findings=$((findings + 1))
  [[ $rule =~ $re ]] || rule="(a rule id that is not printable)"
  if $hide_paths; then file="" line=""; fi
  case "$line" in "" | *[!0-9]*) line="" ;; esac
  if [ -n "$commit" ]; then
    is_sha "$commit" || cannot_prove "a finding named a commit that is not a commit id"
    surface="$surface, commit ${commit:0:12}"
  fi
  if $in_actions; then
    if [ -n "$file" ]; then
      echo "::error file=$(prop "$file")${line:+,line=$line}::$(data "content-firewall $rule ($surface)")"
    else
      echo "::error::$(data "content-firewall $rule ($surface)")"
    fi
  else
    echo "content-firewall: $rule ($(printable "$surface"))${file:+ at $(printable "$file")${line:+:$line}}" >&2
  fi
}

# scan <surface> <directory to run in> <commit to report, or ""> <gitleaks arguments...>
# Standard input passes through, for "gitleaks stdin". gitleaks exits 3 on a finding (its own
# status 1 means both "found" and "failed"); anything other than 0 or 3 cannot prove clean. Its
# own output is never shown: a malformed config makes it print the rules.
scan() {
  local surface="$1" dir="$2" at="$3"
  shift 3
  local out="$T/report.json" rc=0 n=0 rule file line commit
  rm -f "$out"
  (cd "$dir" && exec "$GL" "$@" --no-banner --redact --exit-code 3 --ignore-gitleaks-allow \
    --log-level error --gitleaks-ignore-path "$T/gitleaksignore" \
    --report-format json --report-path "$out") >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    3) ;;
    *) cannot_prove "gitleaks could not scan $surface" ;;
  esac
  # One record per line: every control character in a field, the separator included, becomes "?".
  jq -r '.[] | [.RuleID, .File, .StartLine, .Commit] | map(. // "" | tostring | gsub("[[:cntrl:]]"; "?")) | join("\u001f")' \
    "$out" >"$T/report.txt" 2>/dev/null || cannot_prove "gitleaks reported a finding in $surface, but its report could not be read"
  while IFS=$'\x1f' read -r rule file line commit; do
    n=$((n + 1))
    finding "$rule" "$surface" "$file" "$line" "${commit:-$at}"
  done <"$T/report.txt"
  [ "$n" -gt 0 ] || cannot_prove "gitleaks reported a finding in $surface, but its report could not be read"
}

scan_text() { # scan_text <surface> <file> [commit]: a text file through "gitleaks stdin"
  scan "$1" "$T/empty" "${3:-}" stdin <"$2"
}

scan_paths() { # scan_paths <file holding one path per line>
  local before=$findings
  scan_text "file paths" "$1"
  [ "$findings" -eq "$before" ] || hide_paths=true
}

nul_lines() { tr '\0' '\n' | sed '/^$/d'; } # NUL-separated names, one per line, never quoted

scan_pdf() { # scan_pdf <file> <label>: a PDF's text and metadata
  if ! command -v pdftotext >/dev/null || ! command -v pdfinfo >/dev/null; then
    cannot_prove "a PDF is present and pdftotext or pdfinfo is missing, so PDFs are blocked"
  fi
  { pdftotext -q "$1" - && pdfinfo "$1"; } >"$T/pdf.txt" 2>/dev/null || cannot_prove "cannot read a PDF"
  scan "PDF text and metadata, $2" "$T/empty" "" stdin <"$T/pdf.txt"
}

# binary_surfaces <directory> <label>: files whose bytes the rules cannot read, found by their
# first bytes rather than their names. gitleaks skips every file it types as application/*, so an
# archive, an Office document or a database would pass unread. PDFs are extracted (surface 5);
# everything else of the kind is refused, the way a PDF is when it cannot be extracted.
binary_surfaces() {
  local f rel magic tar label
  find "$1" -type f -print0 >"$T/files" || cannot_prove "cannot list $2"
  while IFS= read -r -d '' f || [ -n "$f" ]; do
    rel="${f#"$1"/}"
    label="$2"
    $hide_paths || label="$2: $rel"
    magic="$(od -An -tx1 -N8 "$f" | tr -d ' \n')" || cannot_prove "cannot read a file in $2"
    case "$magic" in
      255044462d*) # %PDF-
        scan_pdf "$f" "$label"
        continue
        ;;
      504b0304* | 504b0506* | 504b0708* | 1f8b* | 1f9d* | 1fa0* | 425a68* | fd377a585a00* | 28b52ffd* | \
        377abcaf271c* | 526172211a07* | 4c5a4950* | 4d534346* | 213c617263683e* | d0cf11e0a1b11ae1* | \
        7b5c727466* | 25215053* | 53514c6974652066* | 0061736d* | 7f454c46* | 4d5a* | \
        feedface* | feedfacf* | cefaedfe* | cffaedfe* | cafebabe*)
        # zip and every format built on it (docx, xlsx, pptx, epub, jar), gzip, compress, bzip2,
        # xz, zstd, 7z, rar, lzip, cab, ar, OLE (doc, xls, ppt), RTF, PostScript, SQLite,
        # WebAssembly, and executables (ELF, PE, Mach-O, Java classes)
        cannot_prove "a file no rule can read ($label): an archive, an Office document or another packed format. Commit what it holds instead, or remove it"
        ;;
    esac
    tar="$({ od -An -c -j257 -N5 "$f" 2>/dev/null || true; } | tr -d ' \n')"
    [ "$tar" != ustar ] || cannot_prove "a file no rule can read ($label): a tar archive. Commit what it holds instead, or remove it"
  done <"$T/files"
}

# write_blob <object> <directory> <path>: a blob's bytes, exactly as committed. git archive and
# git checkout would apply attributes (export-ignore, export-subst, working-tree-encoding) that a
# committed .gitattributes controls; cat-file applies none.
write_blob() {
  local dir
  case "/$3/" in */../* | */./* | *//*) cannot_prove "a path in git is not a plain relative path" ;; esac
  dir="${3%/*}"
  [ "$dir" != "$3" ] || dir=.
  mkdir -p "$2/$dir" || cannot_prove "cannot copy a file out of git"
  git cat-file blob "$1" >"$2/$3" || cannot_prove "cannot read a file from git"
}

extract_tree() { # extract_tree <tree-ish> <directory>: every committed file
  local entry meta path mode type object
  git ls-tree -r -z --full-tree "$1" >"$T/ls-tree" || cannot_prove "cannot list the tracked tree"
  while IFS= read -r -d '' entry || [ -n "$entry" ]; do
    meta="${entry%%$'\t'*}" # "<mode> <type> <object>", then a tab and the path
    path="${entry#*$'\t'}"
    read -r mode type object <<<"$meta"
    [ "$type" = blob ] || continue # a submodule: its files are not in this repository
    write_blob "$object" "$2" "$path"
  done <"$T/ls-tree"
}

extract_staged() { # the staged version of every added, copied, modified, renamed or retyped file, and its name
  local meta mode object status path
  git diff --cached -z --raw --no-abbrev --diff-filter=ACMRT >"$T/staged.raw" || cannot_prove "cannot list the staged files"
  : >"$T/paths"
  while IFS= read -r -d '' meta; do
    # ":<old mode> <new mode> <old object> <new object> <status>", then the path; a rename or a
    # copy names the old path first
    read -r _ mode _ object status <<<"${meta#:}"
    IFS= read -r -d '' path || cannot_prove "cannot read the staged file list"
    case "$status" in R* | C*) IFS= read -r -d '' path || cannot_prove "cannot read the staged file list" ;; esac
    [ "$mode" != 160000 ] || continue # a submodule pointer
    write_blob "$object" "$T/staged" "$path"
    printf '%s\n' "$path" >>"$T/paths"
  done <"$T/staged.raw"
}

# reviewed_ignore <object>: the .gitleaksignore under review (committed, or staged for a commit),
# or none. gitleaks also reads one from the directory it scans, so every scan runs in a directory
# where that file is either absent or this same version.
reviewed_ignore() {
  if git cat-file -e "$1" 2>/dev/null; then
    git cat-file blob "$1" >"$T/gitleaksignore" || cannot_prove "cannot read .gitleaksignore"
  else
    : >"$T/gitleaksignore"
  fi
}
worktree_ignore_matches() { # a git scan runs in the working tree, so its .gitleaksignore must be the reviewed one
  [ -e "$repo/.gitleaksignore" ] || return 0
  cmp -s "$repo/.gitleaksignore" "$T/gitleaksignore" ||
    cannot_prove "the working tree's .gitleaksignore differs from the one being scanned; a suppression counts only once it is committed and reviewed (security.md, Rule-writing rules)"
}

# Identities: exact match against the allowlist, ignoring case.
[ -r "$here/allowed-identities.txt" ] || cannot_prove "the identity allowlist is missing"
sed -e 's/#.*//' -e 's/[[:space:]]//g' -e '/^$/d' "$here/allowed-identities.txt" |
  tr '[:upper:]' '[:lower:]' >"$T/allowed"
allowed() {
  local address
  case "$1" in "" | *[[:space:]]*) return 1 ;; esac
  address="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  grep -Fxq -- "$address" "$T/allowed"
}
email_of() { printf '%s' "$1" | sed -n 's/.*<\([^>]*\)>.*/\1/p'; } # from "Name <email> time zone"
one_address() {                                                      # one_address <trailer value>: its address, only if it holds exactly one
  local re='^[^<>]*<([^<>[:space:]]+@[^<>[:space:]]+)>$'
  [[ $1 =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
}

check_identities() { # check_identities <git log arguments...>
  local sha author committer trailers co email
  git log -z --format='%H%x1f%ae%x1f%ce%x1f%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x1e)' "$@" \
    >"$T/identities" || cannot_prove "cannot list the commits' identities"
  while IFS=$'\x1f' read -r -d '' sha author committer trailers || [ -n "$sha" ]; do
    is_sha "$sha" || cannot_prove "a commit record could not be read"
    allowed "$author" || finding identity "author not on the allowlist" "" "" "$sha"
    allowed "$committer" || finding identity "committer not on the allowlist" "" "" "$sha"
    [ -n "$trailers" ] || continue
    printf '%s\n' "$trailers" | tr '\036' '\n' >"$T/trailers"
    while IFS= read -r co; do
      email="$(one_address "$co")" || email=""
      if [ -z "$email" ] || ! allowed "$email"; then
        finding identity "Co-authored-by not on the allowlist" "" "" "$sha"
      fi
    done <"$T/trailers"
  done <"$T/identities"
}

scan_messages() { # scan_messages <git log arguments...>: each commit's message, alone
  local sha
  git log -z --format=%H "$@" >"$T/shas" || cannot_prove "cannot list the commits"
  while IFS= read -r -d '' sha || [ -n "$sha" ]; do
    is_sha "$sha" || cannot_prove "a commit record could not be read"
    git log -1 --format=%B "$sha" >"$T/message" || cannot_prove "cannot read a commit message"
    scan_text "commit message" "$T/message" "$sha"
  done <"$T/shas"
}

scan_tag() { # scan_tag <object>: if it is an annotated tag, its name, message and tagger, then any tag it points at
  local object="$1" depth=0 tagger type
  while :; do
    type="$(git cat-file -t "$object")" || cannot_prove "cannot read a pushed or tagged object"
    [ "$type" = tag ] || return 0
    depth=$((depth + 1))
    [ "$depth" -le 10 ] || cannot_prove "a chain of tags too long to follow"
    git cat-file tag "$object" >"$T/tag" || cannot_prove "cannot read a tag"
    scan_text "annotated tag" "$T/tag"
    tagger="$(sed -n 's/^tagger [^<]*<\([^>]*\)>.*/\1/p' "$T/tag" | head -n 1)"
    allowed "$tagger" || finding identity "tagger not on the allowlist"
    object="$(sed -n 's/^object //p' "$T/tag" | head -n 1)"
  done
}

scan_pr_text() { # the pull request's title, body and branch name, passed through env, never ${{ }}
  printf '%s\n%s\n%s\n' "${PR_TITLE:-}" "${PR_BRANCH:-}" "${PR_BODY:-}" >"$T/pr.txt"
  scan_text "pull request title, body or branch name" "$T/pr.txt"
}

# --- Git, as this script and gitleaks read it -------------------------------------------------------
# Both parse git's output, so the caller's git configuration must not change it, or a term passes
# unseen: colors break the parser, a -diff attribute turns a file into "Binary files differ", UTF-16
# log output hides a message from every rule, log.showRoot=false drops the first commit, an
# abbreviated or decorated commit line loses the commit id. These settings outrank every config file.
git_settings=(
  color.ui=never
  color.diff=never
  core.attributesFile=/dev/null
  core.quotePath=false
  diff.noprefix=false
  diff.mnemonicPrefix=false
  diff.relative=false
  diff.srcPrefix=a/
  diff.dstPrefix=b/
  format.pretty=medium
  i18n.logOutputEncoding=UTF-8
  log.abbrevCommit=false
  log.date=default
  log.decorate=false
  log.showRoot=true
  log.showSignature=false
)
export GIT_CONFIG_COUNT="${#git_settings[@]}"
i=0
for setting in "${git_settings[@]}"; do
  export "GIT_CONFIG_KEY_$i=${setting%%=*}" "GIT_CONFIG_VALUE_$i=${setting#*=}"
  i=$((i + 1))
done
# For git log -p as gitleaks runs it: --text reads files marked binary or -diff, --no-textconv and
# --no-ext-diff keep a configured converter from rewriting them, and --diff-merges=first-parent shows
# what a merge itself introduced, such as a conflict resolution. gitleaks splits this on spaces.
LOG_OPTS="--no-color --text --no-textconv --no-ext-diff --diff-merges=first-parent"

# --- Guards: every missing input is exit 2 --------------------------------------------------------

command -v git >/dev/null || cannot_prove "git is not installed"
command -v jq >/dev/null || cannot_prove "jq is not installed"
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || cannot_prove "not inside a git repository"
cd "$repo"
mode="${1:-ci}"

# The identity a commit is about to record, read with any "git -c user.email=..." the commit itself
# was given, before that is dropped below.
if [ "$mode" = --staged ]; then
  for role in author committer; do
    ident="$(git var "GIT_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')_IDENT" 2>/dev/null)" ||
      cannot_prove "git has no $role identity: set user.email for this clone"
    printf '%s %s\n' "$role" "$(email_of "$ident")" >>"$T/staged-identities"
  done
fi
# "git -c" from the command that ran a hook arrives here as GIT_CONFIG_PARAMETERS, which git reads
# after the settings above, so it would outrank them.
unset GIT_CONFIG_PARAMETERS
# Attributes from git's empty tree, that is, none: a committed .gitattributes cannot mark a file
# -diff or binary for any git command here (git 2.40 and later; --text covers older ones).
export GIT_ATTR_SOURCE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
# The variables that point git at this repository, which a hook sets. The git known answer below
# builds a scratch repository and must not write into this one.
repo_vars="$(git rev-parse --local-env-vars | grep -v '^GIT_CONFIG' || true)"

unset GITLEAKS_CONFIG # it would outrank the rules below
if [ -n "${CI:-}" ]; then
  [ -n "${GITLEAKS_CONFIG_TOML:-}" ] || cannot_prove "FIREWALL_RULES is not set for this run"
else
  # Local hooks read the private file and nothing else, so rules left in the environment by a test
  # or a debugging session cannot stand in for it.
  rules_file="$HOME/.config/ihaveasegway/firewall.toml"
  [ -r "$rules_file" ] || cannot_prove "no rules file at $rules_file. Create it, mode 600, as operations.md describes (access setup, step 5)"
  if [ -n "${GITLEAKS_CONFIG_TOML:-}" ]; then
    echo "content-firewall: ignoring GITLEAKS_CONFIG_TOML from the environment; outside CI the rules come only from $rules_file" >&2
  fi
  GITLEAKS_CONFIG_TOML="$(cat "$rules_file")"
  export GITLEAKS_CONFIG_TOML
fi
count="$(grep -c '^[[:space:]]*\[\[rules\]\]' <<<"$GITLEAKS_CONFIG_TOML" || true)"
[ "$count" -ge "$RULE_FLOOR" ] || cannot_prove "$count rules loaded, below the floor of $RULE_FLOOR"
last_id="$({ grep -E '^[[:space:]]*id[[:space:]]*=' <<<"$GITLEAKS_CONFIG_TOML" || true; } | tail -n 1 |
  sed -E "s/^[[:space:]]*id[[:space:]]*=[[:space:]]*[\"']([^\"']*)[\"'].*/\1/")"
[ "$last_id" = fw-canary ] ||
  cannot_prove "the last rule is not fw-canary. Keep the canary rule at the end of the rules, so a truncated copy always loses it (security.md, The canary)"

GL="$("$here/install-gitleaks.sh" "$T/bin")" || cannot_prove "no verified gitleaks binary"

# The canary: a fresh random string that only the secret's fw-canary rule knows. If gitleaks fell
# back to its default rules, or the secret is empty or malformed, it goes unseen.
printf 'zq-fw-canary-%s\n' "$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')" >"$T/canary"
rc=0
(cd "$T/empty" && exec "$GL" stdin --no-banner --redact --exit-code 3 --log-level error \
  --gitleaks-ignore-path "$T/empty") <"$T/canary" >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 3 ] || cannot_prove "the canary was not detected, so the rules did not load"

# The git path's own known answer: a scratch commit holding the canary must be reported, with its
# commit id, under the same settings. A git setting this script does not override, that still
# changes what gitleaks reads, fails here instead of hiding a term.
git_known_answer() {
  local rc=0 sha=""
  (
    for v in $repo_vars; do unset "$v"; done
    kat="$T/known-answer"
    git init -q --template= --object-format=sha1 "$kat" &&
      blob="$(git -C "$kat" hash-object -w --no-filters --stdin <"$T/canary")" &&
      tree="$(printf '100644 blob %s\tknown-answer.txt\n' "$blob" | git -C "$kat" mktree)" &&
      sha="$(GIT_AUTHOR_NAME=firewall GIT_AUTHOR_EMAIL=known-answer@example.invalid \
        GIT_COMMITTER_NAME=firewall GIT_COMMITTER_EMAIL=known-answer@example.invalid \
        git -C "$kat" commit-tree --no-gpg-sign -m "known answer" "$tree")" &&
      git -C "$kat" update-ref refs/heads/known-answer "$sha" &&
      printf '%s' "$sha" >"$T/known-answer.sha" || exit 9
    cd "$kat"
    exec "$GL" git --no-banner --redact --exit-code 3 --ignore-gitleaks-allow --log-level error \
      --gitleaks-ignore-path "$T/empty" --report-format json --report-path "$T/known-answer.json" \
      --log-opts="$LOG_OPTS --all" .
  ) >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 3 ] && sha="$(cat "$T/known-answer.sha")" &&
    [ "$(jq -r '.[0].Commit // empty' "$T/known-answer.json" 2>/dev/null)" = "$sha" ] ||
    cannot_prove "the git known answer failed: a commit holding the canary was not reported, so this machine's git output does not reach the scan intact"
}

# --- Surfaces -----------------------------------------------------------------------------------

case "$mode" in
  --staged)
    reviewed_ignore ":0:.gitleaksignore"
    extract_staged
    scan_paths "$T/paths"
    scan "staged files" "$T/staged" "" dir .
    binary_surfaces "$T/staged" "staged files"
    while read -r role email; do
      allowed "$email" || finding identity "the $role is not on the allowlist"
    done <"$T/staged-identities"
    ;;

  --range)
    base="$(git rev-parse --verify --quiet "${2:-}^{commit}")" || cannot_prove "unknown commit range"
    head="$(git rev-parse --verify --quiet "${3:-}")" || cannot_prove "unknown commit range"
    head_commit="$(git rev-parse --verify --quiet "$head^{commit}")" || cannot_prove "unknown commit range"
    ref="${4:-}"
    reviewed_ignore "$head_commit:.gitleaksignore"
    worktree_ignore_matches
    git log -z --format= --name-only --diff-merges=first-parent "$base..$head_commit" >"$T/paths.z" ||
      cannot_prove "cannot list the paths in the range"
    nul_lines <"$T/paths.z" | sort -u >"$T/paths"
    scan_paths "$T/paths"
    if [ -n "$ref" ]; then
      printf '%s\n' "$ref" >"$T/ref"
      scan_text "the pushed ref name" "$T/ref"
    fi
    git_known_answer
    scan "commits ${base:0:12}..${head_commit:0:12}" "$repo" "" git --log-opts="$LOG_OPTS $base..$head_commit" "$repo"
    scan_messages "$base..$head_commit"
    check_identities "$base..$head_commit"
    scan_tag "$head"
    ;;

  --history)
    reviewed_ignore "HEAD:.gitleaksignore"
    worktree_ignore_matches
    git log -z --all --format= --name-only --diff-merges=first-parent >"$T/paths.z" ||
      cannot_prove "cannot list the paths in the history"
    nul_lines <"$T/paths.z" | sort -u >"$T/paths"
    scan_paths "$T/paths"
    git for-each-ref --format='%(refname)' >"$T/refs" || cannot_prove "cannot list the refs"
    scan_text "ref names" "$T/refs"
    git_known_answer
    scan "history" "$repo" "" git --log-opts="$LOG_OPTS --all" "$repo"
    scan_messages --all
    check_identities --all
    git for-each-ref --format='%(objectname)' refs/tags >"$T/tags" || cannot_prove "cannot list the tags"
    while IFS= read -r tag; do scan_tag "$tag"; done <"$T/tags"
    ;;

  --pr-text)
    [ -n "${PR_TITLE:-}" ] && [ -n "${PR_BRANCH:-}" ] || cannot_prove "the pull request's text was not passed in"
    reviewed_ignore "HEAD:.gitleaksignore"
    scan_pr_text
    ;;

  ci)
    range=""
    if [ "${FW_EVENT:-}" != schedule ]; then
      case "${FW_BASE:-}" in "" | *[!0]*) ;; *) FW_BASE="" ;; esac # all zeros: no previous commit
      [ -n "${FW_BASE:-}" ] && [ -n "${FW_HEAD:-}" ] || cannot_prove "unknown commit range"
      for end in FW_BASE FW_HEAD; do
        given="${!end}"
        sha="$(git rev-parse --verify --quiet "$given^{commit}")" || sha=""
        is_sha "$sha" || cannot_prove "commit range end ${given:0:12} is not in this clone"
        printf -v "$end" '%s' "$sha"
      done
      range="$FW_BASE..$FW_HEAD"
    fi
    if [ "${FW_EVENT:-}" = pull_request ]; then
      [ -n "${PR_TITLE:-}" ] && [ -n "${PR_BRANCH:-}" ] || cannot_prove "the pull request's text was not passed in"
    fi
    dist="${DIST_DIR:-apps/web/dist}"
    [ -d "$dist" ] || cannot_prove "the built site is missing ($dist)"
    [ -n "$(find "$dist" -type f -print | head -n 1)" ] || cannot_prove "the built site is empty"
    find "$dist" -print0 >"$T/dist.z" || cannot_prove "a file or directory in the built site is unreadable"
    while IFS= read -r -d '' f; do
      [ -r "$f" ] || cannot_prove "a file or directory in the built site is unreadable"
    done <"$T/dist.z"
    find "$dist" -type l -print >"$T/links" || cannot_prove "cannot list the built site"
    [ ! -s "$T/links" ] ||
      cannot_prove "the built site holds a symbolic link, so the scan cannot prove what would be published"
    find "$dist" -name .gitleaksignore -print >"$T/dist-ignore" || cannot_prove "cannot list the built site"
    [ ! -s "$T/dist-ignore" ] ||
      cannot_prove "the built site holds a .gitleaksignore: it would suppress the built site's scan, and be served"

    reviewed_ignore "HEAD:.gitleaksignore"
    worktree_ignore_matches
    extract_tree HEAD "$T/tree"
    find "$T/tree" -mindepth 2 -name .gitleaksignore -print >"$T/nested-ignore" || cannot_prove "cannot list the tracked tree"
    [ ! -s "$T/nested-ignore" ] ||
      cannot_prove "a .gitleaksignore below the repository root: only the root one is reviewed and read"

    # 3: file names at HEAD, in the range and in the built site (a slug is a file name)
    git ls-tree -r -z --name-only --full-tree HEAD >"$T/paths.z" || cannot_prove "cannot list the tracked tree"
    if [ -n "$range" ]; then
      git log -z --format= --name-only --diff-merges=first-parent "$range" >>"$T/paths.z" ||
        cannot_prove "cannot list the paths in the range"
    fi
    (cd "$dist" && find . -mindepth 1 -print0) >>"$T/paths.z" || cannot_prove "cannot list the built site"
    nul_lines <"$T/paths.z" | sed 's#^\./##' | sort -u >"$T/paths"
    scan_paths "$T/paths"

    # 1: the tracked tree at HEAD, byte for byte; untracked files and node_modules are excluded by
    # construction
    scan "the tracked tree" "$T/tree" "" dir .

    # 2 and 3: the commit range, and each commit's message
    if [ -n "$range" ]; then
      git_known_answer
      scan "commits in ${FW_BASE:0:12}..${FW_HEAD:0:12}" "$repo" "" git --log-opts="$LOG_OPTS $range" "$repo"
      scan_messages "$range"
    fi

    # 3: the pull request's title, body and branch name
    if [ -n "${PR_TITLE:-}${PR_BODY:-}${PR_BRANCH:-}" ]; then scan_pr_text; fi

    # 4: the built output, the bytes that will be published
    scan "the built site" "$repo" "" dir "$dist"

    # 5: PDFs, and formats no rule can read, in the tree and in the built site
    binary_surfaces "$T/tree" "the tracked tree"
    binary_surfaces "$dist" "the built site"

    # 6: commit identities in the range
    if [ -n "$range" ]; then check_identities "$range"; fi
    ;;

  *) cannot_prove "unknown mode (use --staged, --range BASE HEAD [REF], --history or --pr-text)" ;;
esac

final=1
if [ "$findings" -gt 0 ]; then
  echo "content-firewall: $findings finding(s). Rule ids are opaque: the rules file says what each one guards." >&2
  exit 1
fi
echo "content-firewall: clean"
exit 0
