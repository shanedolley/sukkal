// Paints the saved menu and chart colours before React runs.
//
// Without this the page renders in the default green, then swaps to the saved
// colour once the provider mounts, and every load flashes. The same problem
// next-themes solves the same way.
//
// It applies tokens rather than resolving them. The provider writes the fully
// resolved light and dark sets to one key whenever the selection changes, so
// this script needs no preset table and no colour conversion. That matters: a
// custom colour is computed in TypeScript, and a copy of that maths inlined
// here would be a second implementation to keep in step.
//
// It goes through next/script with beforeInteractive rather than a bare
// <script>. React does not execute a script tag rendered by a component and
// warns about it; this is the supported way to run something before
// hydration.
//
// This is the one place the codebase sets HTML directly. The string is
// authored here and nothing is interpolated into it but a constant key name.
// The script reads localStorage itself, so no value from a user or an
// ingested source can reach it.

import Script from "next/script";

import { RESOLVED_KEY } from "@/lib/appearance";

const SCRIPT = `(function(){try{
var saved=localStorage.getItem(${JSON.stringify(RESOLVED_KEY)});
if(!saved)return;
var theme=localStorage.getItem('theme')||'system';
var dark=theme==='dark'||(theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var tokens=JSON.parse(saved)[dark?'dark':'light'];
if(!tokens)return;
var root=document.documentElement;
Object.keys(tokens).forEach(function(key){root.style.setProperty(key,tokens[key])});
}catch(e){}})();`;

export function AppearanceBootstrap() {
  return (
    // beforeInteractive belonged in _document under the Pages Router. Under
    // the App Router the root layout is the documented place for a script the
    // whole site needs. .oxlintrc.json turns the rule off for this file.
    <Script
      id="kpa-appearance"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
