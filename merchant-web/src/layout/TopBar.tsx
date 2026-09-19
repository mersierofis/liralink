import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/AuthProvider'

export function TopBar() {
  const { merchant, logout } = useAuth()

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <span className="text-sm font-medium">{merchant?.businessName}</span>
      <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
        <LogOut className="h-4 w-4" />
        Logout
      </Button>
    </header>
  )
}
