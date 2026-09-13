#!/usr/bin/env python3
"""Count what the vault holds, without the migration's code.

KPA-13 reconciles five counts in Postgres against the vault: facts, sources,
tasks, questions and edges. check.py emits none of the last four, and a count
taken with the migration's own TypeScript reader would agree with the
migration whenever both shared one misreading. So this counter is Python, and
the independence is structural: it cannot import that reader.

REQ-033 puts it "beside check.py". It lives in this repository instead,
because writing a file into the frozen vault is exactly the drift REQ-032's
check exists to catch. It is still Python, and it still reads the vault's
files directly.

Every definition below is written from the slice one design and the vault's
own conventions, not from src/migrate/:

  facts      a *.md directly inside shared/, collibra/, koinon/ or personal/
  sources    a *.md anywhere under sources/
  tasks      a top-level "- [ ]" or "- [x]" line in a fact's body
  questions  a data row of the "Questions for you" table on index.md
  edges      per fact: one links_to per distinct [[name]] in the body, and one
             derived_from per sources: entry, targeting its first [[name]],
             else its first URL, else its text. Two edges from one fact with
             the same kind and target are one edge, and a fact never links to
             itself, which is what the schema's two edge constraints say.

    scripts/count-vault.py [vault]     print the five counts as JSON
    scripts/count-vault.py --selftest  prove the definitions on fixtures
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

SPACES = ("shared", "collibra", "koinon", "personal")
LINK = re.compile(r"\[\[([^\]|#]+)")
URL = re.compile(r"https?://\S+")
TASK = re.compile(r"^- \[[ xX]\]")


def split_note(text: str) -> tuple[str, str]:
    """The frontmatter block and the body, or no frontmatter and all body."""
    if not text.startswith("---\n"):
        return "", text
    end = text.find("\n---", 4)
    if end == -1:
        return "", text
    after = text.find("\n", end + 4)
    return text[4:end], "" if after == -1 else text[after + 1:]


def sources_entries(head: str) -> list[str]:
    """The sources: list. The vault writes it as one inline JSON array."""
    for line in head.splitlines():
        if line.startswith("sources:"):
            value = line[len("sources:"):].strip()
            if not value:
                return []
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return [value]
            return [str(item) for item in parsed] if isinstance(parsed, list) else [str(parsed)]
    return []


def target_of(entry: str) -> tuple[str, str]:
    link = LINK.search(entry)
    if link:
        return ("name", link.group(1).strip())
    url = URL.search(entry)
    if url:
        return ("url", url.group(0))
    return ("text", entry.strip())


def facts(vault: Path) -> list[Path]:
    return sorted(f for space in SPACES for f in (vault / space).glob("*.md"))


def count(vault: Path) -> dict[str, int]:
    notes = facts(vault)
    edges = tasks = 0

    for note in notes:
        head, body = split_note(note.read_text())
        tasks += sum(1 for line in body.split("\n") if TASK.match(line))

        seen: set[tuple[str, tuple[str, str]]] = set()
        for name in LINK.findall(body):
            seen.add(("links_to", ("name", name.strip())))
        for entry in sources_entries(head):
            if entry != "":
                seen.add(("derived_from", target_of(entry)))
        edges += sum(1 for _, target in seen if target != ("name", note.stem))

    return {
        "facts": len(notes),
        "sources": len(list((vault / "sources").rglob("*.md"))),
        "tasks": tasks,
        "questions": questions(vault),
        "edges": edges,
    }


def questions(vault: Path) -> int:
    index = vault / "index.md"
    if not index.exists():
        return 0
    rows = 0
    inside = past_separator = False
    for line in index.read_text().split("\n"):
        if line.startswith("## "):
            inside = line.strip() == "## Questions for you"
            past_separator = False
            continue
        if not inside or not line.startswith("|"):
            continue
        if re.fullmatch(r"\|[\s\-:|]+\|?", line.strip()):
            past_separator = True
        elif past_separator:
            rows += 1
    return rows


NOTE = (
    "---\ntype: reference\ntitle: A\ndescription: d\nspace: shared\n"
    "status: stable\ngenerated: 2026-08-23\ngenerated_by: human:shane\n"
    "sources: {sources}\n---\n\n{body}\n"
)


def selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp)
        for space in SPACES:
            (vault / space).mkdir()
        (vault / "sources" / "collibra").mkdir(parents=True)

        def write(where: str, sources: list[str], body: str) -> None:
            (vault / where).write_text(NOTE.format(sources=json.dumps(sources), body=body))

        empty = count(vault)
        assert empty == {"facts": 0, "sources": 0, "tasks": 0, "questions": 0, "edges": 0}, empty

        # Two links to one note are one edge, and a sources: entry naming the
        # same note is a second edge because its kind differs.
        write("shared/a.md", ["[[b]], said on a call"], "See [[b]] and [[b|the other]].")
        write("koinon/b.md", [], "Nothing.")
        assert count(vault)["edges"] == 2, count(vault)

        # A URL and plain text are targets too, and two identical prose
        # citations are one edge, not two.
        write("koinon/b.md", ["https://example.com/x", "Shane, 1 May", "Shane, 1 May"], "")
        assert count(vault)["edges"] == 4, count(vault)

        # A fact never links to itself.
        write("koinon/b.md", [], "Back to [[b]].")
        assert count(vault)["edges"] == 2, count(vault)

        # A link in the frontmatter is not a links_to edge; only the body is.
        write("koinon/b.md", ["[[a]]"], "")
        assert count(vault)["edges"] == 3, count(vault)

        # Tasks: top level only, ticked or not, and never in the frontmatter.
        write("koinon/b.md", [], "- [ ] one\n- [x] two\n- [X] three\n  - [ ] nested\n* [ ] star")
        assert count(vault)["tasks"] == 3, count(vault)

        # Sources count at any depth, and a note nested in a space is not a fact.
        (vault / "sources" / "collibra" / "t.md").write_text("raw\n")
        (vault / "sources" / "top.md").write_text("raw\n")
        (vault / "koinon" / "deeper").mkdir()
        (vault / "koinon" / "deeper" / "c.md").write_text("x")
        got = count(vault)
        assert got["sources"] == 2 and got["facts"] == 2, got

        # Questions: the rows under the one heading, not the header, not the
        # separator, and not another table's rows.
        (vault / "index.md").write_text(
            "# Memory\n\n## Questions for you\n\n| Note | Question |\n| --- | --- |\n"
            "| [[a]] | Why? |\n| [[b]] | Who? |\n\n## Decisions\n\n"
            "| Note | Proposal |\n|---|---|\n| [[a]] | Merge |\n"
        )
        assert count(vault)["questions"] == 2, count(vault)

    print("selftest ok")


def main() -> int:
    if "--selftest" in sys.argv:
        selftest()
        return 0
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    vault = Path(args[0]) if args else Path.home() / "Development/obsidian_vaults/Memory"
    print(json.dumps(count(vault), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
