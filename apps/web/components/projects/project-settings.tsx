"use client";

// One project's settings.
//
// Three sections. Connections is where the project's data comes from,
// Defaults is what every issue on it carries, and Display is how its issues
// are drawn. They are separate because one is a decision about the outside
// world and the others are decisions about your own screen.
//
// Two screens ask for this: the project page's Settings tab, and the
// /projects/[key]/settings address the sidebar links to. The strip below
// reads as a line rather than a block of pills, so a reader inside the tab
// can tell which of the two strips is the one they came in on.
//
// IT TAKES THE WORKSPACE, NOT THE PROJECT. The custom fields belong to the
// workspace, and both callers resolve the route key to one before they get
// here. Defaults names it in the heading and again in the lede, so a reader
// on the BHP Meridian page reads that the list is Collibra's. KPA-140.

import Link from "next/link";

import { CustomFields } from "@/components/settings/custom-fields";
import { JiraConnection } from "@/components/settings/jira-connection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground max-w-2xl text-xs">{lede}</p>
      </div>
      {children}
    </section>
  );
}

export function ProjectSettings({ workspace }: { workspace: string }) {
  return (
    <Tabs defaultValue="connections">
      <TabsList variant="line" aria-label="Settings sections">
        <TabsTrigger value="connections">Connections</TabsTrigger>
        <TabsTrigger value="defaults">Defaults</TabsTrigger>
        <TabsTrigger value="display">Display</TabsTrigger>
      </TabsList>

      <TabsContent value="connections" className="flex flex-col gap-6 pt-4">
        <Section
          title="Project management"
          lede="The tracker this project's issues, sprints and boards are read from. One at a time, because two would disagree."
        >
          <JiraConnection />
        </Section>
      </TabsContent>

      <TabsContent value="defaults" className="flex flex-col gap-6 pt-4">
        <Section
          title={`${workspace}'s custom fields`}
          lede={`Fields Jira carries that this assistant does not name. ${workspace} holds one list, and every project in it carries the same fields. A required one has to be filled in before a new issue can be filed.`}
        >
          <CustomFields workspace={workspace} />
        </Section>
      </TabsContent>

      <TabsContent value="display" className="flex flex-col gap-6 pt-4">
        <Section
          title="The issue list"
          lede="How rows are grouped and whether sub-tasks follow their parent. Set these from the two controls above any issue list; they are shown here so the whole setting is in one place."
        >
          <p className="text-muted-foreground border-border/70 rounded-lg border border-dashed p-4 text-xs">
            These choices hold for every list, not for this project alone. They
            become per project once a project carries settings of its own,
            which needs the connection above.
          </p>
        </Section>

        <Section
          title="Colour"
          lede="The menu accent and the chart palette are set once for the whole assistant."
        >
          <p className="text-muted-foreground border-border/70 rounded-lg border border-dashed p-4 text-xs">
            Change them under{" "}
            <Link
              href="/settings"
              className="text-primary underline underline-offset-2"
            >
              Preferences
            </Link>
            .
          </p>
        </Section>
      </TabsContent>
    </Tabs>
  );
}
