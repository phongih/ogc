#!/usr/bin/env bash
# provision-cluster.sh — create the dedicated IIOS PostgreSQL cluster (OGC-ADR-042).
# Synthetic/dev only. Run as root on VM2.
#
# A SECOND PostgreSQL 16 cluster on this host, isolated from the main `postgres`/`ogc`
# cluster: its own data directory, its own port (5433), and — critically for the
# admission guard's OB1 — a SINGLE superuser named `bootstrap` (never `postgres`).
# Listens on localhost only. Idempotent: skips initdb if the data directory exists.
#
# After this, run apply-kernel.sh to install the guarded r2 kernel.
#
# Tunables (env), with VM2 defaults:
#   OGC_IIOS_PGBIN    /usr/lib/postgresql/16/bin
#   OGC_IIOS_PGDATA   /var/lib/ogc-iios/16/main
#   OGC_IIOS_PORT     5433
#   OGC_IIOS_SOCKET   /var/run/postgresql
#   OGC_IIOS_SECRETS  /etc/ogc/iios-kernel.secrets   (root-only; holds PW_BOOTSTRAP + role pws)
#   OGC_IIOS_RUNUSER  postgres                        (OS user that owns data dir + server)
#   OGC_IIOS_NO_SYSTEMD  (set to 1 to start via pg_ctl instead of systemd — for local tests)
set -euo pipefail

# Ensure sbin dirs are on PATH: runuser (util-linux) lives in /usr/sbin, which a caller's
# trimmed PATH (e.g. `env PATH=<pgbin>:$PATH` from a non-root shell) may omit.
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

PGBIN=${OGC_IIOS_PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${OGC_IIOS_PGDATA:-/var/lib/ogc-iios/16/main}
PORT=${OGC_IIOS_PORT:-5433}
SOCKET=${OGC_IIOS_SOCKET:-/var/run/postgresql}
SECRETS=${OGC_IIOS_SECRETS:-/etc/ogc/iios-kernel.secrets}
RUNUSER=${OGC_IIOS_RUNUSER:-postgres}
asrun() { runuser -u "$RUNUSER" -- "$@"; }

# 1) bootstrap superuser password — generate once, 0600
mkdir -p "$(dirname "$SECRETS")"
if [ ! -f "$SECRETS" ] || ! grep -q '^PW_BOOTSTRAP=' "$SECRETS" 2>/dev/null; then
  ( umask 077; printf '# IIOS cluster secrets (synthetic/dev) — generated %s\nPW_BOOTSTRAP=%s\n' \
      "$(date -u +%FT%TZ)" "$(openssl rand -hex 24)" >> "$SECRETS" )
  echo "provision: wrote PW_BOOTSTRAP to $SECRETS"
fi
# shellcheck disable=SC1090
PW_BOOTSTRAP=$(. "$SECRETS"; printf '%s' "$PW_BOOTSTRAP")

# 2) initdb — sole superuser `bootstrap`, scram everywhere. Skip if already initialised.
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"; chown "$RUNUSER": "$PGDATA"; chmod 700 "$PGDATA"
  pwf=$(mktemp); chmod 600 "$pwf"; printf '%s' "$PW_BOOTSTRAP" > "$pwf"; chown "$RUNUSER": "$pwf"
  asrun "$PGBIN/initdb" -D "$PGDATA" -U bootstrap \
    --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile="$pwf" -E UTF8 --no-instructions >/dev/null
  rm -f "$pwf"
  echo "provision: initdb done (sole superuser = bootstrap)"
  # cluster config
  {
    echo "port = $PORT"
    echo "listen_addresses = '127.0.0.1'"
    echo "unix_socket_directories = '$SOCKET'"
    echo "password_encryption = scram-sha-256"
  } >> "$PGDATA/postgresql.conf"
  # pg_hba — scram only, localhost only
  cat > "$PGDATA/pg_hba.conf" <<HBA
# IIOS cluster — synthetic/dev. localhost + scram only.
local   all   all                     scram-sha-256
host    all   all   127.0.0.1/32      scram-sha-256
host    all   all   ::1/128           scram-sha-256
HBA
  chown "$RUNUSER": "$PGDATA/pg_hba.conf"
else
  echo "provision: $PGDATA already initialised — skip initdb"
fi

# 3) start the cluster (systemd on VM2; pg_ctl for local tests)
if [ "${OGC_IIOS_NO_SYSTEMD:-}" = 1 ]; then
  asrun "$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $SOCKET" -w start >/dev/null 2>&1 || true
else
  UNIT=/etc/systemd/system/ogc-iios-pg.service
  if [ ! -f "$UNIT" ]; then
    cat > "$UNIT" <<UNITEOF
[Unit]
Description=OGC IIOS PostgreSQL cluster (synthetic/dev, OGC-ADR-042)
After=network.target

[Service]
Type=notify
User=$RUNUSER
ExecStart=$PGBIN/postgres -D $PGDATA
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
TimeoutSec=120
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNITEOF
    systemctl daemon-reload
    echo "provision: installed $UNIT"
  fi
  systemctl enable --now ogc-iios-pg.service
fi

# 4) wait until it accepts connections
for _ in $(seq 30); do
  if asrun "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
asrun "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT"
echo "provision: IIOS cluster up on 127.0.0.1:$PORT (sole superuser bootstrap)"
echo "provision: next → apply-kernel.sh (PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=bootstrap PGPASSWORD=\$PW_BOOTSTRAP)"
