"use client";

// The search control at the top of the rail.
//
// It reads as a field rather than a button because that is what it opens, and
// it carries its own shortcut so the shortcut is discoverable without being
// documented anywhere.

import { SearchIcon } from "lucide-react";

import { useSearch } from "@/components/search/search-provider";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useModifierKey } from "@/lib/platform";

export function SearchTrigger() {
  const { open } = useSearch();
  const modifier = useModifierKey();

  return (
    <SidebarGroup className="pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={open}
              tooltip={`Search  ${modifier}K`}
              aria-label="Search"
              aria-keyshortcuts="Meta+K Control+K"
              className="text-muted-foreground border-border/70 bg-background hover:bg-muted h-9 border"
            >
              <SearchIcon aria-hidden="true" />
              <span>Search</span>
              {/* Hidden on the icon rail, where there is no room and the
                  tooltip carries the shortcut instead. */}
              <KbdGroup className="ml-auto in-data-[state=collapsed]:hidden">
                <Kbd>{modifier}</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
