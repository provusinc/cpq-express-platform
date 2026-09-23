/**
 * The Quote Document: one `@react-pdf/renderer` tree used for both the
 * browser preview (`PDFViewer` / `usePDF`) and server rendering
 * (`renderQuoteDocument`). It takes only the plain `QuoteDocumentInput`, so
 * a stored snapshot re-renders the same document. Sections follow the
 * document settings' order and visibility; empty ones are skipped. Keep the
 * components free of hooks: the server renderer runs them outside React DOM.
 */
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"

import type {
  DocumentSection,
  DocumentSettings,
} from "@workspace/domain/documents"
import type { MilestoneType } from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"
import type { ReactNode } from "react"

import {
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  formatDocumentQuantity,
} from "./format"
import { groupLinesByPhase } from "./grouping"
import type { PhaseGroup } from "./grouping"
import type { QuoteDocumentInput, QuoteDocumentSnapshot } from "./snapshot"

const MILESTONE_TYPE_LABELS: Record<MilestoneType, string> = {
  milestone: "Milestone",
  deadline: "Deadline",
  review: "Review",
  payment_due: "Payment due",
  custom: "Other",
}

/** Letter paper where it is the norm, A4 everywhere else (height in pt). */
function pageSize(locale: string) {
  return /-(US|CA|MX|PH|CL|CO|VE)\b/i.test(locale)
    ? { size: "LETTER" as const, height: 792 }
    : { size: "A4" as const, height: 841.89 }
}

function makeStyles(settings: DocumentSettings, pageHeight: number) {
  const compact = settings.format === "compact"
  const base = compact ? 8.5 : 10
  const pad = compact ? 3 : 5
  return StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      fontSize: base,
      color: "#111827",
      paddingTop: compact ? 28 : 40,
      paddingBottom: compact ? 48 : 60,
      paddingHorizontal: compact ? 28 : 40,
      lineHeight: 1.35,
    },
    section: { marginBottom: compact ? 10 : 18 },
    label: {
      fontFamily: "Helvetica-Bold",
      fontSize: base - 1.5,
      color: settings.primaryColor,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: compact ? 3 : 5,
    },
    muted: { color: "#4b5563" },
    bold: { fontFamily: "Helvetica-Bold" },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: compact ? 8 : 12,
      borderBottomWidth: 2,
      borderBottomColor: settings.primaryColor,
    },
    headerLeft: { maxWidth: "55%" },
    headerRight: { alignItems: "flex-end", maxWidth: "45%" },
    logo: {
      maxHeight: compact ? 36 : 48,
      maxWidth: 160,
      objectFit: "contain",
      marginBottom: 6,
    },
    companyName: {
      fontFamily: "Helvetica-Bold",
      fontSize: base + 2,
      lineHeight: 1.25,
    },
    title: {
      fontFamily: "Helvetica-Bold",
      fontSize: compact ? 16 : 22,
      lineHeight: 1.1,
      color: settings.primaryColor,
      letterSpacing: 1,
      marginBottom: 4,
    },
    quoteName: {
      fontFamily: "Helvetica-Bold",
      fontSize: base + 3,
      lineHeight: 1.25,
      textAlign: "right",
    },
    paragraph: { marginTop: 4 },
    table: { borderTopWidth: 0 },
    tableHead: {
      flexDirection: "row",
      backgroundColor: settings.primaryColor,
      color: "#ffffff",
      fontFamily: "Helvetica-Bold",
      paddingVertical: pad,
      paddingHorizontal: 4,
    },
    row: {
      flexDirection: "row",
      paddingVertical: pad,
      paddingHorizontal: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    phaseRow: {
      flexDirection: "row",
      paddingVertical: pad,
      paddingHorizontal: 4,
      backgroundColor: "#f3f4f6",
      borderBottomWidth: 0.5,
      borderBottomColor: "#d1d5db",
      fontFamily: "Helvetica-Bold",
    },
    colItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 6 },
    colDates: { width: 148, paddingRight: 6 },
    dates: { fontSize: base - 1 },
    colQty: { width: 64, textAlign: "right" },
    colPrice: { width: 78, textAlign: "right" },
    colTotal: { width: 84, textAlign: "right" },
    description: { color: "#4b5563", fontSize: base - 1, marginTop: 1 },
    summary: { flexDirection: "row", justifyContent: "flex-end" },
    summaryBox: { width: compact ? "42%" : "46%" },
    summaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: compact ? 2 : 3,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
      paddingTop: 5,
      borderTopWidth: 1.5,
      borderTopColor: settings.accentColor,
      fontFamily: "Helvetica-Bold",
      fontSize: base + 2,
      color: settings.accentColor,
    },
    footer: {
      // An absolute View anchored with `bottom` isn't drawn by react-pdf;
      // `top` from the page height is.
      position: "absolute",
      top: pageHeight - (compact ? 18 : 26) - (base - 2) * 1.35 - 6,
      left: compact ? 28 : 40,
      right: compact ? 28 : 40,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: base - 2,
      color: "#6b7280",
      borderTopWidth: 0.5,
      borderTopColor: "#d1d5db",
      paddingTop: 5,
    },
    footerText: { maxWidth: "80%" },
  })
}

type Styles = ReturnType<typeof makeStyles>

interface Ctx {
  snapshot: QuoteDocumentSnapshot
  settings: DocumentSettings
  logo: string | null
  styles: Styles
  money: (amount: string) => string
  date: (iso: string) => string
}

const present = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p && p.trim() !== "")

function Lines({
  lines,
  style,
}: {
  lines: string[]
  style?: Styles[keyof Styles]
}) {
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} style={style}>
          {line}
        </Text>
      ))}
    </>
  )
}

function Header({ snapshot, logo, styles, date }: Ctx) {
  const { company, quote } = snapshot
  const locality = present(
    company.city,
    company.region,
    company.postalCode
  ).join(", ")
  return (
    <View style={[styles.section, styles.header]}>
      <View style={styles.headerLeft}>
        {logo && <Image src={logo} style={styles.logo} />}
        <Text style={styles.companyName}>{company.name}</Text>
        <Lines
          style={styles.muted}
          lines={present(
            company.addressLine1,
            company.addressLine2,
            locality,
            company.country,
            company.email,
            company.phone,
            company.website
          )}
        />
      </View>
      <View style={styles.headerRight}>
        <Text style={styles.title}>QUOTE</Text>
        <Text style={styles.quoteName}>{quote.name}</Text>
        <Text style={styles.muted}>Date: {date(snapshot.generatedAt)}</Text>
        {quote.validUntil && (
          <Text style={styles.muted}>
            Valid until: {date(quote.validUntil)}
          </Text>
        )}
        <Text style={styles.muted}>
          {snapshot.version === null
            ? "Preview"
            : `Version ${snapshot.version}`}
        </Text>
      </View>
    </View>
  )
}

function BillTo({ snapshot, styles }: Ctx) {
  const { account, contact } = snapshot
  const locality = present(
    account.billingCity,
    account.billingState,
    account.billingPostalCode
  ).join(", ")
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.label}>Bill To</Text>
      <Text style={styles.bold}>{account.name}</Text>
      <Lines
        style={styles.muted}
        lines={present(account.billingStreet, locality, account.billingCountry)}
      />
      {contact && (
        <View style={styles.paragraph}>
          <Text>
            Attn: {contact.name}
            {contact.title ? `, ${contact.title}` : ""}
          </Text>
          <Lines
            style={styles.muted}
            lines={present(contact.email, contact.phone)}
          />
        </View>
      )}
    </View>
  )
}

function Overview({ snapshot, styles, date }: Ctx) {
  const { quote } = snapshot
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.label}>Overview</Text>
      <Text style={styles.bold}>{quote.name}</Text>
      <Text style={styles.muted}>
        Period: {date(quote.startDate)} – {date(quote.endDate)}
      </Text>
      <Text style={styles.muted}>
        Prepared by: {quote.owner.name ?? quote.owner.email}
        {quote.owner.name ? ` (${quote.owner.email})` : ""}
      </Text>
      {quote.description && (
        <Text style={styles.paragraph}>{quote.description}</Text>
      )}
    </View>
  )
}

function LineRow({
  line,
  ctx,
  indent,
}: {
  line: QuoteDocumentSnapshot["lines"][number]
  ctx: Ctx
  indent: number
}) {
  const { styles, settings, money, date } = ctx
  const compact = settings.format === "compact"
  const qty = formatDocumentQuantity(line.quantity, {
    locale: settings.locale,
    decimals: settings.quantityDecimals,
  })
  return (
    <View style={styles.row} wrap={false}>
      <View style={[styles.colItem, { paddingLeft: indent }]}>
        <Text>{line.name}</Text>
        {!compact && line.description && (
          <Text style={styles.description}>{line.description}</Text>
        )}
      </View>
      {!compact && (
        <Text style={[styles.colDates, styles.muted, styles.dates]}>
          {date(line.startDate)} – {date(line.endDate)}
        </Text>
      )}
      <Text style={styles.colQty}>
        {line.billingUnit === "hour" ? `${qty} h` : qty}
      </Text>
      <Text style={styles.colPrice}>{money(line.unitPrice)}</Text>
      <Text style={styles.colTotal}>{money(line.lineTotal)}</Text>
    </View>
  )
}

function PhaseRows({ group, ctx }: { group: PhaseGroup; ctx: Ctx }) {
  const indent = group.depth * 10
  return (
    <>
      <View style={ctx.styles.phaseRow} wrap={false} minPresenceAhead={24}>
        <Text style={[ctx.styles.colItem, { paddingLeft: indent }]}>
          {group.phase.name}
        </Text>
        <Text style={ctx.styles.colTotal}>{ctx.money(group.subtotal)}</Text>
      </View>
      {group.lines.map((line) => (
        <LineRow key={line.id} line={line} ctx={ctx} indent={indent + 8} />
      ))}
      {group.children.map((child) => (
        <PhaseRows key={child.phase.id} group={child} ctx={ctx} />
      ))}
    </>
  )
}

function LineItems(ctx: Ctx) {
  const { snapshot, styles, settings } = ctx
  if (snapshot.lines.length === 0) return null
  const groups = groupLinesByPhase(snapshot.phases, snapshot.lines)
  const compact = settings.format === "compact"
  const hasPhases = groups.phases.length > 0
  return (
    <View style={styles.section}>
      <Text style={styles.label} minPresenceAhead={60}>
        Line Items
      </Text>
      <View style={styles.table}>
        <View style={styles.tableHead} fixed>
          <Text style={styles.colItem}>Item</Text>
          {!compact && <Text style={styles.colDates}>Dates</Text>}
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colPrice}>Unit price</Text>
          <Text style={styles.colTotal}>Total</Text>
        </View>
        {groups.phases.map((group) => (
          <PhaseRows key={group.phase.id} group={group} ctx={ctx} />
        ))}
        {hasPhases && groups.unphased.length > 0 && (
          <View style={styles.phaseRow} wrap={false} minPresenceAhead={24}>
            <Text style={styles.colItem}>
              Other items (no {snapshot.labels.phase.singular.toLowerCase()})
            </Text>
          </View>
        )}
        {groups.unphased.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            ctx={ctx}
            indent={hasPhases ? 8 : 0}
          />
        ))}
      </View>
    </View>
  )
}

function Summary({ snapshot, styles, money, settings }: Ctx) {
  const { quote } = snapshot
  const hasDiscount =
    quote.discountKind !== null && !new Decimal(quote.discountAmount).isZero()
  const discountLabel =
    quote.discountKind === "percent" && quote.discountValue
      ? `Discount (${formatDocumentPercent(quote.discountValue, settings.locale)})`
      : "Discount"
  return (
    <View style={[styles.section, styles.summary]} wrap={false}>
      <View style={styles.summaryBox}>
        <View style={styles.summaryRow}>
          <Text>Subtotal</Text>
          <Text>{money(quote.subtotal)}</Text>
        </View>
        {hasDiscount && (
          <View style={styles.summaryRow}>
            <Text>{discountLabel}</Text>
            <Text>-{money(quote.discountAmount)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text>Total ({quote.currencyCode})</Text>
          <Text>{money(quote.total)}</Text>
        </View>
      </View>
    </View>
  )
}

function Milestones({ snapshot, styles, date }: Ctx) {
  if (snapshot.milestones.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.label} minPresenceAhead={40}>
        Milestones
      </Text>
      <View style={styles.tableHead}>
        <Text style={styles.colItem}>Milestone</Text>
        <Text style={styles.colPrice}>Type</Text>
        <Text style={styles.colTotal}>Date</Text>
      </View>
      {snapshot.milestones.map((m, i) => (
        <View key={i} style={styles.row} wrap={false}>
          <View style={styles.colItem}>
            <Text>{m.name}</Text>
            {m.description && (
              <Text style={styles.description}>{m.description}</Text>
            )}
          </View>
          <Text style={styles.colPrice}>{MILESTONE_TYPE_LABELS[m.type]}</Text>
          <Text style={styles.colTotal}>{date(m.date)}</Text>
        </View>
      ))}
    </View>
  )
}

function Terms({ settings, styles }: Ctx) {
  if (!settings.terms) return null
  return (
    // Short terms stay on one page with their heading.
    <View style={styles.section} wrap={settings.terms.length > 800}>
      <Text style={styles.label} minPresenceAhead={30}>
        Terms
      </Text>
      <Text>{settings.terms}</Text>
    </View>
  )
}

function Footer({ settings, styles }: Ctx) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{settings.footerText ?? ""}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  )
}

const SECTIONS: Record<DocumentSection, (ctx: Ctx) => ReactNode> = {
  header: Header,
  bill_to: BillTo,
  overview: Overview,
  line_items: LineItems,
  summary: Summary,
  milestones: Milestones,
  terms: Terms,
  footer: Footer,
}

/** The whole Quote Document (a react-pdf `<Document>`). */
export function QuoteDocument({
  snapshot,
  settings,
  logo,
}: QuoteDocumentInput) {
  const page = pageSize(settings.locale)
  const styles = makeStyles(settings, page.height)
  const ctx: Ctx = {
    snapshot,
    settings,
    logo,
    styles,
    money: (amount) =>
      formatDocumentMoney(amount, snapshot.quote.currencyCode, {
        locale: settings.locale,
        decimals: settings.moneyDecimals,
      }),
    date: (iso) => formatDocumentDate(iso, settings.locale),
  }
  const title = `${snapshot.quote.name}${snapshot.version ? ` v${snapshot.version}` : ""}`
  return (
    <Document
      title={title}
      author={snapshot.company.name}
      subject={`Quote for ${snapshot.account.name}`}
      creator="CPQ Express"
      producer="CPQ Express"
    >
      <Page size={page.size} style={styles.page}>
        {settings.sections
          .filter((s) => s.visible)
          .map((s) => {
            const Section = SECTIONS[s.section]
            return <Section key={s.section} {...ctx} />
          })}
      </Page>
    </Document>
  )
}
