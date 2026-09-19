import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Link2, Receipt, Landmark, Settings } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuth } from '@/auth/AuthProvider'

export function Sidebar() {
  const { merchant } = useAuth()
  // 'auto_payout': nothing to withdraw — the anchor already pays the IBAN. "Withdrawals" would
  // imply an action the merchant can no longer take there (04-BACKEND-HANDOFF.md §5).
  const isAutoPayout = merchant?.settlementMode === 'auto_payout'

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/links', label: 'Links', icon: Link2 },
    { to: '/payments', label: 'Payments', icon: Receipt },
    { to: '/withdrawals', label: isAutoPayout ? 'Payouts' : 'Withdrawals', icon: Landmark },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="hidden w-56 shrink-0 border-r bg-background md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-lg font-semibold tracking-tight">LiraLink</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
