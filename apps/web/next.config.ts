import type { NextConfig } from "next";

/**
 * What every response carries, whatever served it.
 *
 * `Referrer-Policy` is the one header here, and KPA-103 is why. A URL reaches
 * more places than the browser that asked for it, and the `Referer` header is
 * the one nobody sees: a page that loads anything from another origin hands
 * that origin the address of the page it was loaded from. The address of a
 * screen is not always harmless. This is the header that stops it leaving.
 *
 * `same-origin` RATHER THAN `no-referrer`, AND THE DIFFERENCE IS THE `Origin`
 * HEADER. Both send no `Referer` to another origin, which is the whole of the
 * leak. `no-referrer` also sets `Origin` to `null` on an HTML form submission
 * and on a `fetch` in `same-origin` or `no-cors` mode, which would quietly
 * defeat a CSRF check that reads it. Sukkal reads no such header today and may,
 * so the stronger-sounding value is the one that buys nothing and costs a
 * future decision.
 *
 * Within this installation the whole address still travels, which loses
 * nothing: the browser already holds it.
 *
 * THIS IS NOT THE HEADER THAT FIXED THE LEAK. The address came out of the URL
 * in the same story, because a URL reaches browser history and every access
 * log on the way whatever a header says. This closes the fourth path rather
 * than the first three.
 */
const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "same-origin" }],
      },
    ]);
  },
};

export default nextConfig;
