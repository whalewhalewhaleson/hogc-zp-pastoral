"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  {
    href: "/",
    label: "Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4",
  },
  {
    href: "/notes",
    label: "Pastoral Notes",
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  },
  {
    href: "/members",
    label: "Members",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    href: "/attendance",
    label: "Attendance",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  },
];

export function Sidebar({ name }: { name: string }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-warm-200 bg-white md:flex md:flex-col">
      <div className="px-5 py-6">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <span className="text-base font-bold text-gray-800">ZP Pastoral</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">Hey {name}</p>
      </div>

      <nav className="flex-1 px-3">
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-sky-50 text-sky-600"
                  : "text-gray-500 hover:bg-warm-50 hover:text-gray-700"
              }`}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={active ? 2 : 1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={link.icon}
                />
              </svg>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
