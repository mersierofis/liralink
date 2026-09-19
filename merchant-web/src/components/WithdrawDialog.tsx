import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
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
import { useCreateWithdrawal } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { formatTRY } from '@/lib/money'
import { TRY_AMOUNT_REGEX, formatToTRYAmount, parseTRYAmount } from '@/lib/tryAmount'

const IBAN_REGEX = /^TR\d{24}$/

function buildSchema(availableTRY: string) {
  const available = parseTRYAmount(availableTRY)
  return z.object({
    amountTRY: z
      .string()
      .min(1, 'Amount is required')
      .regex(TRY_AMOUNT_REGEX, 'Enter a plain amount, e.g. 1000 or 1000.50')
      .refine((v) => parseTRYAmount(v).gt(0), 'Enter a positive amount')
      .refine((v) => parseTRYAmount(v).lte(available), `Cannot exceed your available balance (${formatTRY(availableTRY)})`),
    iban: z.string().regex(IBAN_REGEX, 'IBAN must be TR followed by 24 digits'),
  })
}

export function WithdrawDialog({ availableTRY, defaultIban }: { availableTRY: string; defaultIban?: string }) {
  const [open, setOpen] = useState(false)
  const createWithdrawal = useCreateWithdrawal()
  const schema = buildSchema(availableTRY)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { amountTRY: '', iban: defaultIban ?? '' },
  })

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      await createWithdrawal.mutateAsync({ amountTRY: formatToTRYAmount(values.amountTRY), iban: values.iban })
      toast.success('Withdrawal requested')
      setOpen(false)
      form.reset({ amountTRY: '', iban: values.iban })
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not request the withdrawal.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={parseTRYAmount(availableTRY).lte(0)}>Withdraw</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw to IBAN</DialogTitle>
          <DialogDescription>Available balance: {formatTRY(availableTRY)}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amountTRY"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (TRY)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="1000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="iban"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IBAN</FormLabel>
                  <FormControl>
                    <Input placeholder="TR330006100519786457841326" {...field} />
                  </FormControl>
                  <FormDescription>TR followed by 24 digits.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={createWithdrawal.isPending}>
                {createWithdrawal.isPending ? 'Requesting…' : 'Request withdrawal'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
