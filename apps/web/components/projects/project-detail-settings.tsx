"use client";

// One project's own settings.
//
// Three fields, because a project inside a workspace holds three things the
// workspace does not: which of the workspace's issues are its own, and the
// two dates the contract sets. Everything else — the tracker, the custom
// fields, how rows are drawn — belongs to the workspace above it.

import { useState } from "react";

import { DateBox } from "@/components/issues/issue-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { realToday } from "@/lib/format";
import { parseDate } from "@/lib/parse-date";
import {
  setProjectSetting,
  useProjectSetting,
  type ProjectSetting,
} from "@/lib/project-settings";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

export function ProjectDetailSettings({
  projectKey,
  name,
}: {
  projectKey: string;
  name: string;
}) {
  const saved = useProjectSetting(projectKey);
  const [draft, setDraft] = useState<ProjectSetting>(saved);
  // Read once, when the form mounts. A page left open over midnight should
  // not change what "next month" means halfway through typing it.
  const [today] = useState(realToday);
  const [startWords, setStartWords] = useState("");
  const [endWords, setEndWords] = useState("");
  // Cleared on the next edit, so the note says what just happened rather than
  // sitting there as a permanent claim.
  const [done, setDone] = useState(false);

  const set = (change: Partial<ProjectSetting>) => {
    setDraft((current) => ({ ...current, ...change }));
    setDone(false);
  };

  // Each date lands as it is typed. Words that are not a date leave the date
  // alone, so a half-typed month never takes away what is already set.
  function typeStart(text: string) {
    setStartWords(text);
    const read = parseDate(text, today);
    // The end counts from the start, so moving the start re-reads it. An end
    // read from the old start would disagree with the words that made it.
    if (read) {
      setDraft((current) => ({
        ...current,
        start: read,
        end: parseDate(endWords, read) ?? current.end,
      }));
      setDone(false);
    }
  }

  function typeEnd(text: string) {
    setEndWords(text);
    const read = parseDate(text, draft.start ?? today);
    if (read) set({ end: read });
  }

  const changed =
    draft.label !== saved.label ||
    draft.start !== saved.start ||
    draft.end !== saved.end;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setProjectSetting(projectKey, { ...draft, label: draft.label.trim() });
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Issues</h2>
          <p className="text-muted-foreground text-xs">
            {name} runs through its workspace&rsquo;s Jira project, so a label
            is what tells its issues from the rest.
          </p>
        </div>

        <Field
          id="project-label"
          label="Jira label"
          hint="An issue carrying this label belongs to the project. Change it and the Issues tab follows."
        >
          <Input
            id="project-label"
            value={draft.label}
            onChange={(event) => set({ label: event.target.value })}
            placeholder="bhp-meridian"
            autoComplete="off"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Dates</h2>
          <p className="text-muted-foreground text-xs">
            What the contract sets. Salesforce holds these once it is
            connected; until then they are yours to write.
          </p>
        </div>

        {/* The boxes take words, not a written-out date, so they need room
            for "3 feb" and nothing more. The line under each one carries the
            full date. */}
        <div className="flex max-w-xs items-start gap-4">
          <DateBox
            name="Start"
            value={draft.start}
            from={today}
            text={startWords}
            onText={typeStart}
            onClear={() => {
              setStartWords("");
              set({ start: null });
            }}
          />
          <DateBox
            name="End"
            value={draft.end}
            from={draft.start ?? today}
            text={endWords}
            onText={typeEnd}
            onClear={() => {
              setEndWords("");
              set({ end: null });
            }}
          />
        </div>

        <p className="text-muted-foreground text-xs">
          Write the date in words. &ldquo;3 feb&rdquo; is the third of
          February to come, and &ldquo;6 months&rdquo; counts from today. The
          end date counts from the start rather than from today, so a start in
          December makes &ldquo;3 feb&rdquo; the February after it.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!changed || !draft.label.trim()}>
          Save
        </Button>
        {done && (
          <span className="text-muted-foreground text-xs" role="status">
            Saved in this browser. Nothing reaches Jira or Salesforce yet.
          </span>
        )}
      </div>
    </form>
  );
}
