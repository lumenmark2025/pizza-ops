import { useEffect, useRef, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Card } from './components/ui/card'
import {
  CustomerCheckoutPage,
  CustomerLocationPage,
  CustomerOrderConfirmationPage,
  CustomerOrderPage,
  CustomerServicePage,
} from './features/customer-ordering'
import { AdminPage } from './features/admin-ops'
import { DiscountCodesAdminPage } from './features/discount-management'
import { IngredientsAdminPage } from './features/ingredient-management'
import { LocationEditPage, LocationNewPage, LocationsListPage } from './features/location-management'
import { MenuAdminPage } from './features/menu-management'
import { ModifiersAdminPage } from './features/modifier-management'
import { CustomerBoardPage, ExpeditorPage, Kds2Page, KdsPage, PaymentPage } from './features/ops-views'
import { OrderEntryPage } from './features/operator-order-entry'
import { AppShell } from './features/operator-shell'
import { ServiceEditPage, ServiceNewPage, ServicesListPage } from './features/service-management'
import { SAFE_MODE } from './lib/runtime-flags'
import { usePizzaOpsStore } from './store/usePizzaOpsStore'

function LoadingScreen({ message, standalone }: { message: string; standalone?: boolean }) {
  return (
    <div className={`flex min-h-screen items-center justify-center px-4 ${standalone ? 'bg-slate-950' : ''}`}>
      <Card className={`flex items-center gap-3 px-5 py-4 ${standalone ? 'border-white/10 bg-white/10 text-white' : ''}`}>
        <LoaderCircle className={`h-5 w-5 animate-spin ${standalone ? 'text-orange-300' : 'text-orange-500'}`} />
        <span className="font-medium">{message}</span>
      </Card>
    </div>
  )
}

function OperationalServicePicker({
  title,
  buildHref,
}: {
  title: string
  buildHref: (serviceId: string) => string
}) {
  const services = usePizzaOpsStore((state) => state.services)
  const liveServices = services.filter((entry) => entry.status === 'live' || entry.status === 'paused')

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Operational Service</p>
        <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">
          Select the service explicitly. Operational screens no longer infer service scope from browser-local state.
        </p>
        <div className="mt-5 grid gap-3">
          {(liveServices.length ? liveServices : services).map((service) => (
            <Link
              key={service.id}
              to={buildHref(service.id)}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{service.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {service.date} · {service.startTime} to {service.lastCollectionTime}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>{service.locationName}</p>
                  <p className="font-mono">{service.id}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}

function ServiceScopedRoute({ children }: { children: ReactNode }) {
  const { serviceId } = useParams()
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const service = usePizzaOpsStore((state) => state.service)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)

  useEffect(() => {
    if (!serviceId) {
      return
    }

    const switched = usePizzaOpsStore.getState().service.id === serviceId || loadServiceForEditing(serviceId)
    if (!switched) {
      return
    }

    const { hydrateRemote, startRealtime } = usePizzaOpsStore.getState()
    let stop: null | (() => void) = null

    void hydrateRemote().then(() => {
      if (SAFE_MODE) {
        return
      }

      stop = startRealtime()
    })

    return () => {
      stop?.()
    }
  }, [loadServiceForEditing, serviceId])

  if (!serviceId) {
    return <Navigate to="/ops" replace />
  }

  if (!remoteReady || service.id !== serviceId) {
    return <LoadingScreen message="Loading service state..." standalone />
  }

  return <>{children}</>
}

function App() {
  const location = useLocation()
  const setOnlineStatus = usePizzaOpsStore((state) => state.setOnlineStatus)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const bootstrapStartedRef = useRef(false)
  const isStandaloneDisplayRoute = [/^\/ops\/[^/]+\/kds$/, /^\/ops\/[^/]+\/kds-2$/, /^\/ops\/[^/]+\/board$/].some((pattern) =>
    pattern.test(location.pathname),
  )

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
    console.info('[pizza-ops] hydration start')
    void usePizzaOpsStore.getState().hydrateRemote().then(() => {
      console.info('[pizza-ops] hydration complete')
    })
  }, [])

  const routes = (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to="/ops" replace />
        }
      />
      <Route
        path="/ops"
        element={
          <OperationalServicePicker
            title="Choose a service for order entry"
            buildHref={(serviceId) => `/ops/${serviceId}`}
          />
        }
      />
      <Route path="/ops/:serviceId" element={<ServiceScopedRoute><OrderEntryPage /></ServiceScopedRoute>} />
      <Route path="/order" element={<CustomerOrderPage />} />
      <Route path="/order/location/:locationId" element={<CustomerLocationPage />} />
      <Route path="/order/service/:serviceId" element={<CustomerServicePage />} />
      <Route path="/order/checkout" element={<CustomerCheckoutPage />} />
      <Route path="/order/confirmation/:orderId" element={<CustomerOrderConfirmationPage />} />
      <Route
        path="/kds"
        element={
          <OperationalServicePicker
            title="Choose a service for KDS"
            buildHref={(serviceId) => `/ops/${serviceId}/kds`}
          />
        }
      />
      <Route
        path="/kds-2"
        element={
          <OperationalServicePicker
            title="Choose a service for KDS 2"
            buildHref={(serviceId) => `/ops/${serviceId}/kds-2`}
          />
        }
      />
      <Route
        path="/expeditor"
        element={
          <OperationalServicePicker
            title="Choose a service for Expeditor"
            buildHref={(serviceId) => `/ops/${serviceId}/expeditor`}
          />
        }
      />
      <Route
        path="/board"
        element={
          <OperationalServicePicker
            title="Choose a service for Customer Board"
            buildHref={(serviceId) => `/ops/${serviceId}/board`}
          />
        }
      />
      <Route path="/ops/:serviceId/kds" element={<ServiceScopedRoute><KdsPage /></ServiceScopedRoute>} />
      <Route path="/ops/:serviceId/kds-2" element={<ServiceScopedRoute><Kds2Page /></ServiceScopedRoute>} />
      <Route path="/ops/:serviceId/expeditor" element={<ServiceScopedRoute><ExpeditorPage /></ServiceScopedRoute>} />
      <Route path="/ops/:serviceId/board" element={<ServiceScopedRoute><CustomerBoardPage /></ServiceScopedRoute>} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/locations" element={<LocationsListPage />} />
      <Route path="/admin/locations/new" element={<LocationNewPage />} />
      <Route path="/admin/locations/:locationId" element={<LocationEditPage />} />
      <Route path="/admin/services" element={<ServicesListPage />} />
      <Route path="/admin/services/new" element={<ServiceNewPage />} />
      <Route path="/admin/services/:serviceId" element={<ServiceEditPage />} />
      <Route path="/admin/menu" element={<MenuAdminPage />} />
      <Route path="/admin/discounts" element={<DiscountCodesAdminPage />} />
      <Route path="/admin/ingredients" element={<IngredientsAdminPage />} />
      <Route path="/admin/modifiers" element={<ModifiersAdminPage />} />
      <Route path="/payments/:paymentId" element={<PaymentPage />} />
      <Route path="*" element={<Navigate to="/ops" replace />} />
    </Routes>
  )

  if (isStandaloneDisplayRoute && !remoteReady) {
    return <LoadingScreen message="Loading display state..." standalone />
  }

  return location.pathname.startsWith('/order') || isStandaloneDisplayRoute ? routes : <AppShell>{routes}</AppShell>
}

export default App
