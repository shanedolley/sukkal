// The hex to OKLCh conversion, checked against known values.
//
// It is thirty lines of fixed matrices standing in for a colour library, so
// it is exactly the kind of code that looks right and is quietly wrong. A
// transposed coefficient would shift every custom colour by a few degrees of
// hue, which nobody would notice by eye and everybody would live with.

import assert from "node:assert/strict";

import { customAccent, hexToOklch } from "../lib/appearance.ts";

const close = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected about ${expected}, got ${actual.toFixed(3)}`
  );

// Reference values from the Oklab specification's own sRGB primaries.
{
  const red = hexToOklch("#ff0000");
  close(red.l, 0.628, 0.005, "red lightness");
  close(red.c, 0.258, 0.005, "red chroma");
  close(red.h, 29.23, 0.5, "red hue");

  const green = hexToOklch("#00ff00");
  close(green.l, 0.866, 0.005, "green lightness");
  close(green.h, 142.5, 0.5, "green hue");

  const blue = hexToOklch("#0000ff");
  close(blue.l, 0.452, 0.005, "blue lightness");
  close(blue.h, 264.05, 0.5, "blue hue");
}

// White and black are achromatic: any hue is correct, but the chroma is not.
{
  const white = hexToOklch("#ffffff");
  close(white.l, 1, 0.002, "white lightness");
  close(white.c, 0, 0.002, "white chroma");

  const black = hexToOklch("#000000");
  close(black.l, 0, 0.002, "black lightness");
  close(black.c, 0, 0.002, "black chroma");
}

// A leading # is optional, because a colour input supplies one and a pasted
// value often does not.
assert.deepEqual(hexToOklch("#ff0000"), hexToOklch("ff0000"));

// The contrast guarantee: whatever you pick, the lightness is held at the
// theme's own values. This is the promise the picker makes, so it is the one
// worth proving.
for (const hex of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff"]) {
  const preset = customAccent(hex);
  assert.match(
    preset.light!["--primary"],
    /^oklch\(0\.527 /,
    `light primary from ${hex} moved off the theme's lightness`
  );
  assert.match(
    preset.dark!["--primary"],
    /^oklch\(0\.448 /,
    `dark primary from ${hex} moved off the theme's lightness`
  );
}

// Chroma is clamped, or the colour leaves the sRGB gamut and the browser
// clips it, which reads as the picker ignoring you.
{
  const vivid = customAccent("#ff0000");
  const chroma = Number(vivid.light!["--primary"].split(" ")[1]);
  assert.ok(chroma <= 0.19, `chroma ${chroma} was not clamped`);
}

console.log("colour OK: hex to OKLCh matches the reference primaries, and lightness is held");
