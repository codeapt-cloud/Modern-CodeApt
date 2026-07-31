import {
  isCollegeOperator,
  isCollegeStudent,
  isPlatformAdmin,
} from "@codeapt/shared";
import {
  Briefcase,
  BookOpen,
  Building2,
  ClipboardCheck,
  Cpu,
  FilePenLine,
  Flame,
  FolderTree,
  IndianRupee,
  LayoutDashboard,
  Library,
  Ticket,
  PenLine,
  Receipt,
  Settings,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Trophy,
  Users,
} from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";

import { AppShell, type NavItem } from "../components/layout/AppShell.js";
import { DropdownMenuItem } from "../components/ui/dropdown-menu.js";
import { useToast } from "../components/ui/toast.js";
import { api } from "../lib/api-client.js";
import { imageUrl } from "../lib/cloudinary.js";
import { homePathForUser } from "../lib/home-nav.js";
import { useQuery } from "../lib/use-query.js";
import { useAuth } from "../providers/AuthProvider.js";

const baseNav: NavItem[] = [
  { label: "Dashboard", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Courses", to: "/courses", icon: BookOpen },
  { label: "Daily challenge", to: "/challenge", icon: Flame },
  { label: "Exams", to: "/exams", icon: ClipboardCheck },
  { label: "Essays", to: "/essays", icon: PenLine },
  { label: "Careers", to: "/careers", icon: Briefcase },
  { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
  { label: "Playground", to: "/playground", icon: TerminalSquare },
  { label: "My orders", to: "/orders", icon: Receipt },
];

/** Authenticated shell layout shared by all protected pages. */
export function AppLayout() {
  const { user, profile, logout } = useAuth();
  // A college MEMBER (operator OR college student) who has switched into the
  // personal learner app gets a "Back to college" account-menu action to return
  // to their college home — operators to their workspace, students to their
  // student dashboard. Individual users / platform admins never see it (they
  // aren't college members, so no network call is made for them).
  const collegeMember =
    !!user &&
    (isCollegeOperator(user.role) ||
      isCollegeStudent(user.role, user.userType));
  const { data: myCollege } = useQuery(
    () =>
      collegeMember ? api.me.college() : Promise.resolve({ college: null }),
    [collegeMember, user?.id],
  );
  const collegeSlug = collegeMember ? (myCollege?.college?.slug ?? null) : null;
  const collegeHome =
    user && collegeSlug
      ? homePathForUser(user.role, user.userType, collegeSlug)
      : null;
  const nav: NavItem[] = [
    ...baseNav,
    ...(user && isPlatformAdmin(user.role)
      ? [
          { label: "Colleges", to: "/admin/colleges", icon: Building2 },
          {
            label: "Manage curriculum",
            to: "/admin/curriculum",
            icon: FolderTree,
          },
          { label: "Manage postings", to: "/admin/careers", icon: Settings },
          { label: "Manage exams", to: "/admin/exams", icon: FilePenLine },
          {
            label: "Manage essay prompts",
            to: "/admin/essay-topics",
            icon: PenLine,
          },
          { label: "Manage challenges", to: "/admin/challenges", icon: Flame },
          { label: "Question banks", to: "/admin/question-banks", icon: Library },
          { label: "AI providers", to: "/admin/ai-providers", icon: Cpu },
          { label: "Manage coupons", to: "/admin/coupons", icon: Ticket },
          { label: "Users", to: "/admin/users", icon: Users },
          { label: "Orders", to: "/admin/orders", icon: IndianRupee },
          {
            label: "Essay analytics",
            to: "/admin/essay-analytics",
            icon: ShieldAlert,
          },
        ]
      : []),
    // Dev-only design-system gallery (route exists only in dev builds).
    ...(import.meta.env.DEV
      ? [{ label: "Component gallery", to: "/dev/ui", icon: Sparkles }]
      : []),
  ];
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    await logout();
    toast({ title: "Signed out" });
    navigate("/login", { replace: true });
  };

  return (
    <AppShell
      nav={nav}
      user={{
        name: profile?.fullName ?? user?.username ?? "User",
        email: user?.email ?? "",
        avatarUrl: imageUrl(profile?.avatarUrl),
      }}
      onLogout={handleLogout}
      accountExtra={
        collegeHome ? (
          <DropdownMenuItem onSelect={() => navigate(collegeHome)}>
            <Building2 />
            Back to college
          </DropdownMenuItem>
        ) : undefined
      }
    >
      <Outlet />
    </AppShell>
  );
}
