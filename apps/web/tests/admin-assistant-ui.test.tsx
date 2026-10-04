// @vitest-environment jsdom
/**
 * Admin Assistant UI (Step 41: interactive checklist) — component tests. Covers the
 * launcher gating, the structured GuideSteps checklist (checkable rows, in-app
 * links, control chips, prereq/gotcha), and the integration invariants: ticking
 * persists across collapse/expand AND across an in-app navigation, and a step's
 * link navigates in-app without resetting the conversation.
 */
import {
  CollegeFeature,
  Role,
  buildDefaultEntitlements,
  subCapabilityKey,
  type AdminAssistantReply,
  type CollegeEntitlements,
} from "@codeapt/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guideReply: AdminAssistantReply = {
  kind: "guide",
  message: "Here's how to attach a game set to a course:",
  steps: [
    {
      text: "Create a GAME curriculum topic",
      route: "/admin/curriculum",
      control: "New topic",
      prerequisite: "A Program → Course → Module must exist",
    },
    {
      text: "Create the platform game set and pick that topic",
      route: "/admin/game-sets",
      control: "New set",
      gotcha: "A college game set can't attach to a course",
    },
  ],
  toolsUsed: ["capability_details"],
  facts: [],
  creditsSpent: 1,
  modelTurns: 2,
};

vi.mock("../src/lib/api-client.js", () => ({
  api: {
    collegeAssistant: { chat: vi.fn(async () => guideReply) },
    adminAssistant: { chat: vi.fn(async () => guideReply) },
  },
  parseApiError: (e: unknown) => ({ message: String(e) }),
}));

import { GuideSteps } from "../src/components/assistant/GuideSteps.js";
import { AssistantPanel } from "../src/components/assistant/AssistantPanel.js";
import {
  AssistantProvider,
  useAssistant,
} from "../src/providers/AssistantProvider.js";
import {
  assistantAvailableInCollege,
  assistantAvailableOnPlatform,
} from "../src/lib/assistant-availability.js";

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(cleanup);

function ent(on: boolean): CollegeEntitlements {
  const e = buildDefaultEntitlements();
  if (on) {
    e.features[CollegeFeature.AI] = true;
    e.subCapabilities[subCapabilityKey(CollegeFeature.AI, "admin_assistant")] = true;
  }
  return e;
}

describe("launcher visibility", () => {
  it("hidden without capability / for faculty; shown for capable admin + super", () => {
    expect(
      assistantAvailableInCollege({
        userRole: Role.COLLEGE_ADMIN,
        membershipRole: Role.COLLEGE_ADMIN,
        entitlements: ent(false),
      }),
    ).toBe(false);
    expect(
      assistantAvailableInCollege({
        userRole: Role.FACULTY,
        membershipRole: Role.FACULTY,
        entitlements: ent(true),
      }),
    ).toBe(false);
    expect(
      assistantAvailableInCollege({
        userRole: Role.COLLEGE_ADMIN,
        membershipRole: Role.COLLEGE_ADMIN,
        entitlements: ent(true),
      }),
    ).toBe(true);
    expect(assistantAvailableOnPlatform(Role.SUPER_ADMIN)).toBe(true);
  });
});

describe("GuideSteps (checklist)", () => {
  it("renders checkable rows with control chips, prereq, gotcha, and in-app links", () => {
    const onToggle = vi.fn();
    const onNavigate = vi.fn();
    render(
      <GuideSteps
        steps={guideReply.steps!}
        checked={[false, false]}
        onToggle={onToggle}
        slug="acme"
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId("guide-steps")).toBeTruthy();
    expect(screen.getByTestId("guide-control-0").textContent).toBe("New topic");
    expect(screen.getByTestId("guide-prereq-0").textContent).toContain("Program");
    expect(screen.getByTestId("guide-gotcha-1").textContent).toContain("can't attach");

    fireEvent.click(screen.getByTestId("guide-check-0"));
    expect(onToggle).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByTestId("guide-link-1"));
    expect(onNavigate).toHaveBeenCalledWith("/admin/game-sets");
  });

  it("renders no link when a route still has unfilled params (no slug)", () => {
    render(
      <GuideSteps
        steps={[{ text: "Open exams", route: "/c/:slug/exams" }]}
        checked={[false]}
        onToggle={() => undefined}
        onNavigate={() => undefined}
      />,
    );
    expect(screen.queryByTestId("guide-link-0")).toBeNull();
  });
});

// --- integration: provider + panel + router --------------------------------

function Harness() {
  const { openPanel } = useAssistant();
  const location = useLocation();
  useEffect(() => {
    openPanel({ kind: "college", slug: "acme" });
  }, [openPanel]);
  return (
    <>
      <div data-testid="where">{location.pathname}</div>
      <SendButton />
      <AssistantPanel />
    </>
  );
}
function SendButton() {
  const { send } = useAssistant();
  return (
    <button data-testid="do-send" onClick={() => void send("how do I attach a game set?")}>
      send
    </button>
  );
}

describe("panel integration — ticks survive collapse/expand + in-app nav", () => {
  it("guides, ticks, collapses/expands, navigates — nothing is lost", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/colleges"]}>
        <AssistantProvider>
          <Routes>
            <Route path="*" element={<Harness />} />
          </Routes>
        </AssistantProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("do-send"));
    });
    await waitFor(() => expect(screen.getByTestId("guide-steps")).toBeTruthy());

    // Tick step 0.
    fireEvent.click(screen.getByTestId("guide-check-0"));
    expect((screen.getByTestId("guide-check-0") as HTMLInputElement).checked).toBe(true);

    // Collapse → edge tab; expand → tick survived.
    fireEvent.click(screen.getByTestId("assistant-collapse"));
    expect(screen.getByTestId("assistant-edge")).toBeTruthy();
    expect(screen.queryByTestId("guide-steps")).toBeNull();
    fireEvent.click(screen.getByTestId("assistant-edge"));
    expect((screen.getByTestId("guide-check-0") as HTMLInputElement).checked).toBe(true);

    // Follow a step's in-app link: route changes, conversation + tick persist.
    fireEvent.click(screen.getByTestId("guide-link-1"));
    expect(screen.getByTestId("where").textContent).toBe("/admin/game-sets");
    expect(screen.getByTestId("guide-steps")).toBeTruthy();
    expect((screen.getByTestId("guide-check-0") as HTMLInputElement).checked).toBe(true);
  });
});
