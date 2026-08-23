# Autonomy bounded by a policy table, not by a prompt

KPA acts on its own rather than queueing everything for approval, which is a
deliberate departure from the markdown system whose governing principle is that
the default is to write nothing. We chose to bound that autonomy with a policy
engine backed by a database table the worker consults before every outbound
action, rather than with instructions in a system prompt, because a prompt cannot
be tested and fails silently.

Four rules. It never sends mail unprompted. It never deletes or destructively
edits. It never marks its own facts verified. It keeps Collibra and Koinon apart,
though only as a guideline (see ADR-0006).

## Consequences

- The policy table is the only thing between an autonomous agent and Shane's sent
  folder, so it needs tests of its own, and a rule that fails to load must deny
  rather than allow.
- Every action writes its intent before acting and its outcome after, along with
  how to reverse it. Without an approval step in front, the audit log is the
  safety net, so it has to surface on the briefing rather than sit in a table
  nobody opens. The markdown system already learned this: findings written to
  logs went unread for three days.
- Labelling mail runs autonomously because a label is reversible. Sending does
  not, because it is not. Reversibility is the test each new capability gets
  judged against.
- Drive is read and write, which brushes against the destructive-edit rule. It
  reconciles because Google keeps revision history and a move is reversible;
  deletion stays forbidden.
