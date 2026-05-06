import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { CreateSessionButton } from "./create-session";

const TYPE_COLORS: Record<string, string> = {
  regular: "bg-sky-100 text-sky-600",
  cg: "bg-sage-100 text-sage-500",
  revival: "bg-lavender-100 text-lavender-500",
  special: "bg-warm-200 text-warm-500",
};

export default async function AttendancePage() {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .order("date", { ascending: false })
    .limit(20);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Attendance</h1>
        <CreateSessionButton />
      </div>

      {sessions && sessions.length > 0 ? (
        <div className="space-y-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/attendance/${s.id}`}
              className="flex items-center justify-between rounded-2xl bg-white px-4 py-3.5 shadow-sm active:bg-warm-50"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {s.label}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(s.date + "T00:00:00").toLocaleDateString("en-SG", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                  TYPE_COLORS[s.type] ?? "bg-gray-100 text-gray-500"
                }`}
              >
                {s.type}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-warm-100 p-6 text-center">
          <p className="mb-1 text-sm text-gray-500">No sessions yet</p>
          <p className="text-xs text-gray-400">
            Create one to start marking attendance
          </p>
        </div>
      )}
    </div>
  );
}
