import { QRCodeSVG } from 'qrcode.react'
import { MessageCircle } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/CopyButton'
import { formatTRY } from '@/lib/money'
import type { PaymentLink } from '@/api/types'

export function LinkCreatedDialog({
  link,
  onOpenChange,
  title = 'Link created',
}: {
  link: PaymentLink | null
  onOpenChange: (open: boolean) => void
  title?: string
}) {
  if (!link) return null

  const whatsappMessage = `${link.merchantName} — ${link.title}: ${formatTRY(link.amountTRY)}\n${link.payUrl}`
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`

  return (
    <Dialog open={!!link} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {link.title} — {formatTRY(link.amountTRY)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg border p-4">
            <QRCodeSVG value={link.payUrl} size={180} />
          </div>
          <p className="break-all rounded-md bg-muted px-3 py-2 text-center text-sm">{link.payUrl}</p>
        </div>
        <DialogFooter className="sm:justify-center">
          <CopyButton value={link.payUrl} label="Copy link" />
          <Button asChild variant="outline" className="gap-1.5">
            <a href={whatsappUrl} target="_blank" rel="noreferrer">
              <MessageCircle className="h-3.5 w-3.5" />
              Share on WhatsApp
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
