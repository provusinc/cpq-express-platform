"use client"

import { PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react"
import { createContext, useContext } from "react"

import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"

/** A catalog row (Catalog Item or Resource Role): what its menu needs. */
interface ManagedRow {
  id: string
  active: boolean
}

export interface ManagedRowActions {
  onEdit: (row: ManagedRow) => void
  onDeactivate: (row: ManagedRow) => void
  onReactivate: (row: ManagedRow) => void
  onDelete: (row: ManagedRow) => void
}

/** Provided by the list; the row menu reads it (columns are module-level). */
export const ManagedRowActionsContext = createContext<ManagedRowActions | null>(
  null
)

/**
 * Edit, Deactivate or Reactivate, and Delete — the "…" menu and the
 * right-click menu of a Catalog Item or Resource Role row (Admins).
 */
export function ManagedRowMenu() {
  const actions = useContext(ManagedRowActionsContext)!
  const row = useDataTableRow<ManagedRow>()
  return (
    <>
      <RowMenuItem onClick={() => actions.onEdit(row)}>
        <PencilIcon />
        Edit
      </RowMenuItem>
      {row.active ? (
        <RowMenuItem onClick={() => actions.onDeactivate(row)}>
          <PowerOffIcon />
          Deactivate
        </RowMenuItem>
      ) : (
        <RowMenuItem onClick={() => actions.onReactivate(row)}>
          <PowerIcon />
          Reactivate
        </RowMenuItem>
      )}
      <RowMenuSeparator />
      <RowMenuItem variant="destructive" onClick={() => actions.onDelete(row)}>
        <Trash2Icon />
        Delete
      </RowMenuItem>
    </>
  )
}
