"use client";

// The door for somebody who cannot remember the password.
//
// It asks one question and gives one answer, and the answer is the same
// whether the address is known or not. Saying "no account with that address"
// tells anybody who asks which addresses hold accounts, which is a list worth
// having if you are the wrong sort of person. Every reset flow worth copying
// answers the same way.
//
// ponytail: nothing sends the mail, and no page takes the link at the other
// end. The reset screen arrives with the worker that can issue a token, and a
// token nobody issues is a screen nobody can reach.

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
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Enter an email address, for example shane@koinon.com.au.");
      return;
    }
    setError("");
    setSent(true);
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
        title="Check your mail"
        lead="A link to set a new password is on its way, if that address holds an account."
        footer={footer}
      >
        <div className="text-muted-foreground flex flex-col items-center gap-3 text-center text-sm">
          <MailCheckIcon className="text-primary size-8" aria-hidden="true" />
          <p>
            The link lasts an hour. Nothing has been sent yet, because no
            worker exists to send it.
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

        <Button type="submit" className="w-full">
          Send the link
        </Button>
      </form>
    </AuthCard>
  );
}
