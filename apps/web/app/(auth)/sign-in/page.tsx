import { SignInForm } from "@/components/auth/sign-in-form";

/**
 * The gate. `proxy.ts` sends a signed-out browser here and puts where it was
 * going in `next`, so this reads that parameter and hands it down.
 *
 * It is a Server Component for that one reason. `useSearchParams` in the form
 * would need a Suspense boundary around it, and Next's documentation says a
 * static page without one fails the production build.
 */
export default async function SignInPage(props: PageProps<"/sign-in">) {
  const { next } = await props.searchParams;
  return <SignInForm next={typeof next === "string" ? next : null} />;
}
