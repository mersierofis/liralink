import { Loader2 } from 'lucide-react'

export function PayingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 className="size-10 animate-spin text-primary" />
      <div>
        <p className="font-medium">Confirming on Stellar…</p>
        <p className="text-sm text-muted-foreground">Usually about 5 seconds</p>
      </div>
    </div>
  )
}
