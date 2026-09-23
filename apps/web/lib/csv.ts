/**
 * A small RFC 4180 CSV reader and writer for catalog imports and their
 * templates (no dependency): quoted fields with embedded commas, quotes
 * ("") and line breaks, CRLF or LF line endings, and a UTF-8 BOM.
 */

/** Parses CSV text into rows of cells. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const endCell = () => {
    row.push(cell)
    cell = ""
  }
  const endRow = () => {
    endCell()
    if (row.length > 1 || row[0] !== "") rows.push(row)
    row = []
  }

  for (; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ",") {
      endCell()
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRow()
    } else {
      cell += c
    }
  }
  if (cell !== "" || row.length > 0) endRow()
  return rows
}

/**
 * Parses CSV text whose first row is the header into one record per data
 * row (header → cell). Missing trailing cells become "".
 */
export function parseCsvRecords(text: string): {
  headers: string[]
  records: Record<string, string>[]
} {
  const [headerRow, ...dataRows] = parseCsv(text)
  const headers = (headerRow ?? []).map((h) => h.trim())
  const records = dataRows.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]))
  )
  return { headers, records }
}

/** Quotes a cell when it needs it. */
function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Writes rows as CSV text (CRLF line endings, as spreadsheets expect). */
export function toCsv(rows: readonly (readonly string[])[]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
