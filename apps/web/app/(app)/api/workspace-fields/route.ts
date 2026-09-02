/**
 * A workspace's custom fields, over HTTP.
 *
 * `GET` answers every workspace's list, keyed by `workspaces.id`, and `PUT`
 * replaces one workspace's list whole. The settings screen edits a list rather
 * than a row, so a field taken off it has to go.
 *
 * TWO IDENTIFIERS, AND NEITHER DERIVES THE OTHER. `id` is the slug an issue
 * files its value under and `jiraId` is what a write to Jira names. Migration
 * 021 says why a name cannot choose between them: the Collibra site offers two
 * custom fields called "Customer". This route refuses a body that leaves the
 * tracker id out, rather than inventing one.
 *
 * A LIST FILES UNDER `workspaces.id`, NEVER UNDER A NAME. The table makes that
 * a foreign key, so an unknown key is a bad request. The project settings
 * screen still sends a project's display name, and KPA-140 asks Shane which
 * list that screen is meant to edit.
 *
 * This route authenticates nobody, because nothing does yet.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  readWorkspaceFields,
  writeWorkspaceFields,
  type WorkspaceField,
} from "@/lib/tree";

/** The reason goes to the server's log and never to the browser: a connection
 *  error names the host, the database and the user. */
function refused(what: string, cause: unknown): Response {
  console.error(`${what}:`, cause);
  return NextResponse.json(
    { error: "The database did not answer." },
    { status: 503 }
  );
}

const bad = (error: string): Response =>
  NextResponse.json({ error }, { status: 400 });

/** The shape the table takes, checked before it gets there. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CUSTOM_FIELD = /^customfield_[0-9]+$/;

function reads(value: unknown): value is WorkspaceField {
  if (!value || typeof value !== "object") return false;
  const field = value as Record<string, unknown>;
  return (
    typeof field["id"] === "string" &&
    SLUG.test(field["id"]) &&
    typeof field["jiraId"] === "string" &&
    CUSTOM_FIELD.test(field["jiraId"]) &&
    typeof field["name"] === "string" &&
    field["name"].trim() !== "" &&
    typeof field["required"] === "boolean"
  );
}

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(await readWorkspaceFields(db()));
  } catch (cause) {
    return refused("workspace fields", cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    workspace?: unknown;
    fields?: unknown;
  } | null;
  if (!body) return bad("Send a JSON body.");

  const { workspace, fields } = body;
  if (typeof workspace !== "string" || workspace.trim() === "") {
    return bad("Name the workspace.");
  }
  if (!Array.isArray(fields) || !fields.every(reads)) {
    return bad(
      "Every field needs a slug, a name, and the tracker's own customfield id."
    );
  }
  if (new Set(fields.map((field) => field.jiraId)).size !== fields.length) {
    return bad("Two fields name one Jira field.");
  }

  try {
    const written = await writeWorkspaceFields(db(), workspace, fields);
    if (!written) {
      return NextResponse.json(
        { error: "No workspace is filed under that key." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return refused("workspace fields write", cause);
  }
}
