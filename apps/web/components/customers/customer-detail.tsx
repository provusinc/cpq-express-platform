"use client"

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  actionsColumn,
  ColumnTitle,
  ListTable,
  LocalTableRoot,
} from "@/components/shell/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { errorMessage, inUseOf } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { CustomerDialog } from "./customer-dialog"
import { ContactDialog } from "./contact-dialog"

type Customer = RouterOutputs["customer"]["byId"]
type Contact = Customer["contacts"][number]

/** A Customer's page: details, archive/delete, and its Contacts. */
export function CustomerDetail({ customerId }: { customerId: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: customer } = useSuspenseQuery(
    trpc.customer.byId.queryOptions({ id: customerId })
  )

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.customer.pathFilter())
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const archive = useMutation(
    trpc.customer.archive.mutationOptions({
      onSuccess: async () => {
        toast.success("Customer archived. It no longer appears in pickers.")
        await invalidate()
      },
      onError,
    })
  )
  const unarchive = useMutation(
    trpc.customer.unarchive.mutationOptions({
      onSuccess: async () => {
        toast.success("Customer restored.")
        await invalidate()
      },
      onError,
    })
  )
  const remove = useMutation(
    trpc.customer.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(`“${customer.name}” deleted.`)
        setConfirmDelete(false)
        router.push("/customers")
        await queryClient.invalidateQueries(trpc.customer.list.pathFilter())
      },
      onError: (e) => {
        setConfirmDelete(false)
        if (inUseOf(e)) setBlocked(errorMessage(e))
        else onError(e)
      },
    })
  )

  const address = [
    customer.billingStreet,
    [customer.billingCity, customer.billingState, customer.billingPostalCode]
      .filter(Boolean)
      .join(" "),
    customer.billingCountry,
  ].filter(Boolean)

  return (
    <>
      <PageHeader
        title={customer.name}
        description={
          [customer.type, customer.industry].filter(Boolean).join(" · ") ||
          undefined
        }
      >
        {customer.archived && <Badge variant="secondary">Archived</Badge>}
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        {customer.archived ? (
          <Button
            variant="outline"
            disabled={unarchive.isPending}
            onClick={() => unarchive.mutate({ id: customer.id })}
          >
            <ArchiveRestoreIcon data-icon="inline-start" />
            Unarchive
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: customer.id })}
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
              <Detail label="Type" value={customer.type} />
              <Detail label="Industry" value={customer.industry} />
              <Detail
                label="Website"
                value={
                  customer.website && (
                    <a
                      href={
                        /^https?:\/\//.test(customer.website)
                          ? customer.website
                          : `https://${customer.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {customer.website}
                    </a>
                  )
                }
              />
              <Detail label="Phone" value={customer.phone} />
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
        <ContactsCard customer={customer} />
      </div>

      <CustomerDialog
        open={editing}
        onOpenChange={setEditing}
        customer={customer}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${customer.name}”?`}
        description="Its Contacts are deleted too. This can't be undone."
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: customer.id })}
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

interface ContactActions {
  onEdit: (contact: Contact) => void
  onMakePrimary: (contact: Contact) => void
  onDelete: (contact: Contact) => void
}
const ContactActionsContext = createContext<ContactActions | null>(null)

/** Edit, Make primary, Delete: the "…" menu and right-click menu. */
function ContactRowMenu() {
  const actions = useContext(ContactActionsContext)!
  const contact = useDataTableRow<Contact>()
  return (
    <>
      <RowMenuItem onClick={() => actions.onEdit(contact)}>
        <PencilIcon />
        Edit
      </RowMenuItem>
      {!contact.isPrimary && (
        <RowMenuItem onClick={() => actions.onMakePrimary(contact)}>
          <StarIcon />
          Make primary
        </RowMenuItem>
      )}
      <RowMenuSeparator />
      <RowMenuItem
        variant="destructive"
        onClick={() => actions.onDelete(contact)}
      >
        <Trash2Icon />
        Delete
      </RowMenuItem>
    </>
  )
}

const contactColumns: DataTableColumns<Contact> = [
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Name" },
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.name}
        {row.original.isPrimary && <Badge className="ml-2">Primary</Badge>}
      </span>
    ),
  },
  {
    id: "title",
    accessorKey: "title",
    header: ColumnTitle,
    meta: { label: "Title" },
  },
  {
    id: "email",
    accessorKey: "email",
    header: ColumnTitle,
    meta: { label: "Email" },
    cell: ({ row }) =>
      row.original.email && (
        <a
          href={`mailto:${row.original.email}`}
          className="underline-offset-4 hover:underline"
        >
          {row.original.email}
        </a>
      ),
  },
  {
    id: "phone",
    accessorKey: "phone",
    header: ColumnTitle,
    meta: { label: "Phone" },
  },
  actionsColumn<Contact>({
    label: (contact) => `Actions for ${contact.name}`,
    Menu: ContactRowMenu,
  }),
]

function ContactsCard({ customer }: { customer: Customer }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<{ contact: Contact | null } | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.customer.pathFilter())
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
        <ContactActionsContext
          value={{
            onEdit: (contact) => setDialog({ contact }),
            onMakePrimary: (contact) => setPrimary.mutate({ id: contact.id }),
            onDelete: setDeleting,
          }}
        >
          <LocalTableRoot columns={contactColumns} data={customer.contacts}>
            <ListTable
              rowMenu={ContactRowMenu}
              empty={{
                icon: <UsersIcon />,
                title: "No Contacts yet",
                description:
                  "The first Contact you add becomes the primary Contact.",
              }}
            />
          </LocalTableRoot>
        </ContactActionsContext>
      </CardContent>
      <ContactDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        customerId={customer.id}
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
