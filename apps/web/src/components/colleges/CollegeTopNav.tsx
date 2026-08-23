/**
 * College workspace top navigation — the shell chrome for /c/:slug/... . Replaces
 * the learner app's sidebar with a product-style top bar: college brand on the
 * left, grouped feature dropdowns in the middle, and the account menu on the
 * right. The nav is built from the shared, entitlement-aware catalog
 * (buildCollegeNav), so available sections link, not-entitled sections show a
 * "Not enabled" state, and roadmap sections show "Soon" — never a broken link.
 *
 * Responsive: the grouped dropdowns collapse into a hamburger drawer below `lg`.
 * Accessible: real buttons/links, keyboard-navigable Radix menus, aria labels.
 */
import type { CollegeEntitlements, CollegeStatus } from "@codeapt/shared";
import { Role } from "@codeapt/shared";
import {
  Award,
  BarChart3,
  BookOpen,
  Gamepad2,
  Briefcase,
  Building2,
  CalendarCheck,
  ChevronDown,
  ClipboardCheck,
  Code2,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  PenLine,
  Trophy,
  Upload,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import {
  buildCollegeNav,
  buildStudentCollegeNav,
  sectionHref,
  type CollegeNavIcon,
  type ResolvedSection,
} from "../../lib/college-nav.js";
import { cn } from "../../lib/cn.js";
import { roleLabel } from "../../lib/role-label.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { Avatar } from "../ui/avatar.js";
import { Badge } from "../ui/badge.js";
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

const ICON: Record<CollegeNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  structure: FolderTree,
  faculty: Users,
  students: GraduationCap,
  import: Upload,
  courses: BookOpen,
  exams: ClipboardCheck,
  essays: PenLine,
  challenges: Trophy,
  jobs: Briefcase,
  analytics: BarChart3,
  attendance: CalendarCheck,
  coding: Code2,
  gaming: Gamepad2,
  results: Award,
};

export interface CollegeTopNavUser {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface CollegeTopNavProps {
  slug: string;
  collegeName: string;
  collegeStatus: CollegeStatus;
  role: Role;
  entitlements: CollegeEntitlements;
  user: CollegeTopNavUser;
  onLogout: () => void;
}

/** Small trailing marker for a locked / coming-soon section. */
function StatusHint({ status }: { status: ResolvedSection["status"] }) {
  if (status === "coming_soon") {
    return (
      <Badge variant="info" className="ml-auto">
        Soon
      </Badge>
    );
  }
  if (status === "locked") {
    return (
      <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-muted">
        <Lock className="h-3 w-3" /> Not enabled
      </span>
    );
  }
  return null;
}

export function CollegeTopNav({
  slug,
  collegeName,
  collegeStatus,
  role,
  entitlements,
  user,
  onLogout,
}: CollegeTopNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // A college STUDENT gets the consume nav + their student home; operators (and
  // platform admins viewing a college) keep the manage nav + workspace home.
  const isStudent = role === Role.STUDENT;
  const groups = isStudent
    ? buildStudentCollegeNav(entitlements)
    : buildCollegeNav(entitlements);
  const dashboardPath = isStudent ? `/c/${slug}/home` : `/c/${slug}`;

  const isSectionActive = (section: ResolvedSection): boolean => {
    if (section.status !== "available" || !section.path) return false;
    return pathname === `/c/${slug}/${section.path}`;
  };
  const isGroupActive = (sections: ResolvedSection[]): boolean =>
    sections.some(isSectionActive);

  const go = (section: ResolvedSection) => {
    const href = sectionHref(slug, section);
    if (href) navigate(href);
  };

  return (
    <header className="sticky top-0 z-sticky border-b border-subtle bg-surface-raised/80 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        {/* Mobile: hamburger */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <IconButton
              aria-label="Open navigation"
              variant="ghost"
              className="lg:hidden"
              icon={<Menu className="h-5 w-5" />}
            />
          </SheetTrigger>
          <SheetContent side="left" className="w-80 overflow-y-auto">
            <MobileNav
              slug={slug}
              collegeName={collegeName}
              groups={groups}
              dashboardPath={dashboardPath}
              onNavigate={(section) => {
                setMobileOpen(false);
                if (section) go(section);
              }}
              onDashboard={() => {
                setMobileOpen(false);
                navigate(dashboardPath);
              }}
              isSectionActive={isSectionActive}
            />
          </SheetContent>
        </Sheet>

        {/* Brand → dashboard */}
        <NavLink
          to={dashboardPath}
          end
          aria-label={`${collegeName} dashboard`}
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-[16rem] truncate text-sm font-semibold leading-tight text-ink">
              {collegeName}
            </span>
            <span className="block font-mono text-[11px] leading-tight text-ink-muted">
              /c/{slug}
            </span>
          </span>
        </NavLink>

        {/* Desktop: grouped nav */}
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          <NavLink
            to={dashboardPath}
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
              )
            }
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </NavLink>

          {groups.map((group) => (
            <DropdownMenu key={group.name}>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "group relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
                    isGroupActive(group.sections)
                      ? "bg-primary/15 text-primary after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary after:content-['']"
                      : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
                  )}
                >
                  {group.name}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70 transition-transform duration-base ease-out group-data-[state=open]:rotate-180" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={10}
                collisionPadding={12}
                className="z-popover w-72 border-strong shadow-lg ring-1 ring-black/5 dark:ring-white/10"
              >
                {group.sections.map((section) => {
                  const Icon = ICON[section.icon];
                  const disabled = section.status !== "available";
                  return (
                    <DropdownMenuItem
                      key={section.key}
                      disabled={disabled}
                      className="items-start"
                      onSelect={() => {
                        if (!disabled) go(section);
                      }}
                    >
                      <Icon className="mt-0.5 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-ink">
                          {section.label}
                        </span>
                        <span className="text-[11px] leading-snug text-ink-muted">
                          {section.description}
                        </span>
                      </span>
                      <StatusHint status={section.status} />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </nav>

        {/* Right: theme + account */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
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
                  <span className="mt-1 flex items-center gap-2">
                    <Badge variant="primary">{roleLabel(role)}</Badge>
                    {collegeStatus === "suspended" ? (
                      <Badge variant="warning">Suspended</Badge>
                    ) : null}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/app")}>
                <UserRound />
                Switch to personal account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/change-password")}>
                <UserCog />
                Change password
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onLogout}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/** Vertical nav for the mobile drawer — the same catalog, flattened by group. */
function MobileNav({
  collegeName,
  groups,
  onNavigate,
  onDashboard,
  isSectionActive,
}: {
  slug: string;
  collegeName: string;
  groups: ReturnType<typeof buildCollegeNav>;
  dashboardPath: string;
  onNavigate: (section: ResolvedSection | null) => void;
  onDashboard: () => void;
  isSectionActive: (section: ResolvedSection) => boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <span className="truncate text-sm font-semibold text-ink">
          {collegeName}
        </span>
      </div>

      <button
        onClick={onDashboard}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink"
      >
        <LayoutDashboard className="h-5 w-5" />
        Dashboard
      </button>

      {groups.map((group) => (
        <div key={group.name} className="space-y-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {group.name}
          </p>
          {group.sections.map((section) => {
            const Icon = ICON[section.icon];
            const disabled = section.status !== "available";
            const active = isSectionActive(section);
            return (
              <button
                key={section.key}
                disabled={disabled}
                onClick={() => onNavigate(section)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-default",
                  active
                    ? "bg-primary/15 text-primary"
                    : disabled
                      ? "text-ink-muted"
                      : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
                )}
              >
                <Icon className="h-5 w-5" />
                {section.label}
                <StatusHint status={section.status} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
