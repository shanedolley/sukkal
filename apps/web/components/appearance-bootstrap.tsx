// Paints the saved menu and chart colours before React runs.
//
// Without this the page renders in the default green, then swaps to the saved
// colour once the provider mounts, and every load flashes. The same problem
// next-themes solves the same way.
//
// It goes through next/script with beforeInteractive rather than a bare
// <script> element. React does not execute a script tag rendered by a
// component and warns about it; this is the supported way to run something
// ahead of hydration.
//
// This is the one place the codebase sets HTML directly. The string is
// authored here and the only data in it is JSON.stringify of the presets in
// lib/appearance.ts, which are constants in this repository. Nothing a user
// or an ingested source can reach it, so there is no injection surface: the
// script reads localStorage itself rather than having a value interpolated.

import Script from "next/script";

import { ACCENTS, ACCENT_KEY, CHARTS_KEY, CHART_PALETTES } from "@/lib/appearance";

const PRESETS = JSON.stringify([...ACCENTS, ...CHART_PALETTES]);

const SCRIPT = `(function(){try{
var root=document.documentElement;
var accent=localStorage.getItem(${JSON.stringify(ACCENT_KEY)});
var charts=localStorage.getItem(${JSON.stringify(CHARTS_KEY)});
var theme=localStorage.getItem('theme')||'system';
var dark=theme==='dark'||(theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var presets=${PRESETS};
[accent,charts].forEach(function(id){
  if(!id)return;
  var preset=presets.filter(function(p){return p.id===id})[0];
  var tokens=preset&&(dark?preset.dark:preset.light);
  if(!tokens)return;
  Object.keys(tokens).forEach(function(key){root.style.setProperty(key,tokens[key])});
});
}catch(e){}})();`;

export function AppearanceBootstrap() {
  return (
    // The lint rule below targets the Pages Router, where beforeInteractive
    // belonged in _document. In the App Router this is the documented place
    // for it: a script the whole site needs, in the root layout.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script
      id="kpa-appearance"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
