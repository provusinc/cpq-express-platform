"use client"

import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/**
 * Shared `onSuccess`/`onError` for the Members page's commands: refetch the
 * member and Invitation lists, toast the outcome.
 */
export function useMembersMutationCallbacks() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return {
    refresh: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.membership.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.invitation.list.queryKey(),
        }),
      ]),
    onError: (error: unknown) => {
      toast.error(errorMessage(error))
    },
  }
}
