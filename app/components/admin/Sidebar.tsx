import { Link, useLocation } from "@remix-run/react";

interface AdminNavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: React.ReactNode;
}

const adminNavItems: AdminNavItem[] = [
  {
    to: "/admin",
    label: "Home",
    end: true,
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    to: "/admin/users",
    label: "Users",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
        />
      </svg>
    ),
  },
];

const stripeNavItem: AdminNavItem = {
  to: "/admin/stripe",
  label: "Stripe",
  icon: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
      />
    </svg>
  ),
};

const emailNavItem: AdminNavItem = {
  to: "/admin/email",
  label: "Email",
  icon: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  ),
};

interface AdminSidebarProps {
  stripeEnabled?: boolean;
  outboundEmailEnabled?: boolean;
}

export default function AdminSidebar({ stripeEnabled, outboundEmailEnabled }: AdminSidebarProps) {
  const location = useLocation();

  const isActive = (path: string, end = false) =>
    end ? location.pathname === path : location.pathname.startsWith(path);

  const navItems = [...adminNavItems];
  if (stripeEnabled) navItems.push(stripeNavItem);
  if (outboundEmailEnabled) navItems.push(emailNavItem);

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Back to app */}
      <div className="flex h-14 items-center border-b border-gray-200 px-4 dark:border-slate-700">
        <Link
          to="/"
          className="group flex items-center gap-2 text-sm font-medium text-gray-500 no-underline transition-colors hover:text-[#840606] dark:text-gray-400 dark:hover:text-red-400"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          <span>Back to SERP</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                  isActive(item.to, item.end)
                    ? "font-medium text-gray-900 dark:text-white"
                    : "font-normal text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                {isActive(item.to, item.end) && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[#840606] dark:bg-red-400" />
                )}
                <span
                  className={`flex-shrink-0 ${isActive(item.to, item.end) ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"}`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
