/**
 * The Quote Document's render input: a plain, serialisable snapshot of the
 * Quote as the customer sees it (no costs or margins), built by the API
 * (`buildQuoteDocumentSnapshot` in `@workspace/api`) and stored with every
 * generated Quote Document as `quote_snapshot`. Money, percentages and
 * quantities are decimal strings at storage scale; dates are ISO strings.
 */
import type { DocumentSettings } from "@workspace/domain/documents"
import type {
  BillingUnit,
  DiscountKind,
  MilestoneType,
  QuoteStage,
  SourceKind,
  TimePeriod,
} from "@workspace/domain/enums"

export interface QuoteDocumentSnapshot {
  /** Bumped when the shape changes, so old snapshots stay readable. */
  schemaVersion: 1
  /** When the snapshot was taken (ISO timestamp): the document's date. */
  generatedAt: string
  /** The Quote Document's version, or `null` for a live preview. */
  version: number | null
  quote: {
    id: string
    name: string
    description: string | null
    /** The Quote Stage and the Quote Status name at the time. */
    stage: QuoteStage
    status: string
    startDate: string
    endDate: string
    validUntil: string | null
    timePeriod: TimePeriod
    currencyCode: string
    discountKind: DiscountKind | null
    discountValue: string | null
    subtotal: string
    discountAmount: string
    total: string
    owner: { name: string | null; email: string }
  }
  /** Bill To: the Customer and its primary Contact (if any). */
  customer: {
    name: string
    phone: string | null
    website: string | null
    billingStreet: string | null
    billingCity: string | null
    billingState: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  }
  contact: {
    name: string
    title: string | null
    email: string | null
    phone: string | null
  } | null
  /** The Organization profile (Settings → Organization profile). */
  profile: {
    name: string
    email: string | null
    phone: string | null
    website: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    region: string | null
    postalCode: string | null
    country: string | null
    /** Object key of the logo the document was rendered with. */
    logoKey: string | null
  }
  phases: {
    id: string
    parentId: string | null
    name: string
    sequence: number
  }[]
  /** In grid order (sequence, then id). */
  lines: {
    id: string
    phaseId: string | null
    sourceKind: SourceKind
    name: string
    description: string | null
    startDate: string
    endDate: string
    billingUnit: BillingUnit
    unitPrice: string
    quantity: string
    lineTotal: string
  }[]
  /** By date. */
  milestones: {
    name: string
    date: string
    type: MilestoneType
    description: string | null
    completed: boolean
  }[]
  /** Display names for the Label Override terms the document prints. */
  labels: { phase: { singular: string; plural: string } }
}

/** Everything `QuoteDocument` and `renderQuoteDocument` need. */
export interface QuoteDocumentInput {
  snapshot: QuoteDocumentSnapshot
  settings: DocumentSettings
  /**
   * The logo as a `data:` URL (PNG or JPEG: the PDF renderer can't embed SVG
   * or WebP), or `null` to print none.
   */
  logo: string | null
}
