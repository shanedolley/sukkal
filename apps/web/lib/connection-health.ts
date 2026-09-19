// Whether a connection works, and what the whole set adds up to. KPA-107.
//
// The card and the navigation both read this, so the red outline on a card and
// the mark beside "Connections" can never disagree about what counts as broken.
//
// A connection is failing when the last check found it not working, or when it
// holds no credential at all, which is a connection that cannot work. One that
// has never been checked is unknown rather than failing: the hourly recheck in
// `src/connections/recheck.ts` has not reached it yet, and painting it red
// would be a guess.

export interface Checkable {
  hasSecret: boolean;
  /** Null until the recheck has run. */
  verifiedOk: boolean | null;
}

/** `none` means there is nothing to report on, and the navigation shows no mark. */
export type Health = "none" | "working" | "some-failing" | "all-failing";

export function isFailing(connection: Checkable): boolean {
  return !connection.hasSecret || connection.verifiedOk === false;
}

export function health(connections: readonly Checkable[]): Health {
  if (connections.length === 0) return "none";
  const failing = connections.filter(isFailing).length;
  if (failing === 0) return "working";
  return failing === connections.length ? "all-failing" : "some-failing";
}

/** What the mark says in words, for the tooltip and for a screen reader. */
export function describe(connections: readonly Checkable[]): string {
  const failing = connections.filter(isFailing).length;
  switch (health(connections)) {
    case "none":
      return "No connections";
    case "working":
      return "Every connection is working";
    case "all-failing":
      return connections.length === 1 ? "The connection is not working" : "No connection is working";
    case "some-failing":
      return `${failing} of ${connections.length} connections not working`;
  }
}
