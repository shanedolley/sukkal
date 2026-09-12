#!/usr/bin/env bash
#
# The root half of the Sukkal provisioning. provision-amaterasu.sh copies this to
# the server, substitutes the three placeholders, and runs it under one sudo
# prompt. Do not run it by hand: the placeholders are unset until then.
#
# It is safe to re-run. Every step checks before it acts.

set -euo pipefail

PGVER=@@PGVER@@
SRCNET=@@SRCNET@@
KPA_PASSWORD=@@PASSWORD@@

CONF=/etc/postgresql/$PGVER/main
LAN_IP=$(hostname -I | awk '{print $1}')

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ── the PGDG repository ───────────────────────────────────────────────────
log "PGDG repository"
if [[ -f /etc/apt/sources.list.d/pgdg.list ]]; then
  echo "already configured"
else
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  echo "added"
fi
apt-get update -qq

# ── the packages ──────────────────────────────────────────────────────────
log "PostgreSQL $PGVER and pgvector"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  "postgresql-$PGVER" "postgresql-$PGVER-pgvector" ssl-cert
systemctl enable --now postgresql

# ── wait for an address before starting ──────────────────────────────────
# listen_addresses below names the LAN address, and a name is not a wildcard.
# The stock unit orders After=network.target, which means "networking is
# starting" rather than "an address exists". On 26 August 2026 Postgres won that
# race after a reboot, logged "could not bind IPv4 address", and served loopback
# only. systemctl reported the unit active throughout, so nothing looked wrong
# until a client on the LAN was refused.
log "Order Postgres after the network is up"
install -d /etc/systemd/system/postgresql@.service.d
cat > /etc/systemd/system/postgresql@.service.d/network-online.conf <<UNITEOF
# Written by scripts/provision-amaterasu-root.sh. Edit there, not here.
[Unit]
Wants=network-online.target
After=network-online.target
UNITEOF
systemctl daemon-reload
systemctl enable systemd-networkd-wait-online.service >/dev/null 2>&1 || \
  echo "note: systemd-networkd-wait-online is absent, so check what manages the network"

# ── tuning, the address, and TLS ──────────────────────────────────────────
# amaterasu holds 7.6 GB of RAM and 12 threads, and it already serves NFS, runs
# NZBGet, and runs a transcode monitor that takes every thread when it fires.
#
# nabium's docs/runbooks/postgres-tuning.md is the source for the reasoning and
# not for the numbers: it targets a 32 GB host and holds effective_cache_size at
# 8 of those 32. Copying its values onto a 7.6 GB box would over-commit memory,
# which is the constraint that binds first here. The reasoning that carries over
# unchanged is random_page_cost on NVMe, jit off at these row counts, and
# time-driven rather than size-driven checkpoints.
log "Tuning, listen address and TLS"
install -d -o postgres -g postgres "$CONF/conf.d"
cat > "$CONF/conf.d/kpa.conf" <<CONFEOF
# Written by scripts/provision-amaterasu-root.sh. Edit there, not here.

# Memory. Scaled for 7.6 GB shared with NFS, NZBGet and a transcode monitor.
shared_buffers = 512MB
work_mem = 16MB
maintenance_work_mem = 256MB
effective_cache_size = 2GB
max_connections = 25

# NVMe, not a spinning disk. The default of 4 produces bad plans.
random_page_cost = 1.1

# Time-driven checkpoints, so a burst does not force full-page writes repeatedly.
checkpoint_timeout = 15min
max_wal_size = 2GB
min_wal_size = 256MB

# The row counts here never reach the complexity where compilation pays back.
jit = off

# Reachable from the LAN and from nowhere else. Never 0.0.0.0.
listen_addresses = 'localhost,$LAN_IP'

# TLS uses the certificate the ssl-cert package generates. sslmode=require
# encrypts without verifying the certificate, which is what this slice needs.
# Verification would need a certificate carrying the host address, and that is
# an upgrade this file can take later without a migration.
ssl = on

log_line_prefix = '%m [%p] %q%u@%d '
log_min_duration_statement = 500
CONFEOF
chown postgres:postgres "$CONF/conf.d/kpa.conf"
chmod 0644 "$CONF/conf.d/kpa.conf"

# ── who may connect ───────────────────────────────────────────────────────
# Only hostssl lines exist for the LAN, so a client offering no TLS matches no
# line and is refused. That refusal is the acceptance criterion, not a default.
log "pg_hba.conf"
if ! grep -q '^# KPA' "$CONF/pg_hba.conf"; then
  cat >> "$CONF/pg_hba.conf" <<HBAEOF

# KPA. The subnet below is the /24 of whichever interface carried the ssh that
# ran this script. The Mac's wired and Wi-Fi addresses share that /24, so either
# one reaches Postgres. Another subnet, a guest SSID or a VLAN needs its own line.
hostssl kpa       kpa  $SRCNET  scram-sha-256
hostssl kpa_dev   kpa  $SRCNET  scram-sha-256
HBAEOF
  echo "added"
else
  echo "already present"
fi

# ── the role and the databases ────────────────────────────────────────────
log "Role and databases"
su - postgres -c "psql -v ON_ERROR_STOP=1 -q" <<SQLEOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kpa') THEN
    CREATE ROLE kpa LOGIN;
  END IF;
END \$\$;
ALTER ROLE kpa WITH PASSWORD '$KPA_PASSWORD' NOSUPERUSER NOCREATEROLE;
SELECT 'kpa' AS role, rolsuper FROM pg_roles WHERE rolname = 'kpa';
SQLEOF

for db in kpa kpa_dev; do
  if su - postgres -c "psql -tAXc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1; then
    echo "$db already exists"
  else
    su - postgres -c "createdb -O kpa $db"
    echo "$db created"
  fi
  su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d $db -c 'CREATE EXTENSION IF NOT EXISTS vector'"
done

# ── restart, because shared_buffers and max_connections need one ──────────
log "Restart"
systemctl restart postgresql
sleep 2
systemctl is-active postgresql
su - postgres -c "psql -tAXc \"SELECT 'pgvector ' || extversion FROM pg_extension WHERE extname='vector'\" -d kpa"

log "Done"
echo "The wizard verifies the rest from the Mac, over the LAN."
