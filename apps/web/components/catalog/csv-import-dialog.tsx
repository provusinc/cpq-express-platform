"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import {
  ColumnTitle,
  ListTable,
  LocalTableRoot,
} from "@/components/shell/data-table"
import { parseCsvRecords } from "@/lib/csv"
import type { CatalogTypeView } from "@/components/shell/catalog-types"
import { useLabels } from "@/components/shell/labels"
import { trimMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import {
  catalogItemTemplate,
  downloadCsv,
  RESOURCE_ROLE_TEMPLATE,
} from "./import-templates"

/**
 * What the dialog imports: one Catalog Type's items (from its page; every
 * row gets that type) or Resource Roles.
 */
export type ImportTarget =
  | {
      type: "catalogItems"
      catalogType: Pick<
        CatalogTypeView,
        "id" | "singular" | "plural" | "billingUnits"
      >
    }
  | { type: "resourceRoles" }

interface PreviewRow {
  row: number
  name: string
  summary: string
  errors: { column: string; message: string }[]
}

/** The preview's columns: row number, name, and its errors or summary. */
const previewColumns: DataTableColumns<PreviewRow> = [
  {
    id: "row",
    accessorKey: "row",
    size: 56,
    header: ColumnTitle,
    meta: { label: "Row" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.row}</span>,
  },
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Name" },
    cell: ({ row }) =>
      row.original.name ? (
        <span className="font-medium">{row.original.name}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "details",
    header: ColumnTitle,
    meta: { label: "Details" },
    cell: ({ row }) =>
      row.original.errors.length > 0 ? (
        <ul className="whitespace-normal text-destructive">
          {row.original.errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted-foreground">{row.original.summary}</span>
      ),
  },
]
const previewRowId = (row: PreviewRow) => String(row.row)

/**
 * CSV import: download the template, pick a file, preview every row with
 * its errors (validated by the API, nothing saved), then import all rows in
 * one transaction. Import is enabled only when every row is valid.
 */
export function CsvImportButton({ target }: { target: ImportTarget }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UploadIcon data-icon="inline-start" />
        Import CSV
      </Button>
      <CsvImportDialog target={target} open={open} onOpenChange={setOpen} />
    </>
  )
}

function CsvImportDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ImportTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const template =
    target.type === "catalogItems"
      ? catalogItemTemplate(target.catalogType)
      : RESOURCE_ROLE_TEMPLATE
  const labels = useLabels()
  const noun =
    target.type === "catalogItems"
      ? target.catalogType.plural
      : labels.resource_role.plural

  const [fileName, setFileName] = useState<string | null>(null)
  const [records, setRecords] = useState<Record<string, string>[]>([])
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const reset = () => {
    setFileName(null)
    setRecords([])
    setPreview(null)
    setProblem(null)
  }
  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const onError = (e: unknown) => setProblem(errorMessage(e))
  const validateItems = useMutation(
    trpc.catalogItem.validateImport.mutationOptions({ onError })
  )
  const validateRoles = useMutation(
    trpc.resourceRole.validateImport.mutationOptions({ onError })
  )
  const onImported = async ({ imported }: { imported: number }) => {
    toast.success(`Imported ${imported} ${noun}.`)
    await queryClient.invalidateQueries(
      target.type === "catalogItems"
        ? trpc.catalogItem.pathFilter()
        : trpc.resourceRole.pathFilter()
    )
    close(false)
  }
  const importItems = useMutation(
    trpc.catalogItem.import.mutationOptions({ onSuccess: onImported, onError })
  )
  const importRoles = useMutation(
    trpc.resourceRole.import.mutationOptions({ onSuccess: onImported, onError })
  )
  const validating = validateItems.isPending || validateRoles.isPending
  const importing = importItems.isPending || importRoles.isPending

  async function onFile(file: File | undefined) {
    reset()
    if (!file) return
    setFileName(file.name)
    const { records: rows } = parseCsvRecords(await file.text())
    if (rows.length === 0) {
      setProblem("The file has no data rows under its header row.")
      return
    }
    setRecords(rows)
    try {
      await validate(rows)
    } catch {
      // Shown by the mutation's onError.
    }
  }

  async function validate(rows: Record<string, string>[]) {
    if (target.type === "catalogItems") {
      const result = await validateItems.mutateAsync({
        rows,
        catalogTypeId: target.catalogType.id,
      })
      setPreview(
        result.rows.map((r, i) => ({
          row: r.row,
          name: r.values?.name ?? rows[i]?.Name ?? "",
          summary: r.values
            ? `${target.catalogType.singular} · ${trimMoney(r.values.price)} / ${r.values.billingUnit === "hour" ? "hour" : "each"}`
            : "",
          errors: r.errors,
        }))
      )
    } else {
      const result = await validateRoles.mutateAsync({ rows })
      setPreview(
        result.rows.map((r, i) => ({
          row: r.row,
          name: r.values?.name ?? rows[i]?.Name ?? "",
          summary: r.values
            ? `${trimMoney(r.values.billRate)} / hour · ${[r.values.locationCity, r.values.locationCountry].filter(Boolean).join(", ")}`
            : "",
          errors: r.errors,
        }))
      )
    }
  }

  const errorCount = preview?.filter((r) => r.errors.length > 0).length ?? 0
  const canImport = preview !== null && preview.length > 0 && errorCount === 0

  const onImport = () => {
    setProblem(null)
    if (target.type === "catalogItems") {
      importItems.mutate({
        rows: records,
        catalogTypeId: target.catalogType.id,
      })
    } else {
      importRoles.mutate({ rows: records })
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {noun} from CSV</DialogTitle>
          <DialogDescription>{template.help}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-auto flex-1">
            <FieldLabel htmlFor="csv-file">CSV file</FieldLabel>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ""
              }}
            />
            <FieldDescription>
              {fileName
                ? `${fileName}: ${records.length} rows`
                : "The first row must be the header row."}
            </FieldDescription>
          </Field>
          <Button
            variant="outline"
            onClick={() => downloadCsv(template.fileName, template.csv)}
          >
            <DownloadIcon data-icon="inline-start" />
            Download template
          </Button>
        </div>

        {problem && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        {validating && (
          <p className="text-sm text-muted-foreground">Checking rows…</p>
        )}

        {preview && preview.length > 0 && (
          <>
            <Alert variant={errorCount > 0 ? "destructive" : "default"}>
              {errorCount > 0 ? <CircleAlertIcon /> : <CircleCheckIcon />}
              <AlertDescription>
                {errorCount > 0
                  ? `${errorCount} of ${preview.length} rows have errors. Fix them in the file and choose it again; nothing is imported until every row is valid.`
                  : `All ${preview.length} rows are valid.`}
              </AlertDescription>
            </Alert>
            <LocalTableRoot
              columns={previewColumns}
              data={preview}
              getRowId={previewRowId}
            >
              <ListTable
                maxHeight={320}
                empty={{ icon: <UploadIcon />, title: "No rows" }}
              />
            </LocalTableRoot>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button disabled={!canImport || importing} onClick={onImport}>
            {importing
              ? "Importing…"
              : canImport
                ? `Import ${preview.length} rows`
                : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
