"use client";

import { useEffect, useState } from "react";

// Light/dark toggle. The class lives on <html> (set pre-paint by the bootstrap script in
// the root layout) and the choice persists under the shared Silk key, so switching here
// carries across every Silk app on the same origin.

const KEY = "silk-apps-theme";

export function ThemeToggle() {
  // Start as null so the first client render matches the server (no hydration mismatch);
  // the effect immediately reconciles with what the bootstrap script already applied.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Private-mode / blocked storage — the class still flips for this session.
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      className="btn-theme"
      onClick={toggle}
      title="Toggle color theme"
      aria-pressed={dark ?? false}
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}
