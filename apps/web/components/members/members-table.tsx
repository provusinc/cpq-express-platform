"use client"

import { useMutation } from "@tanstack/react-query"
import { MoreHorizontalIcon, UserMinusIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
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
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Switch } from "@workspace/ui/components/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatDate } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

import { RoleSelect } from "./role-select"
import { useMembersMutationCallbacks } from "./use-members-mutation"

type Member = RouterOutputs["membership"]["list"][number]

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
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Approver</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isYou={member.id === currentMembershipId}
              adminCount={adminCount}
              onRemove={() => setRemoving(member)}
            />
          ))}
        </TableBody>
      </Table>
      <RemoveMemberDialog
        member={removing}
        isYou={removing?.id === currentMembershipId}
        pickerUrl={pickerUrl}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}

function MemberRow({
  member,
  isYou,
  adminCount,
  onRemove,
}: {
  member: Member
  isYou: boolean
  adminCount: number
  onRemove: () => void
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const { refresh, onError } = useMembersMutationCallbacks()
  const changeRole = useMutation(
    trpc.membership.changeRole.mutationOptions({ onError })
  )
  const setApprover = useMutation(
    trpc.membership.setApprover.mutationOptions({ onError })
  )
  const name = member.user.name ?? member.user.email
  // The same guard the API applies; the API has the final say.
  const lastAdmin = !checkMembershipChange(
    member,
    { kind: "remove" },
    adminCount
  ).ok

  async function onRoleChange(role: Role) {
    await changeRole.mutateAsync({ id: member.id, role })
    await refresh()
    toast.success(`${name} is now ${ROLE_LABELS[role]}.`)
    // Stepping down from Admin: this page (and the nav) no longer apply.
    if (isYou && role !== "admin") router.refresh()
  }

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
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{name}</span>
            {member.user.name && (
              <span className="truncate text-xs text-muted-foreground">
                {member.user.email}
              </span>
            )}
          </div>
          {isYou && <Badge variant="secondary">You</Badge>}
        </div>
      </TableCell>
      <TableCell>
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
      </TableCell>
      <TableCell>
        <Switch
          aria-label={`${name} is an Approver`}
          checked={member.isApprover}
          disabled={setApprover.isPending}
          onCheckedChange={(checked) =>
            void onApproverChange(checked).catch(() => {})
          }
        />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(member.createdAt)}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${name}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              variant="destructive"
              disabled={lastAdmin}
              onClick={onRemove}
            >
              <UserMinusIcon />
              {isYou ? "Leave Organization" : "Remove from Organization"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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
