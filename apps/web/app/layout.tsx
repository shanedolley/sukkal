import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppearanceBootstrap } from "@/components/appearance-bootstrap";
import { NONCE_HEADER } from "@/lib/csp";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// NOTHING IS PRERENDERED, AND THIS IS THE ONE LINE THAT DOES IT. A nonce is
// minted per request and injected during server rendering, so a prerendered
// page carries none and its own scripts are refused: the build stays green and
// the page comes up blank. ADR-0025 measured the cost at seven to nine
// milliseconds a load on this box and took it.
//
// The `headers()` read below forces dynamic rendering on its own. This line
// stays because it says so out loud, where a reader looking for why a page is
// dynamic will look.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sukkal",
  description: "Sukkal, Koinon's personal assistant",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The nonce `proxy.ts` minted for this request. Next puts it on every script
  // it emits by itself; these two are the ones it did not write, so they are
  // handed it here. A null nonce means no proxy ran, which is a broken
  // deployment rather than a case to render around.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html
      lang="en"
      // suppressHydrationWarning: next-themes writes the class on the html
      // element before React hydrates, so the server and client markup differ
      // by design on this one attribute.
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body className="min-h-full">
        <AppearanceBootstrap nonce={nonce} />
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
