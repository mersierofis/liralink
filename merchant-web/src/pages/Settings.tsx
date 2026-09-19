import { useEffect } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { PasswordChangeCard } from '@/components/PasswordChangeCard'
import { useAuth } from '@/auth/AuthProvider'
import { useUpdateMe } from '@/api/hooks'
import { HttpError } from '@/api/client'

const IBAN_REGEX = /^TR\d{24}$/

const schema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(200),
  iban: z.union([z.literal(''), z.string().regex(IBAN_REGEX, 'IBAN must be TR followed by 24 digits')]),
  autoSavePercent: z.number().min(0).max(50),
})

type FormValues = z.infer<typeof schema>

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const { merchant, isLoading } = useAuth()
  const updateMe = useUpdateMe()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { businessName: '', iban: '', autoSavePercent: 0 },
  })

  useEffect(() => {
    if (merchant) {
      form.reset({
        businessName: merchant.businessName,
        iban: merchant.iban ?? '',
        autoSavePercent: merchant.autoSavePercent,
      })
    }
  }, [merchant, form])

  const onSubmit = async (values: FormValues) => {
    try {
      await updateMe.mutateAsync({
        businessName: values.businessName,
        iban: values.iban || undefined,
        autoSavePercent: values.autoSavePercent,
      })
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not save settings.')
    }
  }

  if (isLoading || !merchant) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full max-w-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>Used on your payment links and for withdrawals.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormDescription>Used as the default destination for withdrawals.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoSavePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keep in USD ({field.value}%)</FormLabel>
                    <FormControl>
                      <Slider
                        min={0}
                        max={50}
                        step={1}
                        value={[field.value]}
                        onValueChange={([v]) => field.onChange(v)}
                      />
                    </FormControl>
                    <FormDescription>
                      Keep this share of each payment in USDC instead of converting to TRY. Protects
                      against lira depreciation.
                    </FormDescription>
                    {field.value > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Held by LiraLink until you request a transfer — sending USDC to your own
                        wallet is coming soon.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={updateMe.isPending}>
                {updateMe.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <PasswordChangeCard />
    </div>
  )
}
