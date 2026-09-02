/**
 * The four advisories: things worth a human's judgement, never a failure.
 *
 * Ported from the vault's `scripts/check.py`, whose `advisories()` docstring
 * still applies: each check was chosen because it has few false positives on
 * a vault this shape, and a check that cries wolf weekly is a check that
 * gets ignored, and then so is everything beside it.
 *
 * `check.py` re-reads every note's raw text with a regex to find its links.
 * This reads `edges` instead, which `src/migrate/edges.ts` already resolved
 * once at ingestion, per KPA-34. **Nothing here writes.** An advisory reports
 * and changes nothing, and none of the four fails the run -- unlike the six
 * problems KPA-32 ports, which do.
 *
 * **This file carries the whole drift KPA-13 will find, and it is two
 * lines.** `check.py` scans the vault's four root pages (`index`, `log`,
 * `CLAUDE`, `README`) for their own outbound links, and counts one as an
 * inbound link on the fact it names. The node registry has no kind for a
 * root page, so a root page is ingested as neither a fact nor a source and
 * its links never become edges. A fact linked only from a root page
 * therefore reads as an orphan here though `check.py` does not flag it.
 * `orphans` below names both.
 *
 * `docs/adr/0019-a-root-page-is-not-a-node.md` decided to keep those two
 * lines rather than ingest a root page, and argues they are true findings:
 * a `log.md` entry is provenance, and an `index.md` question row is deleted
 * once Shane answers it, so neither is a link a reader follows.
 *
 * The other three checks are unaffected. A link to a root page (`[[index]]`)
 * resolves to no fact, so it feeds neither cross-space nor
 * uncompiled-sources, and pile-up reads `stale_after` off `facts` directly,
 * never a link.
 */
import path from 'node:path';
import type { ClientBase } from 'pg';

/**
 * Facts nothing links to.
 *
 * `shared/` is exempt, matching `check.py`: the session hook loads it
 * wholesale every session, so a shared note needs no inbound link to be
 * found. An edge counts regardless of kind, `links_to` or `derived_from`,
 * matching `check.py`'s regex, which does not distinguish a body wikilink
 * from one inside a `sources:` entry.
 *
 * ADR-0019's accepted drift is these two rows, and no others. Against the
 * frozen vault `collibra/bhp-unstructured-declined.md` is named only by
 * `index.md` and `log.md`, and `collibra/collibra-meeting-defaults.md` only
 * by `log.md`. Neither root page carries an edge here, so both facts read
 * as orphans though `check.py` reports none. A third orphan is a defect.
 */
export async function orphans(client: ClientBase): Promise<string[]> {
  const found = await client.query<{ path: string }>(
    `SELECT f.path FROM facts f
      WHERE f.space != 'shared'
        AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = f.id)
      ORDER BY f.path`,
  );
  return found.rows.map((row) => `orphan: ${row.path} is linked from nowhere`);
}

/**
 * Links crossing the Collibra and Koinon boundary.
 *
 * `docs/adr/0006-collibra-koinon-separation-is-a-guideline.md` accepts the
 * risk this check exists to cover: nothing in the database enforces the
 * wall, so this is the only signal a boundary was crossed. Flagged, never
 * failed, per that ADR and per `check.py`: a register saying "the other book
 * of work is over there" is a signpost, not a leak, and only a reader can
 * tell the difference.
 *
 * A link is a crossing when both ends sit outside `shared` and in different
 * spaces -- matching `check.py`, this is not limited to Collibra-Koinon
 * pairs; a `personal` fact linking a `collibra` one would flag too. Every
 * pair the frozen vault carries today is Collibra-Koinon.
 */
export async function crossSpaceLinks(client: ClientBase): Promise<string[]> {
  const found = await client.query<{ srcPath: string; tgtPath: string; there: string }>(
    `SELECT src.path AS "srcPath", tgt.path AS "tgtPath", tgt.space AS there
       FROM edges e
       JOIN facts src ON src.id = e.from_id
       JOIN facts tgt ON tgt.id = e.to_id
      WHERE src.space != 'shared' AND tgt.space != 'shared'
        AND tgt.space != src.space
      ORDER BY src.path, tgt.path`,
  );
  return found.rows.map(
    (row) =>
      `crosses spaces: ${row.srcPath} links ${row.there}/${path.basename(row.tgtPath, '.md')}. ` +
      'Fine if it names the boundary, wrong if it carries a fact across.',
  );
}

/**
 * The ratio of sources nothing was ever compiled out of.
 *
 * One line rather than one per source, matching `check.py`: thirty lines
 * every week, most of them bulk-imported note templates that should never
 * become facts, is noise. The ratio is the signal, and it moves.
 *
 * "Cited" means named by either edge kind, same as `orphans` above -- a
 * source named in a `sources:` entry that happens to use body prose instead
 * of a wikilink resolves `unresolved` in `edges.ts` and was never a
 * candidate edge into this source row regardless, so it counts as
 * uncompiled either way.
 */
export async function uncompiledSources(client: ClientBase): Promise<string[]> {
  const found = await client.query<{ uncompiled: string; total: string }>(
    `SELECT
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = s.id)) AS uncompiled,
        count(*) AS total
       FROM sources s`,
  );
  const row = found.rows[0]!;
  const uncompiled = Number(row.uncompiled);
  const total = Number(row.total);
  if (uncompiled === 0 || total === 0) {
    return [];
  }
  return [
    `uncompiled sources: ${uncompiled} of ${total} are cited by no fact. ` +
      'Most bulk imports never should be; a recent one that is not, is worth a look.',
  ];
}

/**
 * Review dates falling due on the same day, more than the nightly clears.
 *
 * `check.py` grouped every note's raw `stale_after` field, however far off
 * or whether the note had even been confirmed once. `docs/adr/0010` made a
 * fact's state derived, so this groups the same facts `src/memory/retire.ts`
 * counts as ever going stale: live (`valid_to IS NULL`) and verified at
 * least once, since an unverified fact is still waiting on its first
 * confirmation and has nothing to fall due from. Unlike `retire.ts`'s
 * `stale`, this carries no `< today`: pile-up is a scheduling warning,
 * worth raising before the day arrives, not only once it has.
 *
 * `n > 3` matches `check.py`'s comment on the nightly: it clears three per
 * run.
 */
export async function reviewPileUp(client: ClientBase): Promise<string[]> {
  const found = await client.query<{ staleAfter: string; n: string }>(
    `SELECT stale_after AS "staleAfter", count(*) AS n
       FROM facts
      WHERE verified IS NOT NULL AND stale_after IS NOT NULL AND valid_to IS NULL
      GROUP BY stale_after
     HAVING count(*) > 3
      ORDER BY stale_after`,
  );
  return found.rows.map(
    (row) => `review pile-up: ${row.n} notes fall due on ${row.staleAfter}, more than one run clears`,
  );
}

/** All four advisories, in `check.py`'s order: orphans, cross-space links,
 *  uncompiled sources, then review pile-up. */
export async function advisories(client: ClientBase): Promise<string[]> {
  return [
    ...(await orphans(client)),
    ...(await crossSpaceLinks(client)),
    ...(await uncompiledSources(client)),
    ...(await reviewPileUp(client)),
  ];
}
