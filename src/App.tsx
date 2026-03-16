import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { CustomerOrderConfirmationPage, CustomerOrderPage } from './features/customer-ordering'
import { AdminPage } from './features/admin-ops'
import { ExpeditorPage, KdsPage, PaymentPage, CustomerBoardPage } from './features/ops-views'
import { OrderEntryPage } from './features/operator-order-entry'
import { AppShell } from './features/operator-shell'
import { usePizzaOpsStore } from './store/usePizzaOpsStore'

function App() {
  const setOnlineStatus = usePizzaOpsStore((state) => state.setOnlineStatus)
  const hydrateRemote = usePizzaOpsStore((state) => state.hydrateRemote)
  const startRealtime = usePizzaOpsStore((state) => state.startRealtime)
  const bootstrapStartedRef = useRef(false)

  useEffect(() => {
    const onOnline = () => setOnlineStatus(true)
    const onOffline = () => setOnlineStatus(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [setOnlineStatus])

  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return
    }

    bootstrapStartedRef.current = true
    let stop: null | (() => void) = null
    console.info('[pizza-ops] hydration start')
    void hydrateRemote().then(() => {
      console.info('[pizza-ops] hydration complete')
      stop = startRealtime()
    })

    return () => {
      stop?.()
    }
  }, [hydrateRemote, startRealtime])

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OrderEntryPage />} />
        <Route path="/order" element={<CustomerOrderPage />} />
        <Route path="/order/confirmation/:orderId" element={<CustomerOrderConfirmationPage />} />
        <Route path="/kds" element={<KdsPage />} />
        <Route path="/expeditor" element={<ExpeditorPage />} />
        <Route path="/board" element={<CustomerBoardPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/payments/:paymentId" element={<PaymentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export default App
