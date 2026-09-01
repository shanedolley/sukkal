"use client";

// One project's settings, at an address of its own.
//
// The project page shows the same three sections under a tab. This route is
// what the sidebar links to, and what a bookmark holds.

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { ProjectSettings } from "@/components/projects/project-settings";
import { projectName } from "../project-name";

export default function ProjectSettingsPage() {
  const { key } = useParams<{ key: string }>();
  const name = projectName(key);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/projects/${key}/issues`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-sm text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-3" aria-hidden="true" />
          Back to {name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {name} settings
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Where this project&rsquo;s work comes from, and how it is drawn.
        </p>
      </header>

      <ProjectSettings name={name} />
    </div>
  );
}
