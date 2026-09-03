# The decision register

`scripts/decision-register.ts` writes this file from the decision blocks in
Jira. **Do not edit it by hand**, because the next run overwrites it. Rule on
a decision in Jira and run the script again.

A question is a warning panel reading `DECISION NEEDED`. A ruling is a Jira
decision block, which carries its own state. Both are structure rather than
prose, so nothing here reads an answer out of a sentence.

`docs/adr/` still holds the decisions that were hard to reverse. This holds
the lighter rulings. A decision that meets the three tests in `CLAUDE.md`
graduates to an ADR, and this register then cites it.

Generated 2026-09-03. 1 decided, 7 waiting.

## Decided

| On | Ticket | The question | The ruling |
|---|---|---|---|
| 2026-09-03 | [KPA-96](https://koinon.atlassian.net/browse/KPA-96) | Does the fourth criterion close as met by migration 018, or does a trigger enforce it? | Proceed with Option A |

## Waiting on a ruling

| Ticket | The question | Recommended |
|---|---|---|
| [KPA-104](https://koinon.atlassian.net/browse/KPA-104) | Where does the Voyage key live: the environment, or a connection? | A |
| [KPA-126](https://koinon.atlassian.net/browse/KPA-126) | Should the setup wizard pre-fill the name, the email and the assistant name from the browser copy before this story deletes it? | A, which is what is built |
| [KPA-135](https://koinon.atlassian.net/browse/KPA-135) | Do the ten autoFocus placements stay? | A |
| [KPA-136](https://koinon.atlassian.net/browse/KPA-136) | When you dismiss a deadline item without re-confirming the fact, does that review settle or defer? | A |
| [KPA-140](https://koinon.atlassian.net/browse/KPA-140) | Does the project settings screen edit the workspace's custom fields, or does a project carry fields of its own? | A |
| [KPA-141](https://koinon.atlassian.net/browse/KPA-141) | Should apps/web run noUncheckedIndexedAccess, matching the root? | A |
| [KPA-142](https://koinon.atlassian.net/browse/KPA-142) | Where does a custom field's tracker id come from: a scan, or one reading by hand? | A |
