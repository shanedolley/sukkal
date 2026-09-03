# A failed sign-in buys a delay, and never a lockout

A run of failed sign-ins makes the next attempt wait. The wait doubles from the
third failure to a ceiling of eight seconds, and a correct password works at
every point in the run. Nothing is ever locked, refused, or held closed.
Decided 3 September 2026, building KPA-78.

ADR-0023 made the application the only gate on every installation, so the
sign-in route faces whoever can reach the box and there is no second gate and
no administrator. One account means an attacker needs one password.

KPA-78 named the hazard running the other way and it is the larger one. A
lockout on the only account is a denial of service against the only person who
can use the system, and nobody can lift it. The obvious defence is the one that
takes the box down.

## What an attacker already pays, measured

Measured on this Mac at ADR-0020's cost, before the ceiling was chosen:

| What | Cost |
|---|---|
| One `verify` | 171 ms |
| Eight in parallel | 378 ms in total |
| Guesses a second, one at a time | 5.8 |

Eight in parallel take barely twice one, because node's `scrypt` runs on the
libuv thread pool and that pool holds four threads. So the door answers about
six guesses a second and never runs more than four hashes at once, whatever
arrives at it.

`apps/web/lib/password.ts` requires sixteen characters, a capital, a number and
two marks, and `POST /api/account` and `PUT /api/reset` both enforce it, so no
password on any installation is weaker than that. Against those rules no online
rate is a threat, at eight guesses a second or at eight hundred.

**So the throttle is not what makes the password safe.** ADR-0020 already did
that. What it buys is a flood kept off the thread pool, and every attempt
written where Shane reads it.

## Considered Options

1. **Lock the account after N failures, for a fixed period** - the answer
   everybody expects, and the reason it is expected is that most systems have
   more than one account and somebody to ring. Rejected because it hands an
   attacker the outage: anyone who can reach the box can keep the only account
   closed by failing on purpose, and the person locked out is the only person
   who can use the system. KPA-78 says so in as many words.

2. **Refuse without hashing during a cooling window** - cheaper than a lock and
   it protects the thread pool best, because a refused attempt costs nothing.
   Rejected for the same reason as option 1 wearing a shorter coat: during the
   window a correct password is refused, so it is a lockout that expires
   quickly rather than something different in kind.

3. **Delay the answer, and never refuse it** - chosen. The wait costs an
   attacker their rate and costs Shane patience. It needs no release, because
   nobody is held.

## What the numbers are, and why

**The first two failures are free.** A person mistypes a sixteen-character
password. Charging for that would make the common case worse and the rare case
no better.

**It doubles after that: 1, 2, 4, 8 seconds.** Doubling makes a sustained run
expensive quickly while leaving a person who mistypes three times a pause they
barely notice.

**Eight seconds is the ceiling.** The measurement above is why it is not
higher: the password is already out of reach, and the ceiling is what keeps the
worst case a pause rather than an outage. A request that waits also holds a
connection, so a large number would be a way to exhaust the server rather than
to defend it.

**A run is forgotten fifteen minutes after the last failure.** That is a
tidy-up rather than a release, because nobody was held. A failure a week apart
therefore starts a fresh run rather than eventually reaching the ceiling and
staying there.

**The wait comes before the hash, not after the answer.** Waiting only on a
failure would let an attacker measure the difference and read a fast answer as
"that guess was closer", and it would leave the hash running at full rate while
they did.

## One counter for the installation, whatever address was typed

An installation has one account, so a failed attempt against an address nobody
holds is a failure at this door. Counting only the known address would leave
the whole throttle behind a name an attacker can simply not type, and the
difference in timing would tell them which name that is.

It follows that a stranger's failures slow Shane down. That is the cost of the
option chosen, and the ceiling and `scripts/reset-password.sh --unlock` are
what bound it: eight seconds, or nothing at all if he has a shell.

## A sign-in reaches the audit log through a policy row

KPA-78 requires every attempt, allowed and refused, to reach the log, because
a sign-in is the highest-value event on the box. `audit_denial_names_a_rule`
refuses a denial that cites nothing, and that constraint is the point of the
table: a refusal nobody can explain tells Shane nothing.

So `migrations/026` writes an `auth.sign-in` row into `policies`. It is a sixth
row and not a sixth rule, exactly as migration 012's `deny-by-default` was a
fifth row and not a fifth rule. `src/policy/engine.ts` never reads it: `decide`
matches a proposal against what a rule governs, and nothing proposes a sign-in,
because authentication is inbound and the engine judges what KPA sends out.

`src/auth/attempts.ts` writes those rows rather than `src/policy/act.ts`, and
`act.ts` names the second writer. `act` is the one path to an *outbound*
action, and it takes a Permit and a verdict because ADR-0005 governs what KPA
sends. A sign-in reaches nothing, so `decide` would deny every one by default.

## Consequences

- **Nobody is ever locked out**, so there is nothing to expire and nothing to
  ask for. The recovery path KPA-78 requires exists anyway, as
  `scripts/reset-password.sh --unlock`, and it shortens a wait rather than
  opening a door.
- **A stranger can make Shane wait eight seconds.** Bounded, and lifted from
  the shell.
- **The counter lives on `users`**, as `sign_in_failures` and
  `sign_in_failed_at`, rather than in a table of its own. There is exactly one
  counter, and a table keyed by `owner_id` as its primary key would be a second
  row that exists whenever the first does.
- **Raising the ceiling is a decision about the connection it holds**, not a
  comfort setting. The same is true of `LIFETIME_DAYS` in `session.ts`.
- **The audit log now carries an attacker's typed address**, trimmed to 200
  characters. That is deliberate: an address nobody holds, tried a hundred
  times, is the shape of an attack and the log is where the shape shows.
- **Nothing raises a `needs_you`.** Somebody guessing is not a decision to
  make, so the briefing stays a list of things to answer. A story could add it
  for anybody who would rather be told than look.
