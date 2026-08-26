# The migration runs on the Mac and writes to amaterasu

Slice one reads two inputs that live on Shane's Mac and cannot move: the
Obsidian vault, and the `check.py` whose report is the verification oracle.
PostgreSQL lives on amaterasu, because that is where KPA will run. Only one of
the two can cross the network, so it is the one that already has a wire
protocol: the migration runs on the Mac and writes to amaterasu over the LAN.

The connection requires TLS. SCRAM protects the password exchange and leaves
the content in the clear, and the content includes Collibra customer material
on a LAN that carries other devices.

## Considered Options

1. **Run the migration on amaterasu** - puts the code beside the database, and
   matches where every other KPA service will run. Rejected because it means
   copying the vault and `check.py` onto a second machine. The verification
   compares the new checks against `check.py`'s report, so a copied oracle is
   an oracle that can drift from the thing it certifies.
2. **A local PostgreSQL on the Mac for development** - Homebrew's PostgreSQL 17
   is already installed and needs no network. Rejected by Shane: two servers at
   two major versions let a migration pass on the Mac and fail on the box that
   matters. The Mac's `pg_dump` already refuses the 18.6 server, which is that
   gap showing itself.
3. **Copy the vault to amaterasu and migrate there** - one machine end to end.
   Rejected for the same reason as option 1, plus it puts a second writable copy
   of the memory on a second machine while the first is still authoritative.

## Consequences

- The migration needs the LAN. amaterasu is reachable at `192.168.20.110` and
  `pg_hba.conf` admits `192.168.20.0/24` only, so the migration runs from home
  and fails anywhere else. This is a slice-one constraint, not a product one.
- amaterasu presents Ubuntu's self-signed certificate, so no client can verify
  the chain and `sslmode=verify-full` is unavailable until a real certificate
  exists. `require` encrypts without verifying, which stops passive capture on
  the LAN and does not stop an active attacker who can impersonate the host.
  Accepted for a home LAN.
- libpq and node-postgres read `sslmode=require` two different ways. libpq
  encrypts without verifying; the driver verifies and fails. `src/db/connect.ts`
  translates `require` to the driver's `no-verify`, so one `.env` serves `psql`
  and Node. Anything else that connects must go through that module.
- Every later slice runs on amaterasu, where these three consequences all
  disappear. This decision covers slice one and expires with it.
