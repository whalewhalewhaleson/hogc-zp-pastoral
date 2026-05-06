"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SESSION_TYPES = ["regular", "cg", "revival", "special"] as const;

export function CreateSessionButton() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<string>("regular");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (!label.trim() || !date) return;
    setSaving(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), date, type }),
    });
    setSaving(false);
    if (res.ok) {
      const { id } = await res.json();
      setOpen(false);
      setLabel("");
      router.push(`/attendance/${id}`);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white active:bg-sky-600"
      >
        + New
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6">
        <h2 className="mb-5 text-lg font-bold text-gray-800">New Session</h2>

        <label className="mb-1 block text-xs font-medium text-gray-400">
          Label
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. W17 Sat"
          className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-sky-400 focus:outline-none"
        />

        <label className="mb-1 block text-xs font-medium text-gray-400">
          Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-sky-400 focus:outline-none"
        />

        <label className="mb-2 block text-xs font-medium text-gray-400">
          Type
        </label>
        <div className="mb-6 flex gap-2">
          {SESSION_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                type === t
                  ? "bg-sky-500 text-white"
                  : "bg-gray-100 text-gray-500 active:bg-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !label.trim()}
            className="flex-1 rounded-xl bg-sky-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
