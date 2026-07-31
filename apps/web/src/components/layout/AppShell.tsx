import { LogOut, Menu, UserCog, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { cn } from "../../lib/cn.js";
import { Logo } from "../brand/Logo.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { Avatar } from "../ui/avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { IconButton } from "../ui/icon-button.js";
import { Sheet, SheetContent, SheetTrigger } from "../ui/sheet.js";
import { Sidebar, SidebarLabel, SidebarLink } from "../ui/sidebar.js";
import { Footer } from "./Footer.js";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface AppShellUser {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface AppShellProps {
  nav: NavItem[];
  user?: AppShellUser;
  onLogout?: () => void;
  /** Extra item(s) for the account menu (e.g. "Switch to personal account"). */
  accountExtra?: ReactNode;
  children: ReactNode;
}

function NavList({
  nav,
  onNavigate,
}: {
  nav: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {nav.map(({ label, to, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/15 text-primary"
                : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({
  nav,
  user,
  onLogout,
  accountExtra,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar — collapsed icon rail; expands to labels on hover/focus */}
      <Sidebar>
        {/* Brand: brace mark when collapsed, full wordmark when expanded (cross-fade) */}
        <div className="relative flex h-16 shrink-0 items-center px-4">
          <NavLink
            to="/app"
            aria-label="CodeApt home"
            className="flex items-center rounded-md focus-visible:outline-none focus-visible:shadow-focus"
          >
            <SidebarLabel
              variant="collapsed"
              className="absolute left-4 font-mono text-xl font-bold text-primary"
            >
              <span aria-hidden="true">{"{ }"}</span>
            </SidebarLabel>
            <SidebarLabel>
              <Logo className="h-7" />
            </SidebarLabel>
          </NavLink>
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          {nav.map((item) => (
            <SidebarLink
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              end={item.end}
            />
          ))}
        </div>
        <div className="shrink-0 border-t border-subtle px-3 py-4">
          <p className="flex items-center gap-2 px-2 font-mono text-xs text-ink-muted">
            <span aria-hidden="true">{"{ }"}</span>
            <SidebarLabel>CodeApt</SidebarLabel>
          </p>
        </div>
      </Sidebar>

      {/* Content offset = collapsed rail width (SIDEBAR_RAIL_WIDTH = 4.5rem) */}
      <div className="flex min-h-screen flex-col lg:pl-[4.5rem]">
        {/* Topbar */}
        <header className="sticky top-0 z-sticky flex h-16 items-center justify-between gap-4 border-b border-subtle bg-surface-raised/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            {/* Mobile nav trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <IconButton
                  aria-label="Open navigation"
                  variant="ghost"
                  className="lg:hidden"
                  icon={<Menu className="h-5 w-5" />}
                />
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <div className="mb-6">
                  <Logo className="h-7" />
                </div>
                <NavList nav={nav} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="lg:hidden">
              <Logo className="h-6" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:shadow-focus"
                    aria-label="Account menu"
                  >
                    <Avatar size="sm" name={user.name} src={user.avatarUrl} />
                    <span className="hidden text-sm font-medium text-ink sm:block">
                      {user.name}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-ink">
                        {user.name}
                      </span>
                      <span className="truncate text-xs font-normal text-ink-muted">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {accountExtra ? (
                    <>
                      {accountExtra}
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => navigate("/change-password")}
                  >
                    <UserCog />
                    Change password
                  </DropdownMenuItem>
                  {onLogout ? (
                    <DropdownMenuItem onSelect={onLogout}>
                      <LogOut />
                      Log out
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
