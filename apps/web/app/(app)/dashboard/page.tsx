import { Suspense } from "react";

import { Briefing } from "@/components/dashboard/briefing";
import { Skeleton } from "@/components/ui/skeleton";

// Briefing reads ?state= to force a region state, and useSearchParams needs a
// boundary here or the whole route opts out of prerendering.
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <Briefing />
    </Suspense>
  );
}
