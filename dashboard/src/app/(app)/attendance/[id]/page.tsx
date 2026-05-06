import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AttendanceChecklist } from "./checklist";

const ROLE_ORDER: Record<string, number> = {
  PTL: 0, SCGL: 1, PCGL: 2, POTL: 3, R: 4, GI: 5, I: 6, G: 7, NF: 8,
};

export default async function AttendanceSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = Number(id);

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!session) notFound();

  const { data: members } = await supabase
    .from("members")
    .select("id, name, role, leader_role")
    .eq("active", true)
    .order("name");

  const sorted = (members ?? []).sort((a, b) => {
    const aOrder = ROLE_ORDER[a.leader_role ?? a.role] ?? 99;
    const bOrder = ROLE_ORDER[b.leader_role ?? b.role] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });

  const { data: existing } = await supabase
    .from("attendance")
    .select("member_id, status, adjusted, adjusted_reason")
    .eq("session_id", sessionId);

  const existingMap: Record<
    string,
    { status: "present" | "absent" | "replay"; adjusted: boolean; adjusted_reason: string | null }
  > = {};
  for (const r of existing ?? []) {
    existingMap[r.member_id] = {
      status: r.status as "present" | "absent" | "replay",
      adjusted: r.adjusted,
      adjusted_reason: r.adjusted_reason,
    };
  }

  return (
    <div>
      <Link
        href="/attendance"
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

      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">{session.label}</h1>
        <p className="text-sm text-gray-400">
          {new Date(session.date + "T00:00:00").toLocaleDateString("en-SG", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {" · "}
          <span className="capitalize">{session.type}</span>
        </p>
      </div>

      <AttendanceChecklist
        sessionId={sessionId}
        members={sorted}
        existing={existingMap}
      />
    </div>
  );
}
