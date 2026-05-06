"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

export default function MiniappHome() {
  const [message, setMessage] = useState("Loading…");

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onerror = () => setMessage("Couldn't load Telegram script.");
    script.onload = async () => {
      const tg = window.Telegram?.WebApp;
      if (!tg?.initData) {
        setMessage("Open this from inside Telegram.");
        return;
      }
      tg.ready?.();
      tg.expand?.();
      const res = await fetch("/api/m/whoami", {
        headers: { Authorization: `tma ${tg.initData}` },
      });
      const data = await res.json();
      setMessage(
        res.ok
          ? `Hi ${data.name} — auth verified.`
          : data.error || "Auth failed",
      );
    };
    document.head.appendChild(script);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-warm-50 p-6">
      <p className="text-center text-base text-gray-700">{message}</p>
    </main>
  );
}
