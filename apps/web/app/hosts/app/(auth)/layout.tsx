export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <p className="text-center text-sm font-medium">CPQ Express</p>
        {children}
      </div>
    </main>
  )
}
