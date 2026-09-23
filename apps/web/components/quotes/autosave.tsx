"use client"

/**
 * Quote editor autosave (ADR-0003): every gesture is one tRPC command,
 * applied optimistically, reconciled with what the server returns, and
 * rolled back with a toast when the server refuses. There is no Save
 * button.
 *
 * - `useQuoteEditor(quoteId)` reads `quote.editor` (Phases, Line Items and
 *   the server's totals), refetched on window focus and every 30 s.
 * - `useQuoteCommand(quoteId, trpc.x.y.mutationOptions(), { optimistic })`
 *   wraps a command's mutation:
 *   1. `optimistic(editor, input)` patches the cached editor at once (the
 *      totals are then re-priced in the browser with the domain's
 *      `priceQuote`, so the Summary moves immediately); `optimisticQuote`
 *      patches the cached `quote.byId` (header fields);
 *   2. on success the command's `EditorResult` (`lines`, `deletedLineIds`,
 *      `totals`) is merged into the editor cache and the totals into
 *      `quote.byId` — server values always win;
 *   3. on error both caches roll back and a toast shows the server's
 *      message;
 *   4. when the last in-flight command on the Quote settles, the editor,
 *      the Quote and the Quote list are refetched.
 *   Every command on one Quote shares the mutation-key prefix
 *   `quoteCommandKey(quoteId)`, which is what the indicator counts.
 * - `<QuoteSaveIndicator quoteId />` shows "Saving…" while any command on
 *   the Quote is in flight and "Saved" after one succeeded.
 *
 *   const update = useQuoteCommand(quoteId, trpc.lineItem.update.mutationOptions(), {
 *     optimistic: (editor, input) => patchLine(editor, input.id, input),
 *   })
 *   update.mutate({ quoteId, id, quantity: "3" })
 */
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { UseMutationOptions } from "@tanstack/react-query"
import { CheckIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { priceQuote } from "@workspace/domain/pricing"

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

export type QuoteEditor = RouterOutputs["quote"]["editor"]
export type EditorLine = QuoteEditor["lines"][number]
export type EditorTotals = QuoteEditor["totals"]
type Quote = RouterOutputs["quote"]["byId"]

/** What an editor command returns (`EditorResult` in the API); every field optional. */
export interface EditorResultLike {
  lines?: EditorLine[]
  deletedLineIds?: string[]
  totals?: EditorTotals
}

/** Refetch the open Quote this often, so a colleague's edits show up. */
export const QUOTE_POLL_MS = 30_000

/** Mutation-key prefix shared by every command on one Quote. */
export const quoteCommandKey = (quoteId: string) =>
  ["quoteCommand", quoteId] as const

/** The open Quote's editor state (`quote.editor`), refetched on focus and every 30 s. */
export function useQuoteEditor(quoteId: string) {
  const trpc = useTRPC()
  return useSuspenseQuery({
    ...trpc.quote.editor.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data
}

const byOrder = (a: EditorLine, b: EditorLine) =>
  a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * `editor` with a command's result merged in: returned lines replace (or
 * join) the cached ones, deleted ones leave, totals are replaced.
 */
export function mergeEditorResult(
  editor: QuoteEditor,
  result: EditorResultLike
): QuoteEditor {
  const gone = new Set(result.deletedLineIds ?? [])
  const lines = new Map(
    editor.lines.filter((l) => !gone.has(l.id)).map((l) => [l.id, l])
  )
  for (const line of result.lines ?? []) lines.set(line.id, line)
  return {
    ...editor,
    lines: [...lines.values()].sort(byOrder),
    totals: result.totals ?? editor.totals,
  }
}

/**
 * The totals the server will compute for `editor`'s lines, priced in the
 * browser with the same domain engine — for optimistic display only.
 */
export function repriceLocally(editor: QuoteEditor): QuoteEditor {
  const { totals } = editor
  const priced = priceQuote({
    currency: totals.currencyCode,
    lines: editor.lines,
    discount:
      totals.discountKind && totals.discountValue !== null
        ? { kind: totals.discountKind, value: totals.discountValue }
        : null,
  })
  return {
    ...editor,
    lines: editor.lines.map((line, i) => ({
      ...line,
      lineTotal: priced.lines[i]!.lineTotal,
      lineMarginPct: priced.lines[i]!.lineMarginPct,
    })),
    totals: {
      ...totals,
      subtotal: priced.subtotal,
      discountAmount: priced.discountAmount,
      total: priced.total,
      cost: priced.cost,
      margin: priced.margin,
      marginPct: priced.marginPct,
    },
  }
}

/** `editor` with one line's fields patched (for `optimistic`). */
export function patchLine(
  editor: QuoteEditor,
  id: string,
  patch: Partial<EditorLine>
): QuoteEditor {
  return {
    ...editor,
    lines: editor.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }
}

interface QuoteCommandConfig<TData, TVariables> {
  /** Patch the cached editor before the server answers (totals re-priced locally). */
  optimistic?: (editor: QuoteEditor, input: TVariables) => QuoteEditor
  /** Patch the cached `quote.byId` before the server answers. */
  optimisticQuote?: (quote: Quote, input: TVariables) => Partial<Quote>
  onSuccess?: (data: TData, input: TVariables) => void
  /** Runs after the rollback and the error toast. */
  onError?: (error: unknown, input: TVariables) => void
}

export interface CommandSnapshot {
  editor?: QuoteEditor
  quote?: Quote
}

/**
 * One Quote command's mutation with optimistic apply, merge, rollback and
 * the shared "Saving…" key; see the module comment. `options` is the
 * command's `trpc.<area>.<command>.mutationOptions()`.
 */
export function useQuoteCommand<TData, TError, TVariables>(
  quoteId: string,
  options: UseMutationOptions<TData, TError, TVariables>,
  config: QuoteCommandConfig<TData, TVariables> = {}
) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const editorKey = trpc.quote.editor.queryKey({ id: quoteId })
  const quoteKey = trpc.quote.byId.queryKey({ id: quoteId })
  const commandKey = quoteCommandKey(quoteId)

  return useMutation<TData, TError, TVariables, CommandSnapshot>({
    ...options,
    mutationKey: [...commandKey, ...(options.mutationKey ?? [])],
    onMutate: async (input) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: editorKey }),
        queryClient.cancelQueries({ queryKey: quoteKey }),
      ])
      const snapshot: CommandSnapshot = {
        editor: queryClient.getQueryData(editorKey),
        quote: queryClient.getQueryData(quoteKey),
      }
      if (config.optimistic && snapshot.editor) {
        queryClient.setQueryData(
          editorKey,
          repriceLocally(config.optimistic(snapshot.editor, input))
        )
      }
      if (config.optimisticQuote && snapshot.quote) {
        queryClient.setQueryData(quoteKey, {
          ...snapshot.quote,
          ...config.optimisticQuote(snapshot.quote, input),
        })
      }
      return snapshot
    },
    onSuccess: (data, input) => {
      const result = data as EditorResultLike
      if (result && typeof result === "object" && "totals" in result) {
        queryClient.setQueryData(editorKey, (editor) =>
          editor ? mergeEditorResult(editor, result) : editor
        )
        const totals = result.totals!
        queryClient.setQueryData(quoteKey, (quote) =>
          quote ? { ...quote, ...totals } : quote
        )
      }
      config.onSuccess?.(data, input)
    },
    onError: (error, input, snapshot) => {
      if (snapshot?.editor) queryClient.setQueryData(editorKey, snapshot.editor)
      if (snapshot?.quote) queryClient.setQueryData(quoteKey, snapshot.quote)
      toast.error(errorMessage(error))
      config.onError?.(error, input)
    },
    onSettled: async () => {
      // Reconcile once the last in-flight command on this Quote is done.
      if (queryClient.isMutating({ mutationKey: commandKey }) > 1) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: editorKey }),
        queryClient.invalidateQueries({ queryKey: quoteKey }),
        queryClient.invalidateQueries(trpc.quote.list.pathFilter()),
      ])
    },
  })
}

/** Whether any command on the Quote is in flight, and whether one has succeeded. */
export function useQuoteSaveState(quoteId: string) {
  const mutationKey = quoteCommandKey(quoteId)
  const saving = useIsMutating({ mutationKey }) > 0
  const saved =
    useMutationState({
      filters: { mutationKey, status: "success" },
      select: (m) => m.state.submittedAt,
    }).length > 0
  return { saving, saved }
}

/** "Saving…" / "Saved" for every command on the Quote (header, grid, Summary). */
export function QuoteSaveIndicator({ quoteId }: { quoteId: string }) {
  const { saving, saved } = useQuoteSaveState(quoteId)
  if (saving) {
    return (
      <span
        className="flex items-center gap-1 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
        Saving…
      </span>
    )
  }
  if (!saved) return null
  return (
    <span
      className="flex items-center gap-1 text-sm text-muted-foreground"
      role="status"
    >
      <CheckIcon className="size-3.5" aria-hidden />
      Saved
    </span>
  )
}
