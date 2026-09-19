import { ExternalLink } from 'lucide-react'

export function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}
