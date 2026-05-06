"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME;
    if (!botUsername || !widgetRef.current) return;

    (window as unknown as Record<string, unknown>).onTelegramAuth = async (
      user: Record<string, unknown>,
    ) => {
      setError("");
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const { error } = await res.json();
        setError(error || "Login failed");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetRef.current.appendChild(script);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-50 px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mb-3 text-4xl">🌿</div>
        <h1 className="mb-2 text-2xl font-bold text-gray-800">ZP Pastoral</h1>
        <p className="mb-10 text-sm text-gray-400">
          Sign in with your Telegram account
        </p>
        <div ref={widgetRef} className="flex justify-center" />
        {process.env.NODE_ENV === "development" && (
          <button
            onClick={async () => {
              setError("");
              const res = await fetch("/api/auth/dev-login", {
                method: "POST",
              });
              if (res.ok) {
                router.push("/");
                router.refresh();
              } else {
                setError("Dev login failed");
              }
            }}
            className="mt-8 rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-500 active:bg-gray-50"
          >
            Dev Login (Wilson)
          </button>
        )}
        {error && (
          <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
