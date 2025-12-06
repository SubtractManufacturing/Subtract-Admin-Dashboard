import { Link } from "@remix-run/react";
import { useState, useRef } from "react";
import AccountDropdown from "./AccountDropdown";

interface NavbarProps {
  userName?: string;
  userEmail?: string;
  userInitials?: string;
  version?: string;
  isStaging?: boolean;
  showEventsLink?: boolean;
  showQuotesLink?: boolean;
}

export default function Navbar({ userName, userEmail, userInitials, version, isStaging, showEventsLink = true, showQuotesLink = true }: NavbarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex justify-between items-center bg-gray-800 text-white px-8 py-4">
      <h1 className="text-2xl font-semibold m-0 flex items-center gap-2">
        <Link to="/" className="text-white no-underline hover:opacity-80">
          Subtract Admin Dashboard
        </Link>
        {isStaging && version && (
          <span className="text-sm font-normal text-gray-300 bg-gray-700 px-2 py-0.5 rounded">
            {version}
          </span>
        )}
      </h1>
      <div className="flex items-center gap-5">
        <Link
          to="/ActionItems"
          className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
        >
          Action Items
        </Link>
        {showQuotesLink && (
          <Link
            to="/quotes"
            className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
          >
            Quotes
          </Link>
        )}
        <Link
          to="/orders"
          className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
        >
          Orders
        </Link>
        <Link
          to="/customers"
          className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
        >
          Customers
        </Link>
        <Link
          to="/vendors"
          className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
        >
          Vendors
        </Link>
        {showEventsLink && (
          <Link
            to="/events"
            className="text-white no-underline font-semibold transition-opacity hover:opacity-80"
          >
            Events
          </Link>
        )}
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/10 transition-colors ml-5"
          >
            <span className="text-sm font-medium">{userName || "User"}</span>
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold text-sm overflow-hidden">
              {userInitials || "U"}
            </div>
            <svg
              className={`w-4 h-4 transition-transform ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <AccountDropdown
            isOpen={isDropdownOpen}
            onClose={() => setIsDropdownOpen(false)}
            userName={userName || "User"}
            userEmail={userEmail || "user@example.com"}
            userInitials={userInitials || "U"}
            excludeRef={buttonRef}
          />
        </div>
      </div>
    </div>
  );
}
