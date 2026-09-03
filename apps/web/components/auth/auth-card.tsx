// The frame every door into the application shares: the mark, the two lines
// that say where you are, the card, and the line under it that leads on.
//
// Sign in and forget your password are two questions asked in one shape. The
// shape lives here, or the two drift apart the day one of them is touched.
// KPA-79 adds the third, where a reset token sets a new password.
//
// THE PROTOTYPE NOTICE IS GONE, and KPA-128 is why. It read that Cloudflare
// Access and WorkOS authenticate before the application sees the request, so
// this screen never appears in production. ADR-0023 refused that: KPA reads no
// identity header on any installation, so this card is the only gate there is.

import { AuthLogo } from "@/components/blocks/auth-20/components/auth-logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function AuthCard({
  title,
  lead,
  footer,
  children,
}: {
  title: string;
  lead: string;
  /** The line under the card, which leads to the door you did not take. */
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-[26rem] flex-col gap-5">
      <Card className="w-full gap-0 overflow-hidden p-0 shadow-sm">
        <CardHeader className="flex flex-col items-center gap-4 px-6 pt-8 pb-0 text-center sm:px-8 sm:pt-9">
          <AuthLogo />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold text-balance">{title}</h1>
            <p className="text-muted-foreground text-sm text-pretty">{lead}</p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 px-6 pt-6 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
          {children}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-sm">{footer}</p>
    </div>
  );
}
