import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Opens a settlement's SEP-24 interactiveUrl — the anchor's KYC/bank-details form the merchant
 * must complete before the settlement can proceed (04-BACKEND-HANDOFF.md §2 + §5). The anchor's
 * token is short-lived (testanchor: ~15 min from when the settlement started).
 */
export function VerificationButton({ url, size = 'sm' }: { url: string; size?: 'sm' | 'default' | 'lg' }) {
  return (
    <Button asChild size={size} className="gap-1.5 bg-warning text-warning-foreground hover:bg-warning/90">
      <a href={url} target="_blank" rel="noopener noreferrer">
        Complete verification
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </Button>
  )
}
