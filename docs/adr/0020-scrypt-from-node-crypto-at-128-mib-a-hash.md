# scrypt from node:crypto, at 128 MiB a hash

ADR-0009 gave every installation its own account, so Sukkal now stores a password
and has to choose how. `src/auth/password.ts` uses scrypt from `node:crypto`
with N of 2^17, r of 8 and p of 1, a 16-byte salt and a 32-byte key, encoded in
the PHC string format. Those are the parameters OWASP names first for scrypt,
and amaterasu was measured before they were accepted rather than after.
Decided 2 September 2026.

The password guards more than a login. The one account reaches three mailboxes,
two of which hold Collibra customer material, and on an installation somebody
else runs there is no Cloudflare Access in front of it. The brief records that
under *Somebody else's installation has no tunnel in front of it*.

## What it costs, measured

amaterasu runs no Node, so two measurements were taken and joined. Node's own
scrypt was timed on the Mac. OpenSSL's scrypt was timed on both machines at the
same parameters, which gives the ratio between the two boxes.

| N | Node, Mac | OpenSSL, Mac | OpenSSL, amaterasu idle | OpenSSL, amaterasu under load |
|---|---|---|---|---|
| 2^14 | 18.5 ms | 22.1 ms | 33.0 ms | - |
| 2^15 | 38.2 ms | 46.0 ms | 72.1 ms | 142.5 ms |
| 2^16 | 79.3 ms | 95.4 ms | 146.6 ms | 292.0 ms |
| 2^17 | 162.2 ms | 192.7 ms | 294.9 ms | 621.8 ms |

Every figure is a median. The Mac is an Apple M4 on Node 22.22 and OpenSSL
3.6.3. amaterasu is the i7-8700B on OpenSSL 3.0.13. *Under load* means twelve
busy loops held all twelve threads, which is what a transcode does to that box.

The ratio between the two machines holds across all four costs, at 1.49 to
1.57. Applying it to Node's own figure puts one hash at 2^17 on amaterasu at
roughly 250 ms on an idle box and roughly 520 ms while a transcode runs.

Memory was measured directly rather than derived. One hash costs 155 MiB of
peak resident memory on the Mac, against the 128 MiB the formula gives, and one
OpenSSL hash costs 132 MiB on amaterasu. Eight hashes started at once peak at
579 MiB and finish in 387 ms, because Node runs four of them at a time on its
thread pool and queues the rest.

Half a second buys one sign-in on a box with one owner. The brief puts roughly
5 GB free on amaterasu, so a hash holding 155 MiB for half a second spends
3 per cent of it.

## Considered Options

1. **argon2id, which OWASP prefers over scrypt** - it wins on memory as well:
   19 MiB and two iterations meets their minimum, against scrypt's 128 MiB.
   Rejected because `node:crypto` has no argon2 and every package that does is
   a native module. This repository has two dependencies, `pg` and `pg-boss`,
   and neither compiles. Adding one that does puts a build toolchain between
   somebody and `docker run`, which is the audience ADR-0009 chose the local
   account for. Worth revisiting the day Node ships argon2, and re-hashing on
   sign-in is the migration.
2. **pbkdf2, which is also in `node:crypto`** - rejected because it is not
   memory-hard. It asks a GPU for arithmetic and nothing else, which is the
   attack the 128 MiB above exists to make expensive. OWASP still gives figures
   for it, at 600,000 SHA-256 iterations, and lists it for FIPS-140 compliance
   rather than for strength.
3. **bcrypt** - rejected twice over. It is a native module, like argon2, and it
   ignores everything past 72 bytes of a password.
4. **scrypt at a cheaper cost, such as 2^16** - the honest alternative, and the
   measurement is what refused it. OWASP's own cheaper row raises p to 2 to
   compensate, which lands within a few milliseconds of 2^17 with p of 1 while
   holding half the memory for twice as long. Neither figure hurts this box.
5. **scrypt at 2^17, r of 8, p of 1** - chosen.

## Consequences

- Concurrent sign-in attempts cost about 580 MiB and no more, because Node's
  thread pool runs four derivations and queues the rest. Four at once take
  211 ms, five take 396 ms and eight take 439 ms, all measured. The ceiling is
  bounded, but 580 MiB of an unattended box is still worth a rate limit, and a
  rate limit belongs with the lockout ADR-0009 already names as unbuilt.
- Raising the cost is safe up to 512 MiB, and the module refuses its own output
  past it. Every hash carries the parameters it was made with, so old hashes
  keep verifying and only new ones pay the new price. At r of 8 that ceiling
  binds before `ln` reaches 19, so a raise past 18 has to move the ceiling in
  the same commit.
- A missing account and a wrong password cost the same, because the module
  derives a key against a random salt and discards it. The measured medians are
  167.4 ms and 167.5 ms against 167.0 ms for a correct password. That property
  survives only while `COST` matches what the stored hashes were made at. Raise
  `COST` and the two paths differ until every hash is rewritten, which is a
  reason to re-hash on the next successful sign-in.
- `verify` reads the cost out of the hash, so a wrong row in the database is a
  memory request. Anything above 512 MiB is refused rather than run.
- Changing algorithm later costs every account a password reset, unless sign-in
  re-hashes. The encoded string starts with `$scrypt$`, so a second algorithm
  can live beside the first rather than replace it.
