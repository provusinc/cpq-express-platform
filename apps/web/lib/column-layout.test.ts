import { describe, expect, it } from "vitest"

import { resolveColumnLayout, toSavedLayout } from "./column-layout"

const COLUMNS = ["select", "name", "account", "owner", "status", "total"]
const opts = { fixed: ["select", "name"], defaultHidden: ["total"] }

describe("resolveColumnLayout", () => {
  it("uses the default order and hidden columns without a saved layout", () => {
    expect(resolveColumnLayout(COLUMNS, null, opts)).toEqual({
      order: COLUMNS,
      visibility: {
        select: true,
        name: true,
        account: true,
        owner: true,
        status: true,
        total: false,
      },
    })
  })

  it("applies a saved layout, keeps fixed columns first and shown", () => {
    const layout = resolveColumnLayout(
      COLUMNS,
      {
        order: ["status", "name", "account", "owner", "total"],
        hidden: ["owner", "name"],
      },
      opts
    )
    expect(layout.order).toEqual([
      "select",
      "name",
      "status",
      "account",
      "owner",
      "total",
    ])
    expect(layout.visibility).toMatchObject({
      name: true,
      owner: false,
      total: true,
    })
  })

  it("drops unknown ids and slots new columns after their default neighbour", () => {
    const layout = resolveColumnLayout(
      COLUMNS,
      { order: ["status", "gone", "account"], hidden: [] },
      opts
    )
    expect(layout.order).toEqual([
      "select",
      "name",
      "status",
      "total",
      "account",
      "owner",
    ])
  })
})

describe("toSavedLayout", () => {
  it("round-trips a layout", () => {
    const layout = resolveColumnLayout(COLUMNS, null, opts)
    const saved = toSavedLayout(layout, opts.fixed)
    expect(saved).toEqual({
      order: ["account", "owner", "status", "total"],
      hidden: ["total"],
    })
    expect(resolveColumnLayout(COLUMNS, saved, opts)).toEqual(layout)
  })

  it("puts fixed columns back first after a reorder moved them", () => {
    const layout = resolveColumnLayout(COLUMNS, null, opts)
    const reordered = {
      ...layout,
      order: ["account", "owner", "name", "select", "total", "status"],
    }
    expect(
      resolveColumnLayout(COLUMNS, toSavedLayout(reordered, opts.fixed), opts)
        .order
    ).toEqual(["select", "name", "account", "owner", "total", "status"])
  })
})
