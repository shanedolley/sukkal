/**
 * The project tree's rows: what a project's contract says, and which custom
 * fields a workspace carries.
 *
 * Both lived in `localStorage` until KPA-127. ADR-0022 asks of every browser
 * key whether it belongs to the person or to the device, and rules that both
 * belong to the person. A contract date arrives from Salesforce through
 * Certinia, and a mapping to a Jira field id describes an external system, so
 * no two devices may legitimately disagree about either.
 *
 * One module for two tables, because `owner.ts` is the shape this tier reads
 * a row in and both tables came from the same slice. `projects` gained its
 * contract columns in migration 020 and `workspace_fields` landed in 021.
 *
 * A FIELD FILES UNDER `workspaces.id`, NEVER UNDER THE NAME. Migration 021
 * makes that a foreign key, so a rename moves nothing and a name reaches no
 * row at all. `savedUnder` in `workspace-fields.ts` is what turns the name
 * every caller holds into the id this module takes.
 *
 * A `date` column comes back as a 'YYYY-MM-DD' string. `src/db/connect.ts`
 * tells the driver so and `db.ts` sets the same parser on this package's
 * registry. Compare these fields as text.
 *
 * The caller hands in the pool, the way every read in this tier does.
 */
import type { Pool } from "pg";

/** One project's settings, as the settings tab writes them. */
export interface ProjectSetting {
  /** The Jira label an issue must carry to belong to this project. */
  label: string;
  /** ISO date. Null when no contract names one. */
  start: string | null;
  /** ISO date. Null when no contract names one. */
  end: string | null;
}

/**
 * One custom field a workspace carries.
 *
 * `jiraId` is the tracker's own id and the only thing a write to Jira may
 * name. It rides along beside the three fields a screen renders because no
 * rule turns the slug into it: migration 021 says why.
 */
export interface WorkspaceField {
  id: string;
  jiraId: string;
  name: string;
  required: boolean;
}

interface ProjectRow {
  id: string;
  match_label: string | null;
  contract_start: string | null;
  contract_end: string | null;
}

/**
 * Every project's settings, by project id.
 *
 * `match_label` is null on a project matched by its key prefix, and the id
 * stands in for it. That is the guess `project-settings.ts` used to make in
 * the browser: the address a project is reached at is also the label its
 * issues carry, and `projects_match_one_way` refuses a column default that
 * would say so.
 */
export async function readProjects(
  pool: Pool
): Promise<Record<string, ProjectSetting>> {
  const { rows } = await pool.query<ProjectRow>(
    `SELECT id, match_label, contract_start, contract_end FROM projects`
  );

  const settings: Record<string, ProjectSetting> = {};
  for (const row of rows) {
    settings[row.id] = {
      label: row.match_label ?? row.id,
      start: row.contract_start,
      end: row.contract_end,
    };
  }
  return settings;
}

/**
 * Replaces one project's settings. It answers false when no such project
 * exists, which is a bad request rather than a broken database.
 *
 * THE LABEL IS WRITTEN ONLY WHERE A LABEL DECIDES. `projects_match_one_way`
 * allows one rule per row, so writing `match_label` onto a project matched by
 * its key prefix breaks the row. The settings form offers the box regardless,
 * and `inProject` ignores what it holds on such a project, so the value is
 * dropped here rather than refused there.
 *
 * TYPING A DATE MAKES ITS SOURCE 'typed', which is what stops the next
 * Salesforce sync overwriting it. Migration 020 states that rule. A date
 * cleared to null clears the source with it, because
 * `projects_contract_start_names_its_source` requires the pair.
 */
export async function writeProject(
  pool: Pool,
  id: string,
  setting: ProjectSetting
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE projects
        SET match_label = CASE WHEN match_label IS NULL THEN NULL ELSE $2 END,
            contract_start = $3::date,
            contract_start_source =
              CASE WHEN $3::date IS NULL THEN NULL ELSE 'typed'::contract_date_source END,
            contract_end = $4::date,
            contract_end_source =
              CASE WHEN $4::date IS NULL THEN NULL ELSE 'typed'::contract_date_source END
      WHERE id = $1`,
    [id, setting.label, setting.start, setting.end]
  );
  return rowCount === 1;
}

/** Every workspace's field list, by `workspaces.id`. A workspace holding no
 *  field is absent rather than empty, which is what the two seeded without
 *  one mean. */
export async function readWorkspaceFields(
  pool: Pool
): Promise<Record<string, WorkspaceField[]>> {
  const { rows } = await pool.query<{
    workspace: string;
    id: string;
    jira_id: string;
    name: string;
    required: boolean;
  }>(
    `SELECT workspace, id, jira_id, name, required
       FROM workspace_fields ORDER BY workspace, name`
  );

  const byWorkspace: Record<string, WorkspaceField[]> = {};
  for (const row of rows) {
    (byWorkspace[row.workspace] ??= []).push({
      id: row.id,
      jiraId: row.jira_id,
      name: row.name,
      required: row.required,
    });
  }
  return byWorkspace;
}

/**
 * Replaces one workspace's list, in one transaction.
 *
 * The screen edits a list rather than a row, so the whole list is written and
 * a field taken off it goes. Both statements run on one client, or a failed
 * insert would leave the workspace with no fields at all.
 *
 * It answers false when the workspace names no row. The settings screen still
 * passes a project's display name, which matches no workspace, and KPA-140
 * asks Shane which list that screen is meant to edit.
 */
export async function writeWorkspaceFields(
  pool: Pool,
  workspace: string,
  fields: WorkspaceField[]
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const known = await client.query(
      `SELECT 1 FROM workspaces WHERE id = $1`,
      [workspace]
    );
    if (known.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(`DELETE FROM workspace_fields WHERE workspace = $1`, [
      workspace,
    ]);
    for (const field of fields) {
      await client.query(
        `INSERT INTO workspace_fields (workspace, id, jira_id, name, required)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspace, field.id, field.jiraId, field.name, field.required]
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
  }
}
