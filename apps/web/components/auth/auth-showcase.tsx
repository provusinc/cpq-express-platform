import { Progress } from "@workspace/ui/components/progress"

import { BrandLockup } from "@/components/brand/brand"

/** Sample lines for the showcase: an illustration, not anyone's data. */
const LINES = [
  { name: "Solution Architect", effort: "40 h", amount: "$8,400" },
  { name: "Senior Consultant", effort: "120 h", amount: "$18,000" },
  { name: "Discovery workshop", effort: "", amount: "$2,500" },
]

/**
 * The branded half of the sign-in screens: the lockup, one line about the
 * product, and a Quote set as a ledger, the thing people come here to make.
 */
export function AuthShowcase() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,oklch(1_0_0/5%)_31px,oklch(1_0_0/5%)_32px)] p-10 text-primary-foreground lg:flex dark:bg-[oklch(0.25_0.04_226)] dark:text-foreground">
      <BrandLockup tone="inverse" className="dark:[&_span]:text-foreground" />

      <div className="flex max-w-md flex-col gap-8">
        <p className="text-3xl leading-[1.15] font-semibold tracking-[-0.02em] text-balance">
          Price the work, watch the margin, send the Quote.
        </p>
        <figure
          aria-hidden
          className="rounded-xl bg-background/[0.07] p-5 ring-1 ring-current/15 backdrop-blur-sm"
        >
          <div className="flex items-baseline justify-between text-xs opacity-70">
            <span>Platform rollout</span>
            <span>Phase 1</span>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {LINES.map((line) => (
              <li
                key={line.name}
                className="grid grid-cols-[1fr_3.5rem_5rem] items-baseline gap-2"
              >
                <span className="truncate">{line.name}</span>
                <span className="figure text-right opacity-70">
                  {line.effort}
                </span>
                <span className="figure text-right">{line.amount}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-end justify-between border-t border-current/20 pt-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs opacity-70">Margin 32.4%</span>
              <Progress
                aria-hidden
                value={65}
                className="w-28 gap-0 **:data-[slot=progress-indicator]:rounded-full **:data-[slot=progress-indicator]:bg-iris **:data-[slot=progress-track]:h-1.5 **:data-[slot=progress-track]:bg-current/15"
              />
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs opacity-70">Total</span>
              <span className="figure text-3xl leading-none font-semibold">
                $28,900
              </span>
            </div>
          </div>
        </figure>
      </div>

      <p className="text-xs opacity-60">
        Quoting for professional services, by Provus.
      </p>
    </aside>
  )
}
