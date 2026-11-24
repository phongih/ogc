#!/usr/bin/env bash
# OGC Platform (VM 2) nightly backup: pg_dump of `ogc` and `iios_mock` → local copy (root, 600) → upload
# to a GCS bucket outside the VM. SYNTHETIC staging data only.
#
# The VM's service account may only CREATE objects in the bucket (roles/storage.objectCreator): it
# cannot read, overwrite or delete what it uploaded, and every upload asks GCS to refuse an existing
# name (ifGenerationMatch=0). The bucket keeps each object 30 days (retention), then deletes it.
#
#   sudo OGC_BACKUP_BUCKET=<bucket> /usr/local/sbin/ogc-backup      (cron: /etc/cron.d/ogc-backup-nightly)
#
# Fail-closed: any step that fails exits non-zero with "[backup][ERROR] …"; nothing half-written is
# kept (dumps are written as *.part, checked with pg_restore --list, then renamed). The access token
# never appears on a command line or in the output. Tests override the OGC_* variables below.
set -Eeuo pipefail
umask 077

log() { printf '[backup] %s\n' "$*"; }
die() {
  printf '[backup][ERROR] %s\n' "$*" >&2
  exit 1
}
trap 'die "failed at line $LINENO (exit $?)"' ERR

BUCKET="${OGC_BACKUP_BUCKET:-}"
DIR="${OGC_BACKUP_DIR:-/var/backups/ogc}"
DBS="${OGC_BACKUP_DBS:-ogc iios_mock}"
KEEP_DAYS="${OGC_BACKUP_KEEP_DAYS:-7}"
PG_DUMP="${OGC_PG_DUMP:-runuser -u postgres -- pg_dump}"
PG_RESTORE="${OGC_PG_RESTORE:-pg_restore}"
GCS="${OGC_GCS_URL:-https://storage.googleapis.com}"
TOKEN_URL="${OGC_TOKEN_URL:-http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token}"

[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || die "OGC_BACKUP_BUCKET is not a bucket name: '${BUCKET}'"
[[ "$DIR" = /* && "$DIR" != "/" ]] || die "OGC_BACKUP_DIR must be an absolute path: '${DIR}'"
[[ "$KEEP_DAYS" =~ ^[1-9][0-9]?$ ]] && ((KEEP_DAYS <= 60)) || die "OGC_BACKUP_KEEP_DAYS must be 1–60"
if [[ -z "${OGC_PG_DUMP:-}" && "$(id -u)" != 0 ]]; then die "run as root (sudo): dumps are written root-only"; fi
for db in $DBS; do [[ "$db" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "not a database name: '${db}'"; done

mkdir -p "$DIR"
chmod 700 "$DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d "$DIR/.work-XXXXXX")
cleanup() { rm -rf "$WORK"; rm -f "$DIR"/*.part; }
trap cleanup EXIT

# 1) dump + check each database
FILES=()
for db in $DBS; do
  f="$DIR/$db-$TS.dump"
  $PG_DUMP -Fc "$db" >"$f.part"
  [[ -s "$f.part" ]] || die "empty dump of $db"
  $PG_RESTORE --list "$f.part" >/dev/null || die "pg_restore cannot read the dump of $db"
  mv "$f.part" "$f"
  chmod 600 "$f"
  FILES+=("$f")
done
SUMS="$DIR/ogc-backup-$TS.sha256"
(cd "$DIR" && sha256sum "${FILES[@]##*/}") >"$SUMS"
chmod 600 "$SUMS"
FILES+=("$SUMS")
log "dumped: $(for f in "${FILES[@]}"; do printf '%s (%s B) ' "${f##*/}" "$(stat -c %s "$f")"; done)"

# 2) access token of the VM's service account (kept in a root-only header file, never printed)
HDR="$WORK/auth"
TOK=$(curl -sS --fail --max-time 10 -H 'Metadata-Flavor: Google' "$TOKEN_URL" |
  sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p') || die "no access token from the metadata server"
[[ -n "$TOK" ]] || die "no access token from the metadata server"
printf 'Authorization: Bearer %s\n' "$TOK" >"$HDR"
unset TOK

# 3) upload each file as <TS>/<name>; GCS must refuse an existing name; the stored size must match
for f in "${FILES[@]}"; do
  name="$TS/${f##*/}"
  size=$(stat -c %s "$f")
  code=$(curl -sS --max-time 120 -o "$WORK/resp" -w '%{http_code}' -X POST \
    -H @"$HDR" -H 'Content-Type: application/octet-stream' --data-binary @"$f" \
    "$GCS/upload/storage/v1/b/$BUCKET/o?uploadType=media&ifGenerationMatch=0&name=$name") ||
    die "upload of $name failed (network)"
  [[ "$code" = 200 ]] || die "upload of $name refused: HTTP $code $(head -c 300 "$WORK/resp" | tr -d '\n')"
  stored=$(sed -n 's/.*"size" *: *"\([0-9]*\)".*/\1/p' "$WORK/resp" | head -1)
  [[ "$stored" = "$size" ]] || die "upload of $name: stored size '${stored}' ≠ local size $size"
done
log "uploaded ${#FILES[@]} files to gs://$BUCKET/$TS/"

# 4) keep KEEP_DAYS days of local copies (the bucket keeps its own for 30 days)
find "$DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sha256' \) -mtime +"$KEEP_DAYS" -print -delete |
  sed 's|^|[backup] removed old local copy |'
printf '%s gs://%s/%s/\n' "$TS" "$BUCKET" "$TS" >"$DIR/last-ok"
chmod 600 "$DIR/last-ok"
log "ok $TS"
