#!/usr/bin/env bash
# B-3 — Certificate-validating HTTPS verification. TLS checks are ALWAYS on; this script
# never passes -k / --insecure. An optional CA bundle (OGC_CACERT) may be supplied to
# validate AGAINST — that still validates, it does not disable checks.
#
# Usage: verify-https.sh <https-url> [expected_substring]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

url="${1:-}"; expect="${2:-}"
[[ -n "$url" ]] || die "usage: verify-https.sh <https-url> [expected_substring]"
[[ "$url" == https://* ]] || die "refusing non-HTTPS url (TLS is required and never disabled): $url"

curl_args=( --fail --silent --show-error --location --max-time 20 )
if [[ -n "${OGC_CACERT:-}" ]]; then
  [[ -f "$OGC_CACERT" ]] || die "OGC_CACERT not found: $OGC_CACERT"
  curl_args+=( --cacert "$OGC_CACERT" )
fi

# Confirm 200 over a validated TLS connection (a cert failure makes curl exit non-zero).
code="$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "$url")" \
  || die "HTTPS request failed (TLS validation or transport error): $url"
[[ "$code" == "200" ]] || die "expected HTTP 200, got $code for $url"

if [[ -n "$expect" ]]; then
  body="$(curl "${curl_args[@]}" "$url")" || die "HTTPS body fetch failed: $url"
  grep -qF -- "$expect" <<<"$body" || die "expected substring not found in page: '$expect'"
fi
log "HTTPS OK — validated certificate, HTTP 200${expect:+, contains '$expect'}: $url"
