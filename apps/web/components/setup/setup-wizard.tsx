"use client";

// The first boot.
//
// Somebody has pulled the container down and started it on a box of their own.
// Nothing knows them yet, so the application asks three things and then gets
// out of the way: who you are, what to call the assistant, and a password.
//
// Three steps rather than one long form. Each question is a different kind of
// answer, and a form that asks all three at once reads as a wall. The rail
// across the top says how much is left, because a person who cannot see the
// end of a setup assumes the worst.
//
// The account goes to the server, and the password with it. KPA-126 moved it
// there: `POST /api/account` hashes the password and writes all four columns in
// one statement, because `users_the_account_is_whole` refuses a subset.
//
// THE WIZARD STAYS, AND IT IS THE ONLY WAY AN ACCOUNT IS MADE. KPA-128 asked
// the question and this is the answer: ADR-0009 gives one installation one
// owner, so a sign-up page was a second door onto the same row and it is gone.
// The sign-in page links here instead, for a box nobody has set up.
//
// WRITING THE ACCOUNT NOW SIGNS THE PERSON IN, so the line below about being
// signed in says something true and the two buttons at the end reach screens
// the gate would otherwise refuse. The route issues the session, because the
// password it would ask for was typed in the request that made the account.
//
// THE SECOND RUN IS REFUSED BY THE SERVER, not only by this screen. A stranger
// on a configured box is told nothing by the read, so they see these questions
// rather than the "already set up" card, and `POST /api/account` answers 401.
// The card below is what the owner sees, because the owner holds a session.
//
// THE WIZARD ASKS FRESH. A browser that already held an account under
// `kpa.account` is not read here, so nothing is pre-filled from it. ADR-0022
// states the half that follows from ADR-0009: that account carried no password,
// so it could not sign anybody in and the first boot has to ask again. Whether
// the three other fields are worth pre-filling for the typing they save is a
// question nobody has ruled on, so this screen asks for all four.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  RefreshCwIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";

import { AuthLogo } from "@/components/blocks/auth-20/components/auth-logo";
import { AssistantAvatar } from "@/components/setup/assistant-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { createAccount, useOwner } from "@/lib/account";
import { looksLikeEmail } from "@/lib/email";
import {
  check,
  MARKS_REQUIRED,
  PASSWORD_MINIMUM,
  passes,
  strength,
} from "@/lib/password";
import { Provisioning } from "@/components/setup/provisioning";
import { cn } from "@/lib/utils";

// Short, neutral, and easy to say out loud, which is how a name gets used.
// Five at a time, because a wall of names is a decision nobody makes.
//
// Ninshubur and Isimud are the exception to "short". The product is the office
// a sukkal held, so the two who held it belong on the list an owner picks from.
// KPA-150.
const NAMES = [
  "Ada", "Otto", "Juno", "Kestrel", "Wren",
  "Iris", "Milo", "Nova", "Pip", "Rune",
  "Sable", "Echo", "Fable", "Halo", "Vale",
  "Bo", "Marlowe", "Quill", "Ninshubur", "Isimud",
];
const SHOWN = 5;

/**
 * Five names nobody has just seen.
 *
 * Drawn one at a time from what is left, rather than sorted by a random
 * comparator. That comparator is undefined behaviour, and in practice it
 * barely moves anything, so the names at the end of the list would never
 * appear.
 *
 * The first set on the screen is the first five, fixed, or the server and the
 * browser would draw different names and the page would not match itself.
 */
function draw(seen: string[]): string[] {
  // NAMES holds more than twice SHOWN, so what is left is always enough.
  const rest = NAMES.filter((name) => !seen.includes(name));
  const picked: string[] = [];
  while (picked.length < SHOWN && rest.length > 0) {
    // `rest.length > 0` is what makes the splice return a name, and it
    // narrows nothing the compiler can read.
    const [name] = rest.splice(Math.floor(Math.random() * rest.length), 1);
    if (name === undefined) break;
    picked.push(name);
  }
  return picked;
}

const STEPS = [
  { id: "you", label: "You", icon: UserRoundIcon },
  { id: "assistant", label: "Assistant", icon: SparklesIcon },
  { id: "password", label: "Password", icon: LockIcon },
] as const;

/** How far along, and what is still to come. */
function Rail({ at }: { at: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < at;
        const here = index === at;
        const Icon = step.icon;
        return (
          <li key={step.id} className="flex flex-1 flex-col gap-2">
            <span
              className={cn(
                "h-1 rounded-full transition-colors",
                done || here ? "bg-primary" : "bg-border"
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors",
                here
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              {done ? (
                <CheckIcon className="text-primary size-3.5" aria-hidden="true" />
              ) : (
                <Icon className="size-3.5" aria-hidden="true" />
              )}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Four bars, filled as far as the password earns. */
function Meter({ score, label }: { score: number; label: string }) {
  const colour =
    score >= 4
      ? "bg-success"
      : score === 3
        ? "bg-success/70"
        : score === 2
          ? "bg-warning"
          : "bg-destructive";

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              step <= score ? colour : "bg-border"
            )}
          />
        ))}
      </div>
      <span className="text-muted-foreground w-16 text-right text-xs">
        {label}
      </span>
    </div>
  );
}

export function SetupWizard() {
  const router = useRouter();
  const [at, setAt] = useState(0);
  // The questions, then the wait while the box builds itself, then the door.
  const [stage, setStage] = useState<"asking" | "building" | "done">("asking");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [assistant, setAssistant] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [tried, setTried] = useState(false);
  const [suggestions, setSuggestions] = useState(NAMES.slice(0, SHOWN));
  // A box that is already set up. The screen is reachable by address, and
  // walking it again would write over the only account on the installation.
  const { status, account: existing } = useOwner();
  const [overwrite, setOverwrite] = useState(false);
  // What the server said when it refused the write.
  const [writeFault, setWriteFault] = useState("");
  // Picking a name leaves the cursor on the button that was clicked, where
  // the return key does nothing. It belongs back in the box, so the next
  // press moves the step on.
  const nameBox = useRef<HTMLInputElement>(null);

  const rules = check(password);
  const bars = strength(password);
  const firstName = name.trim().split(" ")[0] || "you";

  /** What is wrong with the step on the screen, or nothing. */
  const faults: Record<string, string> = {};
  if (name.trim().length < 2) faults.name = "Enter your name.";
  if (!looksLikeEmail(email)) {
    faults.email = "Enter an email address, for example shane@koinon.com.au.";
  }
  if (assistant.trim().length < 2) {
    faults.assistant = "Give the assistant a name, or pick one below.";
  }
  if (!passes(password)) faults.password = "The password misses a rule below.";
  if (password && again !== password) faults.again = "The two do not match.";

  const fields: Record<number, string[]> = {
    0: ["name", "email"],
    1: ["assistant"],
    2: ["password", "again"],
  };
  // A step this map does not name asks for no field, so nothing is unfilled.
  const ready = (fields[at] ?? []).every((field) => !faults[field]);
  // A fault is shown once somebody has tried to move on, rather than while
  // they are still typing the first letter of their name.
  const fault = (field: string) => (tried ? faults[field] : undefined);

  function forward() {
    if (!ready) {
      setTried(true);
      return;
    }
    setTried(false);
    if (at < STEPS.length - 1) {
      setAt(at + 1);
      return;
    }
    setStage("building");
  }

  if (status === "ready" && existing && !overwrite && stage === "asking") {
    return (
      <Card className="w-full max-w-lg gap-0 overflow-hidden p-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
          <AssistantAvatar className="size-24" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {existing.assistant} is already set up
            </h1>
            <p className="text-muted-foreground text-sm text-pretty">
              This box belongs to {existing.name}. Setting it up again writes
              over that account, and there is only one.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setOverwrite(true)}
            >
              Set it up again
            </Button>
            <Button className="flex-1" onClick={() => router.push("/dashboard")}>
              Open the briefing
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "building") {
    return (
      <Provisioning
        firstName={firstName}
        onDone={() => {
          // The account is written when the box that holds it is ready, so a
          // half-built installation never reads as a finished one.
          createAccount({
            name: name.trim(),
            email: email.trim(),
            assistant: assistant.trim(),
            password,
          })
            .then(() => setStage("done"))
            .catch((cause: unknown) => {
              // Back to the last question, with the reason above it. Saying
              // the box is ready when no account reached it would send
              // somebody to a briefing the layout bounces them out of.
              console.error("account:", cause);
              setWriteFault(
                cause instanceof Error
                  ? cause.message
                  : "The account was not written."
              );
              setAt(STEPS.length - 1);
              setStage("asking");
            });
        }}
      />
    );
  }

  if (stage === "done") {
    return (
      <Card className="w-full max-w-lg gap-0 overflow-hidden p-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
          <span className="bg-success/10 text-success flex size-12 items-center justify-center rounded-full">
            <CheckIcon className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {assistant.trim()} is ready
            </h1>
            <p className="text-muted-foreground text-sm text-pretty">
              Signed in as {name.trim()}. Next it wants somewhere to read from,
              which is what the Connections screen is for.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push("/connections")}
            >
              Add a connection
            </Button>
            <Button className="flex-1" onClick={() => router.push("/dashboard")}>
              Open the briefing
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-5">
      <Card className="w-full gap-0 overflow-hidden p-0 shadow-sm">
        <div className="flex flex-col gap-6 px-6 pt-8 sm:px-10">
          <div className="flex items-center gap-3">
            <AuthLogo />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Set up this box</span>
              <span className="text-muted-foreground text-xs">
                Nobody has been here before you.
              </span>
            </div>
          </div>
          <Rail at={at} />
          {writeFault && (
            <p className="text-destructive text-sm" role="alert">
              {writeFault}
            </p>
          )}
        </div>

        <CardContent className="p-0">
          {/* A form, so the return key moves on from whichever box holds the
              cursor. Every other control here says type="button", or it
              would submit the step instead of doing its own job. */}
          <form
            className="flex flex-col gap-6 px-6 pt-7 pb-8 sm:px-10"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              forward();
            }}
          >
          {at === 0 && (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  Who are you?
                </h1>
                <p className="text-muted-foreground text-sm text-pretty">
                  The assistant works for one person. This is the account it
                  works for, and the only one on this installation.
                </p>
              </div>

              <FieldGroup className="gap-4">
                <Field className="gap-2">
                  <FieldLabel htmlFor="setup-name">Your name</FieldLabel>
                  <Input
                    id="setup-name"
                    autoComplete="name"
                    placeholder="Shane Dolley"
                    value={name}
                    autoFocus
                    aria-invalid={Boolean(fault("name"))}
                    aria-describedby={
                      fault("name") ? "setup-name-fault" : undefined
                    }
                    onChange={(event) => setName(event.target.value)}
                  />
                  {fault("name") && (
                    <p id="setup-name-fault" className="text-destructive text-xs">
                      {fault("name")}
                    </p>
                  )}
                </Field>

                <Field className="gap-2">
                  <FieldLabel htmlFor="setup-email">Email</FieldLabel>
                  <Input
                    id="setup-email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={email}
                    aria-invalid={Boolean(fault("email"))}
                    aria-describedby={
                      fault("email") ? "setup-email-fault" : undefined
                    }
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    How you sign in, and where a reset link goes.
                  </p>
                  {fault("email") && (
                    <p id="setup-email-fault" className="text-destructive text-xs">
                      {fault("email")}
                    </p>
                  )}
                </Field>
              </FieldGroup>
            </>
          )}

          {at === 1 && (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  What should it be called?
                </h1>
                <p className="text-muted-foreground text-sm text-pretty">
                  You will read this name every morning and say it out loud to
                  other people. Short ones wear better.
                </p>
              </div>

              <Field className="gap-2">
                <FieldLabel htmlFor="setup-assistant">Assistant name</FieldLabel>
                <Input
                  id="setup-assistant"
                  ref={nameBox}
                  placeholder="Kestrel"
                  value={assistant}
                  autoFocus
                  autoComplete="off"
                  aria-invalid={Boolean(fault("assistant"))}
                  aria-describedby={
                    fault("assistant") ? "setup-assistant-fault" : undefined
                  }
                  onChange={(event) => setAssistant(event.target.value)}
                />
                {fault("assistant") && (
                  <p
                    id="setup-assistant-fault"
                    className="text-destructive text-xs"
                  >
                    {fault("assistant")}
                  </p>
                )}
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                {suggestions.map((one) => (
                  <Button
                    key={one}
                    type="button"
                    size="sm"
                    variant={assistant === one ? "default" : "outline"}
                    aria-pressed={assistant === one}
                    onClick={() => {
                      setAssistant(one);
                      nameBox.current?.focus();
                    }}
                  >
                    {one}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Show five other names"
                  title="Show five other names"
                  onClick={() => setSuggestions(draw(suggestions))}
                >
                  <RefreshCwIcon aria-hidden="true" />
                </Button>
              </div>

              {/* The name in the sentence it will introduce itself with. A
                  name reads differently in a form than it does out loud. */}
              <div className="flex items-center gap-3">
                <AssistantAvatar className="size-24 shrink-0" />
                <div className="bg-muted/40 border-border/60 relative rounded-xl border p-4">
                  {/* The tail, so the line reads as the assistant speaking
                      rather than as a note about it. */}
                  <span
                    className="bg-muted/40 border-border/60 absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 border-b border-l"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-pretty">
                    Hi {firstName}! My name is{" "}
                    <span className="font-medium">
                      {assistant.trim() || "Kestrel"}
                    </span>{" "}
                    and I am excited to work for you!
                  </p>
                </div>
              </div>
            </>
          )}

          {at === 2 && (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  Set a password
                </h1>
                <p className="text-muted-foreground text-sm text-pretty">
                  This account reaches every mailbox the assistant reads, so
                  it is worth more than a password to a forum. It takes{" "}
                  {PASSWORD_MINIMUM} characters, a capital, a number and{" "}
                  {MARKS_REQUIRED} marks.
                </p>
              </div>

              <FieldGroup className="gap-4">
                <Field className="gap-2">
                  <FieldLabel htmlFor="setup-password">Password</FieldLabel>
                  <InputGroup className="w-full">
                    <InputGroupInput
                      id="setup-password"
                      type={shown ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      autoFocus
                      aria-invalid={Boolean(fault("password"))}
                      aria-describedby="setup-password-rules"
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
                  <Meter score={bars.score} label={bars.label} />
                  <ul id="setup-password-rules" className="flex flex-col gap-1 pt-1">
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
                  <FieldLabel htmlFor="setup-again">Type it again</FieldLabel>
                  <Input
                    id="setup-again"
                    type={shown ? "text" : "password"}
                    autoComplete="new-password"
                    value={again}
                    aria-invalid={Boolean(fault("again"))}
                    aria-describedby={
                      fault("again") ? "setup-again-fault" : undefined
                    }
                    onChange={(event) => setAgain(event.target.value)}
                  />
                  {fault("again") && (
                    <p id="setup-again-fault" className="text-destructive text-xs">
                      {fault("again")}
                    </p>
                  )}
                </Field>
              </FieldGroup>
            </>
          )}

          <div className="flex items-center gap-2">
            {at > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTried(false);
                  setAt(at - 1);
                }}
              >
                <ArrowLeftIcon aria-hidden="true" />
                Back
              </Button>
            )}
            <Button type="submit" className="ml-auto min-w-40">
              {at === STEPS.length - 1 ? "Finish" : "Continue"}
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mx-auto max-w-lg text-center text-xs text-pretty">
        Everything here stays on this installation. The password is hashed on
        the server and stored only as that hash, so nothing here or there ever
        holds the password itself.
      </p>
    </div>
  );
}
