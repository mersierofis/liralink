import { FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Shown when the payer's wallet is on Mainnet (or another non-testnet). */
export function TestnetRequiredCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-amber-200/90 bg-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
      <div className="relative overflow-hidden border-b border-amber-100 bg-[linear-gradient(135deg,#fffbeb_0%,#ffffff_55%,#f8fafc_100%)] px-4 py-4">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-amber-200/40 blur-2xl"
        />
        <div className="relative flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 ring-1 ring-amber-200/80">
            <FlaskConical className="size-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 space-y-1 pt-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700/90">
              Beta
            </p>
            <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900">
              This is a beta build — switch to Testnet
            </h3>
            <p className="text-[13px] leading-relaxed text-slate-600">
              Your wallet is on Mainnet. LiraLink currently runs only on Stellar{' '}
              <span className="font-medium text-slate-800">Testnet</span>; no real money moves.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3.5 px-4 py-4">
        <ol className="space-y-2.5">
          {[
            { step: '1', text: 'Open the Freighter extension' },
            { step: '2', text: 'Settings → Network → select Testnet' },
            { step: '3', text: 'Return here and connect again' },
          ].map((item) => (
            <li key={item.step} className="flex items-start gap-2.5 text-[13px] text-slate-700">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                {item.step}
              </span>
              <span className="leading-snug pt-0.5">{item.text}</span>
            </li>
          ))}
        </ol>

        <Button
          type="button"
          className="h-11 w-full rounded-lg bg-slate-900 text-sm font-medium text-white hover:bg-slate-800"
          onClick={onRetry}
        >
          I switched to Testnet — reconnect
        </Button>
      </div>
    </div>
  )
}
