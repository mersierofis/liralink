import { Link } from 'react-router-dom'
import { QrCode, X } from 'lucide-react'
import { toast } from 'sonner'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'
import { CopyButton } from '@/components/CopyButton'
import { useCancelLink } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatTRY, formatUSDC } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import type { PaymentLink } from '@/api/types'

export function LinksTable({ links, onShowQr }: { links: PaymentLink[]; onShowQr: (link: PaymentLink) => void }) {
  const cancelLink = useCancelLink()

  const handleCancel = async (link: PaymentLink) => {
    if (!window.confirm(`Cancel "${link.title}"? This can't be undone.`)) return
    try {
      await cancelLink.mutateAsync(link.id)
      toast.success('Link cancelled')
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not cancel the link.')
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>USDC</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => (
          <TableRow key={link.id}>
            <TableCell className="font-mono text-xs">
              <Link to={`/links/${link.id}`} className="hover:underline">
                {link.code}
              </Link>
            </TableCell>
            <TableCell className="max-w-[220px] truncate">
              <Link to={`/links/${link.id}`} className="hover:underline">
                {link.title}
              </Link>
            </TableCell>
            <TableCell>{formatTRY(link.amountTRY)}</TableCell>
            <TableCell title={`${link.quotedUSDC} USDC`}>
              {link.status === 'underpaid' ? (
                <span className="text-warning-foreground">
                  {formatUSDC(link.receivedUSDC)} / {formatUSDC(link.quotedUSDC)}
                </span>
              ) : (
                formatUSDC(link.quotedUSDC)
              )}
            </TableCell>
            <TableCell>
              <StatusBadge status={link.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDateTime(link.createdAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1.5">
                <CopyButton value={link.payUrl} label="" className="px-2" />
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onShowQr(link)} title="Show QR code">
                  <QrCode className="h-3.5 w-3.5" />
                </Button>
                {link.status === 'open' && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleCancel(link)}
                    disabled={cancelLink.isPending}
                    title="Cancel link"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
