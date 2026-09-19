export function MerchantHeader({
  merchantName,
  title,
  description,
}: {
  merchantName: string
  title: string
  description?: string
}) {
  return (
    <div className="space-y-1 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paying</p>
      <h1 className="text-xl font-semibold leading-tight">{merchantName}</h1>
      <p className="text-sm text-muted-foreground">{title}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}
