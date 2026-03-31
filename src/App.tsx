import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Card } from './components/ui/card'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
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
import { supabase, supabaseConfigError } from './lib/supabase'
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
  const today = new Date()
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const maxDate = new Date(todayDate)
  maxDate.setDate(maxDate.getDate() + 7)
  const dateKey = (value: Date) => value.toISOString().slice(0, 10)
  const minServiceDate = dateKey(todayDate)
  const maxServiceDate = dateKey(maxDate)
  const visibleServices = services.filter(
    (entry) => entry.date >= minServiceDate && entry.date <= maxServiceDate,
  )
  const liveServices = visibleServices.filter((entry) => entry.status === 'live' || entry.status === 'paused')
  const activeFallbackServices = services.filter(
    (entry) => entry.status === 'live' || entry.status === 'paused',
  )
  const listedServices =
    liveServices.length ? liveServices : visibleServices.length ? visibleServices : activeFallbackServices

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Operational Service</p>
        <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">
          Select the service explicitly. Operational screens no longer infer service scope from browser-local state.
        </p>
        <div className="mt-5 grid gap-3">
          {listedServices.map((service) => (
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
          {!listedServices.length ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No services matched the current picker filter. This screen now keeps a visible empty state instead of going blank after hydration.
            </div>
          ) : null}
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

  console.info('[pizza-ops] ServiceScopedRoute render', {
    serviceId,
    activeServiceId: service.id,
    remoteReady,
  })

  useEffect(() => {
    if (!serviceId) {
      return
    }

    console.info('[pizza-ops] ServiceScopedRoute loadServiceForEditing start', { serviceId })
    void loadServiceForEditing(serviceId)
    console.info('[pizza-ops] ServiceScopedRoute loadServiceForEditing end', { serviceId })
  }, [loadServiceForEditing, serviceId])

  if (!serviceId) {
    return <Navigate to="/ops" replace />
  }

  if (!remoteReady || service.id !== serviceId) {
    return <LoadingScreen message="Loading service state..." standalone />
  }

  return <>{children}</>
}

function LegacyExpeditorRedirect() {
  const { serviceId } = useParams()

  if (!serviceId) {
    return <Navigate to="/expeditor" replace />
  }

  return <Navigate to={`/expeditor/${serviceId}`} replace />
}

function LoginPage({
  session,
  authReady,
}: {
  session: Session | null
  authReady: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const redirectTo =
    new URLSearchParams(location.search).get('redirect') || '/admin'

  useEffect(() => {
    if (!authReady || !session) {
      return
    }

    setSubmitting(false)
    setError(null)
    setSuccessMessage('Sign-in successful. Redirecting…')
    navigate(redirectTo, { replace: true })
  }, [authReady, navigate, redirectTo, session])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) {
      setError(supabaseConfigError ?? 'Authentication is not configured.')
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccessMessage(null)
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }

    if (data.session) {
      setSuccessMessage('Sign-in successful. Redirecting…')
      navigate(redirectTo, { replace: true })
      return
    }

    setSuccessMessage('Sign-in successful. Finalising session…')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#fffdf8_0%,#f3efe6_100%)] px-4">
      <Card className="w-full max-w-md rounded-[28px] border-white/70 bg-white/90 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Pizza Ops</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Staff sign in</h1>
        <p className="mt-3 text-sm text-slate-600">
          Sign in to access operational and admin routes.
        </p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="staff-email">Email</label>
            <Input id="staff-email" autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="staff-password">Password</label>
            <Input id="staff-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          {successMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {successMessage}
            </div>
          ) : null}
          <Button className="bg-orange-500 text-white hover:bg-orange-400" disabled={submitting} type="submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-500">After sign-in you will be returned to {redirectTo}.</p>
      </Card>
    </div>
  )
}

function RequireAuth({
  session,
  authReady,
  children,
}: {
  session: Session | null
  authReady: boolean
  children: ReactNode
}) {
  const location = useLocation()

  if (!authReady) {
    return <LoadingScreen message="Checking sign-in…" />
  }

  if (!session) {
    const redirect = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  return <>{children}</>
}

function App() {
  const location = useLocation()
  const setOnlineStatus = usePizzaOpsStore((state) => state.setOnlineStatus)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const activeServiceId = usePizzaOpsStore((state) => state.service.id)
  const bootstrapStartedRef = useRef(false)
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const isAuthRoute = location.pathname === '/login'
  const isStandaloneDisplayRoute = [/^\/ops\/[^/]+\/kds$/, /^\/ops\/[^/]+\/kds-2$/, /^\/ops\/[^/]+\/board$/].some((pattern) =>
    pattern.test(location.pathname),
  )

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      setSession(null)
      return
    }

    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return
      }

      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

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

  useEffect(() => {
    if (!activeServiceId) {
      return
    }

    console.info('[pizza-ops] App service bootstrap effect', {
      activeServiceId,
      pathname: location.pathname,
    })
    let cancelled = false
    let stop: null | (() => void) = null

    void usePizzaOpsStore.getState().hydrateRemote().then(() => {
      console.info('[pizza-ops] App hydrateRemote complete', {
        activeServiceId,
        cancelled,
        safeMode: SAFE_MODE,
      })
      if (cancelled || SAFE_MODE) {
        return
      }

      console.info('[pizza-ops] App startRealtime start', { activeServiceId })
      stop = usePizzaOpsStore.getState().startRealtime()
      console.info('[pizza-ops] App startRealtime end', {
        activeServiceId,
        started: Boolean(stop),
      })
    })

    return () => {
      cancelled = true
      console.info('[pizza-ops] App service bootstrap cleanup', { activeServiceId })
      stop?.()
    }
  }, [activeServiceId, location.pathname])

  const routes = (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to="/ops" replace />
        }
      />
      <Route path="/login" element={<LoginPage authReady={authReady} session={session} />} />
      <Route
        path="/ops"
        element={
          <RequireAuth authReady={authReady} session={session}>
            <OperationalServicePicker
              title="Choose a service for order entry"
              buildHref={(serviceId) => `/ops/${serviceId}`}
            />
          </RequireAuth>
        }
      />
      <Route path="/ops/:serviceId" element={<RequireAuth authReady={authReady} session={session}><ServiceScopedRoute><OrderEntryPage /></ServiceScopedRoute></RequireAuth>} />
      <Route path="/order" element={<CustomerOrderPage />} />
      <Route path="/order/location/:locationId" element={<CustomerLocationPage />} />
      <Route path="/order/service/:serviceId" element={<CustomerServicePage />} />
      <Route path="/order/checkout" element={<CustomerCheckoutPage />} />
      <Route path="/order/confirmation/:orderId" element={<CustomerOrderConfirmationPage />} />
      <Route
        path="/kds"
        element={
          <RequireAuth authReady={authReady} session={session}>
            <OperationalServicePicker
              title="Choose a service for KDS"
              buildHref={(serviceId) => `/ops/${serviceId}/kds`}
            />
          </RequireAuth>
        }
      />
      <Route
        path="/kds-2"
        element={
          <RequireAuth authReady={authReady} session={session}>
            <OperationalServicePicker
              title="Choose a service for KDS 2"
              buildHref={(serviceId) => `/ops/${serviceId}/kds-2`}
            />
          </RequireAuth>
        }
      />
      <Route
        path="/expeditor"
        element={
          <RequireAuth authReady={authReady} session={session}>
            <OperationalServicePicker
              title="Choose a service for Expeditor"
              buildHref={(serviceId) => `/expeditor/${serviceId}`}
            />
          </RequireAuth>
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
      <Route path="/ops/:serviceId/kds" element={<RequireAuth authReady={authReady} session={session}><ServiceScopedRoute><KdsPage /></ServiceScopedRoute></RequireAuth>} />
      <Route path="/ops/:serviceId/kds-2" element={<RequireAuth authReady={authReady} session={session}><ServiceScopedRoute><Kds2Page /></ServiceScopedRoute></RequireAuth>} />
      <Route path="/ops/:serviceId/expeditor" element={<RequireAuth authReady={authReady} session={session}><LegacyExpeditorRedirect /></RequireAuth>} />
      <Route path="/expeditor/:serviceId" element={<RequireAuth authReady={authReady} session={session}><ServiceScopedRoute><ExpeditorPage /></ServiceScopedRoute></RequireAuth>} />
      <Route path="/ops/:serviceId/board" element={<ServiceScopedRoute><CustomerBoardPage /></ServiceScopedRoute>} />
      <Route path="/admin" element={<RequireAuth authReady={authReady} session={session}><AdminPage /></RequireAuth>} />
      <Route path="/admin/locations" element={<RequireAuth authReady={authReady} session={session}><LocationsListPage /></RequireAuth>} />
      <Route path="/admin/locations/new" element={<RequireAuth authReady={authReady} session={session}><LocationNewPage /></RequireAuth>} />
      <Route path="/admin/locations/:locationId" element={<RequireAuth authReady={authReady} session={session}><LocationEditPage /></RequireAuth>} />
      <Route path="/admin/services" element={<RequireAuth authReady={authReady} session={session}><ServicesListPage /></RequireAuth>} />
      <Route path="/admin/services/new" element={<RequireAuth authReady={authReady} session={session}><ServiceNewPage /></RequireAuth>} />
      <Route path="/admin/services/:serviceId" element={<RequireAuth authReady={authReady} session={session}><ServiceEditPage /></RequireAuth>} />
      <Route path="/admin/menu" element={<RequireAuth authReady={authReady} session={session}><MenuAdminPage /></RequireAuth>} />
      <Route path="/admin/discounts" element={<RequireAuth authReady={authReady} session={session}><DiscountCodesAdminPage /></RequireAuth>} />
      <Route path="/admin/ingredients" element={<RequireAuth authReady={authReady} session={session}><IngredientsAdminPage /></RequireAuth>} />
      <Route path="/admin/modifiers" element={<RequireAuth authReady={authReady} session={session}><ModifiersAdminPage /></RequireAuth>} />
      <Route path="/payments/:paymentId" element={<RequireAuth authReady={authReady} session={session}><PaymentPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/ops" replace />} />
    </Routes>
  )

  if (isStandaloneDisplayRoute && !remoteReady) {
    return <LoadingScreen message="Loading display state..." standalone />
  }

  return location.pathname.startsWith('/order') || isStandaloneDisplayRoute || isAuthRoute ? routes : <AppShell>{routes}</AppShell>
}

export default App
