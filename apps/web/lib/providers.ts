// The providers the assistant can reach, and what each one asks for.
//
// A provider that covers several products asks which of them the assistant may
// reach. Google carries five, Microsoft carries five, Salesforce carries three,
// and the rest carry one thing each, so their service list is empty.
//
// A method names the fields it asks for, and the dialog draws them. One that
// signs you in carries the address to open; one that takes a key carries the
// box to type it into. No secret is stored anywhere: see lib/connections.ts.
//
// This file holds data and two pure functions, so scripts/check-connections.ts
// can run it under plain node. Every runtime import here names its file
// extension for the same reason.

import { EMBEDDING } from "../../../src/embedding.ts";

export type ProviderId =
  | "google"
  | "microsoft"
  | "zoom"
  | "jira"
  | "linear"
  | "salesforce"
  | "openrouter"
  | "claude"
  | "voyage";

export interface Service {
  id: string;
  label: string;
}

/** One box on the form. */
export interface Field {
  id: string;
  label: string;
  placeholder: string;
  /**
   * A secret goes in a password box and is written nowhere. A url is opened
   * in a tab, so it is checked before the browser is sent to it. A date takes
   * the browser's own date box, which spells the format out for the reader.
   */
  kind?: "secret" | "url" | "date";
}

/** A way in. Two of them means the provider offers a real choice. */
export interface Method {
  id: string;
  label: string;
  hint: string;
  /**
   * Where the provider signs you in. Set on a method that sends you out to
   * the provider, and absent on one that takes a key instead. A method
   * carrying a url field opens the address typed into it, because the site
   * you name is the one you sign in to.
   */
  signIn?: string;
  /** What the method asks for. A method that only sends you out asks nothing. */
  fields?: Field[];
  /**
   * Whether KPA can run a real grant, rather than open the provider's front
   * door and store nothing.
   *
   * `GRANTS` in `src/connections/oauth.ts` is what decides it, and
   * `scripts/check-connections.ts` fails when the two disagree. The flag is
   * here rather than imported because this file runs under plain node and a
   * client component bundles it: reaching into `src/` would carry
   * `node:crypto` into the browser.
   */
  grant?: boolean;
}

export interface Provider {
  id: ProviderId;
  name: string;
  blurb: string;
  /** What the account may be reached for. Empty when the provider is one thing. */
  services: Service[];
  /**
   * Every way in, and there is always at least one.
   *
   * The tuple says so, which is what lets a caller read `methods[0]` without
   * asking whether it is there. `scripts/check-connections.ts` asserts the
   * same rule over the catalogue, and a provider offering no way in is a card
   * nobody can use.
   */
  methods: [Method, ...Method[]];
}

/**
 * Sends you to the provider. No secret passes through the screen.
 *
 * `grant` says whether pressing the button runs a real OAuth grant or only
 * opens the provider's front door. The hint follows it, because the two do
 * different things and a person deserves to know which they are about to get.
 */
function oauth(signIn: string, fields: Field[] = [], grant = false): Method {
  return {
    id: "oauth",
    label: "OAuth",
    hint: grant
      ? "The button sends you to the provider to consent. The token comes back to the server and never to this screen."
      : "The button opens the provider's own sign-in page, so no secret passes through this screen.",
    signIn,
    fields,
    grant,
  };
}

/** Takes a key instead. The warning is the reason to prefer OAuth. */
/**
 * A key, and the date its owner will look at it again.
 *
 * None of these four vendors publishes an expiry, and the brief's rule is that
 * a credential nobody can date is a credential nobody renews. So the form asks
 * for the term rather than leaving the row undated, and `filled` in the dialog
 * refuses a blank one along with every other empty field.
 *
 * `src/connections/verify.ts` is what dates the other half. It asks each
 * vendor whether the key still works, and writes the answer to the row beside
 * this date.
 */
function apiKey(placeholder: string, hint: string): Method {
  return {
    id: "key",
    label: "API key",
    hint,
    fields: [
      { id: "key", label: "API key", placeholder, kind: "secret" },
      {
        id: "expires",
        label: "Review by",
        placeholder: "YYYY-MM-DD",
        kind: "date",
      },
    ],
  };
}

const SITE: Field = {
  id: "site",
  label: "Site",
  placeholder: "https://your-team.atlassian.net",
  kind: "url",
};

export const PROVIDERS: Provider[] = [
  {
    id: "google",
    name: "Google",
    blurb: "Mail, calendar, meetings, files and notes.",
    services: [
      { id: "gmail", label: "Gmail" },
      { id: "calendar", label: "Calendar" },
      { id: "meet", label: "Meet" },
      { id: "drive", label: "Drive" },
      { id: "keep", label: "Keep" },
    ],
    // The one provider KPA runs a real grant for. `src/connections/oauth.ts`
    // holds the urls and the scopes, and the sign-in address here is what a
    // person reads rather than where the grant goes.
    methods: [oauth("https://accounts.google.com/signin", [], true)],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    blurb: "Mail, chat, tasks and files on a work tenant.",
    services: [
      { id: "outlook", label: "Outlook" },
      { id: "teams", label: "Teams" },
      { id: "todo", label: "To Do" },
      { id: "sharepoint", label: "SharePoint" },
      { id: "onedrive", label: "OneDrive" },
    ],
    methods: [oauth("https://login.microsoftonline.com/")],
  },
  {
    id: "zoom",
    name: "Zoom",
    blurb: "Meetings, recordings and transcripts.",
    services: [],
    methods: [oauth("https://zoom.us/signin")],
  },
  {
    id: "jira",
    name: "Jira",
    blurb: "Issues, sprints and boards on one Atlassian site.",
    services: [],
    methods: [
      // The site you name is the site you sign in to, so the button opens it
      // rather than the Atlassian front door.
      oauth("https://id.atlassian.com/login", [SITE]),
      {
        id: "token",
        label: "API token",
        // Atlassian now sets a term on every token it issues, so the date it
        // runs out is asked for here. A credential nobody can date is a
        // credential nobody renews, and the briefing is where a lapsing one
        // belongs.
        hint: "The fallback for a site where OAuth is not set up. Atlassian expires an API token, so type the date it runs out and the briefing will raise it before it does.",
        fields: [
          SITE,
          {
            id: "email",
            label: "Account email",
            placeholder: "you@example.com",
          },
          {
            id: "token",
            label: "API token",
            placeholder: "Paste the token",
            kind: "secret",
          },
          {
            id: "expires",
            label: "Expires",
            placeholder: "YYYY-MM-DD",
            kind: "date",
          },
        ],
      },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    blurb: "Issues and cycles on one Linear workspace.",
    services: [],
    methods: [
      oauth("https://linear.app/login"),
      apiKey(
        "lin_api_...",
        "Linear makes the key under Settings, then API, then Personal API keys."
      ),
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    blurb: "Contract dates, the project search, and Certinia PSA.",
    // Certinia PSA is a service here rather than a tenth provider. It is a
    // managed package inside Salesforce, which is why every object it owns
    // carries the pse__ prefix, and one grant reaches pse__Proj__c,
    // pse__Assignment__c and pse__Scheduled_Hours__c alike.
    services: [
      { id: "contracts", label: "Contracts" },
      { id: "projects", label: "Projects" },
      { id: "certinia", label: "Certinia PSA" },
    ],
    methods: [oauth("https://login.salesforce.com/")],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "One key, many models.",
    services: [],
    methods: [
      apiKey(
        "sk-or-v1-...",
        "OpenRouter makes the key at openrouter.ai/keys, and bills it to the account that owns it."
      ),
    ],
  },
  {
    id: "claude",
    name: "Claude",
    blurb: "Anthropic models, by subscription or by the token.",
    services: [],
    methods: [
      {
        id: "subscription",
        label: "Subscription",
        hint: "The button opens Claude, and the plan you pay for covers the usage.",
        signIn: "https://claude.ai/login",
      },
      apiKey(
        "sk-ant-...",
        "The Anthropic console makes the key, and bills the usage to the account that owns it."
      ),
    ],
  },
  {
    id: "voyage",
    name: "Voyage AI",
    // src/embedding.ts pins the model and the width, because a pgvector
    // column declares one width and changing either value is a migration.
    // The screen reads it rather than naming them again.
    blurb: `Embeddings, ${EMBEDDING.model} at ${EMBEDDING.dimension}.`,
    services: [],
    methods: [
      apiKey(
        "pa-...",
        `The Voyage dashboard makes the key. The assistant embeds with ${EMBEDDING.model} at ${EMBEDDING.dimension}, which src/embedding.ts pins.`
      ),
    ],
  },
];

/**
 * An address the browser may be sent to.
 *
 * The site comes from a box anybody can type in, and a tab is opened at
 * whatever it holds. A `javascript:` address in that box would run on the
 * page that opened it, so only the two web protocols pass.
 */
export function web(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A typed address, given the scheme people leave out.
 *
 * Nobody types "https://" in front of their own Jira site, and a button that
 * stays dead until they do says nothing about why. A value naming a scheme
 * keeps it, so a dangerous one still fails the check. Anything else takes
 * https, which covers both "your-team.atlassian.net" and "localhost:3000".
 */
export function asUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const full = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  return web(full) ? full : null;
}

/**
 * Where a method sends the browser, or null when it asks for a key instead.
 *
 * A method carrying a url field opens the address typed into it, because the
 * site you name is the site you sign in to. Its own address is the fallback,
 * for a provider with one front door.
 */
export function signInTarget(
  method: Method,
  values: Record<string, string>
): string | null {
  if (!method.signIn) return null;
  const site = method.fields?.find((field) => field.kind === "url");
  const typed = site ? (values[site.id] ?? "").trim() : "";
  // A site that was typed and cannot be read opens nothing. Falling back to
  // the provider's front door would open a page nobody asked for.
  if (typed) return asUrl(typed);
  return web(method.signIn) ? method.signIn : null;
}

export function provider(id: ProviderId): Provider | undefined {
  return PROVIDERS.find((entry) => entry.id === id);
}
