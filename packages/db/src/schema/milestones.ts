import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { MILESTONE_TYPES } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"
import { quotes } from "./quotes"

/** A Milestone's type (milestone, deadline, review, payment due, custom). */
export const milestoneTypeEnum = pgEnum("milestone_type", MILESTONE_TYPES)

/**
 * A dated marker on a Quote's Timeline (glossary: Milestone). It carries no
 * price. `date` is an ISO `yyyy-MM-dd` string; `colour` is lowercase
 * `#rrggbb` (the domain's `checkMilestoneColour`); `completed` is reset
 * when a Quote is cloned. Deleting the Quote deletes its Milestones.
 */
export const milestones = organizationTable(
  "milestones",
  {
    quoteId: uuid().notNull(),
    name: text().notNull(),
    date: date({ mode: "string" }).notNull(),
    type: milestoneTypeEnum().notNull().default("milestone"),
    colour: text().notNull(),
    completed: boolean().notNull().default(false),
    description: text(),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    check("milestones_colour_hex", sql`${t.colour} ~ '^#[0-9a-f]{6}$'`),
    check("milestones_name_not_blank", sql`btrim(${t.name}) <> ''`),
    index().on(t.organizationId, t.quoteId, t.date),
  ]
)

export type Milestone = typeof milestones.$inferSelect
export type NewMilestone = typeof milestones.$inferInsert
