import { Link, useLocation, useFetcher } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "~/contexts/ThemeContext";
import { useSidebar } from "~/contexts/SidebarContext";

interface SidebarProps {
  userName?: string;
  userEmail?: string;
  userInitials?: string;
  version?: string;
  showVersion?: boolean;
  showEventsLink?: boolean;
  showQuotesLink?: boolean;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  show?: boolean;
}

export default function Sidebar({
  userName,
  userEmail,
  userInitials,
  version,
  showVersion,
  showEventsLink = true,
  showQuotesLink = true,
}: SidebarProps) {
  const { isExpanded, toggleSidebar } = useSidebar();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const logoutFetcher = useFetcher();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  // Close account menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node) &&
        accountButtonRef.current &&
        !accountButtonRef.current.contains(event.target as Node)
      ) {
        setIsAccountMenuOpen(false);
      }
    }

    if (isAccountMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isAccountMenuOpen]);

  // Close account menu when sidebar collapses
  useEffect(() => {
    if (!isExpanded) {
      setIsAccountMenuOpen(false);
    }
  }, [isExpanded]);

  const navItems: NavItem[] = [
    {
      to: "/",
      label: "Dashboard",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      to: "/ActionItems",
      label: "Action Items",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
    {
      to: "/quotes",
      label: "Quotes",
      show: showQuotesLink,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      to: "/orders",
      label: "Orders",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
    },
    {
      to: "/customers",
      label: "Customers",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      to: "/vendors",
      label: "Vendors",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      to: "/emails",
      label: "Emails",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      to: "/events",
      label: "Events",
      show: showEventsLink,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const isActiveRoute = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-gray-800 dark:bg-slate-950 dark:border-r dark:border-slate-800 text-white flex flex-col transition-all duration-300 z-40 overflow-x-hidden ${
        isExpanded ? "w-64" : "w-20"
      }`}
    >
      {/* Header with toggle button */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700 dark:border-slate-800 flex-shrink-0">
        {isExpanded && (
          <Link to="/" className="text-white no-underline hover:opacity-80 flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">Subtract</h1>
          </Link>
        )}
        <button
          onClick={toggleSidebar}
          className="p-2 rounded hover:bg-white/10 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            if (item.show === false) return null;
            const isActive = isActiveRoute(item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors no-underline ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-white/10 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {isExpanded ? (
                    <span className="font-medium truncate">{item.label}</span>
                  ) : (
                    <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900 dark:bg-slate-800 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 shadow-lg">
                      {item.label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom section - User profile */}
      <div className="border-t border-gray-700 dark:border-slate-800 p-3 flex-shrink-0 relative">
        {/* User profile section with dropdown trigger */}
        <div className="relative">
          <button
            ref={accountButtonRef}
            onClick={() => isExpanded && setIsAccountMenuOpen(!isAccountMenuOpen)}
            className={`group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors text-left ${
              isExpanded 
                ? "hover:bg-white/10 dark:hover:bg-slate-800 cursor-pointer" 
                : "cursor-default"
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm overflow-hidden flex-shrink-0">
              {userInitials || "U"}
            </div>
            {isExpanded ? (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{userName || "User"}</p>
                  <p className="text-xs text-gray-400 truncate">{userEmail || "user@example.com"}</p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isAccountMenuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </>
            ) : (
              <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900 dark:bg-slate-800 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 shadow-lg">
                {userName || "User"}
              </span>
            )}
          </button>

          {/* Account dropdown menu */}
          {isAccountMenuOpen && isExpanded && (
            <div
              ref={accountMenuRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-50"
            >
              {/* Settings link */}
              <Link
                to="/settings"
                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors no-underline ${
                  isActiveRoute("/settings")
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                }`}
                onClick={() => setIsAccountMenuOpen(false)}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Settings</span>
              </Link>

              {/* Dark mode toggle */}
              <div className="flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                <div className="flex items-center gap-3">
                  {theme === "dark" ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" />
                    </svg>
                  )}
                  <span>Dark mode</span>
                </div>
                <button
                  onClick={toggleTheme}
                  className="relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 focus:outline-none"
                  style={{ backgroundColor: theme === "dark" ? "#2563eb" : "#d1d5db" }}
                >
                  <span
                    className={`inline-block w-4 h-4 transform transition-transform duration-200 bg-white rounded-full shadow ${
                      theme === "dark" ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200 dark:border-slate-700 my-1" />

              {/* Logout button */}
              <logoutFetcher.Form method="post" action="/logout">
                <button
                  type="submit"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors w-full text-left"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Log out</span>
                </button>
              </logoutFetcher.Form>

              {/* Version info */}
              {showVersion && version && (
                <div className="border-t border-gray-200 dark:border-slate-700 mt-1 px-4 py-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">v{version}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
