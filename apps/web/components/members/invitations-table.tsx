"use client"

import { useMutation } from "@tanstack/react-query"
import { MailIcon, MailPlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { ROLE_LABELS } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import {
  actionsColumn,
  ListTable,
  LocalTableRoot,
  SortableColumnTitle,
} from "@/components/shell/data-table"
import { formatDate } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

import { useMembersMutationCallbacks } from "./use-members-mutation"

type PendingInvitation = RouterOutputs["invitation"]["list"][number]

/** Resend (new link, new expiry) or revoke: the "…" and right-click menu. */
function InvitationRowMenu() {
  const invitation = useDataTableRow<PendingInvitation>()
  const trpc = useTRPC()
  const { refresh, onError } = useMembersMutationCallbacks()
  const resend = useMutation(
    trpc.invitation.resend.mutationOptions({
      onError,
      onSuccess: async () => {
        await refresh()
        toast.success(`Sent a new Invitation link to ${invitation.email}.`)
      },
    })
  )
  const revoke = useMutation(
    trpc.invitation.revoke.mutationOptions({
      onError,
      onSuccess: async () => {
        await refresh()
        toast.success(`Revoked the Invitation for ${invitation.email}.`)
      },
    })
  )
  const pending = resend.isPending || revoke.isPending
  return (
    <>
      <RowMenuItem
        disabled={pending}
        onClick={() => resend.mutate({ id: invitation.id })}
      >
        <MailIcon />
        Resend
      </RowMenuItem>
      <RowMenuSeparator />
      <RowMenuItem
        variant="destructive"
        disabled={pending}
        onClick={() => revoke.mutate({ id: invitation.id })}
      >
        <XIcon />
        Revoke
      </RowMenuItem>
    </>
  )
}

const columns: DataTableColumns<PendingInvitation> = [
  {
    id: "email",
    accessorKey: "email",
    header: SortableColumnTitle,
    meta: { label: "Email" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.email}</span>
    ),
  },
  {
    id: "role",
    accessorKey: "role",
    header: SortableColumnTitle,
    meta: { label: "Role" },
    cell: ({ row }) => ROLE_LABELS[row.original.role],
  },
  {
    id: "expiresAt",
    accessorKey: "expiresAt",
    header: SortableColumnTitle,
    meta: { label: "Status" },
    cell: ({ row }) =>
      row.original.status === "expired" ? (
        <Badge variant="destructive">
          Expired {formatDate(row.original.expiresAt)}
        </Badge>
      ) : (
        <span className="text-muted-foreground">
          Expires {formatDate(row.original.expiresAt)}
        </span>
      ),
  },
  {
    id: "invitedBy",
    accessorFn: (i) => i.invitedBy?.name ?? i.invitedBy?.email ?? "",
    header: SortableColumnTitle,
    meta: { label: "Invited by" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.invitedBy?.name ?? row.original.invitedBy?.email ?? "—"}
      </span>
    ),
  },
  actionsColumn<PendingInvitation>({
    label: (invitation) => `Actions for the Invitation to ${invitation.email}`,
    Menu: InvitationRowMenu,
    menuClassName: "min-w-44",
  }),
]

/** Open Invitations: resend (new link, new expiry) or revoke. */
export function InvitationsTable({
  invitations,
}: {
  invitations: PendingInvitation[]
}) {
  return (
    <LocalTableRoot columns={columns} data={invitations} sortable>
      <ListTable
        rowMenu={InvitationRowMenu}
        empty={{ icon: <MailPlusIcon />, title: "No pending Invitations" }}
      />
    </LocalTableRoot>
  )
}
