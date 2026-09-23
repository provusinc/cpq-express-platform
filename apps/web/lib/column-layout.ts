/**
 * A list's column layout as the user arranged it: which columns show and in
 * what order. Saved per User (`user.preferences`) as `{ order, hidden }` of
 * column ids; these helpers turn a saved layout back into table state
 * whatever columns exist now (unknown ids dropped, new columns appended in
 * their default position, fixed columns always shown).
 */
export interface SavedColumnLayout {
  order: readonly string[]
  hidden: readonly string[]
}

export interface ColumnLayout {
  /** Every column id, in display order. */
  order: string[]
  /** Column id → shown. */
  visibility: Record<string, boolean>
}

/**
 * `columns` are the list's column ids in default order; `fixed` ones can't
 * be hidden or moved (e.g. the Name); `defaultHidden` start hidden until
 * the user shows them.
 */
export function resolveColumnLayout(
  columns: readonly string[],
  saved: SavedColumnLayout | null | undefined,
  {
    fixed = [],
    defaultHidden = [],
  }: { fixed?: readonly string[]; defaultHidden?: readonly string[] } = {}
): ColumnLayout {
  const known = new Set(columns)
  const hasSaved = Boolean(saved && (saved.order.length || saved.hidden.length))
  const savedOrder = hasSaved
    ? saved!.order.filter((id) => known.has(id) && !fixed.includes(id))
    : []
  // Columns missing from the saved order (new ones) go after the column
  // they follow by default.
  const order = [...savedOrder]
  for (const [index, id] of columns.entries()) {
    if (fixed.includes(id) || order.includes(id)) continue
    const before = columns
      .slice(0, index)
      .reverse()
      .find((c) => order.includes(c))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id)
  }
  const hidden = new Set(hasSaved ? saved!.hidden : defaultHidden)
  const leading = columns.filter((id) => fixed.includes(id))
  const all = [...leading, ...order]
  return {
    order: all,
    visibility: Object.fromEntries(
      all.map((id) => [id, fixed.includes(id) || !hidden.has(id)])
    ),
  }
}

/** The layout to save: movable column order and the hidden ids. */
export function toSavedLayout(
  layout: ColumnLayout,
  fixed: readonly string[] = []
): { order: string[]; hidden: string[] } {
  return {
    order: layout.order.filter((id) => !fixed.includes(id)),
    hidden: layout.order.filter((id) => layout.visibility[id] === false),
  }
}
