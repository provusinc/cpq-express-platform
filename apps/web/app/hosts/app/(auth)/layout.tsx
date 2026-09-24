import { AuthShowcase } from "@/components/auth/auth-showcase"
import { BrandLockup } from "@/components/brand/brand"
import { ThemeToggle } from "@/components/theme-toggle"

/**
 * Sign-in, check-email and Invitation pages: the branded showcase on wide
 * screens, the form on the canvas beside it.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="grid min-h-svh bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <AuthShowcase />
      <div className="relative flex flex-col items-center justify-center p-6">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="flex w-full max-w-sm flex-col gap-8">
          <BrandLockup className="self-center lg:hidden" />
          {children}
        </div>
      </div>
    </main>
  )
}
