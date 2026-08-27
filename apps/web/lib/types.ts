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
