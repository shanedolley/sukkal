// The name a project key stands for.
//
// A key the sidebar knows keeps its label, whether it names a workspace or a
// project inside one. A key added this session, or one typed into the address
// bar, reads back as words.

import { NAMED_ROWS } from "@/components/blocks/app-shell-1/components/data";

export function projectName(key: string): string {
  const known = NAMED_ROWS.find((row) => row.id === key);
  if (known) return known.label;
  return key
    .replace(/(^|-)(.)/g, (_, __, letter) => ` ${letter.toUpperCase()}`)
    .trim();
}
