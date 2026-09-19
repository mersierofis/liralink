import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <CardTitle>No payment link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Open a LiraLink payment URL shared by a merchant, for example{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-foreground">/p/DEMO0001</code>.
          </p>
          <Button asChild variant="secondary">
            <Link to="/p/DEMO0001">Try demo link</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
