"use client"

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { PageHeader } from "@/components/shell/page-header"
import { errorMessage, inUseOf } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { AccountDialog } from "./account-dialog"
import { ContactDialog } from "./contact-dialog"

type Account = RouterOutputs["account"]["byId"]
type Contact = Account["contacts"][number]

/** An Account's page: details, archive/delete, and its Contacts. */
export function AccountDetail({ accountId }: { accountId: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: account } = useSuspenseQuery(
    trpc.account.byId.queryOptions({ id: accountId })
  )

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.account.pathFilter())
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const archive = useMutation(
    trpc.account.archive.mutationOptions({
      onSuccess: async () => {
        toast.success("Account archived. It no longer appears in pickers.")
        await invalidate()
      },
      onError,
    })
  )
  const unarchive = useMutation(
    trpc.account.unarchive.mutationOptions({
      onSuccess: async () => {
        toast.success("Account restored.")
        await invalidate()
      },
      onError,
    })
  )
  const remove = useMutation(
    trpc.account.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(`“${account.name}” deleted.`)
        setConfirmDelete(false)
        router.push("/accounts")
        await queryClient.invalidateQueries(trpc.account.list.pathFilter())
      },
      onError: (e) => {
        setConfirmDelete(false)
        if (inUseOf(e)) setBlocked(errorMessage(e))
        else onError(e)
      },
    })
  )

  const address = [
    account.billingStreet,
    [account.billingCity, account.billingState, account.billingPostalCode]
      .filter(Boolean)
      .join(" "),
    account.billingCountry,
  ].filter(Boolean)

  return (
    <>
      <Link
        href="/accounts"
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: "self-start",
        })}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Accounts
      </Link>
      <PageHeader
        title={account.name}
        description={
          [account.type, account.industry].filter(Boolean).join(" · ") ||
          undefined
        }
      >
        {account.archived && <Badge variant="secondary">Archived</Badge>}
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        {account.archived ? (
          <Button
            variant="outline"
            disabled={unarchive.isPending}
            onClick={() => unarchive.mutate({ id: account.id })}
          >
            <ArchiveRestoreIcon data-icon="inline-start" />
            Unarchive
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: account.id })}
          >
            <ArchiveIcon data-icon="inline-start" />
            Archive
          </Button>
        )}
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </PageHeader>

      {blocked && (
        <Alert variant="destructive">
          <AlertDescription>{blocked}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Detail label="Type" value={account.type} />
              <Detail label="Industry" value={account.industry} />
              <Detail
                label="Website"
                value={
                  account.website && (
                    <a
                      href={
                        /^https?:\/\//.test(account.website)
                          ? account.website
                          : `https://${account.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {account.website}
                    </a>
                  )
                }
              />
              <Detail label="Phone" value={account.phone} />
              <Detail
                label="Billing address"
                value={
                  address.length > 0 && (
                    <span className="whitespace-pre-line">
                      {address.join("\n")}
                    </span>
                  )
                }
              />
            </dl>
          </CardContent>
        </Card>
        <ContactsCard account={account} />
      </div>

      <AccountDialog
        open={editing}
        onOpenChange={setEditing}
        account={account}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${account.name}”?`}
        description="Its Contacts are deleted too. This can't be undone."
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: account.id })}
      />
    </>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || <span className="text-muted-foreground">—</span>}</dd>
    </>
  )
}

function ContactsCard({ account }: { account: Account }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<{ contact: Contact | null } | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.account.pathFilter())
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const setPrimary = useMutation(
    trpc.contact.setPrimary.mutationOptions({
      onSuccess: async (c) => {
        toast.success(`${c.name} is now the primary Contact.`)
        await invalidate()
      },
      onError,
    })
  )
  const remove = useMutation(
    trpc.contact.delete.mutationOptions({
      onSuccess: async () => {
        toast.success("Contact deleted.")
        setDeleting(null)
        await invalidate()
      },
      onError,
    })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
        <CardDescription>
          Quote Documents address the primary Contact.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setDialog({ contact: null })}>
            <PlusIcon data-icon="inline-start" />
            Add Contact
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {account.contacts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No Contacts yet</EmptyTitle>
              <EmptyDescription>
                The first Contact you add becomes the primary Contact.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    {contact.name}
                    {contact.isPrimary && (
                      <Badge className="ml-2">Primary</Badge>
                    )}
                  </TableCell>
                  <TableCell>{contact.title}</TableCell>
                  <TableCell>
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {contact.email}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>{contact.phone}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${contact.name}`}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDialog({ contact })}
                        >
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                        {!contact.isPrimary && (
                          <DropdownMenuItem
                            onClick={() =>
                              setPrimary.mutate({ id: contact.id })
                            }
                          >
                            <StarIcon />
                            Make primary
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting(contact)}
                        >
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ContactDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        accountId={account.id}
        contact={dialog?.contact}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "Contact"}?`}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </Card>
  )
}
