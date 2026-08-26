# The Memory vault's log

**This is the vault's `log.md`, moved whole on 27 August 2026 for KPA-18.**
Everything below the rule is the file as it was, byte for byte. Nothing is
summarised, reordered or dropped, because a compressed history is the thing the
log existed to prevent.

Fourteen entries, newest first: eight `ingest`, five `change`, one `init`.

## Why it lives here, and not in the other two places

The log records what the vault *did*: a day's ingest run, a convention that
changed, the day it was created. It explains why the vault is shaped as it is,
which is worth more than any single fact in it.

**A table in Postgres** was the obvious choice, because KPA replaces the vault
and the memory lives in Postgres. It loses because this is not memory. It is a
record of process, it answers no question the assistant will ever be asked, and
putting it in the database means a table that no story designed, that KPA-13's
count reconciliation has to account for, and that nothing ever queries.

**A set of ADRs** loses on the numbers. Eight of the fourteen entries are
`ingest`: a day's work, not a decision. The five `change` entries are small
conventions rather than decisions that were hard to reverse, so none of them
passes the three tests in the `architecture-decisions` skill. Fourteen ADRs
would bury the seven real ones already in `docs/adr/`.

**A document in `docs/`** wins because the log is prose that a person reads
occasionally, and git already gives it permanence, history and a diff. Moving it
costs one copy and loses nothing.

The choice is recorded here rather than in an ADR because it fails the first
test: moving a markdown file later is trivial, and a decision that easy to
reverse does not need a record that permanent.

## What has not happened yet

**The vault's own `log.md` still exists.** KPA-14 freezes the vault, and Shane
deferred it until KPA-5, so nothing has been switched off. Until that lands,
this file is a copy and the vault's is the original. `test/vault-log.test.ts`
compares the two entry counts, so the copy cannot fall behind unnoticed.

---

# Log

Newest first. Each entry opens with a fixed prefix, so the log stays greppable:

```
grep '^## \[' log.md | head -20
```

## [2026-08-25] ingest | BHP DLM demo video for Data Week

Shane recorded a demo of the BHP DLM build and filed it on the shared engagement
Drive. Verified the file against Drive before writing: BHP DLM Demo.mp4, 326 MB,
created 25 August 2026.

Added:   collibra/bhp-dlm-demo-video
Updated: none
Retired: none

Shane confirmed the same day that Data Week is a BHP event, and that Ajay
Potturi and Christine Johnston present the video. The recording is a hand-off to
BHP, not a Collibra speaking slot.

## [2026-08-25] ingest | BHP passed on unstructured, and answered the Nexus chase with a meeting

Reviewed 24 August. Searched four entities in the Collibra mailbox: BHP, Deasy
Labs and the unstructured solution, Nexus and Christine Johnston, and the AI Gov
work. The day returned three messages, two of which carried a fact.

Shane recorded on two Jira tickets that BHP has no appetite for the Collibra
unstructured solution after demoing Deasy Labs. That is a customer decision with
a reason, so it earned [[bhp-unstructured-declined]]. His own 1 on 1 notes from
27 January 2026 said the unstructured teams were still unsure what they wanted,
which is the same question closing eight months later. What nobody has said is
whether Deasy Labs won anything, so the note says so and the question went to
[[index]] rather than into the note as a guess.

[[sow-nexus-q47405]] said no reply had come to the 20 August sign-off request.
BHP replied, but not in writing: Nigel Nisbett created and Ajay Potturi
organised a 30-minute meeting for 25 August. The note now says sign-off turns on
that conversation, and the chase task became a task to record what it produced.

Victoria Dawe's signature gives her role as Principal, Data Strategy, Technology,
which fills a cell in [[collibra-people]] that had been empty since the register
was seeded.

The rest of the day was Jira mechanics: 25 tickets deleted from PSAPAC, stories
raised for Sprint 33, and an evening spent working out that Jira Cloud will not
filter a hierarchical view. Real work, but the git log and the transcripts hold
it, and none of it will be true in a month.

## [2026-08-24] ingest | The Marinucci VM failed a second time

Reviewed 21 and 23 August. Searched seven entities across the Collibra and
Koinon mailboxes, and almost everything the two days raised was already written
down: the Zoom booking rule, the BHP DLM demo, the warehouse options, the
Dolche wind-up.

One fact had changed. [[marinucci-demand-planning-platform]] recorded the
17 August outage as the single point of failure proving itself once. Shane asked
Cameron Desmond to restart `MPAZ-ANLYT01` again on 21 August, five days later,
so the note now reads twice rather than once. Two failures in five days argue
for [[marinucci-data-warehouse-proposal]] in a way one does not.

Nothing else passed the gates. The 23rd was a day spent building this vault, and
a vault does not need a note saying it was built; the git log holds that.

## [2026-08-23] change | A weekly review, proposing rather than restructuring

CLAUDE.md has described a Lint operation since this vault was created and
nothing ever ran it. It runs now, Sundays at 18:10, and the split is the whole
design: it fixes what `check.py` can prove wrong and proposes everything else.

A broken link has one right answer. A restructure does not, and a job told
weekly to find something to improve will find something forever. A vault
rewritten every Sunday is a vault nobody trusts.

Proposals land in a Decisions table on [[index]]. A **no** is written onto the
note it concerned, with the reason and the date, and that line is what stops the
proposal coming back next Sunday.

`check.py --review` does the mechanical half nightly and for free. Its first run
found four links crossing the Collibra and Koinon boundary, and all four are
registers pointing at each other to say the other book of work is elsewhere. A
signpost, not a leak. The rule in CLAUDE.md is too strict as written and should
say never carry a fact across, rather than never cite.

## [2026-08-23] change | Review dates taken from the facts

Every `stale_after` in the vault had been set by horizon rather than by fact:
six months from whenever the note was migrated. Running the new sweep against
future dates showed what that produces. Four notes fell due on 20 November, four
more on the 23rd, and by March 2027 the entire vault expired at once. A review
queue that arrives in one pile is one nobody works through, which would have
quietly defeated the field.

Walked all thirteen. Four had a real anchor and took it: the Nexus SOW moves to
30 September because sign-off is pending and resolves in weeks either way;
Koinon Engineering to 30 November because the R&D assessment gates the FY26
return which gates the ABN; the demand planning platform to 31 March because
the warehouse proposal decides its future first; and the warehouse proposal
keeps 12 September, a month past a quote carrying four unanswered questions.

Shane set the cadence for the other nine. Registers quarterly and staggered a
week apart. Marinucci quarterly, on a month end. The SaaS stack at six months
while it is still settling. Config and reference annually, months apart rather
than days, with BHP DLM nearer at 30 April since a product ships changes.

Fourteen review dates, and at most two now fall on any one day against a job
that handles three per run.

## [2026-08-23] ingest | BHP DLM demo transcript

Filed the transcript of the Meridian demo Shane delivered on 21 August 2026 into
`sources/collibra/`, verbatim, and compiled [[bhp-dlm-meridian]] out of it.

It had been sitting untracked in the personal-assistant repository since
21 August, and the nightly review skipped on 20, 21 and 22 August because of it.
The job was behaving correctly and said so in its log each time; nobody was
reading the log, which is the more useful lesson.

What the note records: Collibra never deletes anything, so the product sells
authorisation before and evidence after. BHP's retention estate is 700+
obligations, 82 jurisdictions, 24,000+ schedules and 5,000+ calendars running to
2050. Onboarding is a gate rather than paperwork. Disposal needs a technical
owner and a business owner and neither can act alone. Partial disposal is not
supported, so relaxing a legal hold relaxes the whole scope. And the gap Shane
names himself is escalation: the tasks exist, nothing chases them.

`check.py` now resolves a wikilink against `sources/` as well as the spaces and
the root pages, since a fact citing where it came from is exactly what a source
link is for, and Obsidian already resolved it that way.

## [2026-08-23] ingest | Three more answers, and the table is empty

**Collibra's founders** ([[collibra-people]]): Felix Van de Maele is CEO and
Stijn Waegemans is COO, and the two founded the company. Both write from
first-name addresses, which is why they sat in the register looking like anyone
else. Said in the prose as well as the row, because two founders among fifty
rows is worth more than a cell a reader has to notice.

**Dolche FY26** ([[koinon-engineering-entity]]): the return is gated on
assessing R&D tax credit potential first. That reframes it from paperwork into
a decision with money attached, since filing without the assessment forfeits
whatever the claim was worth. Added as a task. Who prepares it and whether a
deadline bites are still open, and both wait on the assessment.

**Marinucci's finance platform** ([[marinucci-data-warehouse-proposal]]): Shane
does not know it either, and David has not answered. So it moves from a gap in
the record to an established blocker: only David can settle it, and two of the
three options price ingesting it. The existing chase task covers it.

No new questions. Three tasks open, no facts stale, and the questions table is
empty for the first time.

## [2026-08-23] change | The homepage is two panels, and holds the questions itself

Shane asked why the questions table was embedded from its own file rather than
written into the homepage. It was a good question and the answer was that the
reason had expired: the separation made sense when index.md was seven Dataview
blocks and hand-edited data would have been lost among them. At two panels it
bought nothing and cost a click, because an Obsidian embed renders read-only.
So he read the questions in one place and answered them in another.

`questions.md` is gone and its table lives on [[index]]. Every `[[questions]]`
link now points at `[[index]]`, and `check.py`, `session-context.sh`, `CLAUDE.md`
and the nightly review prompt follow it.

The homepage is now open tasks and open questions, nothing else. The staleness
panels, the trust ratio, the coverage breakdown and the day's-work summary are
all cut. The first three rendered as a page of zeroes at this size; the last
could not be computed at all, since a narrative summary is not a query, and the
git log already records what changed with better fidelity.

Added `.obsidian/snippets/dashboard.css`, scoped to `cssclasses: dashboard` so
it touches this page and nothing else. Every colour is an Obsidian variable, so
it is correct in light and dark under any theme. Snippets are version
controlled here while themes are not, so the styling travels with the vault.

## [2026-08-23] ingest | The Data Warehouse thread, read in full

Shane pointed at the email behind the $200K figure. Reading it corrected the
note rather than extending it, which is the point of reading the source.

There are **three** options, not two, quoted to David on 12 August 2026:
$9K to $16K for the simple lift and shift, **$200K to $350K** for a middle path,
and **$300K to $450K** for the comprehensive build aligning with the
Sep-25 proposal David attached on 11 August. They are alternatives rather than
phases, and the largest is roughly fifty times the smallest. Both larger options
add ongoing Azure cost to Marinucci's own bill.

"Operations and finance sit under the ~$200K estimate" was Shane's shorthand and
too loose to keep: $200K is the floor of a band, not a price.

Shane also asked David four questions that day, and **none have been answered in
the eleven days since**: which option, what budget, which finance platform, and
when it would start. Added a task to chase it, since turnaround is the standing
complaint on this account. The finance platform is now a question for Shane too,
because nothing in the vault records which system Marinucci runs and two of the
three options price ingesting it.

Pulled `stale_after` in from 31 October to 12 September. A quote with four
unanswered questions against it goes off sooner than one that is merely open.

## [2026-08-23] ingest | Twelve answers folded in

Shane answered every open question. What changed:

* **Dolche closure** ([[koinon-engineering-entity]]): FY25 return submitted to
  the ATO, FY26 must be finalised before the ABN can be cancelled.
* **Accounting** ([[koinon-business-systems]]): Xero replaced MYOB Solo. Neither
  Atlassian trial was kept; Koinon runs the free versions.
* **Stefan Chetty** ([[koinon-people]]): surname recorded, address unknown to
  Shane as well.
* **Marinucci warehouse** ([[marinucci-data-warehouse-proposal]]): the
  architecture differs from the earlier proposal and is not yet agreed, and
  operations and finance sit under a **roughly $200,000** estimate rather than
  the $9K to $16K lift and shift. That larger number appears nowhere else, so it
  is now the open question.
* **Nexus** ([[sow-nexus-q47405]]): still no reply from Christine Johnston, so
  the engagement is not closed. Added a task to chase it.
* **Collibra meetings** ([[collibra-meeting-defaults]]): no reusable Zoom link,
  every booking needs Shane.
* **Collibra register** ([[collibra-people]]): Stijn Waegemans, Felix Van de
  Maele, `shane.dolley1@bhp.com` confirmed as Shane's own, and NLA identified as
  Novated Leasing Australia rather than an engagement vendor.

Seven notes now carry `verified_by: human:shane`, since he confirmed each by
answering. Four follow-up questions raised, two of them about the $200K figure.

## [2026-08-23] change | Questions moved to an editable table

Dataview renders a table but will not accept typing into one, so the `answer`
property gave Shane nowhere to answer. Questions now live in `questions.md`, a
plain markdown table with a column he types straight into, and the frontmatter
pair is gone. One home, and it edits like any other text.

Shane answered the first row the moment it existed. Folded it into
[[koinon-engineering-entity]]: the new ABN and account details were submitted to
client AP teams, so that is a fact now rather than something to chase. The note
carries his confirmation and the row is deleted. Twelve questions remain.

## [2026-08-23] ingest | Dolche Ventures vault

Imported the Dolche Ventures vault into `sources/dolche/`, fifteen notes. Every
credential value was stripped at import and the labels kept, so each note still
explains what its credential was for. Shane confirmed the credentials were
revoked on 23 August 2026.

Compiled no facts out of it yet. The entity stopped trading on 27 July 2026, so
most of this is history rather than anything still true.

## [2026-08-23] change | An answer column on the homepage

Added the `answer` property. Shane answers a question in the note's own
properties panel, and the agent folds that answer into the note body and clears
both properties. Two homepage tables now split questions waiting on Shane from
answers waiting on the agent.

## [2026-08-23] init | Vault established

Created the vault, the schema in [CLAUDE](CLAUDE.md), and the homepage queries
in [index](index.md). Migrated fourteen facts out of the `memory/` folder in the
`personal-assistant` repository and split the two registers by space. Imported
the Collibra Obsidian vault into `sources/collibra/`.

Held the Dolche Ventures import: four of its notes carry live credentials and
need revoking before anything is committed.
