import { useEffect, useState } from "react";

export type ViewMode = "list" | "card";

export function useViewToggle(storageKey: string) {
  const [desktopView, setDesktopView] = useState<ViewMode>("list");
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsSmallScreen(window.innerWidth < 640);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey) as ViewMode | null;
    setDesktopView(stored ?? "list");
    setIsInitialized(true);
  }, [storageKey]);

  const setAndPersistView = (nextView: ViewMode) => {
    if (!isSmallScreen) {
      setDesktopView(nextView);
      if (isInitialized) {
        localStorage.setItem(storageKey, nextView);
      }
    }
  };

  const effectiveView: ViewMode = isSmallScreen ? "card" : desktopView;
  return [effectiveView, setAndPersistView] as const;
}

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

export default function ViewToggle({ view, onChange }: ViewToggleProps) {
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsSmallScreen(window.innerWidth < 640);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isSmallScreen) return null;

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-slate-600">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`border p-2 transition-colors ${
          view === "list"
            ? "border-transparent bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            : "border-transparent bg-white text-gray-500 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-400 dark:hover:bg-slate-700"
        }`}
        title="List view"
        aria-label="List view"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange("card")}
        className={`border p-2 transition-colors ${
          view === "card"
            ? "border-transparent bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            : "border-transparent bg-white text-gray-500 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-400 dark:hover:bg-slate-700"
        }`}
        title="Card view"
        aria-label="Card view"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
          />
        </svg>
      </button>
    </div>
  );
}
