import { ResetForm } from "@/components/auth/reset-form";

/**
 * Where a reset link lands. The token is in the address, so this reads it and
 * hands it down.
 *
 * It is a Server Component for the reason `sign-in/page.tsx` gives:
 * `useSearchParams` in the form would need a Suspense boundary, and Next's
 * documentation says a static page without one fails the production build.
 */
export default async function ResetPage(props: PageProps<"/reset">) {
  const { token } = await props.searchParams;
  return <ResetForm token={typeof token === "string" ? token : null} />;
}
