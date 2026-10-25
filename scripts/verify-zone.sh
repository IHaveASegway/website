#!/usr/bin/env bash
# The weekly zone audit: every row of security.md's "Zone hardening checklist", plus mail
# posture A. Token-free by design: DNS over HTTPS, RDAP, HTTP and TLS handshakes, the same view
# anyone on the internet has. It never needs, or sees, a Cloudflare credential.
#
# One line per check: PASS, FAIL, SKIP for what cannot be seen from outside, or WARN for a planned
# step that is late, which never fails the audit. Exit 1 on any FAIL, 2 when a tool is missing.
# Values that could locate a person are never printed.
#
# `verify-zone.sh --hsts-ramp <max-age>` prints row 8b alone, for that max-age, and touches no
# network: the known answers in apps/web/test/hsts-ramp.test.ts run it with TODAY and HSTS_CALENDAR.
set -uo pipefail # not -e: every check runs and reports its own result

ZONE="${ZONE:-ihaveasegway.com}" # overridable only to exercise the script against another domain
# A validating resolver run by someone other than the zone's DNS host, so a signature is checked
# by an outside party, the way most visitors' resolvers see it.
DOH="${DOH:-https://dns.google/resolve}"
# A server known to accept TLS 1.1: if this client cannot reach it with TLS 1.1, a refusal from
# the zone would prove nothing (security.md, the TLS row's note).
TLS11_CONTROL="${TLS11_CONTROL:-example.com}"
HSTS_RAMP="300 604800 2592000 31536000" # ADR 0011, in seconds
# When the next step of the ramp is due: the HSTS row of the maintenance calendar, the one place
# the runbook "HSTS ramp step" writes it. Overridable only for the known answers.
HSTS_CALENDAR="${HSTS_CALENDAR:-$(dirname "$0")/../docs/operations.md}"
EXPECTED_MX="route1.mx.cloudflare.net route2.mx.cloudflare.net route3.mx.cloudflare.net"
EXPECTED_SPF="v=spf1 include:_spf.mx.cloudflare.net ~all"
EXPECTED_DMARC="v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s"

failures=0
pass() { printf 'PASS  %-3s %s\n' "$1" "$2"; }
fail() {
  printf 'FAIL  %-3s %s\n' "$1" "$2"
  failures=$((failures + 1))
}
skip() { printf 'SKIP  %-3s %s\n' "$1" "$2"; }
warn() { # counts toward nothing; in Actions it also annotates the run
  printf 'WARN  %-3s %s\n' "$1" "$2"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::verify-zone row $1: $2"; fi
}
check() { # check <row> <what it proves> <command...>
  local row="$1" what="$2"
  shift 2
  if "$@" > /dev/null 2>&1; then pass "$row" "$what"; else fail "$row" "$what"; fi
}

# Row 8b: does the ramp move? ADR 0011 holds each step before the next, and the calendar row reads
# "Next: step <n>, due <YYYY-MM-DD>" once that date is known. A late step, or no date for the next
# one, is a WARN and never a FAIL: whether to take a one-way step is Joseph's call, and a stalled
# ramp blocks nothing. The script keeps no date of its own.
ramp_watch() { # ramp_watch <max-age the zone serves, or empty>
  local age="$1" today="${TODAY:-$(date -u +%Y-%m-%d)}" steps step=0 i next row record
  read -r -a steps <<< "$HSTS_RAMP"
  for i in "${!steps[@]}"; do [ "${steps[$i]}" = "$age" ] && step=$((i + 1)); done
  if [ "$step" -eq 0 ]; then
    skip 8b "HSTS ramp: the zone serves no step of it, so no next step to watch (row 8)"
    return
  fi
  local at="at step $step of ${#steps[@]} (max-age $age)"
  if [ "$step" -eq "${#steps[@]}" ]; then
    pass 8b "HSTS ramp: $at, the last; nothing is due (preload would be a new ADR)"
    return
  fi
  next=$((step + 1))
  row="$(grep -m 1 '^|[^|]*|[[:space:]]*The HSTS ramp' "$HSTS_CALENDAR" 2> /dev/null)"
  record="$(printf '%s' "$row" | sed -n 's/.*Next: step \([0-9]\), due \([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\).*/\1 \2/p')"
  local calendar="operations.md's maintenance calendar"
  if [ -z "$record" ]; then
    warn 8b "HSTS ramp: $at; no date recorded for step $next in $calendar"
  elif [ "${record% *}" != "$next" ]; then
    warn 8b "HSTS ramp: $at, but $calendar names step ${record% *}: no date recorded for step $next"
  elif [ "${today//-/}" -gt "$(printf '%s' "${record#* }" | tr -d -)" ]; then
    warn 8b "HSTS ramp: $at; step $next (max-age ${steps[$step]}) has been due since ${record#* }, by $calendar"
  else
    pass 8b "HSTS ramp: $at; step $next (max-age ${steps[$step]}) is due ${record#* }"
  fi
}

if [ "${1:-}" = --hsts-ramp ]; then
  ramp_watch "${2:-}"
  exit 0
fi

for tool in curl jq openssl; do
  command -v "$tool" > /dev/null || {
    echo "verify-zone: $tool is not installed" >&2
    exit 2
  }
done

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

now="$(date -u +%s)"
fetch() { curl -fsS --max-time 15 "$@"; }
# answer <name> <type>: the resolver's JSON, only when the lookup itself worked. NOERROR (0) and
# NXDOMAIN (3) are answers; SERVFAIL, a refusal or a transport error is not, so it never reads as
# "no records".
answer() {
  fetch -H 'accept: application/dns-json' "$DOH?name=$1&type=$2" | jq -e 'select(.Status == 0 or .Status == 3)'
}
records() { # records <name> <type>: one answer per line, quotes removed, split strings joined
  answer "$1" "$2" | jq -r --arg type "$2" '
    {"A": 1, "AAAA": 28, "MX": 15, "TXT": 16, "DS": 43, "CAA": 257}[$type] as $n
    | .Answer // [] | .[] | select(.type == $n) | .data' | sed -e 's/" "//g' -e 's/"//g'
}
seconds() { jq -rn --arg d "$1" '$d | sub("\\.[0-9]+"; "") | fromdateiso8601'; }
# handshake <host> <s_client options...>: the TLS version of a handshake that completed, or nothing.
# A failed handshake still prints the version it attempted ("Protocol: TLSv1.1", with no cipher),
# so only s_client's exit status says whether the server, and the certificate check, said yes.
handshake() {
  local host="$1" out
  shift
  out="$(openssl s_client -connect "$host:443" -servername "$host" "$@" < /dev/null 2> /dev/null)" || return 0
  printf '%s\n' "$out" | sed -n 's/^ *Protocol *: *\(TLSv[0-9.]*\).*/\1/p' | head -n 1
}
# protocol <host> <version flag>: at the default security level, with a certificate that must chain
# to a trusted root and name the host.
protocol() { handshake "$1" "$2" -verify_return_error -verify_hostname "$1"; }
# legacy <host>: a TLS 1.1 offer. OpenSSL 3 makes one only at security level 0 (security.md, the TLS
# row's note). No certificate check: only the protocol matters here.
legacy() { handshake "$1" -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0'; }

# --- Registration (RDAP) ---------------------------------------------------------------------------
fetch "https://rdap.verisign.com/com/v1/domain/$ZONE" > "$T/rdap.json" 2> /dev/null || : > "$T/rdap.json"
check 1 "registrar lock: RDAP status has client transfer prohibited" \
  jq -e '.status | index("client transfer prohibited")' "$T/rdap.json"

expires="$(jq -r '[.events[]? | select(.eventAction == "expiration") | .eventDate][0] // empty' "$T/rdap.json")"
if [ -n "$expires" ] && [ "$(seconds "$expires")" -gt $((now + 60 * 86400)) ]; then
  pass 2 "registration expires ${expires%%T*}, more than 60 days away"
else
  fail 2 "registration expiry missing, or within 60 days (${expires:-unknown})"
fi

# Row 3: the registrar's own RDAP holds the registrant record. Street, city and postal code must be
# redacted or empty (the state may show), and so must the address label, where a registrar can put
# the whole formatted address while leaving the fields empty. In jCard, an "adr" is
# ["adr", {"label": ...}, "text", [pobox, extended, street, city, region, postal code, country]].
registrar="$(jq -r '[.links[]? | select(.rel == "related" and ((.type // "") | test("rdap"))) | .href][0] // empty' "$T/rdap.json")"
if [ -n "$registrar" ] && fetch "$registrar" > "$T/registrar.json" 2> /dev/null; then
  # shellcheck disable=SC2016 # a jq program in single quotes, not shell
  check 3 "WHOIS privacy: the registrant's street, city, postal code and address label are redacted" jq -e '
    def hidden: (. // "") | tostring | test("^(\\[\\])?$|redact"; "i");
    [.. | objects | select((.roles? // []) | index("registrant"))] as $registrant
    | ($registrant | length) > 0
      and all($registrant[]; [.vcardArray[1][]? | select(.[0] == "adr")]
        | all(.[]; (.[1].label | hidden) and (.[3] as $v | ($v[2] | hidden) and ($v[3] | hidden) and ($v[5] | hidden))))' \
    "$T/registrar.json"
else
  fail 3 "WHOIS privacy: the registrar's RDAP record could not be read"
fi

# --- DNSSEC ------------------------------------------------------------------------------------------
check 4a "DNSSEC: a DS record is published at the parent" test -n "$(records "$ZONE" DS)"
check 4b "DNSSEC: answers validate (AD set by $DOH)" sh -c "curl -fsS --max-time 15 -H 'accept: application/dns-json' '$DOH?name=$ZONE&type=SOA' | jq -e '.AD == true'"
check 4c "DNSSEC: RDAP shows delegationSigned" jq -e '.secureDNS.delegationSigned == true' "$T/rdap.json"

# --- TLS ---------------------------------------------------------------------------------------------
tls12="$(protocol "$ZONE" -tls1_2)"
check 5a "TLS 1.2 is accepted, with a valid certificate for $ZONE" test "$tls12" = TLSv1.2
# A refusal proves something only if this client can offer TLS 1.1 (OpenSSL 3 will not at its
# default security level; SECLEVEL=0 lets it) and the zone answers at all: two known answers.
if [ "$(legacy "$TLS11_CONTROL")" != TLSv1.1 ]; then
  fail 5b "minimum TLS: this client cannot negotiate TLS 1.1 with $TLS11_CONTROL, so a refusal would prove nothing"
elif [ "$tls12" != TLSv1.2 ]; then
  fail 5b "minimum TLS: the zone does not answer over TLS, so a refusal would prove nothing"
elif [ "$(legacy "$ZONE")" = TLSv1.1 ]; then
  fail 5b "minimum TLS: the zone accepted TLS 1.1"
else
  pass 5b "minimum TLS: the zone refuses TLS 1.1 (known answer: $TLS11_CONTROL accepts it from this client)"
fi
check 6 "TLS 1.3 is accepted, with a valid certificate for $ZONE" test "$(protocol "$ZONE" -tls1_3)" = TLSv1.3

# --- HTTP through the zone ---------------------------------------------------------------------------
redirect() { curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{redirect_url}' "$1" 2> /dev/null; }
check 7 "Always Use HTTPS: http:// answers 301 to https://" test "$(redirect "http://$ZONE/")" = "301 https://$ZONE/"

curl -sS --max-time 15 -D "$T/headers" -o "$T/home.html" --compressed "https://$ZONE/" 2> /dev/null || : > "$T/headers"
header() { tr -d '\r' < "$T/headers" | grep -i "^$1:" | head -n 1 | sed 's/^[^:]*: *//'; }
hsts="$(header strict-transport-security)"
age="$(printf '%s' "$hsts" | tr '[:upper:]' '[:lower:]' | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')"
if [ -n "$age" ] && [[ " $HSTS_RAMP " == *" $age "* ]] && [[ "$hsts" =~ [Ii]nclude[Ss]ub[Dd]omains ]] && ! [[ "$hsts" =~ [Pp]reload ]]; then
  pass 8 "HSTS at a ramp step: $hsts"
else
  fail 8 "HSTS missing or off the ramp (ADR 0011): ${hsts:-none}"
fi
ramp_watch "$age"
skip 9 "SSL/TLS mode Full (strict): not observable without an origin; read in the dashboard"
check 10 "no zone feature rewrote the HTML: no /cdn-cgi/ in the page" sh -c "[ -s '$T/home.html' ] && ! grep -q '/cdn-cgi/' '$T/home.html'"
check 11 "no managed security-header transform: no X-XSS-Protection, Expect-CT or X-Frame-Options" \
  sh -c "[ -s '$T/headers' ] && ! grep -Eiq '^(x-xss-protection|expect-ct|x-frame-options):' '$T/headers'"
check 12 "Bot Fight Mode off: no challenge script in the page" sh -c "[ -s '$T/home.html' ] && ! grep -q '/cdn-cgi/challenge-platform/' '$T/home.html'"
fetch "https://$ZONE/robots.txt" > "$T/robots.txt" 2> /dev/null || : > "$T/robots.txt"
check 13 "AI crawlers allowed: robots.txt carries no Cloudflare-managed block" \
  sh -c "[ -s '$T/robots.txt' ] && ! grep -Eiq 'cloudflare|content-signal' '$T/robots.txt'"

# --- DNS records ---------------------------------------------------------------------------------------
# A lookup that failed is not "no record": the answer itself must arrive and hold no CAA record.
caa_absent() { answer "$ZONE" CAA | jq -e '[.Answer // [] | .[] | select(.type == 257)] | length == 0'; }
check 14 "no CAA record, so certificate issuance is not restricted by accident" caa_absent
check 15a "the apex resolves" test -n "$(records "$ZONE" A)$(records "$ZONE" AAAA)"
check 15b "www resolves (the proxied placeholder)" test -n "$(records "www.$ZONE" A)$(records "www.$ZONE" AAAA)"
check 15c "www answers 301 to the apex, keeping path and query" \
  test "$(redirect "https://www.$ZONE/a/?b=1")" = "301 https://$ZONE/a/?b=1"

mx="$(records "$ZONE" MX | awk '{print tolower($2)}' | sed 's/\.$//' | sort | tr '\n' ' ' | sed 's/ $//')"
check 16a "MX: Email Routing's three hosts, and no null MX" test "$mx" = "$EXPECTED_MX"
spf="$(records "$ZONE" TXT | grep -i '^v=spf1')"
check 16b "SPF: exactly one record, as Email Routing writes it" test "$spf" = "$EXPECTED_SPF"
dkim="$(records "cf2024-1._domainkey.$ZONE" TXT | head -n 1)"
has_key() { # an empty p= is a revoked key: a record that exists but signs nothing
  local re='^v=DKIM1;.*p=[A-Za-z0-9+/]{16}'
  [[ $dkim =~ $re ]]
}
check 16c "DKIM: cf2024-1._domainkey publishes a key" has_key
dmarc="$(records "_dmarc.$ZONE" TXT | tr -d ' ' | sed 's/;$//')"
check 16d "DMARC: p=reject, sp=reject, strict alignment" test "$dmarc" = "$EXPECTED_DMARC"

# --- security.txt ----------------------------------------------------------------------------------------
fetch "https://$ZONE/.well-known/security.txt" > "$T/security.txt" 2> /dev/null || : > "$T/security.txt"
stamp="$(sed -n 's/^Expires: *\([^ ]*\).*/\1/p' "$T/security.txt" | tr -d '\r')"
if grep -q '^Contact: mailto:hello@ihaveasegway.com' "$T/security.txt" && [ -n "$stamp" ] &&
  [ "$(seconds "$stamp" 2> /dev/null || echo 0)" -gt $((now + 30 * 86400)) ]; then
  pass 17 "security.txt is served, with Contact and an Expires more than 30 days away ($stamp)"
else
  fail 17 "security.txt is missing, lacks Contact, or expires within 30 days (${stamp:-no Expires})"
fi
skip 18 "workers_dev off and preview_urls on: enforced in verify by apps/web/test/wrangler.test.ts"

echo
if [ "$failures" -gt 0 ]; then
  echo "verify-zone: $failures check(s) failed"
  exit 1
fi
echo "verify-zone: every check passed"
