/**
 * The gate every request passes before a route sees it.
 *
 * ADR-0023 makes the application the only thing authenticating anybody, on
 * every installation, so this is the guard rather than a convenience in front
 * of one. It denies by default: a path is refused unless `PUBLIC` names it, so
 * a route added next month is protected by having been added rather than by
 * somebody remembering to protect it. `test/routes-are-guarded.test.ts` walks
 * the routes on disk and fails when one is neither guarded nor listed here.
 *
 * IT IS `proxy.ts` AND NOT `middleware.ts`. Next.js 16 deprecated the older
 * name and renamed the convention, and the deprecation notice is in
 * `node_modules/next/dist/docs`. KPA-77's own file list said `middleware.ts`,
 * which was written before that release.
 *
 * PROXY RUNS ON NODE, WHICH IS WHY THE CHECK IS REAL. The same documentation
 * records that Proxy defaults to the Node.js runtime, so this reaches the
 * database and asks whether the session exists. Under the older edge runtime
 * it could only have checked that a cookie was present, which proves nothing:
 * a cookie is what an attacker sends.
 *
 * IT IS NOT THE ONLY CHECK, AND NEXT SAYS WHY. The same page warns that a
 * matcher change or a moved Server Function can silently remove coverage, and
 * tells you to verify inside the handler rather than relying on Proxy alone.
 * So `requireOwner` in `lib/session.ts` is what a route calls, and this is the
 * outer gate. Two checks, and neither assumes the other held, which is the
 * shape ADR-0023 chose for Access and for the same reason.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { COOKIE } from '../../src/auth/session.ts';
import { isPublic } from './lib/public-paths.ts';
import { sessionFor } from './lib/session.ts';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();

  const session = await sessionFor(request.cookies.get(COOKIE)?.value);
  if (session) return NextResponse.next();

  // An API caller gets a status it can read. A browser gets the page that
  // lets it fix the problem, and `next` carries where it was going, so
  // signing in lands somebody back where they meant to be.
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const signIn = new URL('/sign-in', request.url);
  signIn.searchParams.set('next', path);
  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Everything but the assets, which is what the negative match says.
   *
   * The Next documentation warns that a Proxy with no matcher runs on every
   * request including `_next/static` and `public/`, and that auth logic there
   * blocks the stylesheet. This excludes those and nothing else: a route is
   * matched by not being an asset, rather than by appearing on a list.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js|woff2?)$).*)'],
};
