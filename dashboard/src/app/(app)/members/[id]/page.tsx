import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import Link from "next/link";

const ROLE_COLORS: Record<string, string> = {
  R: "bg-sky-100 text-sky-700",
  I: "bg-lavender-100 text-lavender-500",
  G: "bg-sage-100 text-sage-500",
  GI: "bg-sky-200 text-sky-600",
  NF: "bg-warm-200 text-warm-500",
};

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", id)
    .single();

  if (!member) notFound();

  const { data: notes } = await supabase
    .from("updates")
    .select("*")
    .eq("member_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const age = member.birthday
    ? Math.floor(
        (Date.now() - new Date(member.birthday).getTime()) / 31557600000,
      )
    : null;

  return (
    <div>
      <Link
        href="/members"
        className="mb-5 inline-flex items-center text-sm text-gray-400"
      >
        <svg
          className="mr-1 h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back
      </Link>

      {/* Profile header */}
      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-gray-800">{member.name}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              ROLE_COLORS[member.role] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {member.role}
          </span>
          {member.leader_role && (
            <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-semibold text-white">
              {member.leader_role}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-y-2 text-sm">
          {member.birthday && (
            <>
              <span className="text-gray-400">Birthday</span>
              <span className="text-gray-700">
                {new Date(member.birthday + "T00:00:00").toLocaleDateString(
                  "en-SG",
                  { day: "numeric", month: "long" },
                )}
                {age !== null && ` (${age})`}
              </span>
            </>
          )}
          {member.school && (
            <>
              <span className="text-gray-400">School</span>
              <span className="text-gray-700">{member.school}</span>
            </>
          )}
          {member.course && (
            <>
              <span className="text-gray-400">Course</span>
              <span className="text-gray-700">{member.course}</span>
            </>
          )}
          {member.year_of_study && (
            <>
              <span className="text-gray-400">Year</span>
              <span className="text-gray-700">{member.year_of_study}</span>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Pastoral Notes
        </h2>
        <span className="text-xs text-gray-300">{notes?.length ?? 0}</span>
      </div>

      {notes && notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((note) => (
            <div key={note.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400">
                  {new Date(note.created_at).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {note.edited_at && " (edited)"}
                </span>
                <span className="text-xs text-gray-300">
                  {note.author_name}
                </span>
              </div>
              {note.title && (
                <p className="mb-1.5 text-sm font-semibold text-gray-700">
                  {note.title}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
                {note.note}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-warm-100 p-5 text-center">
          <p className="text-sm text-gray-400">
            No notes yet — write one via the Telegram bot
          </p>
        </div>
      )}
    </div>
  );
}
