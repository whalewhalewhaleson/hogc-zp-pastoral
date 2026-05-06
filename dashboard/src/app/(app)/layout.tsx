import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <Sidebar name={session.name} />

      {/* Main content */}
      <div className="md:ml-56">
        <main className="mx-auto max-w-3xl px-5 py-6 pb-24 md:px-8 md:py-10 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
