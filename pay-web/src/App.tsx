import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PayPage } from '@/pages/PayPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NotFoundPage />} />
        <Route path="/p/:code" element={<PayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
