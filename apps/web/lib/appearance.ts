// Menu and chart colours, changed at runtime rather than at build time.
//
// Everything visual already runs through CSS custom properties, so a change
// here is a handful of properties set on the root element. Nothing recompiles
// and nothing needs a deploy.
//
// Every preset states its light and its dark values rather than one colour
// for both. The two grounds need different lightness to keep text on the
// accent readable, and a single hex that looks right on white is usually too
// dark on near-black. The default preset sets nothing at all: it removes the
// properties so the stylesheet's own theme-aware values govern, which is the
// only way to be certain the default is exactly what it was.

export type Tokens = Record<string, string>;

// ── sRGB hex to OKLCh ────────────────────────────────────────────────────
//
// Thirty lines rather than a colour library, because this is the only
// conversion the app needs and the matrices are fixed. The hue is what we
// keep: see the note on `accent` below for why the lightness is not.

const srgbToLinear = (channel: number) =>
  channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = srgbToLinear(((value >> 16) & 255) / 255);
  const g = srgbToLinear(((value >> 8) & 255) / 255);
  const b = srgbToLinear((value & 255) / 255);

  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;

  const c = Math.hypot(a, bb);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l, c, h: h < 0 ? h + 360 : h };
}

export interface Preset {
  id: string;
  label: string;
  /** The colour shown on the picker itself. */
  swatch: string;
  /** Null on the default: remove the overrides and let the stylesheet win. */
  light: Tokens | null;
  dark: Tokens | null;
}

// Lightness and chroma are held at the values the base-mira preset already
// uses, and only the hue moves. Contrast against the ground and against the
// foreground therefore holds for every option by construction, rather than by
// checking six palettes by hand.
const accent = (hue: number, chroma = 0.154) => ({
  light: {
    "--primary": `oklch(0.527 ${chroma} ${hue})`,
    "--sidebar-primary": `oklch(0.627 ${chroma * 1.26} ${hue})`,
  },
  dark: {
    "--primary": `oklch(0.448 ${chroma * 0.77} ${hue})`,
    "--sidebar-primary": `oklch(0.527 ${chroma} ${hue})`,
  },
});

export const ACCENTS: Preset[] = [
  {
    id: "green",
    label: "Green",
    swatch: "oklch(0.527 0.154 150)",
    light: null,
    dark: null,
  },
  { id: "blue", label: "Blue", swatch: "oklch(0.527 0.154 250)", ...accent(250) },
  {
    id: "violet",
    label: "Violet",
    swatch: "oklch(0.527 0.154 295)",
    ...accent(295),
  },
  { id: "rose", label: "Rose", swatch: "oklch(0.527 0.154 15)", ...accent(15) },
  {
    id: "amber",
    label: "Amber",
    swatch: "oklch(0.527 0.154 70)",
    ...accent(70),
  },
  {
    id: "slate",
    label: "Slate",
    swatch: "oklch(0.527 0.03 250)",
    ...accent(250, 0.03),
  },
];

const chartTokens = (colours: string[]): Tokens =>
  Object.fromEntries(colours.map((value, index) => [`--chart-${index + 1}`, value]));

/** A ramp of one hue: right for a single series, or for an ordered scale. */
const ramp = (hue: number) =>
  chartTokens([
    `oklch(0.871 0.150 ${hue})`,
    `oklch(0.723 0.219 ${hue})`,
    `oklch(0.627 0.194 ${hue})`,
    `oklch(0.527 0.154 ${hue})`,
    `oklch(0.448 0.119 ${hue})`,
  ]);

/**
 * Distinct hues at one lightness. Categories have no order, so a ramp implies
 * a ranking that is not there; separate hues do not.
 */
const categorical = (hues: number[], lightness: number) =>
  chartTokens(hues.map((hue) => `oklch(${lightness} 0.16 ${hue})`));

export const CHART_PALETTES: Preset[] = [
  {
    id: "greens",
    label: "Greens",
    swatch: "oklch(0.627 0.194 149)",
    light: null,
    dark: null,
  },
  {
    id: "categorical",
    label: "Distinct",
    swatch: "oklch(0.65 0.16 250)",
    light: categorical([250, 150, 295, 40, 15], 0.6),
    dark: categorical([250, 150, 295, 40, 15], 0.72),
  },
  {
    id: "ocean",
    label: "Ocean",
    swatch: "oklch(0.627 0.194 230)",
    light: ramp(230),
    dark: ramp(230),
  },
  {
    id: "warm",
    label: "Warm",
    swatch: "oklch(0.627 0.194 50)",
    light: ramp(50),
    dark: ramp(50),
  },
];

/**
 * A colour of your own.
 *
 * The hue and the chroma come from what you picked. The lightness does not:
 * it stays at the two values the theme already uses, so white text on the
 * accent keeps its contrast whatever you choose. A picker that let you make
 * the buttons unreadable would be a worse tool, not a freer one, so the
 * swatch shows the colour that will actually be used.
 */
export function customAccent(hex: string): Preset {
  const { c, h } = hexToOklch(hex);
  // Past about 0.2 the colour leaves the sRGB gamut at these lightnesses and
  // the browser clips it, which looks like the picker ignoring you.
  const chroma = Math.min(c, 0.19);
  return {
    id: "custom",
    label: "Custom",
    swatch: `oklch(0.527 ${chroma} ${h})`,
    ...accent(h, chroma),
  };
}

/** A ramp built from one chosen hue. */
export function customChart(hex: string): Preset {
  const { h } = hexToOklch(hex);
  return {
    id: "custom",
    label: "Custom",
    swatch: `oklch(0.627 0.194 ${h})`,
    light: ramp(h),
    dark: ramp(h),
  };
}

/**
 * The resolved tokens for the current selection, written by the provider and
 * read by the bootstrap script. One key so the script needs no preset table
 * and no colour maths of its own.
 *
 * The last key here. ADR-0022 moved the four the selection is made of to the
 * server, because an accent is a person's taste and should follow them to a
 * second device. This one stays, because the bootstrap script reads it before
 * React runs and a theme read from the network flashes. It is a cache of a
 * decision held elsewhere rather than the decision itself.
 *
 * KPA-155 RENAMED IT AND CARRIED NOTHING FORWARD, because a cache is the one
 * thing worth losing. A browser holding the `kpa.` name paints the
 * stylesheet's green once on the first load after the rename, and the provider
 * corrects it, which is the same single wrong paint a second device already
 * takes. Carrying it would cost a second `getItem` inside the inline script
 * KPA-148 is about to put under a Content-Security-Policy, to buy one paint.
 */
export const RESOLVED_KEY = "sukkal.appearance";

/** Every property any preset can set, so a change clears the last one. */
const ALL_KEYS = [
  "--primary",
  "--sidebar-primary",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];

export interface Selection {
  accentId: string;
  chartsId: string;
  accentHex: string;
  chartsHex: string;
}

/** The green the stylesheet already paints, and the hex behind it. What a box
 *  shows before anybody opens the settings screen. */
export const DEFAULT_HEX = "#0d6b45";

export const DEFAULT_SELECTION: Selection = {
  accentId: "green",
  chartsId: "greens",
  accentHex: DEFAULT_HEX,
  chartsHex: DEFAULT_HEX,
};

/** Six hex digits with a leading hash, which is what a colour input gives. */
const isHex = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const isPresetId = (presets: Preset[], id: unknown) =>
  typeof id === "string" &&
  (id === "custom" || presets.some((preset) => preset.id === id));

/**
 * Whether something is a selection this build can paint.
 *
 * Two callers, and both read a value this code did not write. The route reads
 * a request body, and the provider reads what the route answered. A preset id
 * this build no longer offers therefore reads as no selection at all, and the
 * caller falls back to the default rather than painting nothing.
 */
export function isSelection(value: unknown): value is Selection {
  if (value === null || typeof value !== "object") return false;
  const read = value as Record<string, unknown>;
  return (
    isPresetId(ACCENTS, read["accentId"]) &&
    isPresetId(CHART_PALETTES, read["chartsId"]) &&
    isHex(read["accentHex"]) &&
    isHex(read["chartsHex"])
  );
}

/** Everything a selection sets, in both themes. */
export function resolveAppearance(selection: Selection): {
  light: Tokens;
  dark: Tokens;
} {
  const chosen = [
    selection.accentId === "custom"
      ? customAccent(selection.accentHex)
      : ACCENTS.find((p) => p.id === selection.accentId),
    selection.chartsId === "custom"
      ? customChart(selection.chartsHex)
      : CHART_PALETTES.find((p) => p.id === selection.chartsId),
  ];

  const light: Tokens = {};
  const dark: Tokens = {};
  for (const preset of chosen) {
    Object.assign(light, preset?.light ?? {});
    Object.assign(dark, preset?.dark ?? {});
  }
  return { light, dark };
}

/**
 * What `applyAppearance` writes to.
 *
 * `HTMLElement` in all but name, and named structurally so this module needs
 * no DOM. `lib/owner.ts` imports the validator above and runs on the server,
 * where `HTMLElement` is a type nothing declares.
 */
export interface StyleTarget {
  style: {
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  };
}

export function applyAppearance(
  root: StyleTarget,
  selection: Selection,
  isDark: boolean
) {
  // Cleared first, so switching away from a preset drops what it set rather
  // than leaving half of the last one behind.
  for (const key of ALL_KEYS) root.style.removeProperty(key);

  const resolved = resolveAppearance(selection);
  for (const [key, value] of Object.entries(isDark ? resolved.dark : resolved.light)) {
    root.style.setProperty(key, value);
  }
}
