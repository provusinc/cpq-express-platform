import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "./root"

export { appRouter, createCaller } from "./root"
export type { AppRouter } from "./root"
export { createTRPCContext } from "./trpc"
export { ORGANIZATION_SLUG_HEADER } from "./headers"
export type { CreateContextOptions, TRPCContext } from "./trpc"
export type { InvitationStatus } from "./invitations"
export type { InUseDetails, InUseEntity, InUseCounts } from "./errors"
export type {
  CatalogItemImportValues,
  CellError,
  ResourceRoleImportValues,
  RowResult,
} from "./catalog-import"
export {
  getCompany,
  getDocumentSettings,
  getLabels,
  getOrganizationSettings,
} from "./settings"
export {
  buildQuoteDocumentSnapshot,
  generateQuoteDocument,
  QUOTE_DOCUMENT_AREA,
  removeQuoteDocumentObjects,
} from "./documents"
export type {
  GenerateQuoteDocumentOptions,
  QuoteDocumentView,
} from "./documents"
export { openQuoteDocument } from "./routers/quote-document"
export type { OpenQuoteDocumentResult } from "./routers/quote-document"
export type { OrganizationSettings } from "./settings"
export type { QuoteCommand, QuoteRow } from "./quotes"
export type {
  EditorResult,
  LineItemView,
  MilestoneView,
  PhaseView,
} from "./line-items"
export { LINE_ITEM_BATCH_MAX } from "./routers/line-item"
export { ALLOCATION_BATCH_MAX } from "./routers/allocation"
export { PHASE_NAME_MAX } from "./routers/phase"
export { QUOTE_SORT_COLUMNS } from "./routers/quote"
export type { QuoteSortColumn } from "./routers/quote"

/** `RouterInputs["health"]["check"]` */
export type RouterInputs = inferRouterInputs<AppRouter>
/** `RouterOutputs["health"]["check"]` */
export type RouterOutputs = inferRouterOutputs<AppRouter>
