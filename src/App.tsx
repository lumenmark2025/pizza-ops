import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  CustomerCheckoutPage,
  CustomerLocationPage,
  CustomerOrderConfirmationPage,
  CustomerOrderPage,
  CustomerServicePage,
} from './features/customer-ordering'
import { AdminPage } from './features/admin-ops'
import { IngredientsAdminPage } from './features/ingredient-management'
import { LocationEditPage, LocationNewPage, LocationsListPage } from './features/location-management'
import { MenuAdminPage } from './features/menu-management'
import { ModifiersAdminPage } from './features/modifier-management'
import { ExpeditorPage, KdsPage, PaymentPage, CustomerBoardPage } from './features/ops-views'
import { OrderEntryPage } from './features/operator-order-entry'
import { AppShell } from './features/operator-shell'
import { ServiceEditPage, ServiceNewPage, ServicesListPage } from './features/service-management'
import { SAFE_MODE } from './lib/runtime-flags'
import { usePizzaOpsStore } from './store/usePizzaOpsStore'

function App() {
  const location = useLocation()
  const setOnlineStatus = usePizzaOpsStore((state) => state.setOnlineStatus)
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
    console.info('[pizza-ops] SAFE_MODE', SAFE_MODE)
    if (SAFE_MODE) {
      console.info('[pizza-ops] hydrateRemote skipped')
      console.info('[pizza-ops] startRealtime skipped')
      usePizzaOpsStore.setState({ remoteReady: true })
      return
    }

    const { hydrateRemote, startRealtime } = usePizzaOpsStore.getState()
    let stop: null | (() => void) = null
    console.info('[pizza-ops] hydration start')
    void hydrateRemote().then(() => {
      console.info('[pizza-ops] hydration complete')
      stop = startRealtime()
    })

    return () => {
      stop?.()
    }
  }, [])

  const routes = (
    <Routes>
      <Route path="/" element={<OrderEntryPage />} />
      <Route path="/order" element={<CustomerOrderPage />} />
      <Route path="/order/location/:locationId" element={<CustomerLocationPage />} />
      <Route path="/order/service/:serviceId" element={<CustomerServicePage />} />
      <Route path="/order/checkout" element={<CustomerCheckoutPage />} />
      <Route path="/order/confirmation/:orderId" element={<CustomerOrderConfirmationPage />} />
      <Route path="/kds" element={<KdsPage />} />
      <Route path="/expeditor" element={<ExpeditorPage />} />
      <Route path="/board" element={<CustomerBoardPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/locations" element={<LocationsListPage />} />
      <Route path="/admin/locations/new" element={<LocationNewPage />} />
      <Route path="/admin/locations/:locationId" element={<LocationEditPage />} />
      <Route path="/admin/services" element={<ServicesListPage />} />
      <Route path="/admin/services/new" element={<ServiceNewPage />} />
      <Route path="/admin/services/:serviceId" element={<ServiceEditPage />} />
      <Route path="/admin/menu" element={<MenuAdminPage />} />
      <Route path="/admin/ingredients" element={<IngredientsAdminPage />} />
      <Route path="/admin/modifiers" element={<ModifiersAdminPage />} />
      <Route path="/payments/:paymentId" element={<PaymentPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )

  return location.pathname.startsWith('/order') ? routes : <AppShell>{routes}</AppShell>
}

export default App
