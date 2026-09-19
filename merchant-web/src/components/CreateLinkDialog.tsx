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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateLink } from '@/api/hooks'
import { HttpError } from '@/api/client'
import { TRY_AMOUNT_REGEX, formatToTRYAmount, parseTRYAmount } from '@/lib/tryAmount'
import type { PaymentLink } from '@/api/types'

const EXPIRY_OPTIONS = [
  { value: '24', label: '24 hours (default)' },
  { value: '1', label: '1 hour' },
  { value: '6', label: '6 hours' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
]

const schema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(500).optional(),
  amountTRY: z
    .string()
    .min(1, 'Amount is required')
    .regex(TRY_AMOUNT_REGEX, 'Enter a plain amount, e.g. 5000 or 5000.50')
    .refine((v) => {
      const n = parseTRYAmount(v)
      return n.gte(1) && n.lte(1_000_000)
    }, 'Enter an amount between ₺1.00 and ₺1,000,000.00'),
  expiresInHours: z.string(),
})

type FormValues = z.infer<typeof schema>

export function CreateLinkDialog({ onCreated }: { onCreated: (link: PaymentLink) => void }) {
  const [open, setOpen] = useState(false)
  const createLink = useCreateLink()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', description: '', amountTRY: '', expiresInHours: '24' },
  })

  const onSubmit = async (values: FormValues) => {
    try {
      const link = await createLink.mutateAsync({
        title: values.title,
        description: values.description || undefined,
        amountTRY: formatToTRYAmount(values.amountTRY),
        expiresInHours: Number(values.expiresInHours),
      })
      setOpen(false)
      form.reset()
      onCreated(link)
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not create the link. Try again.')
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
        <Button>Create link</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a payment link</DialogTitle>
          <DialogDescription>
            Share this with a customer abroad — they pay in USDC, you receive TRY.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Lemon order #1042" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="5kg dried apricots, Al Rashid Trading" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amountTRY"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (TRY)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="5000" {...field} />
                  </FormControl>
                  <FormDescription>Formatted to two decimals automatically, e.g. 5000 → ₺5,000.00.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresInHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expires in</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={createLink.isPending}>
                {createLink.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
