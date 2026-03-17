"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Upload, Search, Settings, FileText, Plus, Menu, X, Mic } from "lucide-react";
import { useAppSession } from "@/components/AppSessionProvider";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ProfileMenu } from "@/components/ProfileMenu";
import { motion, AnimatePresence } from "motion/react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, workspaces } = useAppSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    if (status === "authenticated" && workspaces.length === 0) {
      router.replace("/onboarding");
    }
  }, [router, status, workspaces.length]);

  const navItems = [
    { path: "/dashboard", label: "대시보드", icon: LayoutDashboard, exact: true },
    { path: "/upload", label: "업로드", icon: Upload, exact: false },
    { path: "/recording", label: "녹음", icon: Mic, exact: false },
    { path: "/search", label: "검색", icon: Search, exact: false },
    { path: "/settings", label: "설정", icon: Settings, exact: false },
  ];

  const isNavActive = (path: string, exact: boolean) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  if (status === "loading" || status === "unauthenticated" || workspaces.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-[var(--line-soft)] border-t-[var(--mint-500)] animate-spin mx-auto mb-4" />
          <p className="text-sm text-[var(--text-secondary)]">워크스페이스를 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex">
      {/* Mobile Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 border-r border-[var(--line-soft)] bg-[var(--sidebar)] flex flex-col
          transform transition-transform duration-200 ease-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Logo */}
        <div className="p-6 border-b border-[var(--line-soft)] flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center">
              <FileText className="w-5 h-5 text-[var(--graphite-950)]" />
            </div>
            <span className="text-xl font-semibold">Brevoca</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--graphite-800)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isNavActive(item.path, item.exact);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] transition-all duration-200 ${
                  isActive
                    ? "bg-[var(--sidebar-accent)] text-[var(--text-primary)] shadow-[inset_0_0_20px_rgba(0,0,0,0.15)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-accent)]/50 hover:text-[var(--text-primary)]"
                }`}
              >
                {/* Left accent bar */}
                {isActive && (
                  <motion.div
                    layoutId="nav-active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-[var(--mint-500)] to-[var(--sky-500)] shadow-[0_0_8px_var(--mint-500)]"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <Icon className={`w-5 h-5 transition-colors duration-200 ${isActive ? "text-[var(--mint-400)]" : ""}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-[var(--line-soft)]">
          <div className="text-xs text-[var(--text-secondary)] px-4">
            Brevoca v1.0 Beta
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 border-b border-[var(--line-soft)] bg-[var(--bg-surface)]/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden md:flex items-center gap-4">
              <WorkspaceSwitcher />
              <GlobalSearch />
            </div>
            {/* Mobile: show only search */}
            <div className="md:hidden">
              <GlobalSearch />
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            <Link
              href="/upload"
              className="flex items-center gap-2 px-3 lg:px-4 py-2 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">새 회의</span>
            </Link>
            <ProfileMenu />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
