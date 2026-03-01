import { useSidebar } from "~/contexts/SidebarContext";

export default function MobileHeader() {
  const { setMobileOpen } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-gray-800 dark:bg-slate-950 text-white px-4 py-3 md:hidden">
      <button
        onClick={() => setMobileOpen(true)}
        className="p-2 -ml-2 rounded-lg hover:bg-white/10"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <span className="text-lg font-semibold">Subtract</span>
      <div className="w-10" />
    </header>
  );
}
