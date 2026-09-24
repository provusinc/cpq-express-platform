import { describe, expect, it } from "vitest"

import {
  canDeleteQuoteDocument,
  checkDocumentSettings,
  completeSections,
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_SECTIONS,
  normalizeHexColor,
  sectionsFromColumns,
  sectionsToColumns,
} from "./index"

describe("normalizeHexColor", () => {
  it.each([
    ["#1F2937", "#1f2937"],
    [" #abc ", "#aabbcc"],
    ["#000000", "#000000"],
    ["1f2937", null],
    ["#12345", null],
    ["#ggg", null],
    ["red", null],
    ["", null],
  ])("%j → %j", (input, expected) => {
    expect(normalizeHexColor(input)).toBe(expected)
  })
})

describe("sections", () => {
  it("completes a partial list, keeping its order and the first duplicate", () => {
    const sections = completeSections([
      { section: "summary", visible: false },
      { section: "header", visible: true },
      { section: "summary", visible: true },
    ])
    expect(sections.map((s) => s.section)).toEqual([
      "summary",
      "header",
      ...DOCUMENT_SECTIONS.filter((s) => s !== "summary" && s !== "header"),
    ])
    expect(sections[0]).toEqual({ section: "summary", visible: false })
    expect(sections.slice(2).every((s) => s.visible)).toBe(true)
  })

  it("round-trips through the stored columns", () => {
    const sections = completeSections([
      { section: "terms", visible: false },
      { section: "line_items", visible: true },
      { section: "milestones", visible: false },
    ])
    const columns = sectionsToColumns(sections)
    expect(columns.hiddenSections).toEqual(["terms", "milestones"])
    expect(
      sectionsFromColumns(columns.sectionOrder, columns.hiddenSections)
    ).toEqual(sections)
  })
})

describe("checkDocumentSettings", () => {
  const valid = { ...DEFAULT_DOCUMENT_SETTINGS }

  it("accepts and normalises valid settings", () => {
    const check = checkDocumentSettings({
      ...valid,
      primaryColor: "#ABC",
      locale: "en-gb",
      footerText: "  Thank you  ",
      terms: "   ",
      sections: [{ section: "footer", visible: false }],
    })
    expect(check).toMatchObject({
      ok: true,
      value: {
        primaryColor: "#aabbcc",
        locale: "en-GB",
        footerText: "Thank you",
        terms: null,
      },
    })
    if (check.ok) {
      expect(check.value.sections).toHaveLength(DOCUMENT_SECTIONS.length)
      expect(check.value.sections[0]).toEqual({
        section: "footer",
        visible: false,
      })
    }
  })

  it.each([
    [{ primaryColor: "blue" }, "primaryColor"],
    [{ accentColor: "#12" }, "accentColor"],
    [{ moneyDecimals: 5 }, "moneyDecimals"],
    [{ moneyDecimals: 1.5 }, "moneyDecimals"],
    [{ quantityDecimals: -1 }, "quantityDecimals"],
    [{ quantityDecimals: 4 }, "quantityDecimals"],
    [{ locale: "not a locale!" }, "locale"],
    [{ locale: "" }, "locale"],
    [{ footerText: "x".repeat(501) }, "footerText"],
    [
      {
        sections: [
          { section: "header", visible: true },
          { section: "header", visible: false },
        ],
      },
      "sections",
    ],
  ] as const)("refuses %j", (patch, field) => {
    expect(checkDocumentSettings({ ...valid, ...patch })).toMatchObject({
      ok: false,
      field,
    })
  })

  it("allows the currency's decimals (null) and 0", () => {
    expect(checkDocumentSettings({ ...valid, moneyDecimals: null }).ok).toBe(
      true
    )
    expect(checkDocumentSettings({ ...valid, moneyDecimals: 0 }).ok).toBe(true)
  })
})

describe("canDeleteQuoteDocument", () => {
  const owner = { userId: "owner", role: "member", isApprover: false } as const
  const admin = { userId: "admin", role: "admin", isApprover: false } as const
  const manager = {
    userId: "manager",
    role: "manager",
    isApprover: true,
  } as const
  const quote = { ownerId: "owner" }

  it.each([
    [owner, false, true],
    [admin, false, true],
    [manager, false, false],
    [owner, true, false],
    [admin, true, false],
  ] as const)("%j captured=%s → %s", (actor, captured, allowed) => {
    expect(
      canDeleteQuoteDocument(actor, quote, { capturedByMarkSent: captured })
        .allowed
    ).toBe(allowed)
  })

  it("says why", () => {
    expect(
      canDeleteQuoteDocument(manager, quote, { capturedByMarkSent: false })
    ).toMatchObject({ reason: "owner_or_admin_only" })
    expect(
      canDeleteQuoteDocument(admin, quote, { capturedByMarkSent: true })
    ).toMatchObject({ reason: "document_captured" })
  })
})
