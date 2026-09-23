/** Props the Organization layout hands the (client) shell. Serializable. */
export interface ShellOrganization {
  slug: string
  name: string
  /** Absolute URL of its subdomain (other Organizations are full page loads). */
  url: string
}

export interface ShellUser {
  name: string | null
  email: string
  image: string | null
}
