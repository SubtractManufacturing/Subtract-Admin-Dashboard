import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLocation, useNavigate } from "@remix-run/react";
import { useState, useMemo, useRef, useEffect } from "react";
import AdminSidebar from "~/components/AdminSidebar";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";

const searchableItems = [
  { label: "Home", description: "Admin dashboard overview", path: "/admin" },
  { label: "Users", description: "Manage user accounts and invitations", path: "/admin/users" },
  { label: "Invite User", description: "Send a new user invitation", path: "/admin/users", query: "invite" },
  { label: "App Settings", description: "Application configuration (coming soon)", path: "/admin" },
  { label: "Developer Settings", description: "Developer tools and flags (coming soon)", path: "/admin" },
  { label: "Feature Flags", description: "Toggle application features", path: "/admin" },
  { label: "Active Users", description: "View active user count", path: "/admin" },
  { label: "Deployed Version", description: "Current deployment version", path: "/admin" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  return withAuthHeaders(json({ user, userDetails }), headers);
}

function AdminSearchBar() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return searchableItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    setQuery("");
    setIsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => query.trim() && setIsOpen(true)}
          placeholder="Search admin..."
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-16 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-400 focus:ring-0 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-slate-500"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:inline-block dark:border-slate-600 dark:bg-slate-700 dark:text-gray-500">
          Ctrl K
        </kbd>
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <ul className="py-1">
            {results.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-700"
                  onClick={() => {
                    navigate(item.path);
                    setQuery("");
                    setIsOpen(false);
                  }}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.description}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOpen && query.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-gray-400">
          No results for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
      <AdminSidebar />
      <div className="ml-64 flex flex-1 flex-col">
        {/* Top bar with search */}
        <header className="sticky top-0 z-40 flex items-center border-b border-gray-200 bg-white/80 px-6 py-3 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80">
          <AdminSearchBar />
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
