"use client";

// The connection list and the dialog that adds to it.
//
// The dialog asks two questions in two panes. Which provider, then which
// account and what it may reach. One pane at a time keeps the second question
// short, because the services on offer depend on the answer to the first.
//
// The method decides the second pane. One that signs you in opens the
// provider's page in a new tab. One that takes a key draws the boxes it asks
// for, and the key goes into component state and no further.
//
// ponytail: the sign-in opens the provider's own page rather than an OAuth
// grant, because a grant needs a client id and a redirect the worker has not
// registered. Nothing verifies the key either, so every card reads "Not
// connected". Wire both to the worker when it lands. The Jira card in
// components/settings/jira-connection.tsx shows the shape they take.

import { useId, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

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
  onAdd: (connection: Omit<Connection, "id">) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [method, setMethod] = useState(chosen.methods[0].id);
  // Keyed by field id. A secret sits here and goes no further: the dialog
  // drops the whole object when it closes.
  const [values, setValues] = useState<Record<string, string>>({});
  // Every service on, because an account is usually added for all of them.
  const [services, setServices] = useState<string[]>(
    chosen.services.map((service) => service.id)
  );

  const chosenMethod =
    chosen.methods.find((entry) => entry.id === method) ?? chosen.methods[0];
  const fields = chosenMethod.fields ?? [];

  function value(id: string): string {
    return (values[id] ?? "").trim();
  }

  const filled = fields.every((field) =>
    field.kind === "url"
      ? asUrl(value(field.id)) !== null
      : value(field.id).length > 0
  );
  const ready =
    name.trim().length > 0 &&
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
    const target = signInTarget(chosenMethod, values);
    // noopener, or the page opened gets a handle on this one.
    if (target) window.open(target, "_blank", "noopener,noreferrer");
    onAdd({ provider: chosen.id, name: name.trim(), method, services });
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
                The key is never written to the browser. This screen holds it
                until the worker exists to take it.
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
            The assistant reaches what is ticked here and nothing else.
          </p>
        </div>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={!ready}>
          {chosenMethod.signIn ? `Sign in to ${chosen.name}` : "Add connection"}
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
              ? "The card is added either way. Signing in opens the provider in a new tab, and a key is held by this screen alone until the worker exists to take it."
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
  if (!entry) return null;

  const method = entry.methods.find((item) => item.id === connection.method);

  return (
    <Card size="sm" className="justify-between">
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-3">
        <ProviderTile id={entry.id} />
        <div className="flex min-w-0 flex-col">
          <CardTitle className="truncate">{connection.name}</CardTitle>
          <span className="text-muted-foreground text-xs">
            {entry.name}
            {method ? ` · ${method.label}` : ""}
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${connection.name}`}
          onClick={() => removeConnection(connection.id)}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-1.5">
        {connection.services.map((id) => (
          <Badge key={id} size="sm" variant="outline">
            {entry.services.find((service) => service.id === id)?.label ?? id}
          </Badge>
        ))}
        <Badge size="sm" variant="warning-light" className="ml-auto">
          Not connected
        </Badge>
      </CardContent>
    </Card>
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
