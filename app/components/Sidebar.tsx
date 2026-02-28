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
  showEmailsLink?: boolean;
  emailCategoryCounts?: {
    inbox: number;
    orders: number;
    quotes: number;
    assignedToMe: number;
    important: number;
    sent: number;
    archived: number;
  };
  onComposeEmail?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  show?: boolean;
}

interface EmailSubItem {
  id: string;
  label: string;
  param: string | null;
  countKey?: "inbox" | "orders" | "quotes" | "assignedToMe" | "important" | "sent" | "archived";
  icon: React.ReactNode;
}

export default function Sidebar({
  userName,
  userEmail,
  userInitials,
  version,
  showVersion,
  showEventsLink = true,
  showQuotesLink = true,
  showEmailsLink = true,
  emailCategoryCounts,
  onComposeEmail,
}: SidebarProps) {
  const { isExpanded, toggleSidebar, isMobileOpen, setMobileOpen } = useSidebar();
  const location = useLocation();
  const showLabels = isExpanded || isMobileOpen;
  const { theme, toggleTheme } = useTheme();
  const logoutFetcher = useFetcher();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isEmailsExpanded, setIsEmailsExpanded] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-expand emails dropdown when on email pages
  const isOnEmailPage = location.pathname.startsWith("/emails");
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  useEffect(() => {
    if (isOnEmailPage) {
      setIsEmailsExpanded(true);
    }
  }, [isOnEmailPage]);

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

  // Close account menu and emails dropdown when sidebar collapses
  useEffect(() => {
    if (!isExpanded) {
      setIsAccountMenuOpen(false);
    }
  }, [isExpanded]);

  // Email sub-items for the dropdown
  // Note: "sent" has no countKey (no badge), "important" removed entirely
  const emailSubItems: EmailSubItem[] = [
    {
      id: "inbox",
      label: "Inbox",
      param: null,
      countKey: "inbox",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      ),
    },
    {
      id: "orders",
      label: "Orders",
      param: "orders",
      countKey: "orders",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
    },
    {
      id: "quotes",
      label: "Quotes",
      param: "quotes",
      countKey: "quotes",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: "assigned",
      label: "Assigned to Me",
      param: "assigned",
      countKey: "assignedToMe",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: "sent",
      label: "Sent",
      param: "sent",
      // No countKey - sent emails don't need a badge
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
    },
    {
      id: "archived",
      label: "Archive",
      param: "archived",
      countKey: "archived",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
    },
  ];

  // Build email sub-item URL
  const buildEmailUrl = (param: string | null) => {
    if (param === null) {
      return "/emails";
    }
    // Special case for "assigned" - use assignedToMe param
    if (param === "assigned") {
      return "/emails?assignedToMe=true";
    }
    return `/emails?category=${param}`;
  };

  // Check if email sub-item is active
  const isEmailSubItemActive = (param: string | null) => {
    if (!isOnEmailPage) return false;
    const searchParams = new URLSearchParams(location.search);
    const currentCategory = searchParams.get("category");
    const assignedToMe = searchParams.get("assignedToMe");
    
    if (param === null) {
      return (currentCategory === null || currentCategory === "") && !assignedToMe;
    }
    // Special case for "assigned"
    if (param === "assigned") {
      return assignedToMe === "true";
    }
    return currentCategory === param;
  };

  // Nav items before emails
  const navItemsBeforeEmails: NavItem[] = [
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
  ];

  // Nav items after emails
  const navItemsAfterEmails: NavItem[] = [
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
    <>
      {isMobileOpen && (
        <div
          role="button"
          tabIndex={0}
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => e.key === "Enter" && setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed left-0 top-0 h-screen bg-gray-800 dark:bg-slate-950 dark:border-r dark:border-slate-800 text-white flex flex-col transition-all duration-300 z-50 overflow-x-hidden w-[80vw] max-w-xs ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 ${isExpanded ? "md:w-64" : "md:w-20"}`}
      >
      {/* Header with toggle button */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700 dark:border-slate-800 flex-shrink-0">
        {showLabels && (
          <Link to="/" className="text-white no-underline hover:opacity-80 flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">Subtract</h1>
          </Link>
        )}
        <button
          onClick={toggleSidebar}
          className="p-2 rounded hover:bg-white/10 dark:hover:bg-slate-800 transition-colors flex-shrink-0 hidden md:block"
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
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4 scrollbar-hide">
        <ul className="space-y-1 px-3">
          {/* Nav items before emails */}
          {navItemsBeforeEmails.map((item) => {
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
                  {showLabels ? (
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

          {/* Emails with expandable dropdown */}
          {showEmailsLink && (
            <li>
              <div className="relative">
                {/* Main Emails link with dropdown toggle */}
                <div
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isOnEmailPage
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-white/10 dark:hover:bg-slate-800"
                  }`}
                >
                  <Link
                    to="/emails"
                    className="flex items-center gap-3 flex-1 no-underline text-inherit"
                  >
                    <span className="flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </span>
                    {showLabels ? (
                      <span className="font-medium truncate">Emails</span>
                    ) : (
                      <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900 dark:bg-slate-800 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 shadow-lg">
                        Emails
                      </span>
                    )}
                  </Link>
                  {/* Dropdown toggle button - inside the same box */}
                  {showLabels && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsEmailsExpanded(!isEmailsExpanded);
                      }}
                      className={`p-1 rounded transition-colors ${
                        isOnEmailPage
                          ? "text-white/80 hover:text-white hover:bg-white/20"
                          : "text-gray-400 hover:text-white hover:bg-white/10"
                      }`}
                      aria-label={isEmailsExpanded ? "Collapse email options" : "Expand email options"}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isEmailsExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Email sub-items dropdown */}
                {showLabels && isEmailsExpanded && (
                  <div className="mt-1 ml-4 space-y-0.5">
                    {/* Compose button - styled as CTA with distinct color */}
                    {onComposeEmail && (
                      <div className="pb-2 mb-1 border-b border-gray-700 dark:border-slate-700">
                        <button
                          onClick={onComposeEmail}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-md transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span>Compose</span>
                        </button>
                      </div>
                    )}

                    {/* Email category sub-items */}
                    {emailSubItems.map((subItem) => {
                      const isSubActive = isEmailSubItemActive(subItem.param);
                      const count = subItem.countKey && emailCategoryCounts 
                        ? emailCategoryCounts[subItem.countKey] 
                        : 0;
                      
                      return (
                        <Link
                          key={subItem.id}
                          to={buildEmailUrl(subItem.param)}
                          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors no-underline ${
                            isSubActive
                              ? "bg-blue-500/30 text-white font-medium"
                              : "text-gray-400 hover:text-white hover:bg-white/10"
                          }`}
                        >
                          <span className="flex-shrink-0">{subItem.icon}</span>
                          <span className="flex-1 truncate">{subItem.label}</span>
                          {count > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              isSubActive 
                                ? "bg-blue-500 text-white" 
                                : "bg-gray-600 text-gray-300"
                            }`}>
                              {count > 99 ? "99+" : count}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </li>
          )}

          {/* Nav items after emails */}
          {navItemsAfterEmails.map((item) => {
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
                  {showLabels ? (
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
            onClick={() => showLabels && setIsAccountMenuOpen(!isAccountMenuOpen)}
            className={`group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors text-left ${
              showLabels 
                ? "hover:bg-white/10 dark:hover:bg-slate-800 cursor-pointer" 
                : "cursor-default"
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm overflow-hidden flex-shrink-0">
              {userInitials || "U"}
            </div>
            {showLabels ? (
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
          {isAccountMenuOpen && showLabels && (
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
                  <span className="text-xs text-gray-500 dark:text-gray-400">{version}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </aside>
    </>
  );
}
