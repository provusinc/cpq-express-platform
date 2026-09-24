/**
 * Categorical series colours for the Summary and Financials charts, in a
 * fixed order (never cycled), stepped separately for light and dark. The
 * trio passes the dataviz palette checks (lightness band, chroma, CVD and
 * normal-vision separation); slot 3 is under 3:1 on the light surface, so
 * every chart ships with direct labels or a table of the same numbers.
 */
export const SERIES = {
  /** Slot 1, blue: revenue / labour. */
  one: { light: "#2a78d6", dark: "#3987e5" },
  /** Slot 2, orange: cost / Products. */
  two: { light: "#eb6834", dark: "#d95926" },
  /** Slot 3, aqua: margin, headcount / Add-ons. */
  three: { light: "#1baf7a", dark: "#199e70" },
} as const
