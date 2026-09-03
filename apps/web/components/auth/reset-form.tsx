"use client";

// Where a reset link lands, and the last screen before signing in again.
//
// The token in the address is what authenticates this page. `proxy.ts` lets
// `/reset` through for that reason and `lib/public-paths.ts` records it: there
// is nobody signed in to check, which is the whole situation.
//
// THE RULES COME FROM `lib/password.ts`, the same module the setup wizard
// draws its list from, so a password accepted here is one the wizard would
// have accepted. `PUT /api/reset` checks them again, because a request body is
// a trust boundary and this form is the only caller today rather than the only
// caller possible.
//
// NOTHING SIGNS THE PERSON IN AFTERWARDS. Spending the token ends every
// session the owner had open, and issuing a fresh one here would undo half of
// that in the same breath. Signing in with the new password is what proves it
// worked.

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { CheckIcon, CircleIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { check, MARKS_REQUIRED, PASSWORD_MINIMUM, passes } from "@/lib/password";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FormSubmitEvent = Parameters<FormSubmitHandler>[0];

const signInAgain = (
  <>
    Remembered it?{" "}
    <Link href="/sign-in" className="text-foreground underline underline-offset-4">
      Sign in
    </Link>
  </>
);

export function ResetForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const rules = check(password);

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    if (!passes(password)) {
      setFault("The password misses a rule below.");
      return;
    }
    if (again !== password) {
      setFault("The two do not match.");
      return;
    }

    setFault("");
    setBusy(true);
    fetch("/api/reset", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    })
      .then(async (response) => {
        if (response.ok) {
          setDone(true);
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFault(body?.error ?? "That did not work. Ask for another link.");
      })
      .catch((cause: unknown) => {
        console.error("reset:", cause);
        setFault("The server did not answer. Try again.");
      })
      .finally(() => setBusy(false));
  }

  // A link with nothing after the question mark reaches no token, so there is
  // nothing to spend and no form worth drawing.
  if (!token) {
    return (
      <AuthCard
        title="That link is not complete"
        lead="A reset link carries a token, and this address has none."
        footer={signInAgain}
      >
        <p className="text-muted-foreground text-center text-sm">
          Ask for a new link on the{" "}
          <Link
            href="/forgot-password"
            className="text-foreground underline underline-offset-4"
          >
            forgotten password
          </Link>{" "}
          screen, or run{" "}
          <code className="text-foreground">scripts/reset-password.sh</code> on
          the server.
        </p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="That is set"
        lead="Every browser that was signed in has been signed out, including any that was not yours."
        footer={signInAgain}
      >
        <Button
          className="w-full"
          render={<Link href="/sign-in" />}
          nativeButton={false}
        >
          Sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      lead={`It takes ${String(PASSWORD_MINIMUM)} characters, a capital, a number and ${String(MARKS_REQUIRED)} marks.`}
      footer={signInAgain}
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        {fault && (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {fault}
          </p>
        )}

        <FieldGroup className="gap-4">
          <Field className="gap-2">
            <FieldLabel htmlFor="reset-password">New password</FieldLabel>
            <InputGroup className="w-full">
              <InputGroupInput
                id="reset-password"
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                autoFocus
                aria-describedby="reset-password-rules"
                onChange={(event) => setPassword(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={shown ? "Hide password" : "Show password"}
                  aria-pressed={shown}
                  onClick={() => setShown((current) => !current)}
                >
                  {shown ? (
                    <EyeOffIcon aria-hidden="true" />
                  ) : (
                    <EyeIcon aria-hidden="true" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <ul id="reset-password-rules" className="flex flex-col gap-1 pt-1">
              {rules.map((rule) => (
                <li
                  key={rule.text}
                  className={cn(
                    "flex items-center gap-2 text-xs transition-colors",
                    rule.met ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {rule.met ? (
                    <CheckIcon className="size-3.5" aria-hidden="true" />
                  ) : (
                    <CircleIcon className="size-3.5" aria-hidden="true" />
                  )}
                  {rule.text}
                </li>
              ))}
            </ul>
          </Field>

          <Field className="gap-2">
            <FieldLabel htmlFor="reset-again">Type it again</FieldLabel>
            <InputGroup className="w-full">
              <InputGroupInput
                id="reset-again"
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </InputGroup>
          </Field>
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Setting it..." : "Set the password"}
        </Button>
      </form>
    </AuthCard>
  );
}
