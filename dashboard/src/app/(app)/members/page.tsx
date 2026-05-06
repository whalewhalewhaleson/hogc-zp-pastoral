import { supabase } from "@/lib/supabase";
import Link from "next/link";

const ROLE_ORDER: Record<string, number> = {
  PTL: 0, SCGL: 1, PCGL: 2, POTL: 3, R: 4, GI: 5, I: 6, G: 7, NF: 8,
};

const ROLE_COLORS: Record<string, string> = {
  R: "bg-sky-100 text-sky-700",
  I: "bg-lavender-100 text-lavender-500",
  G: "bg-sage-100 text-sage-500",
  GI: "bg-sky-200 text-sky-600",
  NF: "bg-warm-200 text-warm-500",
};

export default async function MembersPage() {
  const { data: members } = await supabase
    .from("members")
    .select("id, name, role, leader_role, birthday, school, course, year_of_study, active")
    .eq("active", true)
    .order("name");

  const sorted = (members ?? []).sort((a, b) => {
    const aOrder = ROLE_ORDER[a.leader_role ?? a.role] ?? 99;
    const bOrder = ROLE_ORDER[b.leader_role ?? b.role] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });

  const today = new Date();
  const upcomingBirthdays = sorted
    .filter((m) => m.birthday)
    .map((m) => {
      const bday = new Date(m.birthday + "T00:00:00");
      const next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
      if (next < today) next.setFullYear(next.getFullYear() + 1);
      const daysAway = Math.ceil((next.getTime() - today.getTime()) / 86400000);
      return { ...m, daysAway };
    })
    .filter((m) => m.daysAway <= 30)
    .sort((a, b) => a.daysAway - b.daysAway);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 md:text-3xl">
          Members
        </h1>
        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-600">
          {sorted.length} active
        </span>
      </div>

      {/* Upcoming birthdays */}
      {upcomingBirthdays.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Upcoming Birthdays
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {upcomingBirthdays.map((m) => (
              <Link
                key={m.id}
                href={`/members/${m.id}`}
                className="flex shrink-0 flex-col items-center rounded-2xl bg-warm-100 px-5 py-3 transition-colors hover:bg-warm-200 active:bg-warm-200"
              >
                <span className="text-lg">🎂</span>
                <span className="mt-1 text-xs font-semibold text-gray-700">
                  {m.name.split(" ")[0]}
                </span>
                <span className="text-[10px] text-gray-400">
                  {m.daysAway === 0
                    ? "Today!"
                    : m.daysAway === 1
                      ? "Tomorrow"
                      : `in ${m.daysAway}d`}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Mobile: card list / Desktop: table-like */}
      <div className="space-y-2 md:space-y-0">
        {/* Desktop header */}
        <div className="hidden rounded-xl bg-gray-100/50 px-5 py-2.5 md:grid md:grid-cols-12 md:gap-4">
          <span className="col-span-4 text-xs font-semibold text-gray-400">Name</span>
          <span className="col-span-2 text-xs font-semibold text-gray-400">Role</span>
          <span className="col-span-2 text-xs font-semibold text-gray-400">Birthday</span>
          <span className="col-span-2 text-xs font-semibold text-gray-400">School</span>
          <span className="col-span-2 text-xs font-semibold text-gray-400">Course</span>
        </div>

        {sorted.map((m) => (
          <Link
            key={m.id}
            href={`/members/${m.id}`}
            className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm transition-colors hover:bg-warm-50 active:bg-warm-50 md:grid md:grid-cols-12 md:gap-4 md:rounded-xl md:py-3"
          >
            {/* Mobile layout */}
            <div className="md:col-span-4 md:flex md:items-center md:gap-2">
              <span className="text-sm font-semibold text-gray-800">
                {m.name}
              </span>
              {/* Mobile: birthday under name */}
              {m.birthday && (
                <p className="text-[11px] text-gray-400 md:hidden">
                  🎂{" "}
                  {new Date(m.birthday + "T00:00:00").toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              )}
            </div>

            {/* Role badges */}
            <div className="flex items-center gap-1.5 md:col-span-2">
              {m.leader_role && (
                <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {m.leader_role}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  ROLE_COLORS[m.role] ?? "bg-gray-100 text-gray-500"
                }`}
              >
                {m.role}
              </span>
            </div>

            {/* Desktop-only columns */}
            <span className="hidden text-sm text-gray-500 md:col-span-2 md:block">
              {m.birthday
                ? new Date(m.birthday + "T00:00:00").toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                  })
                : "—"}
            </span>
            <span className="hidden text-sm text-gray-500 md:col-span-2 md:block">
              {m.school || "—"}
            </span>
            <span className="hidden text-sm text-gray-500 md:col-span-2 md:block">
              {m.course || "—"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
