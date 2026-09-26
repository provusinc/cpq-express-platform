import { describe, expect, it } from "vitest"

import { DEFAULT_DOCUMENT_SETTINGS } from "@workspace/domain/documents"

import {
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  formatDocumentQuantity,
  isPdfPrintable,
} from "./format"
import { groupLinesByPhase } from "./grouping"
import { renderQuoteDocument } from "./render"
import type { QuoteDocumentSnapshot } from "./snapshot"

describe("formatDocumentMoney", () => {
  it.each([
    ["1234.5000", "USD", "en-US", null, "$1,234.50"],
    ["1234.5050", "USD", "en-US", null, "$1,234.51"],
    ["1234.5000", "USD", "en-US", 0, "$1,235"],
    ["0.1250", "USD", "en-US", 4, "$0.1250"],
    ["1234.4000", "JPY", "en-US", null, "¥1,234"],
    ["1234.5000", "EUR", "de-DE", null, "1.234,50 €"],
    ["1234.5000", "INR", "en-IN", null, "INR 1,234.50"],
  ])("%s %s %s (%s dp) → %s", (amount, currency, locale, decimals, out) => {
    expect(formatDocumentMoney(amount, currency, { locale, decimals })).toBe(
      out
    )
  })

  it("never emits characters Helvetica can't print", () => {
    for (const locale of ["fr-FR", "de-CH", "en-IN", "sv-SE"]) {
      const text = formatDocumentMoney("-1234567.8900", "EUR", {
        locale,
        decimals: null,
      })
      expect(isPdfPrintable(text), `${locale}: ${text}`).toBe(true)
    }
  })
})

describe("other formats", () => {
  it("formats quantities, percents and dates", () => {
    expect(
      formatDocumentQuantity("1240.000", { locale: "en-US", decimals: 2 })
    ).toBe("1,240.00")
    expect(
      formatDocumentQuantity("12.345", { locale: "en-US", decimals: 0 })
    ).toBe("12")
    expect(formatDocumentPercent("12.5000", "en-US")).toBe("12.5%")
    expect(formatDocumentDate("2026-10-01", "en-US")).toBe("Oct 1, 2026")
    expect(formatDocumentDate("2026-10-01T23:30:00.000Z", "en-GB")).toBe(
      "1 Oct 2026"
    )
  })
})

const line = (
  id: string,
  phaseId: string | null,
  lineTotal: string
): QuoteDocumentSnapshot["lines"][number] => ({
  id,
  phaseId,
  sourceKind: "resource_role",
  name: `Line ${id}`,
  description: null,
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  billingUnit: "hour",
  unitPrice: "100.0000",
  quantity: "10.000",
  lineTotal,
})

describe("groupLinesByPhase", () => {
  it("nests Phases in sequence order with subtree subtotals", () => {
    const phases = [
      { id: "b", parentId: null, name: "Build", sequence: 2 },
      { id: "a", parentId: null, name: "Discover", sequence: 1 },
      { id: "b1", parentId: "b", name: "Backend", sequence: 0 },
      { id: "empty", parentId: null, name: "Empty", sequence: 3 },
    ]
    const groups = groupLinesByPhase(phases, [
      line("1", "b1", "300.0000"),
      line("2", "a", "100.0000"),
      line("3", null, "50.0000"),
      line("4", "b", "25.5000"),
      line("5", "gone", "1.0000"),
    ])
    expect(groups.phases.map((g) => g.phase.name)).toEqual([
      "Discover",
      "Build",
    ])
    const build = groups.phases[1]!
    expect(build.subtotal).toBe("325.5000")
    expect(build.lines.map((l) => l.id)).toEqual(["4"])
    expect(build.children[0]).toMatchObject({
      depth: 1,
      subtotal: "300.0000",
      phase: { name: "Backend" },
    })
    expect(groups.unphased.map((l) => l.id)).toEqual(["3", "5"])
  })
})

export const sampleSnapshot: QuoteDocumentSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-09-23T10:00:00.000Z",
  version: 3,
  quote: {
    id: "q",
    name: "Initech – Oct 2026",
    description: "Discovery and build.",
    status: "draft",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    validUntil: "2026-10-31",
    timePeriod: "months",
    currencyCode: "USD",
    discountKind: "percent",
    discountValue: "10.0000",
    subtotal: "1000.0000",
    discountAmount: "100.0000",
    total: "900.0000",
    owner: { name: "Ada", email: "ada@acme.test" },
  },
  customer: {
    name: "Initech",
    phone: null,
    website: null,
    billingStreet: "1 Main St",
    billingCity: "Austin",
    billingState: "TX",
    billingPostalCode: "78701",
    billingCountry: "USA",
  },
  contact: {
    name: "Bill",
    title: "CTO",
    email: "bill@initech.test",
    phone: null,
  },
  profile: {
    name: "Acme",
    email: "hello@acme.test",
    phone: null,
    website: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    logoKey: null,
  },
  phases: [{ id: "a", parentId: null, name: "Discover", sequence: 0 }],
  lines: [line("1", "a", "600.0000"), line("2", null, "400.0000")],
  milestones: [
    {
      name: "Kick-off",
      date: "2026-10-01",
      type: "milestone",
      description: null,
      completed: false,
    },
  ],
  labels: { phase: { singular: "Phase", plural: "Phases" } },
}

describe("renderQuoteDocument", () => {
  it("renders a PDF in both formats", async () => {
    for (const format of ["standard", "compact"] as const) {
      const pdf = await renderQuoteDocument({
        snapshot: sampleSnapshot,
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          format,
          terms: "Net 30.",
          footerText: "Thank you",
        },
        logo: null,
      })
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
      expect(pdf.byteLength).toBeGreaterThan(1000)
    }
  })
})
