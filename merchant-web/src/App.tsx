import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth } from '@/auth/RequireAuth'
import { AppShell } from '@/layout/AppShell'
import LoginPage from '@/pages/Login'
import RegisterPage from '@/pages/Register'
import DashboardPage from '@/pages/Dashboard'
import LinksPage from '@/pages/Links'
import LinkDetailPage from '@/pages/LinkDetail'
import PaymentsPage from '@/pages/Payments'
import WithdrawalsPage from '@/pages/Withdrawals'
import SettingsPage from '@/pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/links" element={<LinksPage />} />
                    <Route path="/links/:id" element={<LinkDetailPage />} />
                    <Route path="/payments" element={<PaymentsPage />} />
                    <Route path="/withdrawals" element={<WithdrawalsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  )
}
