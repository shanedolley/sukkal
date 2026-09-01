# The tracker owns issue text

KPA shows and edits issues from boards other people also write to, and a rich
editor needs a document model to edit them in. We chose TipTap, whose model is
ProseMirror, and left the tracker as the source of truth: KPA caches what it
reads and converts at the boundary, rather than holding its own canonical copy.

Jira's ADF is a ProseMirror schema. Atlassian's `@atlaskit/adf-schema` ships
ProseMirror node and mark specs, and `adf-schema-generator` emits both formats
from one source. So ADF to a ProseMirror document and back is close to a node
rename, which removes the only good reason to keep a second copy.

## Considered Options

1. **A local canonical store, synced outward** - gives one document model across
   every tracker, and works offline. Rejected because PSAPAC and PER carry
   Collibra writers. Two masters over one mutable blob means merging rich text,
   which is the kind that does not merge.
2. **Markdown as the stored text** - one simple format with converters in every
   language. Rejected because neither Jira API accepts it, so it converts on
   every write anyway, and it drops what ADF holds: task lists, panels, media.
3. **BlockNote rather than TipTap** - the slash menu is built, free and works
   today. Rejected because its core is MPL-2.0 and its XL packages GPL-3.0, it
   ships CSS that fights the design system, and its block layer sits one hop
   further from ADF. Its own markdown export is named `blocksToMarkdownLossy`.
4. **Plate or Lexical** - Plate is built as shadcn components and would drop
   into the registry this app already uses. Rejected because Slate and Lexical
   are not ProseMirror, so ADF conversion stops being a rename and becomes a
   parser.

## Consequences

- The brief draws `worker --> jira` one way. The UI reads and edits issues, so
  that arrow becomes bidirectional and the brief changes with it.
- Postgres gains no issues table that anything treats as true. It gains a cache
  carrying the tracker's own `updated` stamp, and a queue for writes the tracker
  has not yet accepted.
- A write reads the stamp first and refuses when it has moved. The writer then
  re-reads and decides, because KPA cannot guess how two descriptions combine.
- Comments need none of that. They are append-only in practice, so KPA writes
  them straight through.
- Every tracker needs its own adapter. Jira takes ADF, Linear takes markdown,
  and the adapter stays the only place that knows the difference.
- TipTap's own slash-command extension is an experiment its authors say they do
  not maintain. The menu gets built on `@tiptap/suggestion`, which is MIT and
  stable, and reuses the `Command` component the field menus already use.
- Anything KPA wants that a tracker cannot hold takes its own column. A second
  copy of the description wearing a different name is still a second master.
