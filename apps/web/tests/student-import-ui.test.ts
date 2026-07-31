/**
 * Pure client-side import parser — CSV + TSV/paste → rows, header handling
 * (present/absent/reordered), quoted fields, ragged rows, blank lines. No DOM.
 */
import { describe, expect, it } from "vitest";

import { parseStudentRows } from "../src/lib/student-import-ui.js";

describe("parseStudentRows", () => {
  it("parses CSV with a header row (positional headers)", () => {
    const text = [
      "fullName,email,rollNumber,orgUnit",
      "Asha Rao,asha@c.edu,R1,CSE / 2026 / A",
      "Vikram Singh,vikram@c.edu,R2,CSE / 2026 / B",
    ].join("\n");
    const { rows, hadHeader, delimiter } = parseStudentRows(text);
    expect(hadHeader).toBe(true);
    expect(delimiter).toBe(",");
    expect(rows).toEqual([
      { fullName: "Asha Rao", email: "asha@c.edu", rollNumber: "R1", orgUnit: "CSE / 2026 / A" },
      { fullName: "Vikram Singh", email: "vikram@c.edu", rollNumber: "R2", orgUnit: "CSE / 2026 / B" },
    ]);
  });

  it("parses TSV (spreadsheet paste) with a header", () => {
    const text = "fullName\temail\trollNumber\torgUnit\nAsha\tasha@c.edu\tR1\tCSE / 2026 / A";
    const { rows, hadHeader, delimiter } = parseStudentRows(text);
    expect(delimiter).toBe("\t");
    expect(hadHeader).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      fullName: "Asha",
      email: "asha@c.edu",
      rollNumber: "R1",
      orgUnit: "CSE / 2026 / A",
    });
  });

  it("maps reordered + spaced/underscored headers", () => {
    const text = [
      "Email,Full Name,org_unit,Roll Number",
      "asha@c.edu,Asha Rao,CSE / 2026 / A,R1",
    ].join("\n");
    const { rows, hadHeader } = parseStudentRows(text);
    expect(hadHeader).toBe(true);
    expect(rows[0]).toEqual({
      fullName: "Asha Rao",
      email: "asha@c.edu",
      rollNumber: "R1",
      orgUnit: "CSE / 2026 / A",
    });
  });

  it("falls back to positional order when there's no recognizable header", () => {
    const text = "Asha Rao,asha@c.edu,R1,CSE / 2026 / A";
    const { rows, hadHeader } = parseStudentRows(text);
    expect(hadHeader).toBe(false);
    expect(rows[0]).toEqual({
      fullName: "Asha Rao",
      email: "asha@c.edu",
      rollNumber: "R1",
      orgUnit: "CSE / 2026 / A",
    });
  });

  it("honors quoted fields containing the delimiter", () => {
    const text = [
      "fullName,email,rollNumber,orgUnit",
      '"Rao, Asha",asha@c.edu,R1,"CSE, A"',
    ].join("\n");
    const { rows } = parseStudentRows(text);
    expect(rows[0]?.fullName).toBe("Rao, Asha");
    expect(rows[0]?.orgUnit).toBe("CSE, A");
  });

  it("pads ragged rows and drops blank lines", () => {
    const text = [
      "fullName,email,rollNumber,orgUnit",
      "OnlyName", // missing trailing cells
      "",
      "  ",
      "Bob,bob@c.edu,R9,CSE",
    ].join("\n");
    const { rows } = parseStudentRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      fullName: "OnlyName",
      email: "",
      rollNumber: "",
      orgUnit: "",
    });
    expect(rows[1]?.email).toBe("bob@c.edu");
  });

  it("returns an empty result for blank input", () => {
    expect(parseStudentRows("").rows).toEqual([]);
    expect(parseStudentRows("\n\n   \n").rows).toEqual([]);
  });
});
