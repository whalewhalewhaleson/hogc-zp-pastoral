"use client";

import { useState } from "react";

type Status = "present" | "absent" | "replay";

interface Member {
  id: string;
  name: string;
  role: string;
  leader_role: string | null;
}

interface AttendanceRecord {
  status: Status;
  adjusted: boolean;
  adjusted_reason: string | null;
}

const STATUS_CONFIG: Record<Status, { bg: string; label: string; next: Status }> = {
  absent: { bg: "bg-rose-400", label: "A", next: "present" },
  present: { bg: "bg-sage-500", label: "P", next: "replay" },
  replay: { bg: "bg-sky-400", label: "R", next: "absent" },
};

const ROLE_COLORS: Record<string, string> = {
  R: "text-sky-500",
  I: "text-lavender-500",
  G: "text-sage-500",
  GI: "text-sky-600",
  NF: "text-warm-500",
};

export function AttendanceChecklist({
  sessionId,
  members,
  existing,
}: {
  sessionId: number;
  members: Member[];
  existing: Record<string, AttendanceRecord>;
}) {
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>(
    () => {
      const init: Record<string, AttendanceRecord> = {};
      for (const m of members) {
        init[m.id] = existing[m.id] ?? {
          status: "absent",
          adjusted: false,
          adjusted_reason: null,
        };
      }
      return init;
    },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function cycleStatus(memberId: string) {
    setRecords((prev) => {
      const current = prev[memberId].status;
      return {
        ...prev,
        [memberId]: {
          ...prev[memberId],
          status: STATUS_CONFIG[current].next,
        },
      };
    });
    setSaved(false);
  }

  function toggleAdjusted(memberId: string) {
    setRecords((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        adjusted: !prev[memberId].adjusted,
        adjusted_reason: prev[memberId].adjusted
          ? null
          : prev[memberId].adjusted_reason,
      },
    }));
    setSaved(false);
  }

  function setReason(memberId: string, reason: string) {
    setRecords((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], adjusted_reason: reason || null },
    }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const payload = members.map((m) => ({
      member_id: m.id,
      ...records[m.id],
    }));
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, records: payload }),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  }

  const presentCount = Object.values(records).filter(
    (r) => r.status === "present" || r.status === "replay",
  ).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-sage-500" />{" "}
            Present
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-rose-400" />{" "}
            Absent
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-sky-400" />{" "}
            Replay
          </span>
        </div>
        <span className="text-sm font-semibold text-gray-600">
          {presentCount}/{members.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {members.map((m) => {
          const rec = records[m.id];
          const st = STATUS_CONFIG[rec.status];
          const showReason = rec.adjusted && m.role === "R";

          return (
            <div
              key={m.id}
              className="rounded-2xl bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => cycleStatus(m.id)}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white transition-colors ${st.bg}`}
                >
                  {st.label}
                </button>

                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-gray-800">
                    {m.name}
                  </span>
                  <span
                    className={`ml-1.5 text-xs ${ROLE_COLORS[m.role] ?? "text-gray-400"}`}
                  >
                    {m.leader_role ?? m.role}
                  </span>
                </div>

                {m.role !== "NF" && (
                  <button
                    onClick={() => toggleAdjusted(m.id)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                      rec.adjusted
                        ? "bg-warm-200 text-warm-500"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    Adj
                  </button>
                )}
              </div>

              {showReason && (
                <input
                  value={rec.adjusted_reason ?? ""}
                  onChange={(e) => setReason(m.id, e.target.value)}
                  placeholder="Reason (e.g. sick, overseas)"
                  className="mt-2 ml-12 w-[calc(100%-3rem)] rounded-xl border border-warm-200 px-3 py-1.5 text-xs focus:border-warm-400 focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-20 mt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full rounded-2xl py-3.5 text-sm font-semibold text-white shadow-lg transition-colors ${
            saved
              ? "bg-sage-500"
              : "bg-sky-500 active:bg-sky-600"
          } disabled:opacity-50`}
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
        </button>
      </div>
    </div>
  );
}
