import { describe, expect, it } from "vitest"

import {
  checkHoursPerDay,
  checkLabelOverride,
  checkLogoFile,
  DEFAULT_HOURS_PER_DAY_VALUE,
  LOGO_MAX_BYTES,
  resolveLabels,
} from "./index"

describe("checkHoursPerDay", () => {
  it.each([
    ["8", "8.00"],
    [8, "8.00"],
    ["7.5", "7.50"],
    [" 0.25 ", "0.25"],
    ["24", "24.00"],
  ])("accepts %j as %s", (input, value) => {
    expect(checkHoursPerDay(input)).toEqual({ ok: true, value })
  })

  it.each([
    ["", "hours_per_day_invalid"],
    [null, "hours_per_day_invalid"],
    ["abc", "hours_per_day_invalid"],
    ["NaN", "hours_per_day_invalid"],
    ["Infinity", "hours_per_day_invalid"],
    ["7.125", "hours_per_day_invalid"],
    ["0", "hours_per_day_range"],
    ["-1", "hours_per_day_range"],
    ["24.01", "hours_per_day_range"],
  ])("refuses %j (%s)", (input, reason) => {
    expect(checkHoursPerDay(input)).toMatchObject({ ok: false, reason })
  })

  it("defaults to 8 hours", () => {
    expect(DEFAULT_HOURS_PER_DAY_VALUE).toBe("8.00")
  })
})

describe("resolveLabels", () => {
  it("uses the canonical names without overrides", () => {
    expect(resolveLabels()).toEqual({
      resource_role: { singular: "Resource Role", plural: "Resource Roles" },
      phase: { singular: "Phase", plural: "Phases" },
    })
  })

  it("applies overrides and falls back per name", () => {
    const labels = resolveLabels([
      { term: "resource_role", singular: "Consultant", plural: null },
    ])
    expect(labels.resource_role).toEqual({
      singular: "Consultant",
      plural: "Resource Roles",
    })
  })
})

describe("checkLabelOverride", () => {
  it("trims names and stores blanks and canonical names as no override", () => {
    expect(
      checkLabelOverride({
        term: "phase",
        singular: "  Work   stream ",
        plural: "Phases",
      })
    ).toEqual({
      ok: true,
      value: { term: "phase", singular: "Work stream", plural: null },
    })
  })

  it("refuses names over 40 characters", () => {
    expect(
      checkLabelOverride({ term: "phase", plural: "x".repeat(41) })
    ).toMatchObject({ ok: false, reason: "label_too_long", field: "plural" })
  })
})

describe("checkLogoFile", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/svg+xml", "svg"],
    ["image/webp", "webp"],
    ["IMAGE/PNG", "png"],
  ])("accepts %s", (contentType, extension) => {
    expect(checkLogoFile({ contentType, size: 1000 })).toMatchObject({
      ok: true,
      extension,
    })
  })

  it.each([
    [{ contentType: "image/gif", size: 10 }, "logo_type"],
    [{ contentType: "text/html", size: 10 }, "logo_type"],
    [{ contentType: undefined, size: 10 }, "logo_type"],
    [{ contentType: "image/png", size: 0 }, "logo_size"],
    [{ contentType: "image/png", size: LOGO_MAX_BYTES + 1 }, "logo_size"],
  ])("refuses %j (%s)", (file, reason) => {
    expect(checkLogoFile(file)).toMatchObject({ ok: false, reason })
  })

  it("accepts exactly the maximum size", () => {
    expect(
      checkLogoFile({ contentType: "image/png", size: LOGO_MAX_BYTES }).ok
    ).toBe(true)
  })
})
