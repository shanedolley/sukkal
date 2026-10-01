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
//
// OPENING A CARD RECONNECTS IT. KPA-159: the only fix for a dead credential
// used to be deleting the connection and rebuilding it, which threw away the
// row's id, its created_at and its verification history. The card's body is
// now a dialog trigger, and the dialog carries Reconnect for a grant method or
// a new-key form for one that takes a secret. Both call PATCH
// /api/connections, which replaces the credential in place rather than
// inserting a row POST would refuse as a duplicate.

import { useId, useState } from "react";
import { CircleXIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { isFailing } from "@/lib/connection-health";
import { formatDay } from "@/lib/format";

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
  renameConnection,
  replaceKey,
  useConnections,
  type Connection,
  type NewConnection,
} from "@/lib/connections";
import {
  PROVIDERS,
  provider as providerById,
  asUrl,
  initialValues,
  isEmail,
  signInTarget,
  type Method,
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
  // closes. Nothing writes it to this browser. A box with a default starts
  // filled: only the send-from address has one.
  const [values, setValues] = useState<Record<string, string>>(
    initialValues(chosen.methods[0])
  );
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
  // A method asking for a send-from address is a card whose mail somebody
  // else reads, so the Name box says the name travels with it.
  const sends = fields.some((field) => field.kind === "email");

  function value(id: string): string {
    return (values[id] ?? "").trim();
  }

  // The address is checked here so the button stays dead on a typo, and again
  // at the route, which is the boundary a request actually crosses.
  const filled = fields.every((field) =>
    field.kind === "url"
      ? asUrl(value(field.id)) !== null
      : field.kind === "email"
        ? isEmail(value(field.id))
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
    const from = fields.find((field) => field.kind === "email");
    onAdd({
      provider: chosen.id,
      name: name.trim(),
      method,
      services,
      secret: key ? value(key.id) : undefined,
      expiresOn: expiry ? (value(expiry.id) || null) : null,
      sendFrom: from ? (value(from.id) || null) : null,
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
            // A card that sends mail shows a name that reads well in somebody
            // else's inbox. "BHP Resend" told two accounts apart and
            // contradicted the hint below it, which is the form disagreeing
            // with itself that KPA-158 closes.
            placeholder={sends ? "Sukkal Resend" : `BHP ${chosen.name}`}
            autoComplete="off"
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            {sends
              ? "What tells this account from the next one on the same provider, and the name recipients see beside the address: Sukkal Resend <no-reply@sukkal.app>."
              : "What tells this account from the next one on the same provider."}
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
              // The boxes belong to the method that asked for them, so the
              // new method's own defaults replace the old method's answers.
              setValues(
                initialValues(
                  chosen.methods.find((entry) => entry.id === next) ??
                    chosen.methods[0]
                )
              );
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
                secret
                  ? "password"
                  : field.kind === "date"
                    ? "date"
                    : field.kind === "email"
                      ? "email"
                      : "text"
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
            {field.kind === "email" && (
              <p className="text-muted-foreground text-xs">
                Resend sends only from a domain verified with it, so this
                address has to sit on one.
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

/** One labelled fact in the detail dialog. A null value reads as a plain
 *  sentence rather than a dash, because a dash answers nothing. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/** Starts a real grant for a connection that already exists. The same POST
 *  `ConnectionForm` makes, so a first connection and a reconnect seal a token
 *  the same way; only the caller differs. */
function Reconnect({ connection }: { connection: Connection }) {
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");

  function start() {
    setBusy(true);
    setFault("");
    fetch("/api/connections/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: connection.provider,
        services: connection.services,
        returnsTo: "/connections",
      }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (response.ok && body?.url) {
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
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={start} disabled={busy}>
        {busy ? "Opening the provider..." : "Reconnect"}
      </Button>
      <p className="text-muted-foreground text-xs">
        Signing in as a different account creates a second connection. It does
        not update this one, because the match is on the account the provider
        reports, not on the card you opened.
      </p>
      {fault && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {fault}
        </p>
      )}
    </div>
  );
}

/** Replaces the key on a connection that already exists, over PATCH. The box
 *  is a password box held in component state alone: it is written to no
 *  storage, and the sentence below it says where it goes instead. */
function ReplaceKey({ connection, method }: { connection: Connection; method: Method }) {
  const secretId = useId();
  const dateId = useId();
  const dateField = (method.fields ?? []).find((field) => field.kind === "date");
  const [secret, setSecret] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (secret.trim() === "") return;
    setBusy(true);
    setFault("");
    void replaceKey(connection.id, secret, expiresOn || null).then((said) => {
      setBusy(false);
      if (said !== null) {
        setFault(said);
        return;
      }
      setSecret("");
      setExpiresOn("");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={secretId}>New key</Label>
        <Input
          id={secretId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="Paste the new key"
        />
        <p className="text-muted-foreground text-xs">
          The key goes to the server and is sealed there. This browser keeps
          no copy of it, and no screen reads it back.
        </p>
      </div>
      {dateField && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={dateId}>{dateField.label}</Label>
          <Input
            id={dateId}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
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
      <Button type="submit" disabled={busy || secret.trim() === ""}>
        {busy ? "Sealing..." : "Replace key"}
      </Button>
    </form>
  );
}

/**
 * Changes the name on a connection whose method takes a key. KPA-162.
 *
 * A grant method's card is named by the provider, so no such form opens for
 * one: `ConnectionDetail` below holds the choice, and the route refuses the
 * request anyway, since the screen is a convenience and the route is the
 * boundary.
 */
function RenameConnection({ connection, sends }: { connection: Connection; sends: boolean }) {
  const nameId = useId();
  const [name, setName] = useState(connection.name);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === connection.name) return;
    setBusy(true);
    setFault("");
    void renameConnection(connection.id, trimmed).then((said) => {
      setBusy(false);
      if (said !== null) setFault(said);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={nameId}>Name</Label>
      <Input
        id={nameId}
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="off"
      />
      <p className="text-muted-foreground text-xs">
        {sends
          ? "What tells this account from the next one on the same provider. Renaming it changes the name recipients see beside the address."
          : "What tells this account from the next one on the same provider."}
      </p>
      {fault && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {fault}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={busy || name.trim() === "" || name.trim() === connection.name}
      >
        {busy ? "Saving..." : "Save name"}
      </Button>
    </form>
  );
}

/** What a card opens into: the connection as it stands, and the one way this
 *  method offers to fix a dead credential. A method that neither grants nor
 *  takes a key, such as a subscription, shows the facts and offers neither. */
function ConnectionDetail({
  connection,
  entry,
}: {
  connection: Connection;
  entry: Provider;
}) {
  const method = entry.methods.find((item) => item.id === connection.method);
  const grant = method?.grant === true;
  const secretField = (method?.fields ?? []).some((field) => field.kind === "secret");
  // A method whose form asks for a send-from address is one whose mail a
  // stranger reads, so renaming such a card says so where the name is edited.
  const sends = (method?.fields ?? []).some((field) => field.kind === "email");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider" value={entry.name} />
        {grant && <Field label="Name" value={connection.name} />}
        <Field label="Method" value={method?.label ?? connection.method} />
        <Field
          label="Issued"
          value={connection.issuedOn ? formatDay(connection.issuedOn) : "Not recorded."}
        />
        <Field
          label="Expires"
          value={connection.expiresOn ? formatDay(connection.expiresOn) : "No expiry set."}
        />
        <Field
          label="Last checked"
          value={
            connection.verifiedOn ? formatDay(connection.verifiedOn) : "Not checked yet."
          }
        />
        {connection.sendFrom && <Field label="Send from" value={connection.sendFrom} />}
      </div>

      {/* No rename here, and no hint that a reconnect is one. A grant under a
          different account makes a second connection, which the Reconnect
          block below says in as many words, so a sentence pointing at it as a
          way to rename this card would contradict it. */}
      {grant && (
        <p className="text-muted-foreground text-xs">
          The provider names this card, so it cannot be renamed here. The name
          is the account that consented.
        </p>
      )}
      {!grant && <RenameConnection connection={connection} sends={sends} />}

      {/* The verdict is a sentence the provider wrote, and one of them runs to
          three lines. It sat in the Last checked box until 1 October 2026 and
          stretched that column past every other, so it reads on its own row. */}
      {connection.verdict && (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">What the check said</span>
          <span
            className={cn("text-sm", connection.verifiedOk === false && "text-destructive")}
          >
            {connection.verdict}
          </span>
        </div>
      )}

      {connection.services.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">Services</span>
          <div className="flex flex-wrap gap-1.5">
            {connection.services.map((id) => (
              <Badge key={id} size="sm" variant="outline">
                {entry.services.find((service) => service.id === id)?.label ?? id}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {grant && <Reconnect connection={connection} />}
      {!grant && secretField && method && (
        <ReplaceKey connection={connection} method={method} />
      )}
    </div>
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
    <Dialog>
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
          {/* The trigger covers the tile and the name, and nothing else: the
              trash button below is its sibling, not its child, so pressing
              it can never also open the dialog. */}
          <DialogTrigger
            render={
              <button
                type="button"
                aria-label={`Open ${connection.name}`}
                className="col-span-2 grid cursor-pointer grid-cols-[auto_1fr] items-center gap-3 rounded-md text-left focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
              />
            }
          >
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
          </DialogTrigger>
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
              Last check
              {connection.verifiedOn ? ` on ${formatDay(connection.verifiedOn)}` : ""}:{" "}
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

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{connection.name}</DialogTitle>
          <DialogDescription>
            What this connection is, and the one way to fix a dead credential
            without deleting it.
          </DialogDescription>
        </DialogHeader>
        <ConnectionDetail connection={connection} entry={entry} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
