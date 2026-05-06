import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import Link from "next/link";

const ROLE_LABELS: Record<string, string> = {
  R: "Regular",
  I: "Integration",
  G: "Guest",
  GI: "Good Integration",
  NF: "New Friend",
};

const ROLE_COLORS: Record<string, string> = {
  R: "bg-sky-100 text-sky-700",
  I: "bg-lavender-100 text-lavender-500",
  G: "bg-sage-100 text-sage-500",
  GI: "bg-sky-200 text-sky-600",
  NF: "bg-warm-200 text-warm-500",
};

export default async function DashboardPage() {
  const session = await getSession();

  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, role, leader_role, active")
    .eq("active", true);

  const members = allMembers ?? [];

  const roleCounts: Record<string, number> = {};
  for (const m of members) {
    roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  }
  const leaderCount = members.filter((m) => m.leader_role).length;

  const { data: recentNotes } = await supabase
    .from("updates")
    .select("member_id, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const notedMemberIds = new Set<string>();
  const notedRecently = new Set<string>();
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  for (const n of recentNotes ?? []) {
    notedMemberIds.add(n.member_id);
    if (new Date(n.created_at) >= fourWeeksAgo) {
      notedRecently.add(n.member_id);
    }
  }

  const neverNoted = members.filter((m) => !notedMemberIds.has(m.id));
  const notNotedRecently = members.filter(
    (m) => notedMemberIds.has(m.id) && !notedRecently.has(m.id),
  );

  const { data: latestNotes } = await supabase
    .from("updates")
    .select("id, member_id, author_name, title, note, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const noteMemIds = [...new Set(latestNotes?.map((n) => n.member_id) ?? [])];
  const { data: noteMembers } = await supabase
    .from("members")
    .select("id, name, role")
    .in("id", noteMemIds.length > 0 ? noteMemIds : ["none"]);
  const memberMap = new Map(noteMembers?.map((m) => [m.id, m]) ?? []);

  const guests = members.filter((m) => m.role === "G");

  return (
    <div>
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-800 md:text-3xl">
          Hey {session?.name}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Here&apos;s how your connect group is doing
        </p>
      </div>

      {/* Top stats row */}
      <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-3xl font-bold text-sky-500">{members.length}</p>
          <p className="mt-1 text-xs font-medium text-gray-400">
            Active members
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-3xl font-bold text-warm-500">{leaderCount}</p>
          <p className="mt-1 text-xs font-medium text-gray-400">Leaders</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-3xl font-bold text-sage-500">
            {notedRecently.size}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-400">
            Noted (4 wks)
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-3xl font-bold text-lavender-500">
            {guests.length}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-400">Guests</p>
        </div>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid gap-10 md:grid-cols-2">
        {/* Left column */}
        <div className="space-y-10">
          {/* CG Strength */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              CG Strength
            </h2>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex h-5 overflow-hidden rounded-full">
                {["R", "GI", "I", "G", "NF"].map((role) => {
                  const count = roleCounts[role] ?? 0;
                  if (count === 0) return null;
                  const pct = (count / members.length) * 100;
                  const colors: Record<string, string> = {
                    R: "bg-sky-400",
                    GI: "bg-sky-300",
                    I: "bg-lavender-400",
                    G: "bg-sage-400",
                    NF: "bg-warm-400",
                  };
                  return (
                    <div
                      key={role}
                      className={`${colors[role]} first:rounded-l-full last:rounded-r-full`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {["R", "GI", "I", "G", "NF"].map((role) => {
                  const count = roleCounts[role] ?? 0;
                  if (count === 0) return null;
                  return (
                    <span
                      key={role}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${ROLE_COLORS[role]}`}
                    >
                      {count} {ROLE_LABELS[role]}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Pastoral care health */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Pastoral Care
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm">
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    Noted recently
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">Past 4 weeks</p>
                </div>
                <span className="text-2xl font-bold text-sage-500">
                  {notedRecently.size}
                  <span className="text-sm font-normal text-gray-300">
                    /{members.length}
                  </span>
                </span>
              </div>

              {notNotedRecently.length > 0 && (
                <div className="rounded-2xl bg-warm-100 px-5 py-4">
                  <p className="mb-2 text-sm font-semibold text-warm-500">
                    Not noted recently ({notNotedRecently.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {notNotedRecently.slice(0, 8).map((m) => (
                      <Link
                        key={m.id}
                        href={`/members/${m.id}`}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-xs text-gray-600 hover:bg-white"
                      >
                        {m.name.split(" ")[0]}
                      </Link>
                    ))}
                    {notNotedRecently.length > 8 && (
                      <span className="px-2 py-1 text-xs text-gray-400">
                        +{notNotedRecently.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {neverNoted.length > 0 && (
                <div className="rounded-2xl bg-rose-50 px-5 py-4">
                  <p className="mb-2 text-sm font-semibold text-rose-500">
                    Never noted ({neverNoted.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {neverNoted.slice(0, 8).map((m) => (
                      <Link
                        key={m.id}
                        href={`/members/${m.id}`}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-xs text-gray-600 hover:bg-white"
                      >
                        {m.name.split(" ")[0]}
                      </Link>
                    ))}
                    {neverNoted.length > 8 && (
                      <span className="px-2 py-1 text-xs text-gray-400">
                        +{neverNoted.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Ready for FP */}
          {guests.length > 0 && (
            <section>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Potential for Follow-Up
              </h2>
              <div className="rounded-2xl bg-lavender-50 px-5 py-4">
                <p className="mb-2 text-sm font-semibold text-lavender-500">
                  {guests.length} Guest{guests.length !== 1 && "s"} in CG
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {guests.slice(0, 8).map((m) => (
                    <Link
                      key={m.id}
                      href={`/members/${m.id}`}
                      className="rounded-full bg-white/60 px-2.5 py-1 text-xs text-gray-600 hover:bg-white"
                    >
                      {m.name.split(" ")[0]}
                    </Link>
                  ))}
                  {guests.length > 8 && (
                    <span className="px-2 py-1 text-xs text-gray-400">
                      +{guests.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right column — latest notes */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Latest Notes
            </h2>
            <Link
              href="/notes"
              className="text-xs font-medium text-sky-500 hover:text-sky-600"
            >
              See all
            </Link>
          </div>
          {latestNotes && latestNotes.length > 0 ? (
            <div className="space-y-3">
              {latestNotes.map((note) => {
                const member = memberMap.get(note.member_id);
                return (
                  <Link
                    key={note.id}
                    href={`/members/${note.member_id}`}
                    className="block rounded-2xl bg-white p-5 shadow-sm transition-colors hover:bg-warm-50 active:bg-warm-50"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">
                        {member?.name ?? "Unknown"}
                        <span className="ml-1.5 text-xs font-normal text-gray-400">
                          {member?.role}
                        </span>
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(note.created_at).toLocaleDateString("en-SG", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                    {note.title && (
                      <p className="mb-1.5 text-sm font-medium text-gray-600">
                        {note.title}
                      </p>
                    )}
                    <p className="line-clamp-3 text-sm leading-relaxed text-gray-400">
                      {note.note}
                    </p>
                    <p className="mt-2 text-xs text-gray-300">
                      by {note.author_name}
                    </p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-warm-100 p-6 text-center">
              <p className="text-sm text-gray-400">No notes yet</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
