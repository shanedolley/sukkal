// The frame every door into the application shares: the mark, the two lines
// that say where you are, the card, and the line under it that leads to the
// other door.
//
// Sign in, create an account and forget your password are three questions
// asked in one shape. The shape lives here, or the three drift apart the day
// one of them is touched.

import { AuthLogo } from "@/components/blocks/auth-20/components/auth-logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ShieldCheckIcon } from "lucide-react";

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

      {/* The page exists because Shane asked for it, not because the design
          needs it. Saying so on the screen keeps the prototype honest. */}
      <p className="text-muted-foreground mx-auto flex max-w-[26rem] items-start gap-2 text-center text-xs">
        <ShieldCheckIcon
          className="mt-0.5 size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span className="text-left">
          Prototype only. In production Cloudflare Access and WorkOS AuthKit
          authenticate you before the application sees the request, so this
          screen never appears.
        </span>
      </p>
    </div>
  );
}
