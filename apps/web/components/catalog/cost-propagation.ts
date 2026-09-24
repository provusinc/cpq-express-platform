/**
 * The toast text after saving a Catalog Item or Resource Role, mentioning
 * Cost Propagation (`costPropagation` in the update's result) when a cost
 * change reached Draft Quotes.
 */
export function savedMessage(singular: string, result: object) {
  const quotes =
    "costPropagation" in result
      ? (result.costPropagation as { quotes: number }).quotes
      : 0
  if (quotes === 0) return `${singular} saved.`
  return `${singular} saved. The new cost was applied to ${quotes} Draft Quote${quotes === 1 ? "" : "s"}.`
}
