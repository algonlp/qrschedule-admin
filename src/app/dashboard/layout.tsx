"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ToastProvider } from "@/components/ui/Toast";
import { cn } from "@/components/ui/utils";

type NavItem = { name: string; href: string; icon: IconName };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: null, items: [{ name: "Overview", href: "/dashboard", icon: "overview" }] },
  {
    label: "Management",
    items: [
      { name: "Salons", href: "/dashboard/salons", icon: "salons" },
      { name: "Bookings", href: "/dashboard/bookings", icon: "bookings" },
      { name: "Customers", href: "/dashboard/customers", icon: "customers" },
      { name: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
    ],
  },
  {
    label: "Billing",
    items: [
      { name: "Subscriptions", href: "/dashboard/subscriptions", icon: "subscriptions" },
      { name: "Packages", href: "/dashboard/packages", icon: "packages" },
      { name: "Payments", href: "/dashboard/payments", icon: "payments" },
    ],
  },
  {
    label: "Messaging",
    items: [
      { name: "Messaging Pricing", href: "/dashboard/pricing", icon: "pricing" },
      { name: "Messaging Costs", href: "/dashboard/messaging-costs", icon: "cost" },
      { name: "WhatsApp Templates", href: "/dashboard/whatsapp-templates", icon: "whatsapp" },
      { name: "Send Email / SMS", href: "/dashboard/communicate", icon: "send" },
    ],
  },
  { label: "System", items: [{ name: "Logs", href: "/dashboard/logs", icon: "logs" }] },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/dashboard/salons/") && pathname !== "/dashboard/salons") return "Salon Details";
  return ALL_ITEMS.find((i) => i.href === pathname)?.name ?? "Dashboard";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // Hydrate UI-only prefs from the browser on mount (SSR can't read these);
    // a one-shot sync set here is intentional, not a render loop.
    try {
      const nextDark = document.documentElement.classList.contains("dark");
      const nextCollapsed = localStorage.getItem("qs-sidebar") === "collapsed";
      setDark(nextDark); // eslint-disable-line react-hooks/set-state-in-effect
      setCollapsed(nextCollapsed);
    } catch {
      /* private mode */
    }
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("qs-sidebar", next ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className={cn("flex items-center gap-2.5 h-14 shrink-0 border-b border-border", collapsed ? "px-3 justify-center" : "px-4")}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Icon name="calendar" className="w-4.5 h-4.5 text-primary-fg" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-fg leading-tight">QR Schedule</p>
            <p className="text-[11px] text-fg-subtle leading-tight">Admin Panel</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4">
        {NAV.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            {group.label && !collapsed && (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{group.label}</p>
            )}
            {group.label && collapsed && gi > 0 && <div className="mx-2 my-2 border-t border-border" />}
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                    collapsed ? "px-2.5 py-2 justify-center" : "px-2.5 py-2",
                    active ? "bg-primary-soft text-primary" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2.5 space-y-0.5">
        <button
          onClick={toggleTheme}
          title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
          className={cn(
            "flex items-center gap-3 w-full rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer",
            collapsed && "justify-center",
          )}
        >
          <Icon name={dark ? "sun" : "moon"} className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && (dark ? "Light mode" : "Dark mode")}
        </button>
        <button
          onClick={logout}
          title={collapsed ? "Log out" : undefined}
          className={cn(
            "flex items-center gap-3 w-full rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted hover:bg-danger-soft hover:text-danger transition-colors cursor-pointer",
            collapsed && "justify-center",
          )}
        >
          <Icon name="logout" className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && "Log out"}
        </button>
      </div>
    </div>
  );

  return (
    <ToastProvider>
      <div className="h-full flex bg-bg">
        {/* Mobile overlay */}
        {mobileOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 bg-surface border-r border-border transition-[transform,width] duration-200 lg:static lg:z-auto",
            collapsed ? "w-[4.25rem]" : "w-60",
            mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          )}
        >
          {sidebar}
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 shrink-0 bg-surface/80 backdrop-blur border-b border-border px-3 lg:px-5 flex items-center gap-3 sticky top-0 z-20">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-fg-muted hover:bg-surface-hover cursor-pointer"
            >
              <Icon name="menu" className="w-5 h-5" />
            </button>
            <button
              onClick={toggleCollapse}
              aria-label="Toggle sidebar"
              className="hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-lg text-fg-muted hover:bg-surface-hover cursor-pointer"
            >
              <Icon name="sidebar" className="w-4.5 h-4.5" />
            </button>
            <h1 className="text-sm font-semibold text-fg">{pageTitle(pathname)}</h1>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-2 text-xs text-fg-subtle">
                <span className="w-6 h-6 rounded-full bg-primary-soft text-primary flex items-center justify-center text-[10px] font-bold">A</span>
                Admin
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="mx-auto max-w-[1400px] qs-animate-in">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
