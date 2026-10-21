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
  | "voyage"
  | "resend";

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
   * the browser's own date box, which spells the format out for the reader. An
   * email is the address a sending connection's mail comes from, and it is
   * checked here and again at the route.
   */
  kind?: "secret" | "url" | "date" | "email";
  /**
   * What the box starts with, when the answer is the same on almost every
   * installation. Only the send-from address has one.
   */
  initial?: string;
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
   * Whether Sukkal can run a real grant, rather than open the provider's front
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
function oauth(signIn: string, grant = false): Method {
  return {
    id: "oauth",
    label: "OAuth",
    hint: grant
      ? "The button sends you to the provider to consent. The token comes back to the server and never to this screen."
      : "The button opens the provider's own sign-in page, so no secret passes through this screen.",
    signIn,
    fields: [],
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
function apiKey(placeholder: string, hint: string, extra: Field[] = []): Method {
  return {
    id: "key",
    label: "API key",
    hint,
    fields: [
      ...extra,
      { id: "key", label: "API key", placeholder, kind: "secret" },
      REVIEW_BY,
    ],
  };
}

const REVIEW_BY: Field = {
  id: "expires",
  label: "Review by",
  placeholder: "YYYY-MM-DD",
  kind: "date",
};

/**
 * The address a sending connection's mail comes from.
 *
 * KPA-143 read it off the card's name, and that broke on 1 October 2026: the
 * Name box asks what tells one account from the next, so the card was named
 * "Sukkal Resend" and Resend refuses that as a `from`. The two are separate
 * questions and this is the second one. The name is still public, because it is
 * the display name beside this address.
 *
 * ponytail: the default is this installation's verified Resend domain and not a
 * product-wide truth. It is here because one person runs one installation and a
 * box pre-filled with the right answer beats a setting nobody has a screen for.
 * Move it to a stored setting, or read it from the domains Resend says are
 * verified, the first time a second installation exists.
 */
const SEND_FROM: Field = {
  id: "sendFrom",
  label: "Send from",
  placeholder: "no-reply@sukkal.app",
  kind: "email",
  initial: "no-reply@sukkal.app",
};

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
    // The one provider Sukkal runs a real grant for. `src/connections/oauth.ts`
    // holds the urls and the scopes, and the sign-in address here is what a
    // person reads rather than where the grant goes.
    methods: [oauth("https://accounts.google.com/signin", true)],
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
      {
        id: "token",
        label: "API token",
        // Atlassian now sets a term on every token it issues, so the date it
        // runs out is asked for here. A credential nobody can date is a
        // credential nobody renews, and the briefing is where a lapsing one
        // belongs.
        hint: "One connection per site, and the site must be an atlassian.net address. Atlassian expires an API token, so type the date it runs out and the briefing will raise it before it does.",
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
    blurb: "Anthropic models, on your subscription first and an API key if it fails.",
    services: [],
    methods: [
      // A setup token, because signing in at claude.ai grants Sukkal nothing to
      // keep. The server runs the Claude Code CLI with the token, and never
      // sends it to Anthropic itself. ADR-0027.
      {
        id: "subscription",
        label: "Subscription",
        hint: "Run claude setup-token in a terminal on your own computer and paste the token it prints. Your plan covers the usage, and an API key connection is the fallback.",
        fields: [
          {
            id: "key",
            label: "Setup token",
            placeholder: "sk-ant-oat01-...",
            kind: "secret",
          },
          REVIEW_BY,
        ],
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
  {
    id: "resend",
    name: "Resend",
    // The sender of the password reset link, and nothing else so far. KPA-143
    // ruled it over SMTP because the send is one HTTPS POST that Node's own
    // fetch carries, so the package gained nothing.
    blurb: "Sends the password reset link.",
    services: [],
    methods: [
      // The one method that asks for a Send from address. The name box above
      // holds the display name beside it, so `deliver` in src/auth/reset.ts
      // sends as "Sukkal Resend <no-reply@sukkal.app>". KPA-143 had the name
      // carry both jobs and KPA-158 separated them.
      apiKey(
        "re_...",
        "Resend makes the key at resend.com/api-keys. Give it sending access only, because sending is the one thing Sukkal asks Resend to do. The mail comes from the Send from address below, and the name above it is what recipients see beside that address.",
        [SEND_FROM]
      ),
    ],
  },
];

/**
 * Whether `value` is shaped like an email address.
 *
 * It proves one @, something either side of it, a dot in the domain, and none
 * of the characters that would end a mail header or a quoted name. It proves
 * nothing about the mailbox existing or the domain being verified at the
 * vendor: no check short of a send does.
 *
 * The route calls it, and so does the dialog. The route is the trust boundary
 * and the dialog is the convenience, which is the order to keep them in.
 */
export function isEmail(value: string): boolean {
  return /^[^\s@,;:"<>\\]+@[^\s@,;:"<>\\]+\.[^\s@,;:"<>\\]+$/.test(value.trim());
}

/**
 * Whether a card on this provider has to carry a Send from address.
 *
 * The catalogue decides, rather than the route naming a provider: a provider
 * whose form asks for the address is a provider that sends, and one that does
 * not is unaffected. A second sender therefore gains the rule by gaining the
 * field, which is the only place the two could have drifted.
 */
export function needsSendFrom(id: string): boolean {
  return PROVIDERS.some(
    (entry) =>
      entry.id === id &&
      entry.methods.some((method) =>
        (method.fields ?? []).some((field) => field.kind === "email")
      )
  );
}

/** What a method's boxes start with. Empty for every method but Resend's. */
export function initialValues(method: Method): Record<string, string> {
  return Object.fromEntries(
    (method.fields ?? []).flatMap((field) =>
      field.initial === undefined ? [] : [[field.id, field.initial] as const]
    )
  );
}

/**
 * An address the browser may be sent to.
 *
 * The site comes from a box anybody can type in, and a tab is opened at
 * whatever it holds. A `javascript:` address in that box would run on the
 * page that opened it, so only the two web protocols pass. The host must look
 * like a host name too, because a pasted API token parses as a host and a tab
 * would open at the token.
 */
export function web(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      (protocol === "https:" || protocol === "http:") &&
      (hostname === "localhost" || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname))
    );
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

/** Why the route refuses this method for this provider, or null when it takes it. */
export function refusedMethod(provider: string, method: string): string | null {
  return provider === "jira" && method !== "token"
    ? "Jira connects by API token."
    : null;
}

export function provider(id: ProviderId): Provider | undefined {
  return PROVIDERS.find((entry) => entry.id === id);
}
