"use client";

// KPA-42. The brief requires citations that open. This is what they open into.
//
// It reads and never writes: ingestion stores a source verbatim and nothing
// edits one afterwards, so there is no edit control and no delete control.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CalendarIcon, FileTextIcon, MailIcon, MessagesSquareIcon, UsersIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SOURCES } from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import { SPACE_LABELS, type SourceKind } from "@/lib/types";

interface OpenTarget {
  sourceId: string;
  chunkId?: string;
}

interface SourceDrawerValue {
  open: (target: OpenTarget) => void;
}

const SourceDrawerContext = createContext<SourceDrawerValue | null>(null);

export function useSourceDrawer(): SourceDrawerValue {
  const value = useContext(SourceDrawerContext);
  if (!value) {
    throw new Error("useSourceDrawer must be used inside SourceDrawerProvider");
  }
  return value;
}

const KIND_ICON: Record<SourceKind, typeof MailIcon> = {
  meeting: UsersIcon,
  mail: MailIcon,
  document: FileTextIcon,
  chat: MessagesSquareIcon,
};

const KIND_LABEL: Record<SourceKind, string> = {
  meeting: "Meeting transcript",
  mail: "Mail",
  document: "Document",
  chat: "Chat",
};

export function SourceDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<OpenTarget | null>(null);

  const open = useCallback((next: OpenTarget) => setTarget(next), []);
  const value = useMemo(() => ({ open }), [open]);

  const source = target
    ? SOURCES.find((s) => s.id === target.sourceId)
    : undefined;
  const Icon = source ? KIND_ICON[source.kind] : FileTextIcon;

  return (
    <SourceDrawerContext value={value}>
      {children}
      <Sheet
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
          {source ? (
            <>
              <SheetHeader className="gap-3 border-b">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" size="sm">
                    <Icon className="size-3" aria-hidden="true" />
                    {KIND_LABEL[source.kind]}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {SPACE_LABELS[source.space]}
                  </Badge>
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <CalendarIcon className="size-3" aria-hidden="true" />
                    {new Date(source.date).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <SheetTitle className="text-left text-base leading-snug">
                  {source.title}
                </SheetTitle>
                <SheetDescription className="text-left">
                  {source.author}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-4">
                <ol className="flex flex-col gap-3">
                  {source.chunks.map((chunk) => {
                    const cited = chunk.id === target?.chunkId;
                    return (
                      <li
                        key={chunk.id}
                        aria-current={cited ? "true" : undefined}
                        className={cn(
                          "rounded-md border p-3 text-sm leading-relaxed",
                          cited
                            ? "border-primary/40 bg-primary/5"
                            : "border-transparent bg-muted/40"
                        )}
                      >
                        {cited && (
                          <span className="text-primary mb-1.5 block text-xs font-medium">
                            Cited passage
                          </span>
                        )}
                        {chunk.text}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="text-muted-foreground border-t p-4 text-xs">
                Sources are stored verbatim and never edited. Corrections are
                made by writing a new fact, not by changing this text.
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </SourceDrawerContext>
  );
}
