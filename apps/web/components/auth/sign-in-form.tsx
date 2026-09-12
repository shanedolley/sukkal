"use client";

// The door. It is the only one, on every installation.
//
// KPA-37 built this as a prototype and recorded that production would drop it,
// because Cloudflare Access authenticated the person before the request
// arrived. ADR-0023 refused that assumption: Sukkal reads no identity header on
// any box, so this form is the gate rather than a picture of one. KPA-128 is
// where it started authenticating somebody.
//
// ONE ANSWER FOR EVERY FAILURE, and the server decides it. `POST /api/session`
// answers the same 401 for a wrong address and a wrong password, so this shows
// what the server said rather than composing a message of its own.
// `forgot-password-form.tsx` keeps the same rule on its own screen.
//
// A HARD NAVIGATION AFTERWARDS, not `router.push`. The cookie changes what
// every read on the next page returns, and two caches in front of those reads
// were populated while nobody was signed in: Next's router cache, and the
// module-level store in `lib/account.ts` that answered "this box has no
// account". A full load empties both. It happens once a fortnight, which is
// what `LIFETIME_DAYS` costs.
//
// WHERE TO GO NEXT ARRIVES AS A PROP, from the page above. `useSearchParams`
// would read it here and cost a Suspense boundary: Next's own documentation
// says a static page calling that hook fails the production build without one.
// The page is a Server Component and holds the parameter already.

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { looksLikeEmail } from "@/lib/email";
import { safeNext } from "@/lib/next-path";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FormSubmitEvent = Parameters<FormSubmitHandler>[0];

export function SignInForm({ next }: { next: string | null }) {
  const target = safeNext(next);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState("");
  const [busy, setBusy] = useState(false);

  function validate() {
    const next: Record<string, string> = {};
    if (!looksLikeEmail(email)) {
      next.email = "Enter an email address, for example shane@koinon.com.au.";
    }
    // The rules in `lib/password.ts` are not checked here. They govern a
    // password being set, and this one was set already: measuring an existing
    // password against today's rules would refuse somebody with a valid one.
    if (password.length === 0) {
      next.password = "Enter your password.";
    }
    return next;
  }

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setRefusal("");
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    })
      .then(async (response) => {
        if (response.ok) {
          window.location.assign(target);
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setRefusal(body?.error ?? "That email and password do not match.");
        setBusy(false);
      })
      .catch((cause: unknown) => {
        console.error("sign in:", cause);
        setRefusal("The server did not answer. Try again.");
        setBusy(false);
      });
  }

  return (
    <AuthCard
      title="Welcome back"
      lead="Sign in to open your briefing."
      footer={
        <>
          Nobody has set this box up?{" "}
          <Link
            href="/setup"
            className="text-foreground underline underline-offset-4"
          >
            Set it up
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        {/* The one message the server gives back, above the fields it refused
            rather than beside either of them. Saying which half was wrong is
            what tells somebody which half to keep guessing. */}
        {refusal && (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {refusal}
          </p>
        )}

        <FieldGroup className="gap-4">
          <Field className="gap-2">
            <FieldLabel htmlFor="auth-email">Email</FieldLabel>
            <Input
              id="auth-email"
              type="email"
              autoComplete="username"
              placeholder="shane@koinon.com.au"
              value={email}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "auth-email-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {errors.email && (
              <p id="auth-email-error" className="text-destructive text-xs">
                {errors.email}
              </p>
            )}
          </Field>

          <Field className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="auth-password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              >
                Forgot password?
              </Link>
            </div>

            <InputGroup className="w-full">
              <InputGroupInput
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "auth-password-error" : undefined
                }
                onChange={(event) => setPassword(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? (
                    <EyeOffIcon aria-hidden="true" />
                  ) : (
                    <EyeIcon aria-hidden="true" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {errors.password && (
              <p id="auth-password-error" className="text-destructive text-xs">
                {errors.password}
              </p>
            )}
          </Field>
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
