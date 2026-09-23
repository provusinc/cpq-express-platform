import { describe, expect, it } from "vitest"

import { parseCsv, parseCsvRecords, toCsv } from "./csv"

describe("parseCsv", () => {
  it.each([
    [
      "a,b\n1,2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "a,b\r\n1,2\r\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    ["﻿Name\nX", [["Name"], ["X"]]],
    ['"a, b","say ""hi"""', [["a, b", 'say "hi"']]],
    ['"line\nbreak",x', [["line\nbreak", "x"]]],
    [
      "a,,c\n\n\n1,2,",
      [
        ["a", "", "c"],
        ["1", "2", ""],
      ],
    ],
    ["", []],
  ])("parses %j", (text, expected) => {
    expect(parseCsv(text)).toEqual(expected)
  })
})

describe("parseCsvRecords", () => {
  it("maps each data row to its headers", () => {
    expect(parseCsvRecords(" Name ,Price\nBasic,75\nShort\n")).toEqual({
      headers: ["Name", "Price"],
      records: [
        { Name: "Basic", Price: "75" },
        { Name: "Short", Price: "" },
      ],
    })
  })
})

describe("toCsv", () => {
  it("round-trips cells that need quoting", () => {
    const rows = [
      ["Name", "Description"],
      ["UI/UX", 'Design, "sprint"\nincluded'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n")
  })
})
