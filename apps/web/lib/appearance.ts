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

export const ACCENT_KEY = "kpa.accent";
export const CHARTS_KEY = "kpa.charts";

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

export function applyAppearance(
  root: HTMLElement,
  accentId: string,
  chartsId: string,
  isDark: boolean
) {
  for (const key of ALL_KEYS) root.style.removeProperty(key);

  const chosen = [
    ACCENTS.find((p) => p.id === accentId),
    CHART_PALETTES.find((p) => p.id === chartsId),
  ];

  for (const preset of chosen) {
    const tokens = isDark ? preset?.dark : preset?.light;
    if (!tokens) continue;
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value);
    }
  }
}
