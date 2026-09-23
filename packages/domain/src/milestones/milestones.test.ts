import { describe, expect, it } from "vitest"

import { MILESTONE_TYPES } from "../enums"
import {
  checkMilestoneColour,
  DEFAULT_MILESTONE_COLOURS,
  MILESTONE_COLOUR_PATTERN,
} from "./index"

describe("checkMilestoneColour", () => {
  it.each([
    ["#2563EB", "#2563eb"],
    [" #abc ", "#aabbcc"],
    ["#000000", "#000000"],
  ])("accepts %s as %s", (input, colour) => {
    expect(checkMilestoneColour(input)).toEqual({ ok: true, colour })
  })

  it.each(["", "red", "#12345", "#1234567", "2563eb", "#ggg"])(
    "refuses %j",
    (input) => {
      expect(checkMilestoneColour(input)).toMatchObject({
        ok: false,
        reason: "invalid_colour",
      })
    }
  )

  it("has a valid default colour for every type", () => {
    for (const type of MILESTONE_TYPES) {
      expect(DEFAULT_MILESTONE_COLOURS[type]).toMatch(MILESTONE_COLOUR_PATTERN)
    }
  })
})
