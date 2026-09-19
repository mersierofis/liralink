import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Decimal } from 'decimal.js'
import { Loader2 } from 'lucide-react'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ExplorerLink } from '@/components/ExplorerLink'
import { useCreateUsdcWithdrawal } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatUSDCFull } from '@/lib/money'
import { STELLAR_ADDRESS_REGEX, USDC_AMOUNT_REGEX, formatToUsdcAmount } from '@/lib/usdcAmount'
import type { UsdcWithdrawal } from '@/api/types'

function buildSchema(available: string) {
  const max = new Decimal(available)
  return z.object({
    amountUSDC: z
      .string()
      .min(1, 'Amount is required')
      .regex(USDC_AMOUNT_REGEX, 'Enter a plain amount with up to 7 decimals')
      .refine((v) => new Decimal(v).gt(0), 'Enter a positive amount')
      .refine((v) => new Decimal(v).lte(max), `Cannot exceed ${formatUSDCFull(available)}`),
    destination: z
      .string()
      .regex(STELLAR_ADDRESS_REGEX, 'Enter a Stellar address: G followed by 55 characters (56 in total)'),
  })
}

/**
 * "Send to my wallet" — POST /usdc-withdrawals sends USDC (never TRY) from the platform account to
 * the merchant's own Stellar wallet, from Held-in-USD ('saved') or Unallocated ('unallocated').
 * Takes ~5 s and the amount leaves the balance immediately, so the submit is disabled while it
 * runs (no double send). 400/422 messages are plain sentences meant for the user — shown verbatim.
 */
export function SendToWalletDialog({
  open,
  onOpenChange,
  source,
  available,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: UsdcWithdrawal['source']
  available: string
}) {
  const create = useCreateUsdcWithdrawal()
  const [serverError, setServerError] = useState<string | null>(null)
  const [result, setResult] = useState<UsdcWithdrawal | null>(null)
  const schema = buildSchema(available)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { amountUSDC: '', destination: '' },
  })

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setServerError(null)
      setResult(null)
    }
  }

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setServerError(null)
    try {
      const w = await create.mutateAsync({
        amountUSDC: formatToUsdcAmount(values.amountUSDC),
        destination: values.destination,
        source,
      })
      setResult(w)
    } catch (err) {
      setServerError(err instanceof HttpError ? err.message : 'Could not send the USDC. Try again.')
    }
  }

  const sourceLabel = source === 'saved' ? 'Held in USD' : 'Unallocated USDC'

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to my wallet</DialogTitle>
          <DialogDescription>
            Sends USDC from <strong>{sourceLabel}</strong> ({formatUSDCFull(available)} available) to your own
            Stellar wallet. Testnet only. The wallet needs a USDC trustline.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="space-y-1">
                <p>
                  {result.status === 'completed'
                    ? `Sent ${formatUSDCFull(result.amountUSDC)}.`
                    : `Submitted ${formatUSDCFull(result.amountUSDC)} — it's being confirmed on the ledger.`}
                </p>
                <ExplorerLink href={result.explorerUrl}>View transaction</ExplorerLink>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {serverError && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="amountUSDC"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (USDC)</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0.0000000" {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => form.setValue('amountUSDC', available, { shouldValidate: true })}
                      >
                        Max
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="destination"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination address</FormLabel>
                    <FormControl>
                      <Input className="font-mono text-xs" placeholder="G…" autoComplete="off" {...field} />
                    </FormControl>
                    <FormDescription>Your own Stellar public key (starts with G, 56 characters).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                {create.isPending && (
                  <p className="mr-auto self-center text-xs text-muted-foreground">Sending — about 5 seconds.</p>
                )}
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending && <Loader2 className="animate-spin" />}
                  {create.isPending ? 'Sending…' : 'Send USDC'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
