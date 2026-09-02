"use client";

// The search palette, and the Cmd+K that opens it.
//
// Two ways out of the box. Pick a result and it opens where it already lives:
// a fact or a Needs you row in the detail panel, a meeting on its own page.
// Or press Tab and the question goes to chat, because a question the memory
// has no row for is exactly the case chat exists to answer.
//
// Tab is the right key for that. It is the one key a text field does not
// already use, it reads as "carry on with what I typed", and it leaves Enter
// to mean what Enter means everywhere else in a list.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  MessagesSquareIcon,
  ScrollTextIcon,
  SparklesIcon,
} from "lucide-react";

import { useDetailPanel } from "@/components/detail-panel";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { MEETINGS, SOURCES } from "@/lib/fixtures";
import { useNeedsYou } from "@/lib/needs-you-context";
import { formatDay } from "@/lib/format";
import { useReview } from "@/lib/review-context";
import { inSpace, useSpace } from "@/lib/space-context";

interface SearchValue {
  open: () => void;
  toggle: () => void;
}

const SearchContext = createContext<SearchValue | null>(null);

export function useSearch(): SearchValue {
  const value = useContext(SearchContext);
  if (!value) {
    throw new Error("useSearch must be used inside SearchProvider");
  }
  return value;
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { space } = useSpace();
  const { facts } = useReview();
  const { open: openPanel } = useDetailPanel();

  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  const value = useMemo(() => ({ open, toggle }), [open, toggle]);

  function close() {
    setIsOpen(false);
    setQuery("");
  }

  function askAi() {
    const asked = query.trim();
    if (!asked) return;
    close();
    router.push(`/chat?q=${encodeURIComponent(asked)}`);
  }

  // The palette searches what the memory holds, narrowed by the same space
  // filter as everything else.
  const matchingFacts = inSpace(facts, space).filter((f) =>
    f.state === "proposed" || f.state === "stale" || f.state === "verified"
  );
  // Already narrowed by space, in SQL. See lib/needs-you.ts.
  const { items: needsYou } = useNeedsYou();
  const meetings = inSpace(MEETINGS, space);
  const sources = inSpace(SOURCES, space);

  return (
    <SearchContext value={value}>
      {children}

      <CommandDialog
        open={isOpen}
        onOpenChange={(next) => (next ? setIsOpen(true) : close())}
        title="Search"
        description="Search your memory, or press Tab to ask a question."
        className="overflow-hidden p-0"
      >
        <Command
          // cmdk filters on the text of each item, which is what we want here.
          className="**:data-[selected=true]:bg-muted **:data-selected:bg-transparent"
        >
          <CommandInput
            placeholder="Search facts, meetings and mail, or ask a question..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === "Tab" && query.trim()) {
                event.preventDefault();
                askAi();
              }
            }}
          />

          <CommandList className="max-h-[22rem]">
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <SparklesIcon
                  className="text-muted-foreground size-5"
                  aria-hidden="true"
                />
                <p className="text-sm">Nothing in the memory matches that.</p>
                <p className="text-muted-foreground text-xs">
                  Press Tab to ask it as a question instead.
                </p>
              </div>
            </CommandEmpty>

            {query.trim() && (
              <CommandGroup heading="Ask">
                <CommandItem
                  value={`ask ${query}`}
                  onSelect={askAi}
                  className="gap-2"
                >
                  <SparklesIcon aria-hidden="true" />
                  <span className="truncate">
                    Ask AI: &ldquo;{query.trim()}&rdquo;
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Needs you">
              {needsYou.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.title} ${item.detail} ${item.entity ?? ""}`}
                  onSelect={() => {
                    close();
                    openPanel({ kind: "needsYou", itemId: item.id });
                  }}
                >
                  <ScrollTextIcon aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                  {item.entity && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                      {item.entity}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Facts">
              {matchingFacts.map((fact) => (
                <CommandItem
                  key={fact.id}
                  value={`${fact.statement} ${fact.entity}`}
                  onSelect={() => {
                    close();
                    openPanel({ kind: "fact", factId: fact.id });
                  }}
                >
                  <FileTextIcon aria-hidden="true" />
                  <span className="truncate">{fact.statement}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {fact.entity}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Meetings today">
              {meetings.map((meeting) => (
                <CommandItem
                  key={meeting.id}
                  value={`${meeting.title} ${meeting.engagement}`}
                  onSelect={() => {
                    close();
                    router.push("/meetings");
                  }}
                >
                  <CalendarIcon aria-hidden="true" />
                  <span className="truncate">{meeting.title}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {meeting.engagement}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Sources">
              {sources.map((source) => (
                <CommandItem
                  key={source.id}
                  value={`${source.title} ${source.author}`}
                  onSelect={() => {
                    close();
                    openPanel({ kind: "source", sourceId: source.id });
                  }}
                >
                  <MessagesSquareIcon aria-hidden="true" />
                  <span className="truncate">{source.title}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {formatDay(source.date)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          {/* The hint appears once there is something to ask. An empty box has
              nothing to carry into a chat, so the offer would be noise. */}
          <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeftIcon className="size-3" aria-hidden="true" />
              </Kbd>
              Open
            </span>
            {query.trim() ? (
              <span className="text-foreground inline-flex items-center gap-1.5">
                <Kbd>Tab</Kbd>
                <SparklesIcon className="size-3" aria-hidden="true" />
                Ask AI
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Tab</Kbd>
                Ask AI
              </span>
            )}
          </div>
        </Command>
      </CommandDialog>
    </SearchContext>
  );
}
