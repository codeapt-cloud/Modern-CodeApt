// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Markdown } from "../src/components/player/Markdown.js";
import { SubjectEditorDialog } from "../src/components/curriculum/admin/SubjectEditorDialog.js";

// Mock ResizeObserver for Radix UI in jsdom
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Mock api client and toast
vi.mock("../src/lib/api-client.js", () => ({
  api: {
    adminCurriculum: {
      programs: {
        list: vi.fn().mockResolvedValue({ items: [] }),
      },
      subjects: {
        create: vi.fn().mockResolvedValue({ id: "subj-1" }),
        update: vi.fn().mockResolvedValue({ id: "subj-1" }),
      },
    },
  },
  parseApiError: vi.fn().mockReturnValue({ message: "An error occurred" }),
}));

vi.mock("../src/components/ui/toast.js", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("Markdown renderer for course descriptions", () => {
  it("renders bold text using strong tag when ** is used", () => {
    const { container } = render(
      <Markdown content="This is **bold text** and this is normal." />,
    );
    const strongEl = container.querySelector("strong");
    expect(strongEl).not.toBeNull();
    expect(strongEl?.textContent).toBe("bold text");
  });

  it("renders structured bullet lists for - list items", () => {
    const { container } = render(
      <Markdown content={"Course highlights:\n- Topic 1\n- Topic 2\n- Topic 3"} />,
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0]?.textContent).toBe("Topic 1");
    expect(items[1]?.textContent).toBe("Topic 2");
    expect(items[2]?.textContent).toBe("Topic 3");
  });

  it("renders structured headings for ### headers", () => {
    const { container } = render(
      <Markdown content="### Syllabus Overview&#10;Detailed description here." />,
    );
    const h3 = container.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toBe("Syllabus Overview");
  });

  it("preserves single line breaks within paragraphs via whitespace-pre-line", () => {
    const { container } = render(
      <Markdown content={"Line 1\nLine 2\nLine 3"} />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.className).toContain("whitespace-pre-line");
    expect(p?.textContent).toBe("Line 1\nLine 2\nLine 3");
  });
});

describe("SubjectEditorDialog description tabbed editor", () => {
  it("provides Write and Preview tabs for the description", async () => {
    render(
      <SubjectEditorDialog
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        initial={undefined}
      />
    );

    const writeTab = screen.getByRole("button", { name: /write/i });
    const previewTab = screen.getByRole("button", { name: /preview/i });
    expect(writeTab).toBeDefined();
    expect(previewTab).toBeDefined();

    const textarea = screen.getByPlaceholderText(/Course Highlights/i);
    expect(textarea).toBeDefined();

    // Type markdown into the description textarea
    fireEvent.change(textarea, {
      target: { value: "**Fast Track:**\n- 5 Tests\n- Video solutions" },
    });

    // Switch to Preview tab
    fireEvent.click(previewTab);

    // Verify preview renders bold text and list
    await waitFor(() => {
      expect(screen.getByText("Fast Track:")).toBeDefined();
      expect(screen.getByText("5 Tests")).toBeDefined();
      expect(screen.getByText("Video solutions")).toBeDefined();
    });
  });
});
