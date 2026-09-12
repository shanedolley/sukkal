# The application authenticates, and reads no identity header

Sukkal signs its owner in with its own account, on every installation. It reads no
identity from Cloudflare Access, on any box, under any configuration. Decided
by Shane on 3 September 2026.

ADR-0009 gave the installation a local account, because somebody running this
from a container has no Access and no identity provider. It left one question
open: what a box that *does* have Access in front of it should do with the
identity Access already established. This settles that, and the answer is
nothing.

## Sukkal requires no Access

**Whether a deployment runs Access is that deployment's own choice.** Sukkal
depends on it for nothing, which is the point: ADR-0009 made this software
somebody else installs, and that person has no Cloudflare account. Shane
recorded the same thing about his own box on 3 September 2026.

**Where a deployment does run it, it is a network gate.** Access refuses
everyone but the owner before a request reaches the tunnel, and Sukkal still asks
who is knocking. Two gates stand in series and neither assumes the other held,
which is the whole value of running both. A tunnel misrouted, a port published
to the LAN, a container reachable on a network somebody trusted: each is
survivable, because the application authenticates on its own.

That is also what makes dropping Access safe. The application was never leaning
on it.

## Considered Options

1. **Trust an identity header when configured** - one line, and the cheapest
   thing to build. Access sets `Cf-Access-Authenticated-User-Email`, and the
   application reads it. Rejected because the security of the whole system
   becomes the claim that nothing ever reaches the application directly. That
   claim is one misconfiguration from false, and the failure is total and
   silent: a forged header arrives as the owner, and the audit log records the
   owner doing it.

2. **Verify the assertion Access signs** - correct, and materially different
   from trusting a header. Access also sets `Cf-Access-Jwt-Assertion`, a JWT
   Cloudflare signs, verifiable against the keys the team publishes at
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with `iss` and
   `aud` both checked. A forged header fails the signature, so this answers the
   question that defeats option 1. It needs no dependency either: node's own
   `crypto` rebuilds the key with `createPublicKey({ format: 'jwk' })` and
   `createVerify('RSA-SHA256')` does the rest, which was measured before this
   decision rather than assumed. Rejected because it is forty lines on the
   security boundary, two environment variables that are dangerous when half
   set, and a second code path that exists on one box in the world. It stays
   available, and nothing here forecloses it.

3. **Authenticate, always, everywhere** - chosen.

## Why the cost is smaller than it first reads

The obvious objection is that Shane passes two gates every morning to reach a
machine only he can reach. He does not. KPA-77 gives a session a lifetime, and
that lifetime is a decision rather than a default, so a sign-in happens when a
session lapses. The friction is whatever KPA-77 chooses, and it is not daily.

## Consequences

- **One behaviour on every installation.** No branch, no configuration, no
  environment variable that means "trust". A class of defect where a header is
  believed cannot occur here, because nothing reads one.
- **The acceptance criteria KPA-80 wrote are met by construction.** The
  behaviour is not guessed from the request, because there is one behaviour.
  The default on a box configured with nothing is to authenticate, because that
  is the only thing there is.
- **The sign-in pages stay, and KPA-128 is settled.** KPA-37 built them and
  recorded that production would drop them, because Access authenticated first.
  That instruction predates ADR-0009. They are now the only gate on a
  self-hosted box, and the working gate on Shane's.
- **KPA-77 is unblocked, and it owns the session lifetime.** A box holding
  employer customer material is not a shopping site, and that story says so.
- **Access becomes removable.** Nothing in Sukkal reads it, so taking it down
  costs the network gate and no application behaviour. The brief's *Remote
  access* row is now a deployment choice rather than a dependency.
- **Nothing is foreclosed.** Option 2 is an addition rather than a replacement,
  because a local account is exactly what it falls back to. So is OIDC, which
  ADR-0009 already left open for an organisation that runs an identity
  provider.
- **The password carries real weight, and ADR-0020 is why that is affordable.**
  One account reaches three mailboxes holding employer customer material. The
  rules are 16 characters with a capital, a number and two marks, and scrypt at
  128 MiB a hash is what makes a stolen hash expensive to guess.
- **A forgotten password still needs the command line escape hatch.** ADR-0009
  named it and KPA-79 owns it. This decision makes it load bearing rather than
  convenient, because no second gate can let somebody back in.
