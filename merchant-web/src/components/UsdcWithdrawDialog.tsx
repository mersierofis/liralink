import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Decimal } from 'decimal.js'
import { z } from 'zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateUsdcWithdrawal } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatUSDC } from '@/lib/money'
import type { Balance } from '@/api/types'

const USDC_AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/

type Source = 'saved' | 'unallocated'

const SOURCE_LABEL: Record<Source, string> = {
  saved: 'Saved (auto-save)',
  unallocated: 'Unallocated',
}

function buildSchema(balance: Pick<Balance, 'savedUSDC' | 'unallocatedUSDC'>) {
  const available = (source: Source) => new Decimal(source === 'saved' ? balance.savedUSDC : balance.unallocatedUSDC)
  return z
    .object({
      source: z.enum(['saved', 'unallocated']),
      amountUSDC: z
        .string()
        .min(1, 'Amount is required')
        .regex(USDC_AMOUNT_REGEX, 'Enter a plain amount with up to 7 decimals')
        .refine((v) => new Decimal(v).gt(0), 'Enter a positive amount'),
      destination: z.string().regex(STELLAR_ADDRESS_REGEX, 'Enter a Stellar address starting with G (56 characters)'),
    })
    .superRefine((v, ctx) => {
      if (!USDC_AMOUNT_REGEX.test(v.amountUSDC)) return
      if (new Decimal(v.amountUSDC).gt(available(v.source))) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountUSDC'],
          message: `Cannot exceed the ${SOURCE_LABEL[v.source].toLowerCase()} balance (${formatUSDC(available(v.source).toFixed(7))})`,
        })
      }
    })
}

/** Sends USDC from the Saved or Unallocated balance to the merchant's own Stellar wallet
 * (POST /usdc-withdrawals). The destination must already trust USDC, or the API returns 422. */
export function UsdcWithdrawDialog({ balance }: { balance: Pick<Balance, 'savedUSDC' | 'unallocatedUSDC'> }) {
  const [open, setOpen] = useState(false)
  const create = useCreateUsdcWithdrawal()
  const schema = buildSchema(balance)
  const hasFunds = new Decimal(balance.savedUSDC).gt(0) || new Decimal(balance.unallocatedUSDC).gt(0)
  const initialSource: Source = new Decimal(balance.savedUSDC).gt(0) ? 'saved' : 'unallocated'

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { source: initialSource, amountUSDC: '', destination: '' },
  })

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      await create.mutateAsync({
        source: values.source,
        amountUSDC: new Decimal(values.amountUSDC).toFixed(7),
        destination: values.destination,
      })
      toast.success('USDC withdrawal submitted')
      setOpen(false)
      form.reset({ source: values.source, amountUSDC: '', destination: values.destination })
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not submit the USDC withdrawal.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset({ source: initialSource, amountUSDC: '', destination: '' })
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!hasFunds}>
          Withdraw USDC
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw USDC to your wallet</DialogTitle>
          <DialogDescription>
            Saved: {formatUSDC(balance.savedUSDC)} · Unallocated: {formatUSDC(balance.unallocatedUSDC)}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>From</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="saved">{SOURCE_LABEL.saved}</SelectItem>
                      <SelectItem value="unallocated">{SOURCE_LABEL.unallocated}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amountUSDC"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (USDC)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="5.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="destination"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Stellar address</FormLabel>
                  <FormControl>
                    <Input className="font-mono text-xs" placeholder="G…" {...field} />
                  </FormControl>
                  <FormDescription>The account must exist and already trust USDC.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Submitting…' : 'Withdraw'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
