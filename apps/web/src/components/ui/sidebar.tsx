/**
 * Collapsible navigation sidebar (desktop) — an icon rail that expands to a
 * full, labeled panel on hover or keyboard focus.
 *
 * Adapted for CodeApt from a 21st.dev / Aceternity pattern, but rewritten to fit
 * our stack and rules:
 *   - react-router `NavLink` (not `next/link`) with real active states
 *   - design tokens only (no hardcoded `neutral-*` colors), dark + light
 *   - the shared motion scale from `lib/motion` (no invented durations/easings)
 *   - reduced-motion safe: expansion/collapse snap instantly with no animation,
 *     fully functional. framer-motion only; no new dependency.
 *
 * The rail is desktop-only (`hidden lg:flex`) and fixed to the viewport's left
 * edge; it OVERLAYS page content when expanded (above the sticky header) so the
 * page never reflows on hover. Mobile navigation is handled separately by the
 * Sheet in AppShell.
 */
import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { NavLink } from "react-router-dom";

import { cn } from "../../lib/cn.js";
import { DURATION, EASING } from "../../lib/motion.js";

/**
 * Collapsed icon-rail width and expanded panel width. The rail width MUST match
 * the `lg:pl-[4.5rem]` content offset in AppShell so nothing sits under the rail.
 */
export const SIDEBAR_RAIL_WIDTH = "4.5rem"; // 72px
export const SIDEBAR_OPEN_WIDTH = "16rem"; // 256px

interface SidebarContextValue {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** false under prefers-reduced-motion → width/label transitions snap instantly. */
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within <Sidebar>");
  return ctx;
}

export interface SidebarProps {
  children: ReactNode;
  /** Optional controlled open state. Uncontrolled (hover/focus) by default. */
  open?: boolean;
  setOpen?: Dispatch<SetStateAction<boolean>>;
  className?: string;
  "aria-label"?: string;
}

/**
 * Context provider + the desktop rail container. Expands on pointer hover and on
 * keyboard focus entering it; collapses on leave/blur.
 */
export function Sidebar({
  children,
  open: openProp,
  setOpen: setOpenProp,
  className,
  "aria-label": ariaLabel = "Primary",
}: SidebarProps) {
  const [openState, setOpenState] = useState(false);
  const reduced = useReducedMotion();
  const open = openProp ?? openState;
  const setOpen = setOpenProp ?? setOpenState;
  const animate = !reduced;

  const widthTransition: Transition = animate
    ? { duration: DURATION.base, ease: EASING.standard }
    : { duration: 0 };

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      <motion.aside
        aria-label={ariaLabel}
        className={cn(
          // z-overlay (1200) sits above the sticky header (1100) so the expanded
          // panel cleanly overlays content; modals/toasts still win over it.
          "fixed inset-y-0 left-0 z-overlay hidden flex-col overflow-hidden border-r border-subtle bg-surface-raised lg:flex",
          className,
        )}
        initial={false}
        animate={{ width: open ? SIDEBAR_OPEN_WIDTH : SIDEBAR_RAIL_WIDTH }}
        transition={widthTransition}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocusCapture={() => setOpen(true)}
        onBlurCapture={(e) => {
          // Collapse only when focus actually leaves the sidebar subtree.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        {children}
      </motion.aside>
    </SidebarContext.Provider>
  );
}

/**
 * A label whose visibility tracks the rail's open state. The default
 * ("expanded") fades in when the rail expands; "collapsed" is the inverse (shown
 * only on the icon rail) — used to cross-fade a compact brand mark against the
 * full wordmark. Kept in the accessibility tree at all times (only visually
 * hidden), so screen readers always read the full navigation.
 */
export function SidebarLabel({
  children,
  className,
  variant = "expanded",
}: {
  children: ReactNode;
  className?: string;
  variant?: "expanded" | "collapsed";
}) {
  const { open, animate } = useSidebar();
  const visible = variant === "collapsed" ? !open : open;
  return (
    <motion.span
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={
        animate ? { duration: DURATION.fast, ease: EASING.out } : { duration: 0 }
      }
      className={cn("whitespace-nowrap", className)}
    >
      {children}
    </motion.span>
  );
}

export interface SidebarLinkProps {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the route exactly (react-router `end`) — used for the dashboard root. */
  end?: boolean;
  onNavigate?: () => void;
}

/**
 * A nav row: fixed-position icon (never shifts when the rail expands) + a label
 * that fades in. Active/hover styling matches the app's other nav surfaces.
 */
export function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <SidebarLabel>{label}</SidebarLabel>
    </NavLink>
  );
}
