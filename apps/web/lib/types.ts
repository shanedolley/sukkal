// The vocabulary comes from docs/project-brief.md. Production replaces the
// data and keeps these shapes.

/** The three spaces retrieval filters by. See "The policy" in the brief. */
export type Space = "collibra" | "koinon" | "personal";

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

/** Where a fact came from. A citation opens the named chunk. */
export interface Provenance {
  sourceId: string;
  chunkId: string;
}

export interface Fact {
  id: string;
  statement: string;
  state: FactState;
  space: Space;
  entity: string;
  /** ISO date the fact became true. */
  validFrom: string;
  /** ISO date it stopped being true. Null while it still holds. */
  validTo: string | null;
  /** ISO date it falls due for review. The sweep flags, it never retires. */
  staleAfter: string | null;
  provenance: Provenance;
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
  entity: string;
  /** ISO date the item arrived. */
  raisedAt: string;
  /** Drafts open in Gmail. KPA never sends. */
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
  /** Every space the answer drew on. Two or more raises the crossing flag. */
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
  /** What the issue is, at length. Empty until somebody writes it. */
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
  /** ISO date it last moved. */
  updated: string;
  /** The sprint it sits in. Null while it sits in the backlog. */
  sprintId: string | null;
  /** What the project's custom fields hold, by field id. Absent is empty. */
  fields: Record<string, string>;
  /**
   * The keys this issue blocks.
   *
   * One direction, stored once. "Blocked by" is read from the other end,
   * because holding both sides invites them to disagree, and Jira's own link
   * puts the truth at the inward end.
   */
  blocks: string[];
  /** The key of the issue it hangs under. Absent on an epic. */
  parent?: string;
}

export type AuditOutcome = "allowed" | "denied";

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
  /** Present only on a denial: the policy rule that denied it. */
  rule?: string;
}

export const SPACE_LABELS: Record<Space, string> = {
  collibra: "Collibra",
  koinon: "Koinon",
  personal: "Personal",
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
