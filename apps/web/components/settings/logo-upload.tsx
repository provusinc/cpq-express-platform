"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import {
  checkLogoFile,
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
} from "@workspace/domain/settings"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

const ACCEPT = Object.keys(LOGO_CONTENT_TYPES).join(",")

/**
 * The Organization's logo. Uploading is three steps: the API hands out a
 * presigned PUT URL for this exact file (`settings.requestLogoUpload`), the
 * browser PUTs the file straight to object storage, and the API adopts it
 * (`settings.confirmLogoUpload`), re-checking type and size.
 */
export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const requestUpload = useMutation(
    trpc.settings.requestLogoUpload.mutationOptions()
  )
  const confirmUpload = useMutation(
    trpc.settings.confirmLogoUpload.mutationOptions()
  )
  const remove = useMutation(
    trpc.settings.removeLogo.mutationOptions({
      onSuccess: (profile) => {
        queryClient.setQueryData(trpc.settings.profile.queryKey(), profile)
        toast.success("Logo removed")
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )

  async function upload(file: File) {
    const check = checkLogoFile({ contentType: file.type, size: file.size })
    if (!check.ok) {
      toast.error(check.message)
      return
    }
    setUploading(true)
    try {
      const { key, url, headers } = await requestUpload.mutateAsync({
        contentType: check.contentType,
        size: file.size,
      })
      const response = await fetch(url, { method: "PUT", headers, body: file })
      if (!response.ok) {
        throw new Error("The upload failed. Try again.")
      }
      const profile = await confirmUpload.mutateAsync({ key })
      queryClient.setQueryData(trpc.settings.profile.queryKey(), profile)
      toast.success("Logo uploaded")
    } catch (error) {
      toast.error(
        error instanceof Error && !("data" in error)
          ? error.message
          : errorMessage(error)
      )
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor="profile-logo">Logo</FieldLabel>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {logoUrl ? (
            // A short-lived presigned URL from object storage; next/image
            // would need the storage host configured and gains nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Organization logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            id="profile-logo"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading || remove.isPending}
            onClick={() => input.current?.click()}
          >
            <UploadIcon />
            {uploading
              ? "Uploading…"
              : logoUrl
                ? "Replace logo"
                : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={uploading || remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2Icon />
              Remove
            </Button>
          )}
        </div>
      </div>
      <FieldDescription>
        PNG, JPEG, SVG or WebP, up to {LOGO_MAX_BYTES / 1024 / 1024} MB. Shown
        on your Quote Documents.
      </FieldDescription>
    </Field>
  )
}
