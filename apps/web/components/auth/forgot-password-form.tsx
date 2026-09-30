"use client";

// The door for somebody who cannot remember the password.
//
// It asks one question and gives one answer, and the answer is the same
// whether the address is known or not. Saying "no account with that address"
// tells anybody who asks which addresses hold accounts, which is a list worth
// having if you are the wrong sort of person. Every reset flow worth copying
// answers the same way.
//
// KPA-79 gave it something to ask. `POST /api/reset` issues a token when the
// address holds the account, and answers the same either way, so the promise
// this screen has always made is now one the server keeps.
//
// KPA-143 GAVE THE LINK A WAY OUT, AND THE WORDING DID NOT CHANGE. `deliver`
// in `src/auth/reset.ts` sends through a Resend connection somebody
// configured, and a box with no such connection behaves as it always did. This
// screen cannot tell the two apart and must not be told, so it names the
// escape hatch ADR-0009 gave, `scripts/reset-password.sh --link`, which is
// true on a box that mails and on one that does not.

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { MailCheckIcon } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { looksLikeEmail } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FormSubmitEvent = Parameters<FormSubmitHandler>[0];

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Enter an email address, for example shane@koinon.com.au.");
      return;
    }
    setError("");
    setBusy(true);

    // The screen shows the same card whatever the server says, including when
    // it says nothing. A failure that changed the wording would tell somebody
    // which address reached a real account.
    fetch("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    })
      .catch((cause: unknown) => console.error("reset request:", cause))
      .finally(() => {
        setBusy(false);
        setSent(true);
      });
  }

  const footer = (
    <>
      Remembered it?{" "}
      <Link
        href="/sign-in"
        className="text-foreground underline underline-offset-4"
      >
        Sign in
      </Link>
    </>
  );

  if (sent) {
    return (
      <AuthCard
        title="That is asked"
        lead="A link to set a new password is waiting, if that address holds an account."
        footer={footer}
      >
        <div className="text-muted-foreground flex flex-col items-center gap-3 text-center text-sm">
          <MailCheckIcon className="text-primary size-8" aria-hidden="true" />
          {/* True on a box with mail and on one without, because the browser
              cannot tell which this is and must not be told. */}
          <p>
            The link lasts an hour and works once. If nothing arrives, run{" "}
            <code className="text-foreground">
              scripts/reset-password.sh --link
            </code>{" "}
            on the server to reach it.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setSent(false)}
        >
          Use a different address
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      lead="Give the address the account is under, and a link to set a new password follows."
      footer={footer}
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <FieldGroup className="gap-4">
          <Field className="gap-2">
            <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="username"
              placeholder="shane@koinon.com.au"
              value={email}
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "forgot-email-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error && (
              <p id="forgot-email-error" className="text-destructive text-xs">
                {error}
              </p>
            )}
          </Field>
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Asking..." : "Send the link"}
        </Button>
      </form>
    </AuthCard>
  );
}
