// Connections. Every account the assistant reaches, and one card that adds
// another.
//
// The list is on the server, and so is the key each account is reached with,
// sealed under the connection's own id. KPA-127 moved both there. What this
// screen records is which accounts exist, what each one covers, and whether a
// key is stored against it. Using that key is the worker's job.
//
// IT IS A SERVER COMPONENT, AND THE QUERY IS WHY. The OAuth callback redirects
// here with what it did, and `useSearchParams` in a client component would
// need a Suspense boundary: Next's own documentation says a static page
// calling that hook fails the production build without one. The sign-in and
// reset pages read their parameters the same way.

import {
  ConnectionsGrid,
  GrantNotice,
} from "@/components/connections/connections";

/** The query, read once. Anything but a single string is nothing. */
function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * What an OAuth error code looks like. RFC 6749 makes every one lower case
 * with underscores: `access_denied`, `invalid_scope`.
 *
 * The query is filtered here rather than only where it renders, because a
 * prop reaches the browser whether a component prints it or not. React
 * serialises it into the payload, so a value refused downstream still travels.
 * An address in the query would then sit in the response body as well as in
 * the URL, which is most of what putting it in the URL cost.
 */
const ERROR_CODE = /^[a-z_]{1,40}$/;

export default async function ConnectionsPage(props: PageProps<"/connections">) {
  const asked = await props.searchParams;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground text-sm">
          One card per account. A provider takes as many accounts as you hold
          on it, so the BHP Microsoft account and the Sydney Water one sit side
          by side.
        </p>
      </header>

      <GrantNotice
        outcome={one(asked["grant"])}
        detail={
          ERROR_CODE.test(one(asked["detail"]) ?? "") ? one(asked["detail"]) : null
        }
      />

      <ConnectionsGrid />

      <p className="text-muted-foreground text-xs leading-relaxed">
        A key typed here is sent to the server and sealed there. No screen
        reads one back, and this browser keeps no copy. The worker is what
        reaches the provider with it, and it does not run yet, so a card says
        whether a key is stored rather than whether the account works.
      </p>
    </div>
  );
}
