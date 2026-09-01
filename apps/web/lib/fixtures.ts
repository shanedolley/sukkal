// Mock data for the prototype. KPA-48.
// No database, no worker, no external service. Production replaces this file
// and keeps the shapes in lib/types.ts.

import type {
  AuditEntry,
  ChatAnswer,
  Conversation,
  Fact,
  CustomField,
  Issue,
  Meeting,
  NeedsYouItem,
  ProjectActivity,
  ProjectAssignment,
  ProjectOverview,
  Provenance,
  Source,
  SourceChunk,
  Sprint,
} from "./types";

/** Resolve a provenance or a citation to the source it points at. */
export function findSource(sourceId: string): Source | undefined {
  return SOURCES.find((source) => source.id === sourceId);
}

/** The passage a provenance names, for quoting in a reply. */
export function findChunk(
  provenance: Provenance
): SourceChunk | undefined {
  return findSource(provenance.sourceId)?.chunks.find(
    (chunk) => chunk.id === provenance.chunkId
  );
}

export function findNeedsYou(id: string): NeedsYouItem | undefined {
  return NEEDS_YOU.find((item) => item.id === id);
}

export function findAudit(id: string): AuditEntry | undefined {
  return AUDIT.find((entry) => entry.id === id);
}

/** The day the prototype renders. The brief's sketch reads "Tuesday 25 Aug". */
export const TODAY = "2026-08-25";

export const SOURCES: Source[] = [
  {
    id: "src-meridian-retention",
    kind: "meeting",
    title: "BHP Meridian: retention working session",
    date: "2026-08-19",
    space: "collibra",
    author: "nabium transcript",
    chunks: [
      {
        id: "c1",
        text: "Priya: We cannot keep lineage records for seven years on the current storage tier. Legal asked for seven, the platform budget covers three.",
      },
      {
        id: "c2",
        text: "Nigel: Then we agree on three years hot and four years archived, and we put the archive cost in the next budget round. I will confirm that with legal by the end of the month.",
      },
      {
        id: "c3",
        text: "Shane: I will write the retention position into the design note and send it round for comment before the steering group.",
      },
    ],
  },
  {
    id: "src-maybank-sow",
    kind: "mail",
    title: "Re: Maybank data governance SOW, second draft",
    date: "2026-08-22",
    space: "koinon",
    author: "adrian.wong@maybank.com.my",
    chunks: [
      {
        id: "c1",
        text: "Thanks Shane. Procurement has the second draft. Nothing else is outstanding from our side.",
      },
      {
        id: "c2",
        text: "The signature is with our regional director, who returns from leave on the 27th. Expect it that week.",
      },
    ],
  },
  {
    id: "src-tfnsw-contacts",
    kind: "mail",
    title: "Transport for NSW: handover of the data quality workstream",
    date: "2026-06-11",
    space: "collibra",
    author: "notifications@transport.nsw.gov.au",
    chunks: [
      {
        id: "c1",
        text: "Please note that Nigel Barros left Transport for NSW in June. Data quality now reports to Amara Okonkwo.",
      },
    ],
  },
  {
    id: "src-tfnsw-invoice",
    kind: "mail",
    title: "Invoice 2026-114: which cost centre?",
    date: "2026-08-24",
    space: "collibra",
    author: "accounts.payable@transport.nsw.gov.au",
    chunks: [
      {
        id: "c1",
        text: "Invoice 2026-114 has been received but carries no cost centre. Please confirm which centre it should be booked against so we can process payment this cycle.",
      },
    ],
  },
  {
    id: "src-koinon-rates",
    kind: "document",
    title: "Koinon Engineering rate card 2026",
    date: "2026-01-15",
    space: "koinon",
    author: "Shane Dolley",
    chunks: [
      {
        id: "c1",
        text: "Principal consulting rate is 2,400 AUD per day, excluding GST, for engagements under twenty days.",
      },
    ],
  },
  {
    id: "src-tax-receipts",
    kind: "mail",
    title: "2026 tax return: the receipts I still need",
    date: "2026-08-18",
    space: "personal",
    author: "hannah@brightonpartners.com.au",
    chunks: [
      {
        id: "c1",
        text: "Hi Shane, I have everything except the home office receipts for the second half of the year. Send those and I can lodge before the deadline.",
      },
      {
        id: "c2",
        text: "The lodgement deadline for your circumstances is 31 October 2026.",
      },
    ],
  },
  {
    id: "src-sydney-water-kickoff",
    kind: "meeting",
    title: "Sydney Water: catalogue rollout kickoff",
    date: "2026-08-24",
    space: "collibra",
    author: "nabium transcript",
    chunks: [
      {
        id: "c1",
        text: "Deborah: The pilot covers the billing domain only. We will not touch asset management until the new year.",
      },
    ],
  },
];

export const FACTS: Fact[] = [
  {
    id: "fact-meridian-retention",
    statement:
      "BHP Meridian retains lineage records for three years hot and four years archived.",
    state: "proposed",
    space: "collibra",
    entity: "BHP Meridian",
    validFrom: "2026-08-19",
    validTo: null,
    staleAfter: "2026-11-19",
    provenance: { sourceId: "src-meridian-retention", chunkId: "c2" },
    generatedByAgent: true,
  },
  {
    id: "fact-meridian-legal",
    statement:
      "Nigel confirms the retention position with BHP legal by 31 August 2026.",
    state: "proposed",
    space: "collibra",
    entity: "BHP Meridian",
    validFrom: "2026-08-19",
    validTo: null,
    staleAfter: "2026-09-01",
    provenance: { sourceId: "src-meridian-retention", chunkId: "c2" },
    generatedByAgent: true,
  },
  {
    id: "fact-maybank-signature",
    statement:
      "The Maybank SOW awaits signature from the regional director, who returns on 27 August 2026.",
    state: "proposed",
    space: "koinon",
    entity: "Maybank",
    validFrom: "2026-08-22",
    validTo: null,
    staleAfter: "2026-09-05",
    provenance: { sourceId: "src-maybank-sow", chunkId: "c2" },
    generatedByAgent: true,
  },
  {
    id: "fact-sydney-water-scope",
    statement:
      "The Sydney Water catalogue pilot covers the billing domain only.",
    state: "proposed",
    space: "collibra",
    entity: "Sydney Water",
    validFrom: "2026-08-24",
    validTo: null,
    staleAfter: "2026-11-24",
    provenance: { sourceId: "src-sydney-water-kickoff", chunkId: "c1" },
    generatedByAgent: true,
  },
  {
    id: "fact-koinon-rate",
    statement:
      "The Koinon principal rate is 2,400 AUD per day excluding GST, under twenty days.",
    state: "stale",
    space: "koinon",
    entity: "Koinon Engineering",
    validFrom: "2026-01-15",
    validTo: null,
    staleAfter: "2026-07-15",
    provenance: { sourceId: "src-koinon-rates", chunkId: "c1" },
    generatedByAgent: false,
  },
  {
    id: "fact-tfnsw-owner",
    statement: "Amara Okonkwo owns data quality at Transport for NSW.",
    state: "stale",
    space: "collibra",
    entity: "Transport for NSW",
    validFrom: "2026-06-11",
    validTo: null,
    staleAfter: "2026-08-11",
    provenance: { sourceId: "src-tfnsw-contacts", chunkId: "c1" },
    generatedByAgent: true,
  },
  {
    id: "fact-tfnsw-nigel",
    statement: "Nigel Barros owns data quality at Transport for NSW.",
    state: "retired",
    space: "collibra",
    entity: "Transport for NSW",
    validFrom: "2025-03-02",
    validTo: "2026-06-11",
    staleAfter: null,
    provenance: { sourceId: "src-tfnsw-contacts", chunkId: "c1" },
    generatedByAgent: false,
  },
  {
    id: "fact-meridian-owner",
    statement: "Priya Raman is the data governance lead on BHP Meridian.",
    state: "verified",
    space: "collibra",
    entity: "BHP Meridian",
    validFrom: "2026-02-10",
    validTo: null,
    staleAfter: "2027-02-10",
    provenance: { sourceId: "src-meridian-retention", chunkId: "c1" },
    generatedByAgent: false,
  },
  {
    id: "fact-tax-deadline",
    statement: "Shane's 2026 tax return is due for lodgement by 31 October 2026.",
    state: "verified",
    space: "personal",
    entity: "Brighton Partners",
    validFrom: "2026-08-18",
    validTo: null,
    staleAfter: "2026-11-01",
    provenance: { sourceId: "src-tax-receipts", chunkId: "c2" },
    generatedByAgent: true,
  },
  {
    id: "fact-tax-receipts-outstanding",
    statement:
      "Shane owes Brighton Partners the home office receipts for the second half of the year.",
    state: "stale",
    space: "personal",
    entity: "Brighton Partners",
    validFrom: "2026-08-18",
    validTo: null,
    staleAfter: "2026-08-22",
    provenance: { sourceId: "src-tax-receipts", chunkId: "c1" },
    generatedByAgent: true,
  },
  {
    id: "fact-meridian-seven-years",
    statement: "BHP Meridian retains lineage records for seven years.",
    state: "rejected",
    space: "collibra",
    entity: "BHP Meridian",
    validFrom: "2026-08-19",
    validTo: null,
    staleAfter: null,
    provenance: { sourceId: "src-meridian-retention", chunkId: "c1" },
    generatedByAgent: true,
    rejectionReason:
      "Seven years is what legal asked for, not what was agreed. The agreement is three hot and four archived.",
  },
  {
    id: "fact-maybank-scope",
    statement: "The Maybank engagement covers data governance advisory only.",
    state: "candidate",
    space: "koinon",
    entity: "Maybank",
    validFrom: "2026-08-22",
    validTo: null,
    staleAfter: null,
    provenance: { sourceId: "src-maybank-sow", chunkId: "c1" },
    generatedByAgent: true,
  },
];

export const NEEDS_YOU: NeedsYouItem[] = [
  {
    id: "need-meridian-retention",
    kind: "question",
    title: "BHP Meridian: retention question",
    detail:
      "Priya asks whether the four-year archive tier goes in this budget round or the next. No source answers it.",
    space: "collibra",
    entity: "BHP Meridian",
    raisedAt: "2026-08-25T07:42:00+10:00",
    provenance: { sourceId: "src-meridian-retention", chunkId: "c1" },
  },
  {
    id: "need-maybank-sow",
    kind: "deadline",
    title: "Maybank SOW unsigned",
    detail:
      "Sent 22 August, six days ago. The regional director returns on the 27th.",
    space: "koinon",
    entity: "Maybank",
    raisedAt: "2026-08-25T07:42:00+10:00",
    provenance: { sourceId: "src-maybank-sow", chunkId: "c2" },
  },
  {
    id: "need-tfnsw-draft",
    kind: "draft",
    title: "Reply owed: Transport for NSW invoice query",
    detail:
      "A draft is ready in Gmail. Nothing sends until you click, in Gmail.",
    space: "collibra",
    entity: "Transport for NSW",
    raisedAt: "2026-08-25T06:15:00+10:00",
    gmailUrl: "https://mail.google.com/mail/u/0/#drafts",
    provenance: { sourceId: "src-tfnsw-invoice", chunkId: "c1" },
  },
  {
    id: "need-tax-receipts",
    kind: "deadline",
    title: "Brighton Partners is waiting on receipts",
    detail:
      "Asked on 18 August. The lodgement deadline is 31 October, and nothing has gone back.",
    space: "personal",
    entity: "Brighton Partners",
    raisedAt: "2026-08-25T07:42:00+10:00",
    provenance: { sourceId: "src-tax-receipts", chunkId: "c1" },
  },
  {
    id: "need-denied-calendar",
    kind: "denied-action",
    title: "Calendar hold refused: Sydney Water follow-up",
    detail:
      "The agent tried to hold 90 minutes on Thursday. The policy refused it and queued the decision for you.",
    space: "collibra",
    entity: "Sydney Water",
    raisedAt: "2026-08-25T05:03:00+10:00",
    rule: "calendar.hold.max-minutes = 60",
    auditId: "audit-hold-sydney-water",
  },
];

export const MEETINGS: Meeting[] = [
  {
    id: "meet-meridian-steering",
    start: "2026-08-25T10:00:00+10:00",
    end: "2026-08-25T11:00:00+10:00",
    title: "BHP Meridian steering group",
    engagement: "BHP Meridian",
    space: "collibra",
    attendees: ["Priya Raman", "Nigel Barros", "Shane Dolley"],
  },
  {
    id: "meet-maybank-checkin",
    start: "2026-08-25T15:30:00+10:00",
    end: "2026-08-25T16:00:00+10:00",
    title: "Maybank fortnightly check-in",
    engagement: "Maybank",
    space: "koinon",
    attendees: ["Adrian Wong", "Shane Dolley"],
  },
  {
    id: "meet-tax-call",
    start: "2026-08-25T17:00:00+10:00",
    end: "2026-08-25T17:30:00+10:00",
    title: "Brighton Partners: tax return check-in",
    engagement: "Brighton Partners",
    space: "personal",
    attendees: ["Hannah Reid", "Shane Dolley"],
  },
];

export const CHAT_ANSWERS: ChatAnswer[] = [
  {
    id: "chat-retention",
    question: "What did BHP agree about lineage retention?",
    answer:
      "BHP Meridian agreed to three years hot and four years archived, with the archive cost deferred to the next budget round. Nigel took the action to confirm the position with legal by the end of August. The agreement is proposed rather than verified, so it still sits on your review queue.",
    citations: [
      {
        sourceId: "src-meridian-retention",
        chunkId: "c2",
        label: "Meridian retention session, 19 Aug",
      },
      {
        sourceId: "src-meridian-retention",
        chunkId: "c1",
        label: "Meridian retention session, 19 Aug",
      },
    ],
    spaces: ["collibra"],
    askedAt: "2026-08-25T08:10:00+10:00",
  },
  {
    id: "chat-crossing",
    question: "What day rate have I quoted for governance advisory this year?",
    answer:
      "The Koinon rate card sets the principal rate at 2,400 AUD per day excluding GST for engagements under twenty days. The Collibra engagements carry no day rate, because your time there is employed rather than billed. That fact is past its review date and needs re-confirming.",
    citations: [
      {
        sourceId: "src-koinon-rates",
        chunkId: "c1",
        label: "Koinon rate card 2026",
      },
      {
        sourceId: "src-meridian-retention",
        chunkId: "c1",
        label: "Meridian retention session, 19 Aug",
      },
    ],
    spaces: ["koinon", "collibra"],
    askedAt: "2026-08-25T08:22:00+10:00",
  },
];

// Past chats, so History has something to show and the meter has a
// conversation near its limit to warn about.
export const CONVERSATIONS: Conversation[] = [
  {
    id: "conv-retention",
    title: "BHP lineage retention",
    startedAt: "2026-08-25T08:10:00+10:00",
    lastAt: "2026-08-25T08:12:00+10:00",
    answers: [CHAT_ANSWERS[0]],
  },
  {
    id: "conv-rates",
    title: "Day rates across both companies",
    startedAt: "2026-08-25T08:22:00+10:00",
    lastAt: "2026-08-25T08:24:00+10:00",
    answers: [CHAT_ANSWERS[1]],
  },
  {
    id: "conv-meridian-history",
    title: "Everything Meridian agreed this year",
    startedAt: "2026-08-21T14:02:00+10:00",
    lastAt: "2026-08-21T15:47:00+10:00",
    answers: [CHAT_ANSWERS[0]],
    // Forty turns over eleven transcripts. The record keeps the last one and
    // counts the rest, which is what the model is still carrying.
    carriedTokens: 156_000,
  },
  {
    id: "conv-tfnsw-audit",
    title: "Transport for NSW: the whole data quality history",
    startedAt: "2026-08-18T09:14:00+10:00",
    lastAt: "2026-08-18T12:31:00+10:00",
    answers: [CHAT_ANSWERS[0]],
    // Near the ceiling. The meter says to start again rather than to ask a
    // shorter question, because a shorter question does not help here.
    carriedTokens: 186_000,
  },
];

export function findConversation(id: string): Conversation | undefined {
  return CONVERSATIONS.find((conversation) => conversation.id === id);
}

export const AUDIT: AuditEntry[] = [
  {
    id: "audit-label-meridian",
    at: "2026-08-25T06:02:00+10:00",
    action: "Apply Gmail label",
    intent: "File the Meridian thread under BHP / Meridian.",
    before: "Thread carried no label.",
    outcome: "allowed",
    result: "Label applied to 4 messages.",
    reverse: "Remove the label from the 4 messages listed above.",
    space: "collibra",
  },
  {
    id: "audit-draft-tfnsw",
    at: "2026-08-25T06:15:00+10:00",
    action: "Create Gmail draft",
    intent: "Draft a reply to the Transport for NSW invoice query.",
    before: "No draft on the thread.",
    outcome: "allowed",
    result: "Draft created. It stays in the drafts folder until you send it.",
    reverse: "Delete the draft. Nothing left the account.",
    space: "collibra",
  },
  {
    id: "audit-hold-sydney-water",
    at: "2026-08-25T05:03:00+10:00",
    action: "Hold calendar time",
    intent: "Hold 90 minutes on Thursday for the Sydney Water follow-up.",
    before: "Thursday 14:00 to 15:30 was free.",
    outcome: "denied",
    result: "Refused and queued for your decision. No event was created.",
    reverse: "Nothing to reverse.",
    space: "collibra",
    rule: "calendar.hold.max-minutes = 60",
  },
  {
    id: "audit-send-maybank",
    at: "2026-08-24T19:48:00+10:00",
    action: "Send mail",
    intent: "Chase Adrian Wong for the Maybank signature.",
    before: "Draft prepared, unsent.",
    outcome: "denied",
    result: "Refused. The draft stays queued for you.",
    reverse: "Nothing to reverse.",
    space: "koinon",
    rule: "mail.send.never-unprompted",
  },
  {
    id: "audit-fact-write",
    at: "2026-08-24T22:31:00+10:00",
    action: "Write fact",
    intent:
      "Record the Sydney Water pilot scope from the kickoff transcript.",
    before: "No fact recorded the pilot scope.",
    outcome: "allowed",
    result: "Fact written as proposed. It is not verified.",
    reverse: "Reject the fact from the review queue. The row is kept.",
    space: "collibra",
  },
  {
    id: "audit-retire-nigel",
    at: "2026-08-24T22:33:00+10:00",
    action: "Retire fact",
    intent:
      "Retire the Transport for NSW ownership fact, contradicted by the June handover mail.",
    before: "Fact was verified, valid from 2 March 2025.",
    outcome: "allowed",
    result: "valid_to set to 11 June 2026. The row is kept and still queries.",
    reverse: "Clear valid_to on fact-tfnsw-nigel.",
    space: "collibra",
  },
  {
    id: "audit-delete-attempt",
    at: "2026-08-24T02:10:00+10:00",
    action: "Delete mail",
    intent: "Clear 214 newsletters older than six months.",
    before: "214 messages in the inbox.",
    outcome: "denied",
    result: "Refused. Nothing was deleted.",
    reverse: "Nothing to reverse.",
    space: "personal",
    rule: "never-delete-or-destructively-edit",
  },
];

// ── Sprints ──
// Three states, so every sprint view has something to show. The dates bracket
// TODAY, which is what makes one of them the current sprint.

export const SPRINTS: Sprint[] = [
  {
    id: "sprint-40",
    name: "Sprint 40",
    start: "2026-08-04",
    end: "2026-08-15",
    state: "closed",
  },
  {
    id: "sprint-41",
    name: "Sprint 41",
    start: "2026-08-18",
    end: "2026-08-29",
    state: "active",
  },
  {
    id: "sprint-42",
    name: "Sprint 42",
    start: "2026-09-01",
    end: "2026-09-12",
    state: "future",
  },
];

/** The sprint in flight. */
export const CURRENT_SPRINT = SPRINTS.find((s) => s.state === "active")!;

// ── Issues ──
// One project per space, matching the three the sidebar lists.

export const ISSUES: Issue[] = [
  {
    key: "PSAPAC-2607",
    title: "Meridian retention: agree the archive tier with legal",
    description:
      "Legal asked for seven years of lineage records. The platform budget covers three. Nigel proposed three years hot and four archived, with the archive cost going in the next budget round.",
    status: "in-progress",
    kind: "epic",
    priority: "urgent",
    workspace: "Collibra",
    labels: ["Blocked", "bhp-meridian"],
    assignee: "Shane Dolley",
    start: "2026-08-18",
    due: "2026-08-28",
    updated: "2026-08-25",
    fields: { customer: "BHP", engagement: "Meridian" },
    blocks: ["PSAPAC-2598"],
    sprintId: "sprint-41",
  },
  {
    key: "PSAPAC-2611",
    title: "Rebuild the Modify Data Utility form on the new method",
    description: "",
    status: "in-progress",
    kind: "story",
    priority: "high",
    workspace: "Collibra",
    labels: ["Improvement", "bhp-meridian"],
    assignee: "Priya Raman",
    start: "2026-08-19",
    due: null,
    updated: "2026-08-25",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "PSAPAC-2612",
    title: "Restrict the Data Utility group picker to the Snowflake community",
    description: "",
    status: "todo",
    kind: "subtask",
    priority: "medium",
    workspace: "Collibra",
    labels: ["Improvement", "bhp-meridian"],
    assignee: "Priya Raman",
    start: null,
    due: "2026-08-29",
    updated: "2026-08-24",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
    parent: "PSAPAC-2611",
  },
  {
    key: "PSAPAC-2613",
    title: "Filter obsolete data concepts out of the search list",
    description: "",
    status: "todo",
    kind: "subtask",
    priority: "low",
    workspace: "Collibra",
    labels: ["transport-for-nsw"],
    assignee: "Priya Raman",
    start: null,
    due: null,
    updated: "2026-08-21",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
    parent: "PSAPAC-2611",
  },
  {
    key: "PSAPAC-2598",
    title: "Sydney Water: hand the lineage runbook to the platform team",
    description: "",
    status: "in-review",
    kind: "story",
    priority: "medium",
    workspace: "Collibra",
    labels: ["Documentation", "sydney-water"],
    assignee: "Shane Dolley",
    start: "2026-08-20",
    due: "2026-08-26",
    updated: "2026-08-24",
    fields: { customer: "Sydney Water", engagement: "Lineage uplift" },
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "PSAPAC-2589",
    title: "Close out the Transport for NSW invoice query",
    description: "",
    status: "done",
    kind: "story",
    priority: "high",
    workspace: "Collibra",
    labels: ["transport-for-nsw"],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-20",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "MP-142",
    title: "Maybank SOW: chase the regional director for signature",
    description:
      "Sent 22 August. The regional director returns on the 27th, so nothing moves before then.",
    status: "in-progress",
    kind: "story",
    priority: "urgent",
    workspace: "Koinon Engineering",
    labels: ["Waiting"],
    assignee: "Shane Dolley",
    start: "2026-08-18",
    due: "2026-08-27",
    updated: "2026-08-25",
    fields: {},
    blocks: ["MP-146"],
    sprintId: "sprint-41",
  },
  {
    key: "MP-146",
    title: "Move the nabium transcript worker onto the new queue",
    description: "",
    status: "todo",
    kind: "story",
    priority: "high",
    workspace: "Koinon Engineering",
    labels: ["Infrastructure"],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-23",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "MP-149",
    title: "Add the staleness sweep to the nightly schedule",
    description: "",
    status: "todo",
    kind: "story",
    priority: "medium",
    workspace: "Koinon Engineering",
    labels: ["Feature"],
    assignee: "Shane Dolley",
    start: null,
    due: "2026-08-29",
    updated: "2026-08-22",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "MS-88",
    title: "Marinucci: the RCTI PDF prints the wrong ABN",
    description: "",
    status: "done",
    kind: "story",
    priority: "urgent",
    workspace: "Koinon Engineering",
    labels: ["Bug"],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-19",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "MS-91",
    title: "Rebuild the Talentblocks booking export",
    description: "",
    status: "cancelled",
    kind: "story",
    priority: "low",
    workspace: "Koinon Engineering",
    labels: [],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-18",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "PERS-12",
    title: "Renew the practising certificate before it lapses",
    description: "",
    status: "todo",
    kind: "story",
    priority: "high",
    workspace: "Personal",
    labels: ["Deadline"],
    assignee: "Shane Dolley",
    start: null,
    due: "2026-08-31",
    updated: "2026-08-24",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },
  {
    key: "PERS-14",
    title: "Book the Sydney trip for the September on-site",
    description: "",
    status: "backlog",
    kind: "story",
    priority: "none",
    workspace: "Personal",
    labels: [],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-15",
    fields: {},
    blocks: [],
    sprintId: "sprint-41",
  },

  // Sprint 42, so the future view is not empty.
  {
    key: "MP-151",
    title: "Give the assistant a read-only Jira token",
    description:
      "Read-only is the whole point. The token must not carry write scope, because the policy table denies every write to a customer system.",
    status: "todo",
    kind: "story",
    priority: "high",
    workspace: "Koinon Engineering",
    labels: ["Feature"],
    assignee: "Shane Dolley",
    start: "2026-09-01",
    due: null,
    updated: "2026-08-25",
    fields: {},
    blocks: [],
    sprintId: "sprint-42",
  },
  {
    key: "PSAPAC-2620",
    title: "Draft the BHP Meridian handover pack",
    description: "",
    status: "backlog",
    kind: "story",
    priority: "medium",
    workspace: "Collibra",
    labels: ["Documentation", "bhp-meridian"],
    assignee: "Shane Dolley",
    start: null,
    due: "2026-09-11",
    updated: "2026-08-24",
    fields: {},
    blocks: [],
    sprintId: "sprint-42",
  },
  {
    key: "PERS-16",
    title: "Move the family photo archive off the old drive",
    description: "",
    status: "backlog",
    kind: "story",
    priority: "low",
    workspace: "Personal",
    labels: [],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-12",
    fields: {},
    blocks: [],
    sprintId: "sprint-42",
  },

  // Sprint 40, closed, so the all-sprints view spans more than one.
  {
    key: "MP-138",
    title: "Ship the appearance preferences page",
    description: "",
    status: "done",
    kind: "epic",
    priority: "medium",
    workspace: "Koinon Engineering",
    labels: ["Feature"],
    assignee: "Shane Dolley",
    start: null,
    due: null,
    updated: "2026-08-14",
    fields: {},
    blocks: [],
    sprintId: "sprint-40",
  },
  {
    key: "PSAPAC-2571",
    title: "Retire the old lineage import script",
    description: "",
    status: "done",
    kind: "story",
    priority: "low",
    workspace: "Collibra",
    labels: ["sydney-water"],
    assignee: "Priya Raman",
    start: null,
    due: null,
    updated: "2026-08-13",
    fields: {},
    blocks: [],
    sprintId: "sprint-40",
  },
  {
    key: "PERS-9",
    title: "Lodge the quarterly BAS",
    description: "",
    status: "done",
    kind: "story",
    priority: "urgent",
    workspace: "Personal",
    labels: ["Deadline"],
    assignee: "Shane Dolley",
    start: "2026-08-10",
    due: "2026-08-14",
    updated: "2026-08-14",
    fields: {},
    blocks: [],
    sprintId: "sprint-40",
  },
];

// ── Custom fields ──
//
// What the site offers, and what each project has taken from it.
//
// The catalogue stands in for a scan of /rest/api/3/field, which is where the
// real list comes from once the connection lands. Collibra's two are real:
// see the Jira section of the repository's CLAUDE.md.

/** Every custom field the site offers, whatever project uses it. */
export const JIRA_FIELDS: { id: string; name: string }[] = [
  { id: "acceptance-criteria", name: "Acceptance Criteria" },
  { id: "account", name: "Account" },
  { id: "billable", name: "Billable" },
  { id: "customer", name: "Customer" },
  { id: "delivery-date", name: "Delivery Date" },
  { id: "engagement", name: "Engagement" },
  { id: "environment", name: "Environment" },
  { id: "epic-link", name: "Epic Link" },
  { id: "root-cause", name: "Root Cause" },
  { id: "severity", name: "Severity" },
  { id: "team", name: "Team" },
];

/** When the catalogue above was last read. A scan moves it. */
export const FIELDS_SCANNED_AT = "2026-08-24";


// ── Projects ──
// Keyed by the address the project is reached at, so a page holding a route
// key can read them without a second lookup.

export const PROJECT_OVERVIEW: Record<string, ProjectOverview> = {
  "bhp-meridian": {
    description:
      "A resident enterprise architect on the Meridian programme. Retention, lineage and the archive tier, renewed each year.",
    start: "2026-06-08",
    end: "2027-06-07",
  },
  "sydney-water": {
    description:
      "Lineage uplift. Hand the runbook to the platform team, then retire the import scripts it replaces.",
    start: "2026-03-02",
    end: "2026-11-27",
  },
  "transport-for-nsw": {
    description: "",
    start: "2026-07-01",
    end: null,
  },
};

/**
 * The open and closed counts, week by week.
 *
 * ponytail: shaped by hand. The fixtures are one snapshot and carry no
 * history, so a count on any day but today cannot be read from them. Jira's
 * changelog replaces this whole map.
 */
function weekly(open: number[], closed: number[]): ProjectActivity[] {
  return open.map((count, week) => {
    const day = new Date(TODAY);
    day.setDate(day.getDate() - 7 * (open.length - 1 - week));
    return {
      date: day.toISOString().slice(0, 10),
      open: count,
      closed: closed[week],
    };
  });
}

export const PROJECT_ACTIVITY: Record<string, ProjectActivity[]> = {
  "bhp-meridian": weekly([2, 5, 6, 4, 7, 6, 4], [0, 1, 2, 5, 5, 7, 9]),
  "sydney-water": weekly([4, 3, 5, 3, 2, 2, 1], [1, 3, 3, 6, 8, 8, 9]),
  "transport-for-nsw": weekly([1, 2, 3, 3, 2, 2, 2], [0, 0, 1, 2, 4, 4, 5]),
  collibra: weekly([7, 10, 12, 9, 11, 9, 8], [1, 4, 6, 13, 17, 19, 23]),
  "koinon-engineering": weekly([5, 6, 8, 7, 9, 8, 7], [0, 2, 3, 5, 6, 9, 11]),
  personal: weekly([2, 3, 3, 4, 5, 4, 4], [0, 1, 1, 2, 2, 4, 5]),
};

/**
 * Who is assigned to a project, and what they have booked.
 *
 * ponytail: shaped by hand, on the same seven weeks the activity chart uses,
 * so the two read against each other. Certinia PSA replaces the whole map.
 * Only Collibra runs projects on hours, so only its engagements appear.
 */
export const PROJECT_HOURS: Record<string, ProjectAssignment[]> = {
  "bhp-meridian": [
    {
      resource: "Shane Dolley",
      assigned: 1200,
      usedEarlier: 260,
      used: [32, 30, 28, 34, 26, 30, 24],
    },
    {
      resource: "Priya Raman",
      assigned: 400,
      usedEarlier: 70,
      used: [8, 12, 10, 6, 14, 10, 8],
    },
  ],
  "sydney-water": [
    {
      resource: "Shane Dolley",
      assigned: 320,
      usedEarlier: 180,
      used: [10, 8, 12, 6, 9, 7, 5],
    },
    {
      resource: "Priya Raman",
      assigned: 160,
      usedEarlier: 96,
      used: [4, 6, 4, 8, 5, 3, 2],
    },
  ],
  "transport-for-nsw": [
    {
      resource: "Shane Dolley",
      assigned: 120,
      usedEarlier: 22,
      used: [6, 4, 8, 5, 6, 4, 3],
    },
  ],
};

/** The Monday of each week the hours above are booked against, oldest first. */
export const HOURS_WEEKS: string[] = Array.from({ length: 7 }, (_, week) => {
  const day = new Date(TODAY);
  day.setDate(day.getDate() - 7 * (6 - week));
  return day.toISOString().slice(0, 10);
});

export const WORKSPACE_FIELDS: Record<string, CustomField[]> = {
  Collibra: [
    { id: "customer", name: "Customer", required: true },
    { id: "engagement", name: "Engagement", required: false },
  ],
  "Koinon Engineering": [],
  Personal: [],
};
