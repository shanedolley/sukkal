import { redirect } from "next/navigation";

// The screen he opens is the briefing. Nothing else belongs at the root.
export default function Home() {
  redirect("/dashboard");
}
