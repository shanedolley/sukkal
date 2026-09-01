"use client";

// The Jira connection for one project.
//
// Two ways in. OAuth sends you to Atlassian and brings back a grant, so no
// secret passes through this screen. An API token is the fallback for a site
// where OAuth is not set up, and it is the reason for the warning below.
//
// The token is never stored here. A secret in localStorage is readable by
// anything that runs on the page and travels with the browser profile, so
// the field holds it only until the connection is made, and the worker keeps
// it after that. `~/.zshenv` already exports KOINON_JIRA_TOKEN for exactly
// this reason.

import { useState } from "react";
import {
  CheckIcon,
  InfoIcon,
  LinkIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Method = "oauth" | "token";

const METHODS: { id: Method; label: string }[] = [
  { id: "oauth", label: "OAuth" },
  { id: "token", label: "API token" },
];

/**
 * Two ways in, both on screen.
 *
 * A menu of two hides one of them behind a click, and the choice between
 * them is the decision this card is really asking for. Side by side, the
 * safer one reads first and neither has to be hunted for.
 */
function MethodToggle({
  value,
  onChange,
}: {
  value: Method;
  onChange: (method: Method) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Method"
      className="border-input bg-input/20 inline-flex h-8 w-fit items-center gap-0.5 rounded-lg border p-[3px] dark:bg-input/30"
    >
      {METHODS.map((method) => {
        const on = value === method.id;
        return (
          <button
            key={method.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(method.id)}
            className={cn(
              "focus-visible:ring-ring h-full cursor-pointer rounded-md px-2.5 text-xs whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none",
              on
                ? "bg-background text-foreground shadow-xs shadow-black/5"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {method.label}
          </button>
        );
      })}
    </div>
  );
}

interface Check {
  ok: boolean;
  message: string;
}

/**
 * What this screen can prove, and what it cannot.
 *
 * A browser cannot call Jira: the site would refuse the cross-origin request,
 * and sending a token from a page would hand it to every script on that page.
 * So the shape of the credentials is checked here, and the call itself waits
 * for the worker.
 */
function inspect(method: Method, site: string, email: string, token: string) {
  const checks: Check[] = [];

  const trimmed = site.trim();
  let host = "";
  try {
    host = new URL(trimmed).host;
  } catch {
    host = "";
  }
  checks.push({
    ok: host.endsWith(".atlassian.net"),
    message: host
      ? `Site reads as ${host}`
      : "Site is not a URL. It looks like https://your-team.atlassian.net",
  });

  if (method === "token") {
    checks.push({
      ok: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()),
      message: email.trim()
        ? `Sent as ${email.trim()}`
        : "An API token needs the email of the account that made it",
    });
    checks.push({
      ok: token.length > 0,
      message: token.length > 0 ? "Token supplied" : "No token supplied",
    });
  }

  return checks;
}

function Result({ check }: { check: Check }) {
  const Icon = check.ok ? CheckIcon : XIcon;
  return (
    <li
      className={cn(
        "flex items-start gap-2 text-xs",
        check.ok ? "text-success-foreground" : "text-destructive"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {check.message}
    </li>
  );
}

export function JiraConnection() {
  const [method, setMethod] = useState<Method>("oauth");
  const [site, setSite] = useState("https://koinon.atlassian.net");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);

  const passed = checks?.every((check) => check.ok) ?? false;

  return (
    <div className="border-border/70 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <LinkIcon className="size-4" aria-hidden="true" />
            Jira
          </h3>
          <p className="text-muted-foreground text-xs">
            Where this project&rsquo;s issues, sprints and boards come from.
          </p>
        </div>
        <span className="border-border/70 text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]">
          Not connected
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Method</Label>
          <MethodToggle
            value={method}
            onChange={(next) => {
              setMethod(next);
              // The last result was about the other method.
              setChecks(null);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jira-site">Site</Label>
          <Input
            id="jira-site"
            value={site}
            onChange={(event) => setSite(event.target.value)}
            placeholder="https://your-team.atlassian.net"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {method === "token" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jira-email">Account email</Label>
              <Input
                id="jira-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jira-token">API token</Label>
              <Input
                id="jira-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste the token"
                autoComplete="off"
              />
            </div>
          </>
        )}
      </div>

      {method === "token" && (
        <div className="border-warning/40 bg-warning/5 flex items-start gap-2 rounded-md border p-3">
          <TriangleAlertIcon
            className="text-warning mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1 text-xs">
            <p className="font-medium">Prefer OAuth where the site allows it.</p>
            <p className="text-muted-foreground">
              A token is a password that never expires. This screen keeps it
              only until the connection is made, and the worker holds it after
              that. It is never written to the browser.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChecks(inspect(method, site, email, token))}
        >
          Test the connection
        </Button>
        <Button size="sm" disabled={!passed}>
          {method === "oauth" ? "Authorise with Atlassian" : "Connect"}
        </Button>
      </div>

      {checks && (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md p-3">
          <ul className="flex flex-col gap-1.5">
            {checks.map((check) => (
              <Result key={check.message} check={check} />
            ))}
          </ul>
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {passed
              ? "The credentials are the right shape. Reaching Jira is the worker's job, and it is not built yet."
              : "Fix the above, then test again."}
          </p>
        </div>
      )}
    </div>
  );
}
