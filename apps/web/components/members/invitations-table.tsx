"use client"

import { useMutation } from "@tanstack/react-query"
import { MailIcon, MoreHorizontalIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { ROLE_LABELS } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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

import { useMembersMutationCallbacks } from "./use-members-mutation"

type PendingInvitation = RouterOutputs["invitation"]["list"][number]

/** Open Invitations: resend (new link, new expiry) or revoke. */
export function InvitationsTable({
  invitations,
}: {
  invitations: PendingInvitation[]
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function InvitationRow({ invitation }: { invitation: PendingInvitation }) {
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
    <TableRow>
      <TableCell className="font-medium">{invitation.email}</TableCell>
      <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
      <TableCell className="whitespace-nowrap">
        {invitation.status === "expired" ? (
          <Badge variant="destructive">
            Expired {formatDate(invitation.expiresAt)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">
            Expires {formatDate(invitation.expiresAt)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? "—"}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`Actions for the Invitation to ${invitation.email}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              onClick={() => resend.mutate({ id: invitation.id })}
            >
              <MailIcon />
              Resend
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => revoke.mutate({ id: invitation.id })}
            >
              <XIcon />
              Revoke
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
