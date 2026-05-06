import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default async function NotesPage() {
  const { data: notes } = await supabase
    .from("updates")
    .select("id, member_id, author_name, title, note, created_at, edited_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const memberIds = [...new Set(notes?.map((n) => n.member_id) ?? [])];
  const { data: members } = await supabase
    .from("members")
    .select("id, name, role")
    .in("id", memberIds.length > 0 ? memberIds : ["none"]);

  const memberMap = new Map(members?.map((m) => [m.id, m]) ?? []);

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold text-gray-800 md:text-3xl">
        Pastoral Notes
      </h1>

      {notes && notes.length > 0 ? (
        <div className="columns-1 gap-4 space-y-4 md:columns-2">
          {notes.map((note) => {
            const member = memberMap.get(note.member_id);
            return (
              <Link
                key={note.id}
                href={`/members/${note.member_id}`}
                className="block break-inside-avoid rounded-2xl bg-white p-5 shadow-sm transition-colors hover:bg-warm-50 active:bg-warm-50"
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
                    {note.edited_at && " (edited)"}
                  </span>
                </div>
                {note.title && (
                  <p className="mb-2 text-sm font-medium text-gray-600">
                    {note.title}
                  </p>
                )}
                <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
                  {note.note}
                </p>
                <p className="mt-3 text-xs text-gray-300">
                  by {note.author_name}
                </p>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-warm-100 p-8 text-center">
          <p className="text-sm text-gray-400">
            No notes yet — write some via the Telegram bot!
          </p>
        </div>
      )}
    </div>
  );
}
