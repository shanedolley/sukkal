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
import { EyeIcon, EyeOffIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";

import { AuthLogo } from "@/components/blocks/auth-20/components/auth-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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

// Deliberately loose. A trust boundary needs a real check on the server, and
// this form has no server. It catches the typo and nothing more.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const router = useRouter();

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
    if (!EMAIL.test(email.trim())) {
      next.email = "Enter an email address, for example shane@koinon.com.au.";
    }
    if (password.length < 8) {
      next.password = "Use at least 8 characters.";
    }
    return next;
  }

  function handleSubmit(event: FormSubmitEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    router.push("/dashboard");
  }

  return (
    <div className="flex w-full max-w-[26rem] flex-col gap-5">
      <Card className="w-full gap-0 overflow-hidden p-0 shadow-sm">
        <CardHeader className="flex flex-col items-center gap-4 px-6 pt-8 pb-0 text-center sm:px-8 sm:pt-9">
          <AuthLogo />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold text-balance">{copy.title}</h1>
            <p className="text-muted-foreground text-sm text-pretty">
              {copy.lead}
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 px-6 pt-6 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
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
                    <Button
                      type="button"
                      variant="link"
                      className="text-muted-foreground h-auto cursor-pointer p-0 text-xs font-normal"
                    >
                      Forgot password?
                    </Button>
                  )}
                </div>

                <InputGroup className="w-full">
                  <InputGroupInput
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "sign-in" ? "current-password" : "new-password"
                    }
                    placeholder="At least 8 characters"
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
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-sm">
        {copy.footer}{" "}
        <Link
          href={copy.footerHref}
          className="text-foreground underline underline-offset-4"
        >
          {copy.footerLink}
        </Link>
      </p>

      {/* The page exists because Shane asked for it, not because the design
          needs it. Saying so on the screen keeps the prototype honest. */}
      <p className="text-muted-foreground mx-auto flex max-w-[26rem] items-start gap-2 text-center text-xs">
        <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-left">
          Prototype only. In production Cloudflare Access and WorkOS AuthKit
          authenticate you before the application sees the request, so this
          screen never appears.
        </span>
      </p>
    </div>
  );
}
