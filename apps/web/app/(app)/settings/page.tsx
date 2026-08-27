"use client";

// Preferences. What the prototype can actually change is the theme and the
// space it opens on, so those are what it offers. The rest of the settings
// the brief implies, the policy rules and the account, belong to screens that
// do not exist yet, and this page says so rather than showing dead controls.

import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { SHORTCUTS } from "@/components/shortcuts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useModifierKey } from "@/lib/platform";
import { useSpace, type SpaceFilter } from "@/lib/space-context";
import { SPACE_LABELS } from "@/lib/types";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

const SPACES: { value: SpaceFilter; label: string }[] = [
  { value: "all", label: "All spaces" },
  { value: "collibra", label: SPACE_LABELS.collibra },
  { value: "koinon", label: SPACE_LABELS.koinon },
  { value: "personal", label: SPACE_LABELS.personal },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { space, setSpace } = useSpace();
  const modifier = useModifierKey();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-muted-foreground text-sm">
          Both settings live in this browser. Nothing here reaches the server.
        </p>
      </header>

      <Section
        title="Appearance"
        description="System follows whatever your machine is set to."
      >
        <div className="flex flex-wrap gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              size="sm"
              variant={theme === value ? "default" : "outline"}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Space"
        description="Which space every screen filters to when you open it."
      >
        <div className="flex flex-wrap gap-2">
          {SPACES.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={space === value ? "default" : "outline"}
              aria-pressed={space === value}
              onClick={() => setSpace(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Keyboard"
        description="These work anywhere in the application."
      >
        <dl className="flex flex-col gap-3">
          {SHORTCUTS.map(({ keys, label }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-sm">{label}</dt>
              <dd>
                <KbdGroup>
                  <Kbd>{modifier}</Kbd>
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <p className="text-muted-foreground text-xs leading-relaxed">
        The policy rules and the account settings the brief implies are not
        built. The policy is the one that matters: it is the only thing between
        an autonomous agent and your sent mail, so it needs a screen of its own
        rather than a row here.
      </p>
    </div>
  );
}
