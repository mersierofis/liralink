export function ComingSoon({ title, step }: { title: string; step: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{step}</p>
    </div>
  )
}
