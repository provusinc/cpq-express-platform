import { redirect } from "next/navigation"

/** An Organization's home is its Quote list. */
export default function OrganizationHomePage() {
  redirect("/quotes")
}
