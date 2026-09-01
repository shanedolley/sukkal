"use client";

// The face the assistant wears while it is being set up.
//
// Drawn rather than fetched. A picture file would be one more thing to host,
// to theme and to keep at the right size, and this is a few gradients: a lit
// side, a shaded side, a rim where the light wraps, and a soft shadow under
// it. Those four are what make a flat shape read as a solid one.
//
// It takes the accent colour, so a person who sets their own menu colour in
// Preferences gets an assistant to match rather than a mascot in somebody
// else's brand.
//
// Two crops. "full" is head and shoulders, for the screen that asks what to
// call it. "face" is the head alone, for the wait, where it sits beside a
// line of speech and a smaller mark reads as an avatar rather than a picture.

import { useId } from "react";

import { cn } from "@/lib/utils";

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
  const visor = `kpa-visor-${own}`;
  const gloss = `kpa-gloss-${own}`;
  const soft = `kpa-soft-${own}`;

  return (
    <svg
      // The face crop is square and holds the whole head, aerial included.
      // Cutting the aerial in half reads as a mistake rather than a crop.
      viewBox={face ? "10 0 100 100" : "0 0 120 132"}
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

        <linearGradient id={visor} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="color-mix(in oklab, var(--primary) 22%, black)"
          />
          <stop
            offset="100%"
            stopColor="color-mix(in oklab, var(--primary) 40%, black)"
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
        @keyframes kpa-blink { 0%, 92%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.08); } }
        @keyframes kpa-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
        @keyframes kpa-ping { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        .kpa-eye { transform-box: fill-box; transform-origin: center; animation: kpa-blink 5.2s infinite; }
        .kpa-eye-right { animation-delay: 0.06s; }
        .kpa-body { animation: kpa-float 4.5s ease-in-out infinite; }
        .kpa-lamp { animation: kpa-ping 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .kpa-eye, .kpa-body, .kpa-lamp { animation: none; }
        }
      `}</style>

      {/* What it stands on. Without a shadow it floats in a void. */}
      <ellipse
        cx="60"
        cy={face ? 96 : 124}
        rx={face ? 26 : 34}
        ry="5"
        fill="black"
        opacity="0.18"
        filter={`url(#${soft})`}
      />

      <g className={busy ? undefined : "kpa-body"}>
        {/* Shoulders, on the full crop only. The head sits on something. */}
        {!face && (
          <>
            <path
              d="M27 124c0-18 14.8-30 33-30s33 12 33 30z"
              fill={`url(#${shell})`}
            />
            <path
              d="M27 124c0-18 14.8-30 33-30s33 12 33 30z"
              fill="none"
              stroke="white"
              strokeOpacity="0.22"
              strokeWidth="1.5"
            />
          </>
        )}

        {/* The aerial, and the lamp that says it is thinking. */}
        <path
          d="M60 18v-9"
          stroke="color-mix(in oklab, var(--primary) 55%, black)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="60"
          cy="7"
          r="4.5"
          fill="color-mix(in oklab, var(--primary) 45%, white)"
          className={busy ? "kpa-lamp" : undefined}
        />

        <g>
          <ellipse cx="60" cy="56" rx="42" ry="39" fill={`url(#${shell})`} />
          {/* The rim where the light wraps around the edge. */}
          <ellipse
            cx="60"
            cy="56"
            rx="42"
            ry="39"
            fill="none"
            stroke="white"
            strokeOpacity="0.26"
            strokeWidth="1.5"
          />
          {/* The shine across the top, which is what says "solid". */}
          <ellipse cx="60" cy="34" rx="30" ry="15" fill={`url(#${gloss})`} />

          {/* Ears, so the head has a front and a back. */}
          <rect
            x="12"
            y="48"
            width="8"
            height="18"
            rx="4"
            fill="color-mix(in oklab, var(--primary) 55%, black)"
          />
          <rect
            x="100"
            y="48"
            width="8"
            height="18"
            rx="4"
            fill="color-mix(in oklab, var(--primary) 55%, black)"
          />

          <rect
            x="26"
            y="38"
            width="68"
            height="40"
            rx="19"
            fill={`url(#${visor})`}
          />

          <g fill="color-mix(in oklab, var(--primary) 30%, white)">
            <ellipse className="kpa-eye" cx="47" cy="55" rx="6" ry="7.5" />
            <ellipse
              className="kpa-eye kpa-eye-right"
              cx="73"
              cy="55"
              rx="6"
              ry="7.5"
            />
          </g>
          {/* A short arc, well clear of the eyes. A wide grin reads as a
              cartoon; this reads as pleased to see you. */}
          <path
            d="M52 68q8 6 16 0"
            fill="none"
            stroke="color-mix(in oklab, var(--primary) 30%, white)"
            strokeOpacity="0.85"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
