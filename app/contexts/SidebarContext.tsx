import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const SIDEBAR_STORAGE_KEY = "sidebar-expanded";

interface SidebarContextType {
  isExpanded: boolean;
  toggleSidebar: () => void;
  setIsExpanded: (expanded: boolean) => void;
  isMobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setMobileOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize sidebar state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) {
      setIsExpanded(stored === "true");
    }
    setIsInitialized(true);
  }, []);

  // Persist sidebar state to localStorage
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isExpanded));
    }
  }, [isExpanded, isInitialized]);

  const toggleSidebar = () => {
    setIsExpanded(!isExpanded);
  };

  const value = {
    isExpanded,
    toggleSidebar,
    setIsExpanded,
    isMobileOpen,
    setMobileOpen,
  };

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
