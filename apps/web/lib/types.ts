// The vocabulary comes from docs/project-brief.md. Production replaces the
// data and keeps these shapes.

/**
 * The spaces retrieval filters by. See "The policy" in the brief.
 *
 * `shared` is not a fourth silo beside the other three. It is the space
 * either side may cite: how Shane works whatever hat he wears. So the filter
 * offers three, and narrowing to one of them shows that space and `shared`
 * together. ADR-0018.
 */
export type Space = "collibra" | "koinon" | "personal" | "shared";

/** The states in "A fact's life". Nothing is ever deleted.
 *  Rejected is terminal: the row stays and its reason is recorded, so a later
 *  run reads the reason and does not raise the same candidate again. */
export type FactState =
  | "candidate"
  | "proposed"
  | "verified"
  | "stale"
  | "retired"
  | "rejected";

export type SourceKind = "meeting" | "mail" | "document" | "chat";

export interface SourceChunk {
  id: string;
  text: string;
}

/** Ingestion writes a source verbatim and never edits it. */
export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  /** ISO date. */
  date: string;
  space: Space;
  author: string;
  chunks: SourceChunk[];
}

/**
 * Where a thing came from. A citation opens the named chunk.
 *
 * The chunk is optional, because the column is. A derived_from edge written
 * before chunking existed names the source and no passage, and so does a
 * queue row raised before its source was broken up. The drawer then opens the
 * source at the top and says so, which is more use than refusing to open it.
 */
export interface Provenance {
  sourceId: string;
  chunkId?: string;
}

export interface Fact {
  id: string;
  statement: string;
  state: FactState;
  space: Space;
  /**
   * The customer, engagement or person this fact concerns. Null until
   * something resolves one, which migration 010 made the column allow and
   * ADR-0014 explains. Every screen that groups by entity says what it does
   * with a row naming none, rather than letting one fall through a template
   * literal and read as "undefined". KPA-69, carried by KPA-121.
   */
  entity: string | null;
  /** ISO date the fact became true. */
  validFrom: string;
  /** ISO date it stopped being true. Null while it still holds. */
  validTo: string | null;
  /** ISO date it falls due for review. The sweep flags, it never retires. */
  staleAfter: string | null;
  /**
   * Where the fact came from, when anything records it.
   *
   * Optional because a fact's source is a `derived_from` edge rather than a
   * column, and nothing writes that edge yet: `src/memory/gates.ts` inserts
   * the node and the fact row alone. A required field here would be a promise
   * no read could keep, and the two answers to that are worse than the gap.
   * Dropping a sourceless fact hides a proposed fact nobody would then
   * confirm, and an empty `sourceId` is the sentinel ADR-0014 argues against.
   * The panel says so instead. KPA-121.
   */
  provenance?: Provenance;
  /** Set when an agent wrote it rather than Shane. */
  generatedByAgent: boolean;
  /** Recorded when Shane rejects it. Kept, never deleted. */
  rejectionReason?: string;
}

/** A row in "Needs you". Each waits on a decision from Shane. */
export type NeedsYouKind = "draft" | "question" | "denied-action" | "deadline";

export interface NeedsYouItem {
  id: string;
  kind: NeedsYouKind;
  title: string;
  detail: string;
  space: Space;
  /**
   * The customer, engagement or person the item concerns. Null until
   * something resolves one, which migration 010 made the column allow and
   * ADR-0014 explains. A row with none renders without it.
   */
  entity: string | null;
  /** ISO date the item arrived. */
  raisedAt: string;
  /** Drafts open in Gmail. Sukkal never sends. */
  gmailUrl?: string;
  /** Named on a denied-action row: the policy rule that stopped it. */
  rule?: string;
  /**
   * Where the item came from. Every row that an ingested source raised has
   * one, so the panel can say whether it was a meeting or a mail, on what
   * date, and from whom. Without it a row is an assertion with no address.
   */
  provenance?: Provenance;
  /** A row the policy engine raised points at its audit entry instead. */
  auditId?: string;
}

export interface Meeting {
  id: string;
  /** ISO datetime. */
  start: string;
  /** ISO datetime. */
  end: string;
  title: string;
  engagement: string;
  space: Space;
  attendees: string[];
}

/** A provenance the reader can see: the same pointer, plus what to call it. */
export interface Citation extends Provenance {
  label: string;
}

export interface ChatAnswer {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  /**
   * Every space the answer drew on. Two or more raises the crossing flag,
   * and `shared` is never one of the two. It is the space either side may
   * cite, so citing it crosses nothing. `crosses` in lib/space.ts holds the
   * rule, and ADR-0018 gives the reason.
   */
  spaces: Space[];
  askedAt: string;
}

/** One chat, kept so it can be reopened. */
export interface Conversation {
  id: string;
  title: string;
  /** ISO datetime of the first question. */
  startedAt: string;
  /** ISO datetime of the last answer. */
  lastAt: string;
  answers: ChatAnswer[];
  /**
   * Tokens from turns this record does not store verbatim. A long
   * conversation keeps its whole transcript in the prompt, so the meter has
   * to count what came before, not only what is on screen.
   */
  carriedTokens?: number;
}

/** ── Jira ──
 *
 * The shapes the project management section reads. Jira is the source, so
 * these mirror what its API returns rather than inventing a second model.
 */

/** Where an issue sits on the board. */
export type IssueStatus =
  | "backlog"
  | "todo"
  | "in-progress"
  | "in-review"
  | "done"
  | "cancelled";

/**
 * Where an issue sits in the tree.
 *
 * An epic hangs off nothing, a story hangs off an epic, and a sub-task hangs
 * off a story. Jira allows more shapes than this; the three are the ones this
 * assistant files.
 */
export type IssueKind = "epic" | "story" | "subtask";

/** What a kind may hang off. An epic hangs off nothing. */
export const PARENT_KIND: Record<IssueKind, IssueKind | null> = {
  epic: null,
  story: "epic",
  subtask: "story",
};

export const ISSUE_KIND_LABELS: Record<IssueKind, string> = {
  epic: "Epic",
  story: "Story",
  subtask: "Sub-task",
};

export type IssuePriority = "none" | "low" | "medium" | "high" | "urgent";

export type SprintState = "active" | "future" | "closed";

export interface Sprint {
  id: string;
  name: string;
  /** ISO date the sprint opens. */
  start: string;
  /** ISO date it closes. */
  end: string;
  state: SprintState;
}

/**
 * What a project carries beyond its issues.
 *
 * Jira holds none of it. The description is written here, and the dates come
 * from the contract, which Collibra keeps in Salesforce on pse__Proj__c.
 */
export interface ProjectOverview {
  /** Empty until somebody writes it. */
  description: string;
  /** ISO date. Null when no contract names one. */
  start: string | null;
  /** ISO date. Null when no contract names one. */
  end: string | null;
}

/**
 * One person's assignment on a project, and the hours they have booked.
 *
 * Certinia PSA holds these on pse__Assignment__c. `assigned` is
 * pse__Scheduled_Hours__c, and the booked hours are the billable and
 * non-billable submitted hours added together.
 */
export interface ProjectAssignment {
  /** Resource_Name__c. */
  resource: string;
  /** Hours the assignment allows. */
  assigned: number;
  /** Hours booked before the weeks below, so the totals reach back further. */
  usedEarlier: number;
  /** Hours booked in each week, oldest first. */
  used: number[];
}

/** One day's standing count, for the open and closed lines on a chart. */
export interface ProjectActivity {
  /** ISO date. */
  date: string;
  open: number;
  closed: number;
}

export interface CustomField {
  /** Stable across a rename, because an issue's value is filed under it. */
  id: string;
  name: string;
  /** A new issue cannot be filed until this one is filled in. */
  required: boolean;
}

export interface Issue {
  /** The Jira key, such as MP-142. */
  key: string;
  title: string;
  /**
   * What the issue is, at length. Empty until somebody writes it.
   *
   * The cache stores something else. ADR-0007 rejects markdown as lossy, so
   * `issues.description` is `jsonb` and holds what the tracker sent: ADF from
   * Jira, markdown from Linear. This is the plain string the editor binds to,
   * and the adapter converts between the two at the boundary.
   */
  description: string;
  status: IssueStatus;
  kind: IssueKind;
  priority: IssuePriority;
  /**
   * The workspace it sits in, by name. A workspace is a Jira project, so this
   * is what Jira calls the project. Which project inside the workspace it
   * belongs to is read from the rule that project carries: see
   * lib/workspaces.ts.
   */
  workspace: string;
  labels: string[];
  assignee: string;
  /** ISO date work is meant to start. Null when Jira holds no start date. */
  start: string | null;
  /** ISO date it is due. Null when Jira holds no due date. */
  due: string | null;
  /**
   * ISO date it last moved, which is the day the list screen shows.
   *
   * `issues.updated` holds the moment instead, because it is the stamp a
   * write reads before it refuses a stale one. A stamp resolved to the day
   * refuses no write made later the same day, which is every conflict worth
   * catching. ADR-0007.
   */
  updated: string;
  /** The sprint it sits in. Null while it sits in the backlog. */
  sprintId: string | null;
  /** What the workspace's custom fields hold, keyed by `workspace_fields.id`.
   *  Absent is empty. */
  fields: Record<string, string>;
  /**
   * The keys this issue blocks.
   *
   * One direction, stored once. "Blocked by" is read from the other end,
   * because holding both sides invites them to disagree, and Jira's own link
   * puts the truth at the inward end. `issue_blocks` stores the pair from the
   * blocker for that reason, and a check there refuses a self-link.
   */
  blocks: string[];
  /** The key of the issue it hangs under. Absent on an epic. */
  parent?: string;
}

/** `attempted` is a row state, not a verdict: the agent wrote the row, called
 *  out, and has not yet recorded how the call ended. ADR-0015. */
export type AuditOutcome = "allowed" | "denied" | "attempted";

/** The brief requires four fields on every entry, plus the rule on a denial. */
export interface AuditEntry {
  id: string;
  /** ISO datetime. */
  at: string;
  action: string;
  /** What the agent meant to do. */
  intent: string;
  /** The state before it acted. */
  before: string;
  outcome: AuditOutcome;
  /** What happened, or why it was refused. */
  result: string;
  /** How to reverse it. */
  reverse: string;
  space: Space;
  /** Present only on a denial: the policy rule that denied it, by key. */
  rule?: string;
  /**
   * The rule's own words, read from `policies` rather than copied here. The
   * key names the policy so its wording can change without rewriting every
   * entry that cited it, which is exactly why the words are read.
   */
  policy?: { governs: string; effect: string };
  /**
   * The Needs you row a denial raised, while it is still open. A denial is
   * queued for Shane's decision, so the log says which decision waits and
   * which one is closed.
   */
  decision?: { id: string; title: string };
}

export const SPACE_LABELS: Record<Space, string> = {
  collibra: "Collibra",
  koinon: "Koinon",
  personal: "Personal",
  shared: "Shared",
};

export const FACT_STATE_LABELS: Record<FactState, string> = {
  candidate: "Candidate",
  proposed: "Proposed",
  verified: "Verified",
  stale: "Stale",
  retired: "Retired",
  rejected: "Rejected",
};


export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
