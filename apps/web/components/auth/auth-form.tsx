"use client";

// KPA-37. Adapted from the ReUI auth-20 block.
//
// A conflict this file records: the brief's "Identity" decision puts WorkOS
// AuthKit behind Cloudflare Access, which authenticates the person before the
// request reaches the application, and "Users" gives the system one user. So
// production needs neither of these pages. Shane asked for them on
// 27 August 2026 as a prototype. They authenticate nobody.

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { useAccount } from "@/lib/account";
import { looksLikeEmail } from "@/lib/email";
import { check, PASSWORD_MINIMUM, passes } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FormSubmitEvent = Parameters<FormSubmitHandler>[0];

export type AuthMode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Welcome back",
    lead: "Sign in to open your briefing.",
    submit: "Sign in",
    divider: "Or sign in with email",
    footer: "No account yet?",
    footerLink: "Create one",
    footerHref: "/sign-up",
  },
  "sign-up": {
    title: "Create your account",
    lead: "One account, three mailboxes, one memory.",
    submit: "Create account",
    divider: "Or sign up with email",
    footer: "Already have an account?",
    footerLink: "Sign in",
    footerHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const router = useRouter();
  // Nothing here authenticates anybody, and nothing writes an account. So a
  // box nobody has set up has nowhere to send them but the setup screen,
  // which is where the application itself sends them.
  const configured = useAccount() !== null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function validate() {
    const next: Record<string, string> = {};
    if (mode === "sign-up" && name.trim().length < 2) {
      next.name = "Enter your name.";
    }
    if (!looksLikeEmail(email)) {
      next.email = "Enter an email address, for example shane@koinon.com.au.";
    }
    // A new password meets the installation's rules, wherever it is typed.
    // The sign-in box only catches an empty one, because the password it is
    // checking already exists and its rules were met when it was set.
    if (mode === "sign-up" && !passes(password)) {
      next.password = `It needs ${check(password)
        .filter((rule) => !rule.met)
        .map((rule) => rule.text.toLowerCase())
        .join(", ")}.`;
    }
    if (mode === "sign-in" && password.length === 0) {
      next.password = "Enter your password.";
    }
    return next;
  }

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    router.push(configured ? "/dashboard" : "/setup");
  }

  return (
    <AuthCard
      title={copy.title}
      lead={copy.lead}
      footer={
        <>
          {copy.footer}{" "}
          <Link
            href={copy.footerHref}
            className="text-foreground underline underline-offset-4"
          >
            {copy.footerLink}
          </Link>
        </>
      }
    >
      <Button type="button" variant="outline" className="w-full">
        <KeyRoundIcon className="size-4 shrink-0" aria-hidden="true" />
        Continue with WorkOS
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">
          {copy.divider}
        </span>
        <Separator className="flex-1" />
      </div>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <FieldGroup className="gap-4">
          {mode === "sign-up" && (
            <Field className="gap-2">
              <FieldLabel htmlFor="auth-name">Name</FieldLabel>
              <Input
                id="auth-name"
                type="text"
                autoComplete="name"
                placeholder="Shane Dolley"
                value={name}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "auth-name-error" : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {errors.name && (
                <p id="auth-name-error" className="text-destructive text-xs">
                  {errors.name}
                </p>
              )}
            </Field>
          )}

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
              {mode === "sign-in" && (
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                >
                  Forgot password?
                </Link>
              )}
            </div>

            <InputGroup className="w-full">
              <InputGroupInput
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "sign-up"
                    ? `At least ${PASSWORD_MINIMUM} characters`
                    : "Your password"
                }
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
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
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
          {busy ? "Opening your briefing..." : copy.submit}
        </Button>
      </form>
    </AuthCard>
  );
}
