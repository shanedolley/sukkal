// The auth pages sit outside the app shell: there is no navigation to show
// until someone is through the door.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6">
      {children}
    </main>
  );
}
