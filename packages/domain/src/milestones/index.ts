/**
 * Milestone rules: a dated marker on a Quote's timeline (glossary:
 * Milestone). It carries no price. Its colour is a `#rrggbb` hex string;
 * each type has a default colour the editor preselects.
 */
import type { MilestoneType } from "../enums"

/** The longest Milestone name. */
export const MILESTONE_NAME_MAX = 200
/** The longest Milestone description. */
export const MILESTONE_DESCRIPTION_MAX = 2000

/** A colour as stored: `#` and six hex digits, lowercase. */
export const MILESTONE_COLOUR_PATTERN = /^#[0-9a-f]{6}$/

/** The colour a new Milestone of each type starts with. */
export const DEFAULT_MILESTONE_COLOURS: Record<MilestoneType, string> = {
  milestone: "#2563eb",
  deadline: "#dc2626",
  review: "#7c3aed",
  payment_due: "#16a34a",
  custom: "#64748b",
}

export type ColourCheck =
  | { ok: true; colour: string }
  | { ok: false; reason: "invalid_colour"; message: string }

/**
 * Checks a colour input (`#rgb` or `#rrggbb`, any case) and normalises it
 * to lowercase `#rrggbb`.
 */
export function checkMilestoneColour(input: string): ColourCheck {
  const value = input.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value)
  const colour = short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : value
  if (!MILESTONE_COLOUR_PATTERN.test(colour)) {
    return {
      ok: false,
      reason: "invalid_colour",
      message: "Use a hex colour such as #2563eb.",
    }
  }
  return { ok: true, colour }
}
