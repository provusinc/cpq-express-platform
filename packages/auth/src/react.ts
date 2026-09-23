/**
 * Client-side sign-in / sign-out (they POST to `/api/auth/*` with a CSRF
 * token). Use from client components only — there are no Server Actions.
 *
 *   signIn("nodemailer", { email, redirectTo })
 *   signIn("google", { redirectTo })
 *   signOut({ redirectTo: "/sign-in" })
 */
export { signIn, signOut } from "next-auth/react"
