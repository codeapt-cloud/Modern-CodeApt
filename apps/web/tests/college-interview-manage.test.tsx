// @vitest-environment jsdom
import { CollegeFeature, Role } from "@codeapt/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockContext = {
  slug: "avniet",
  context: {
    college: { id: "c1", name: "AVNIET", slug: "avniet", status: "active" as const },
    membership: { role: Role.COLLEGE_ADMIN, userType: "college" as const },
    entitlements: {
      features: { [CollegeFeature.INTERVIEW]: true },
      subCapabilities: {},
      grantedCourses: [],
    },
  },
  refetchContext: vi.fn(),
};

vi.mock("../src/pages/colleges/college-context.js", () => ({
  useCollege: () => mockContext,
}));

vi.mock("../src/lib/api-client.js", () => ({
  api: {
    collegeInterview: {
      available: vi.fn().mockResolvedValue({ items: [] }),
    },
  },
}));

import { CollegeInterviewPage } from "../src/pages/colleges/CollegeInterviewPage.js";

describe("CollegeInterviewPage Manage button for college admins", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders Manage interviews button and EmptyState create action for COLLEGE_ADMIN", async () => {
    mockContext.context.membership.role = Role.COLLEGE_ADMIN;
    mockContext.context.entitlements.features = { [CollegeFeature.INTERVIEW]: true };

    render(
      <MemoryRouter>
        <CollegeInterviewPage />
      </MemoryRouter>
    );

    // Header manage button
    const manageBtns = screen.getAllByRole("link", { name: /manage interviews/i });
    expect(manageBtns.length).toBeGreaterThan(0);
    expect(manageBtns[0].getAttribute("href")).toBe("/c/avniet/interviews/manage");

    // Empty state should reflect admin perspective once loaded
    await waitFor(() => {
      expect(screen.getByText(/no mock interviews created yet/i)).toBeDefined();
      expect(screen.getByRole("link", { name: /create & manage interviews/i })).toBeDefined();
    });
  });

  it("renders Manage interviews button for platform ADMIN (super_admin / admin)", async () => {
    mockContext.context.membership.role = Role.ADMIN;
    mockContext.context.entitlements.features = { [CollegeFeature.INTERVIEW]: true };

    render(
      <MemoryRouter>
        <CollegeInterviewPage />
      </MemoryRouter>
    );

    const manageBtn = screen.getByRole("link", { name: /manage interviews/i });
    expect(manageBtn).toBeDefined();
    expect(manageBtn.getAttribute("href")).toBe("/c/avniet/interviews/manage");
  });

  it("does NOT render Manage button for STUDENT", async () => {
    mockContext.context.membership.role = Role.STUDENT;
    mockContext.context.entitlements.features = { [CollegeFeature.INTERVIEW]: true };

    render(
      <MemoryRouter>
        <CollegeInterviewPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /manage/i })).toBeNull();
    expect(screen.queryByText(/no mock interviews created yet/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByText(/nothing assigned yet/i)).toBeDefined();
    });
  });
});
