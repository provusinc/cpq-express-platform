"use client"

import { useMutation } from "@tanstack/react-query"
import { UserMinusIcon, UsersIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { ROLE_LABELS } from "@workspace/domain/enums"
import type { Role } from "@workspace/domain/enums"
import { checkMembershipChange } from "@workspace/domain/members"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import {
  RowMenuItem,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"
import { Switch } from "@workspace/ui/components/switch"

import {
  actionsColumn,
  ListTable,
  LocalTableRoot,
  SortableColumnTitle,
} from "@/components/shell/data-table"
import { formatDate } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

import { RoleSelect } from "./role-select"
import { useMembersMutationCallbacks } from "./use-members-mutation"

type Member = RouterOutputs["membership"]["list"][number]

interface MembersContextValue {
  currentMembershipId: string
  adminCount: number
  onRemove: (member: Member) => void
}
const MembersContext = createContext<MembersContextValue | null>(null)
const useMembers = () => useContext(MembersContext)!

const nameOf = (member: Member) => member.user.name ?? member.user.email

/** The same guard the API applies; the API has the final say. */
function useIsLastAdmin(member: Member) {
  const { adminCount } = useMembers()
  return !checkMembershipChange(member, { kind: "remove" }, adminCount).ok
}

type MemberCell = { row: { original: Member } }

function MemberNameCell({ row }: MemberCell) {
  const { currentMembershipId } = useMembers()
  const member = row.original
  return (
    <div className="flex items-center gap-2">
      <span className="truncate font-medium">{nameOf(member)}</span>
      {member.id === currentMembershipId && (
        <Badge variant="secondary">You</Badge>
      )}
    </div>
  )
}

function RoleCell({ row }: MemberCell) {
  const trpc = useTRPC()
  const router = useRouter()
  const { currentMembershipId } = useMembers()
  const { refresh, onError } = useMembersMutationCallbacks()
  const changeRole = useMutation(
    trpc.membership.changeRole.mutationOptions({ onError })
  )
  const member = row.original
  const name = nameOf(member)
  const lastAdmin = useIsLastAdmin(member)

  async function onRoleChange(role: Role) {
    await changeRole.mutateAsync({ id: member.id, role })
    await refresh()
    toast.success(`${name} is now ${ROLE_LABELS[role]}.`)
    // Stepping down from Admin: this page (and the nav) no longer apply.
    if (member.id === currentMembershipId && role !== "admin") router.refresh()
  }

  return (
    <div
      title={
        lastAdmin
          ? "The Organization's last Admin keeps the Admin Role."
          : undefined
      }
    >
      <RoleSelect
        size="sm"
        className="w-32"
        aria-label={`Role of ${name}`}
        value={member.role}
        disabled={lastAdmin || changeRole.isPending}
        onChange={(role) => void onRoleChange(role).catch(() => {})}
      />
    </div>
  )
}

function ApproverCell({ row }: MemberCell) {
  const trpc = useTRPC()
  const { refresh, onError } = useMembersMutationCallbacks()
  const setApprover = useMutation(
    trpc.membership.setApprover.mutationOptions({ onError })
  )
  const member = row.original
  const name = nameOf(member)

  async function onApproverChange(isApprover: boolean) {
    await setApprover.mutateAsync({ id: member.id, isApprover })
    await refresh()
    toast.success(
      isApprover
        ? `${name} can now approve Quotes.`
        : `${name} can no longer approve Quotes.`
    )
  }

  return (
    <Switch
      aria-label={`${name} is an Approver`}
      checked={member.isApprover}
      disabled={setApprover.isPending}
      onCheckedChange={(checked) =>
        void onApproverChange(checked).catch(() => {})
      }
    />
  )
}

/** Remove (or Leave, for yourself): the "…" menu and the right-click menu. */
function MemberRowMenu() {
  const { currentMembershipId, onRemove } = useMembers()
  const member = useDataTableRow<Member>()
  const lastAdmin = useIsLastAdmin(member)
  return (
    <RowMenuItem
      variant="destructive"
      disabled={lastAdmin}
      onClick={() => onRemove(member)}
    >
      <UserMinusIcon />
      {member.id === currentMembershipId
        ? "Leave Organization"
        : "Remove from Organization"}
    </RowMenuItem>
  )
}

const columns: DataTableColumns<Member> = [
  {
    id: "member",
    accessorFn: nameOf,
    header: SortableColumnTitle,
    meta: { label: "Member" },
    cell: MemberNameCell,
  },
  {
    id: "email",
    accessorFn: (m) => m.user.email,
    header: SortableColumnTitle,
    meta: { label: "Email" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.user.email}</span>
    ),
  },
  {
    id: "role",
    accessorKey: "role",
    header: SortableColumnTitle,
    meta: { label: "Role" },
    cell: RoleCell,
  },
  {
    id: "isApprover",
    accessorKey: "isApprover",
    header: SortableColumnTitle,
    meta: { label: "Approver" },
    cell: ApproverCell,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: SortableColumnTitle,
    meta: { label: "Joined" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
  actionsColumn<Member>({
    label: (member) => `Actions for ${nameOf(member)}`,
    Menu: MemberRowMenu,
    menuClassName: "min-w-52",
  }),
]

/** The Organization's Members: Role, Approver flag, removal (Admins). */
export function MembersTable({
  members,
  currentMembershipId,
  pickerUrl,
}: {
  members: Member[]
  currentMembershipId: string
  pickerUrl: string
}) {
  const adminCount = members.filter((m) => m.role === "admin").length
  const [removing, setRemoving] = useState<Member | null>(null)

  return (
    <MembersContext
      value={{ currentMembershipId, adminCount, onRemove: setRemoving }}
    >
      <LocalTableRoot columns={columns} data={members} sortable>
        <ListTable
          rowMenu={MemberRowMenu}
          empty={{ icon: <UsersIcon />, title: "No Members yet" }}
        />
      </LocalTableRoot>
      <RemoveMemberDialog
        member={removing}
        isYou={removing?.id === currentMembershipId}
        pickerUrl={pickerUrl}
        onClose={() => setRemoving(null)}
      />
    </MembersContext>
  )
}

function RemoveMemberDialog({
  member,
  isYou,
  pickerUrl,
  onClose,
}: {
  member: Member | null
  isYou: boolean
  pickerUrl: string
  onClose: () => void
}) {
  const trpc = useTRPC()
  const { refresh, onError } = useMembersMutationCallbacks()
  const remove = useMutation(
    trpc.membership.remove.mutationOptions({ onError })
  )
  const name = member ? (member.user.name ?? member.user.email) : ""

  async function onConfirm() {
    if (!member) return
    try {
      await remove.mutateAsync({ id: member.id })
    } catch {
      return
    }
    if (isYou) {
      window.location.assign(pickerUrl)
      return
    }
    await refresh()
    toast.success(`${name} was removed from the Organization.`)
    onClose()
  }

  return (
    <AlertDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isYou ? "Leave this Organization?" : `Remove ${name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isYou
              ? "You'll lose access right away. Your Quotes stay, and an Admin can invite you again."
              : `${name} loses access right away. Their Quotes stay in the Organization and they remain their owner; an Admin can invite them again.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => void onConfirm()}
          >
            {remove.isPending ? "Removing…" : isYou ? "Leave" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
