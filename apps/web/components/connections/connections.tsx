"use client";

// The connection list and the dialog that adds to it.
//
// The dialog asks two questions in two panes. Which provider, then which
// account and what it may reach. One pane at a time keeps the second question
// short, because the services on offer depend on the answer to the first.
//
// The method decides the second pane. One that signs you in opens the
// provider's page in a new tab. One that takes a key draws the boxes it asks
// for.
//
// THE KEY LEAVES THIS SCREEN AND NOTHING KEEPS IT. It sits in form state
// while it is typed, goes to /api/connections in the request body, and is
// sealed there under the connection's own id. This browser writes no copy of
// it, and no read brings one back: the card knows only whether a secret is
// stored. KPA-127 moved the whole record onto the server, for the reason
// ADR-0022 gives.
//
// A METHOD MARKED `grant` RUNS A REAL ONE. KPA-103 built the pair of routes,
// so pressing the button on such a card posts to /api/connections/authorize
// and leaves for the provider. The connection is written by the callback,
// under the address the provider says consented, so this screen sends no name
// and receives no token.
//
// ponytail: every other card still opens the provider's own page and stores
// nothing, because only Google has a record in src/connections/oauth.ts. A
// fourth provider is a key in that object and a flag on this card. Nothing has
// asked a provider whether a stored key works either, so a card reads "Key
// stored" rather than "Connected".

import { useId, useState } from "react";
import { CircleXIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { isFailing } from "@/lib/connection-health";

import { Badge } from "@/components/reui/badge";
import { BrandMark } from "@/components/ui/svgs/brands";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addConnection,
  removeConnection,
  useConnections,
  type Connection,
  type NewConnection,
} from "@/lib/connections";
import {
  PROVIDERS,
  provider as providerById,
  asUrl,
  signInTarget,
  type Provider,
} from "@/lib/providers";
import { cn } from "@/lib/utils";

/** The provider's mark, on the white a brand colour is drawn for. */
function ProviderTile({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cn(
        "ring-foreground/10 flex size-8 shrink-0 items-center justify-center rounded-md bg-white ring-1",
        className
      )}
    >
      <BrandMark id={id} className="size-5" />
    </span>
  );
}

/** One row of buttons, one of them pressed. The Preferences page reads the same. */
function Choice<T extends { id: string; label: string }>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={value === option.id ? "default" : "outline"}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/** Pane one: which provider. */
function ProviderChoice({ onPick }: { onPick: (chosen: Provider) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PROVIDERS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onPick(entry)}
          className="border-border/70 hover:bg-accent focus-visible:ring-ring flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ProviderTile id={entry.id} />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{entry.name}</span>
            <span className="text-muted-foreground text-xs">{entry.blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Pane two: what this account is called, and what it may reach. */
function ConnectionForm({
  chosen,
  onBack,
  onAdd,
}: {
  chosen: Provider;
  onBack: () => void;
  onAdd: (connection: NewConnection) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [method, setMethod] = useState(chosen.methods[0].id);
  // Keyed by field id. A secret sits here while it is typed, goes to the
  // route on submit, and is dropped with the whole object when the dialog
  // closes. Nothing writes it to this browser.
  const [values, setValues] = useState<Record<string, string>>({});
  // Every service on, because an account is usually added for all of them.
  const [services, setServices] = useState<string[]>(
    chosen.services.map((service) => service.id)
  );
  // A real grant leaves the page, so the button has to say it is working and
  // a refusal has somewhere to appear. Nothing else on this form can fail
  // before it submits.
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");

  const chosenMethod =
    chosen.methods.find((entry) => entry.id === method) ?? chosen.methods[0];
  const fields = chosenMethod.fields ?? [];
  // The provider names the account that consented, so a grant asks for no
  // name and the box would be a question with no use for the answer.
  const grant = chosenMethod.grant === true;

  function value(id: string): string {
    return (values[id] ?? "").trim();
  }

  const filled = fields.every((field) =>
    field.kind === "url"
      ? asUrl(value(field.id)) !== null
      : value(field.id).length > 0
  );
  const ready =
    (grant || name.trim().length > 0) &&
    filled &&
    (chosen.services.length === 0 || services.length > 0);

  function toggle(id: string, on: boolean) {
    setServices((current) =>
      on ? [...current, id] : current.filter((entry) => entry !== id)
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;

    // A real grant leaves this page rather than opening a tab. The provider
    // redirects back to the callback, which writes the connection, so nothing
    // is added here and the name box was never shown.
    if (chosenMethod.grant) {
      setBusy(true);
      setFault("");
      fetch("/api/connections/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: chosen.id,
          services,
          returnsTo: "/connections",
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as {
            url?: string;
            error?: string;
          } | null;
          if (response.ok && body?.url) {
            // The whole page goes. A new tab would leave the person watching
            // a dialog that never closes.
            window.location.assign(body.url);
            return;
          }
          setFault(body?.error ?? "The grant could not start.");
          setBusy(false);
        })
        .catch((cause: unknown) => {
          console.error("authorize:", cause);
          setFault("The server did not answer. Try again.");
          setBusy(false);
        });
      return;
    }

    const target = signInTarget(chosenMethod, values);
    // noopener, or the page opened gets a handle on this one.
    if (target) window.open(target, "_blank", "noopener,noreferrer");
    // The method names which box holds the key and which holds its expiry, so
    // neither is found by its id. A method that asks for neither sends
    // neither.
    const key = fields.find((field) => field.kind === "secret");
    const expiry = fields.find((field) => field.kind === "date");
    onAdd({
      provider: chosen.id,
      name: name.trim(),
      method,
      services,
      secret: key ? value(key.id) : undefined,
      expiresOn: expiry ? (value(expiry.id) || null) : null,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ProviderTile id={chosen.id} />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{chosen.name}</span>
          <span className="text-muted-foreground text-xs">{chosen.blurb}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onBack}
        >
          Change
        </Button>
      </div>

      {!grant && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`BHP ${chosen.name}`}
            autoComplete="off"
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            What tells this account from the next one on the same provider.
          </p>
        </div>
      )}

      {chosen.methods.length > 1 && (
        <div className="flex flex-col gap-2">
          <Label>Method</Label>
          <Choice
            label="Method"
            options={chosen.methods}
            value={method}
            onChange={(next) => {
              setMethod(next);
              // The boxes belong to the method that asked for them.
              setValues({});
            }}
          />
        </div>
      )}

      <p className="text-muted-foreground text-xs">{chosenMethod.hint}</p>

      {fields.map((field) => {
        const id = `${nameId}-${field.id}`;
        const secret = field.kind === "secret";
        return (
          <div key={field.id} className="flex flex-col gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            <Input
              id={id}
              // A date takes the browser's own box, which spells the format
              // out and rejects a day that does not exist.
              type={
                secret ? "password" : field.kind === "date" ? "date" : "text"
              }
              value={values[field.id] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.id]: event.target.value,
                }))
              }
              placeholder={field.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
            {secret && (
              <p className="text-muted-foreground text-xs">
                The key goes to the server and is sealed there. This browser
                keeps no copy of it, and no screen reads it back.
              </p>
            )}
          </div>
        );
      })}

      {chosen.services.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Services</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {chosen.services.map((service) => {
              const id = `${nameId}-${service.id}`;
              return (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={services.includes(service.id)}
                    onCheckedChange={(on) => toggle(service.id, on)}
                  />
                  <Label htmlFor={id} className="text-xs font-normal">
                    {service.label}
                  </Label>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            {grant
              ? "The consent screen asks for what is ticked here and nothing else, so a box left clear is access the provider never grants."
              : "The assistant reaches what is ticked here and nothing else."}
          </p>
        </div>
      )}

      {fault && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {fault}
        </p>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={!ready || busy}>
          {busy
            ? `Opening ${chosen.name}...`
            : chosenMethod.signIn
              ? `Sign in to ${chosen.name}`
              : "Add connection"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddConnection() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Provider | null>(null);

  function close() {
    setOpen(false);
    // The next visit starts at the provider list rather than the last answer.
    setChosen(null);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Add a connection"
            // Narrower than a card. It holds a plus and two lines, so the
            // width a real connection needs would be mostly empty.
            className="border-border/70 text-muted-foreground hover:border-border hover:text-foreground focus-visible:ring-ring flex min-h-28 w-full max-w-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none"
          />
        }
      >
        <PlusIcon className="size-5" aria-hidden="true" />
        <span className="text-sm font-medium">Add a connection</span>
        <span className="text-xs">Google, Microsoft, Zoom, Jira and the rest</span>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {chosen ? `Connect ${chosen.name}` : "Add a connection"}
          </DialogTitle>
          <DialogDescription>
            {chosen
              ? chosen.methods.some((one) => one.grant)
                ? "The provider asks you to consent, then names the account. The card is written under that name, and the token is sealed on the server."
                : "The card is added either way. Signing in opens the provider in a new tab, and a key typed here goes to the server and is sealed there."
              : "Pick the provider. The same one can be added as often as you hold accounts on it."}
          </DialogDescription>
        </DialogHeader>

        {chosen ? (
          <ConnectionForm
            chosen={chosen}
            onBack={() => setChosen(null)}
            onAdd={(connection) => {
              addConnection(connection);
              close();
            }}
          />
        ) : (
          <ProviderChoice onPick={setChosen} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const entry = providerById(connection.provider);
  // A refused removal, in the provider's own terms. The card stays either way,
  // because the server keeps the row when the provider will not revoke, and a
  // card that reappears with no reason reads as a bug rather than a refusal.
  const [fault, setFault] = useState("");
  const [going, setGoing] = useState(false);
  if (!entry) return null;

  const method = entry.methods.find((item) => item.id === connection.method);
  // KPA-107. A connection the hourly recheck found dead, or one holding no
  // credential, is outlined in red and says why. One never checked is left
  // alone, because unknown is not the same as broken.
  const failing = isFailing(connection);

  return (
    <Card
      size="sm"
      data-failing={failing || undefined}
      className={
        failing
          ? "ring-destructive justify-between ring-2"
          : "justify-between"
      }
    >
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-3">
        <ProviderTile id={entry.id} />
        <div className="flex min-w-0 flex-col">
          <CardTitle className="flex min-w-0 items-center gap-1.5">
            {failing && (
              <CircleXIcon
                className="text-destructive size-4 shrink-0"
                role="img"
                aria-label="Not working"
              />
            )}
            <span className="truncate">{connection.name}</span>
          </CardTitle>
          <span className="text-muted-foreground text-xs">
            {entry.name}
            {method ? ` · ${method.label}` : ""}
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={going}
          aria-label={`Remove ${connection.name}`}
          onClick={() => {
            setGoing(true);
            setFault("");
            void removeConnection(connection.id).then((said) => {
              // Nothing sets `going` back on success, because the card is
              // gone by then and setting state on it would say so in the
              // console.
              if (said !== null) {
                setFault(said);
                setGoing(false);
              }
            });
          }}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </CardHeader>

      {fault && (
        <CardContent className="pt-0">
          <p role="alert" className="text-destructive text-xs">
            {fault}
          </p>
        </CardContent>
      )}

      {failing && connection.hasSecret && connection.verdict && (
        <CardContent className="pt-0">
          <p className="text-destructive text-xs">
            Last check{connection.verifiedOn ? ` on ${connection.verifiedOn}` : ""}:{" "}
            {connection.verdict}
          </p>
        </CardContent>
      )}

      <CardContent className="flex flex-wrap items-center gap-1.5">
        {connection.services.map((id) => (
          <Badge key={id} size="sm" variant="outline">
            {entry.services.find((service) => service.id === id)?.label ?? id}
          </Badge>
        ))}
        <Badge
          size="sm"
          variant={failing ? "destructive-light" : "outline"}
          className="ml-auto"
        >
          {!connection.hasSecret
            ? "Not connected"
            : connection.verifiedOk === false
              ? "Not working"
              : connection.verifiedOk === true
                ? "Working"
                : "Key stored"}
        </Badge>
      </CardContent>
    </Card>
  );
}

/** What an OAuth error code looks like. RFC 6749 gives every one this shape. */
const ERROR_CODE = /^[a-z_]{1,40}$/;

/**
 * What the last grant did, if the browser has just come back from one.
 *
 * The callback redirects here with an outcome in the query, and the page reads
 * it on the server and hands it down.
 *
 * NOTHING RENDERED HERE IS A MESSAGE SOMEBODY WROTE, and the check is here
 * rather than only in the route, because anybody can open `/connections` with
 * a query of their own. `outcome` selects one of a fixed set of sentences and
 * an unknown value selects the last of them. `detail` is rendered only where
 * it looks like an error code. React escapes it either way, so this is not
 * about script: it is about a link that puts "call this number to restore
 * your account" under Sukkal's own heading.
 *
 * IT NAMES NO ACCOUNT, AND THAT IS THE POINT. This line used to say which
 * address had connected, which put the address in the URL, in browser history
 * and in every access log between the browser and the box. Shane read one
 * there on 12 September 2026. The card in the grid below says the same thing
 * in a place that does not travel.
 */
export function GrantNotice({
  outcome,
  detail,
}: {
  outcome: string | null;
  detail: string | null;
}) {
  if (!outcome) return null;

  const code = detail && ERROR_CODE.test(detail) ? detail : null;

  const said: Record<string, string> = {
    ok: "That account is connected. The token is sealed on the server, and the card below names it.",
    refused:
      code === "access_denied"
        ? "Nothing was connected, because consent was refused."
        : `The provider refused the grant${code ? `: ${code}` : "."}`,
    expired: "That took longer than ten minutes. Start it again.",
    unknown: "That link had already been used. Start the grant again.",
    "no-code": "The provider sent nothing to exchange. Start it again.",
    "no-refresh-token":
      "The provider granted an hour and no way to renew it, so nothing was stored.",
    failed: "The grant did not finish. The server log says why.",
  };

  // An outcome nobody issued reads as a failure rather than as a success, so a
  // crafted link cannot show a green tick beside a connection that is absent.
  const known = outcome in said;
  const good = known && outcome === "ok";

  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        good
          ? "border-success/40 bg-success/5 text-success"
          : "border-destructive/40 bg-destructive/5 text-destructive"
      )}
    >
      {said[outcome] ?? "The grant did not finish."}
    </p>
  );
}

export function ConnectionsGrid() {
  const connections = useConnections();

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      <AddConnection />
    </div>
  );
}
