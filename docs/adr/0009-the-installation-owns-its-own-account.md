# The installation owns its own account

Sukkal now ships as software other people run, on a server of their own or in a
container. Those installations have no Cloudflare Access in front of them and no
WorkOS tenant behind them, so the assumption that the network authenticates the
person before the request arrives no longer holds. Every installation therefore
creates its own account on the first boot: the wizard asks for a name, an email,
a name for the assistant, and a password, and the application authenticates from
then on. Decided by Shane on 1 September 2026.

This supersedes the identity decision the brief carried, which had WorkOS
AuthKit wired into Access as an OIDC provider. That arrangement stays in front
of Shane's own box, where it already runs. It is now one deployment's choice
rather than the product's design.

## Considered Options

1. **Keep Access and WorkOS for everybody** - no password handling in Sukkal at
   all, which is the cheapest security posture available. Rejected because it
   puts two paid accounts in front of the front door of self-hosted software.
   Somebody who types `docker run` has neither, and telling them to open a
   Cloudflare account before they can see the login screen loses them there.
2. **OIDC against whatever the deployer already runs** - correct for an
   organisation that has an identity provider, and it keeps passwords out of
   Sukkal. Rejected as the only route for the same reason: it assumes an identity
   provider exists. It stays available as an addition, because a local account
   and an OIDC option are not exclusive.
3. **A local account, created on first boot** - chosen. It is the only option
   that works on a box with nothing else on it.

## Consequences

- Sukkal now owns the parts Access made unnecessary: password storage, sessions,
  reset, and a lockout. Each is a place to get security wrong, and none of them
  existed in the design a week ago.
- A password is worth more here than on a forum, because the one account reaches
  every mailbox the assistant reads. The rules are 16 characters, a capital, a
  number and two marks, and they live in `apps/web/lib/password.ts` so the form
  and the screen cannot state different rules.
- Shane's own box keeps Access in front of it, so he passes two gates. Dropping
  Access there is now a choice rather than a consequence.
- A forgotten password on a self-hosted box has nowhere to send a reset link,
  because a fresh installation has no mail relay. The reset flow needs a command
  line escape hatch on the server, and that is not built.
- The setup wizard is the only writer of the account, so it has to refuse to run
  twice. It asks before it overwrites.
- "Single user" still holds and now means one owner per installation, rather
  than one person named Shane. Nothing else in the design may assume more than
  one user exists.
