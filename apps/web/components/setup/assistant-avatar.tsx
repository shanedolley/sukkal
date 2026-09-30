"use client";

// The face the assistant wears while it is being set up.
//
// It is Isimud, sukkal of Enki: advisor, messenger and doorkeeper, with one
// head and two faces looking opposite ways. He is the exception among sukkals,
// because every other one needs a staff to be identified in art and he does
// not. The two faces also say what this product does: one turned to the person
// served, one to the world reached.
//
// THIS DOES NOT REPRODUCE THE SEAL. It is a reading of a 4,000 year old
// object, drawn from the Adda seal in the British Museum: greenstone, Akkadian
// period, about 2300 BC, where Isimud stands behind Enki at the right of the
// impression. Four things here come from it and the rest is ours: the horned
// crown of tiered horns, the ring at its base, two bearded profiles meeting
// back to back, and the stepped rows of the beard. The proportions are an
// avatar's rather than the seal's, where the head is a sixth of the figure and
// would vanish at this size.
//
// Drawn rather than fetched. A picture file would be one more thing to host,
// to theme and to keep at the right size, and this is four effects: a lit
// side, a shaded side, a rim where the light wraps, and a soft shadow under
// it. Those four are what make a flat shape read as a solid one.
//
// Three of the four are gradients, `shell`, `deep` and `gloss`. The shadow is
// a `filter` running `feGaussianBlur`, because a blur is what a soft edge
// needs and no gradient gives one. KPA-151 called all four gradients, and this
// sentence corrects it rather than the drawing, which was always right.
//
// It takes the accent colour, so a person who sets their own menu colour in
// Preferences gets an assistant to match rather than a mascot in somebody
// else's brand. No colour is fixed for Isimud's sake.
//
// Two crops. "full" is head and shoulders, for the screen that asks what to
// call it. "face" is the head alone, for the wait, where it sits beside a line
// of speech and a smaller mark reads as an avatar rather than a picture. Both
// keep the two faces: the smallest place either is used is `size-16`, which
// Tailwind renders at 64px, and two profiles hold well below that. KPA-151.

import { useId } from "react";

import { cn } from "@/lib/utils";

// One profile facing left: forehead, brow, nose, lip and chin, closed along
// the centre line the two faces share. Drawn once and mirrored about x=60,
// because two hand-drawn halves would disagree by a unit somewhere and read as
// a wobble.
//
// THE SILHOUETTE IS THE IDENTITY. A round skull with a bump on each side reads
// as one head with ears, whatever is drawn inside it. The outline has to run
// forehead, nose, lip, chin and then the same mirrored, or there is only one
// face here. It starts at x=54 rather than at the centre so the two foreheads
// meet across a plateau: two profiles joined at a point make a spearhead.
//
// The nose turns rather than points. A straight wedge at this size is a beak.
const PROFILE =
  "M54 30C46 31 41 37 40 44L38 47Q31 52 35 57L40 59L38 62Q42 66 45 68L60 68L60 30Z";

// The beard, a shape of its own rather than more of the face, and short. A
// long one stops reading as a beard and starts reading as a torso, which turns
// the whole figure into a chess piece.
const BEARD = "M46 62C42 69 42 80 47 86L60 86L60 62Z";

const MIRROR = "translate(120,0) scale(-1,1)";

export function AssistantAvatar({
  variant = "full",
  className,
  /** Still, for a reader who asked their system for less movement. */
  busy = false,
}: {
  variant?: "full" | "face";
  className?: string;
  busy?: boolean;
}) {
  const face = variant === "face";
  // Two of these on one page would otherwise share four ids, and a fill
  // pointing at a duplicate id takes whichever the document reached first.
  const own = useId().replace(/:/g, "");
  const shell = `kpa-shell-${own}`;
  const deep = `kpa-deep-${own}`;
  const gloss = `kpa-gloss-${own}`;
  const soft = `kpa-soft-${own}`;

  return (
    <svg
      // The face crop is square and holds the whole head, crown included.
      // Cutting the crown in half reads as a mistake rather than a crop.
      viewBox={face ? "16 3 88 88" : "0 0 120 132"}
      className={cn("shrink-0", className)}
      role="img"
      aria-label="The assistant"
    >
      <defs>
        {/* Lit from the top left, the way every rounded thing on a desk is. */}
        <radialGradient id={shell} cx="34%" cy="26%" r="82%">
          <stop
            offset="0%"
            stopColor="color-mix(in oklab, var(--primary) 62%, white)"
          />
          <stop offset="55%" stopColor="var(--primary)" />
          <stop
            offset="100%"
            stopColor="color-mix(in oklab, var(--primary) 58%, black)"
          />
        </radialGradient>

        {/* The crown and the beard, which sit behind the lit face and have to
            read as further away. */}
        <linearGradient id={deep} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="color-mix(in oklab, var(--primary) 62%, black)"
          />
          <stop
            offset="100%"
            stopColor="color-mix(in oklab, var(--primary) 46%, black)"
          />
        </linearGradient>

        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.42" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        <filter id={soft} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <style>{`
        @keyframes kpa-blink { 0%, 93%, 100% { transform: scaleY(1); } 96.5% { transform: scaleY(0.1); } }
        @keyframes kpa-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
        @keyframes kpa-ping { 0%, 100% { opacity: 0.22; } 50% { opacity: 0.6; } }
        .kpa-eye { transform-box: fill-box; transform-origin: center; animation: kpa-blink 6.4s infinite; }
        .kpa-eye-back { animation-delay: 3.1s; }
        .kpa-body { animation: kpa-float 4.5s ease-in-out infinite; }
        .kpa-crown { animation: kpa-ping 1.9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .kpa-eye, .kpa-body, .kpa-crown { animation: none; }
        }
      `}</style>

      {/* What it stands on. Without a shadow it floats in a void. */}
      <ellipse
        cx="60"
        cy={face ? 89 : 126}
        rx={face ? 22 : 30}
        ry="5"
        fill="black"
        opacity="0.18"
        filter={`url(#${soft})`}
      />

      <g className={busy ? undefined : "kpa-body"}>
        {/* Shoulders, on the full crop only. The head sits on something, and
            the flounces are the kaunakes every figure on the seal wears. */}
        {!face && (
          <>
            <path
              d="M28 124C28 105 41 84 60 84C79 84 92 105 92 124Z"
              fill={`url(#${shell})`}
            />
            <g
              fill="none"
              stroke="color-mix(in oklab, var(--primary) 40%, black)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M33 105q27 6 54 0" />
              <path d="M30 115q30 6 60 0" />
            </g>
            <path
              d="M28 124C28 105 41 84 60 84C79 84 92 105 92 124Z"
              fill="none"
              stroke="white"
              strokeOpacity="0.2"
              strokeWidth="1.5"
            />
          </>
        )}

        {/* The light behind the crown while it is working. The horned crown is
            what marks a Mesopotamian figure as divine; the light is ours. */}
        {busy && (
          <circle
            className="kpa-crown"
            cx="60"
            cy="26"
            r="26"
            fill="var(--primary)"
            opacity="0.22"
          />
        )}

        {/* The beards, behind the skull so the jaw overlaps them and they
            emerge below it. */}
        <g fill={`url(#${deep})`}>
          <path d={BEARD} />
          <path d={BEARD} transform={MIRROR} />
        </g>

        {/* Two faces, back to back, sharing one skull. */}
        <g fill={`url(#${shell})`}>
          <path d={PROFILE} />
          <path d={PROFILE} transform={MIRROR} />
        </g>

        <g
          fill="none"
          stroke="color-mix(in oklab, var(--primary) 26%, black)"
          strokeOpacity="0.6"
          strokeWidth="1.3"
          strokeLinecap="round"
        >
          {/* The stepped rows a Mesopotamian beard is drawn in. */}
          <path d="M47 74q13 3 26 0" />
          <path d="M47 81q13 3 26 0" />
          {/* Where the two faces meet, which says there are two of them. */}
          <path d="M60 31v54" strokeOpacity="0.35" />
        </g>

        {/* One eye to a face, frontal in a profile head, which is the
            convention the seal itself uses rather than a mistake. They blink
            three seconds apart, so the two faces read as two. */}
        <g fill="color-mix(in oklab, var(--primary) 24%, black)">
          <ellipse className="kpa-eye" cx="45" cy="47" rx="2.9" ry="2.3" />
          <ellipse
            className="kpa-eye kpa-eye-back"
            cx="75"
            cy="47"
            rx="2.9"
            ry="2.3"
          />
        </g>
        <g
          fill="none"
          stroke="color-mix(in oklab, var(--primary) 30%, black)"
          strokeOpacity="0.6"
          strokeWidth="1.3"
          strokeLinecap="round"
        >
          <path d="M41.5 42.5q4 -2 7 0.5" />
          <path d="M78.5 42.5q-4 -2 -7 0.5" />
        </g>

        {/* The horned crown: a peak, three tiers of horns to a side, and the
            cap it all stands on. It stays inside the width of the head,
            because a crown wider than the face reads as a hat brim. */}
        <path d="M57 26L60 7L63 26Z" fill={`url(#${deep})`} />
        <g
          fill="none"
          stroke={`url(#${deep})`}
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M57.5 12Q52 13 48.5 17" />
          <path d="M57.5 17Q51.5 19 47 22" />
          <path d="M57.5 22Q51.5 24 46 26" />
          <path d="M62.5 12Q68 13 71.5 17" />
          <path d="M62.5 17Q68.5 19 73 22" />
          <path d="M62.5 22Q68.5 24 74 26" />
        </g>
        <path
          d="M45 33C45 26 51.5 22.5 60 22.5C68.5 22.5 75 26 75 33Z"
          fill={`url(#${deep})`}
        />
        <path
          d="M45 33C45 26 51.5 22.5 60 22.5C68.5 22.5 75 26 75 33"
          fill="none"
          stroke="white"
          strokeOpacity="0.2"
          strokeWidth="1.2"
        />

        {/* The shine across the brow, which is what says "solid". */}
        <ellipse
          cx="57"
          cy="40"
          rx="12"
          ry="6"
          fill={`url(#${gloss})`}
          opacity="0.5"
        />
      </g>
    </svg>
  );
}
