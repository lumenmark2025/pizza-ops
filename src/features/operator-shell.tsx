import { useEffect, useState, type ComponentType, type PropsWithChildren } from 'react'
import {
  ChefHat,
  ClipboardList,
  LoaderCircle,
  Menu,
  MonitorSmartphone,
  PackageCheck,
  Pizza,
  ReceiptText,
  Settings2,
  SmartphoneNfc,
  TimerReset,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { SAFE_MODE } from '../lib/runtime-flags'
import { cn, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'

function MetricChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  tone?: 'ok' | 'warn'
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold',
        tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  )
}

function getNavItems(serviceId: string, showCustomerLink: boolean) {
  return [
    { href: '/ops', label: 'Choose Service', icon: ClipboardList },
    { href: `/ops/${serviceId}`, label: 'Order Entry', icon: Pizza },
    { href: `/ops/${serviceId}/kds`, label: 'KDS', icon: ChefHat },
    { href: `/expeditor/${serviceId}`, label: 'Expeditor', icon: PackageCheck },
    { href: `/ops/${serviceId}/board`, label: 'Customer Board', icon: MonitorSmartphone },
    { href: '/admin', label: 'Admin', icon: Settings2 },
    { href: '/admin/services', label: 'Services', icon: ClipboardList },
    { href: '/admin/locations', label: 'Locations', icon: Settings2 },
    { href: '/admin/menu', label: 'Menu', icon: Pizza },
    { href: '/admin/discounts', label: 'Discounts', icon: ReceiptText },
    { href: '/admin/ingredients', label: 'Ingredients', icon: ClipboardList },
    { href: '/admin/modifiers', label: 'Modifiers', icon: Settings2 },
    ...(showCustomerLink ? [{ href: '/order', label: 'Public Order', icon: SmartphoneNfc }] as const : []),
  ] as const
}

function getRouteTitle(pathname: string) {
  if (pathname === '/ops') return 'Choose Service'
  if (pathname.startsWith('/ops/') && pathname.endsWith('/kds')) return 'KDS'
  if (pathname.startsWith('/ops/') && pathname.endsWith('/kds-2')) return 'KDS 2'
  if (pathname.startsWith('/ops/') && pathname.endsWith('/board')) return 'Customer Board'
  if (pathname.startsWith('/ops/')) return 'Order Entry'
  if (pathname.startsWith('/expeditor')) return 'Expeditor'
  if (pathname === '/admin') return 'Admin'
  if (pathname.startsWith('/admin/services')) return 'Services'
  if (pathname.startsWith('/admin/locations')) return 'Locations'
  if (pathname.startsWith('/admin/menu')) return 'Menu'
  if (pathname.startsWith('/admin/discounts')) return 'Discounts'
  if (pathname.startsWith('/admin/ingredients')) return 'Ingredients'
  if (pathname.startsWith('/admin/modifiers')) return 'Modifiers'
  if (pathname.startsWith('/payments/')) return 'Payments'
  return 'Pizza Ops'
}

function isNavItemActive(pathname: string, href: string) {
  if (pathname === href) {
    return true
  }

  if (
    href === '/ops' ||
    href === '/order' ||
    /^\/ops\/[^/]+$/.test(href) ||
    /^\/expeditor\/[^/]+$/.test(href)
  ) {
    return false
  }

  return pathname.startsWith(`${href}/`)
}

export function AppShell({
  children,
  currentUserEmail,
  onLogout,
  loggingOut = false,
  showCustomerLink = true,
}: PropsWithChildren<{
  currentUserEmail?: string | null
  onLogout?: () => void
  loggingOut?: boolean
  showCustomerLink?: boolean
}>) {
  const location = useLocation()
  const isOnline = usePizzaOpsStore((state) => state.isOnline)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const realtimeStatus = usePizzaOpsStore((state) => state.realtimeStatus)
  const orders = usePizzaOpsStore((state) => state.orders)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const service = usePizzaOpsStore((state) => state.service)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navItems = getNavItems(service.id, showCustomerLink)
  const routeTitle = getRouteTitle(location.pathname)

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  if (!remoteReady) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="flex items-center gap-3 px-5 py-4">
          <LoaderCircle className="h-5 w-5 animate-spin text-orange-500" />
          <span className="font-medium">Loading service state...</span>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-3 text-slate-950 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1600px]">
        <Card className="overflow-hidden border-white/70 bg-white/80">
          <header className="border-b border-slate-200 bg-white/90 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-bold">{routeTitle}</p>
                  <p className="truncate text-sm text-slate-500">{service.name}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <MetricChip icon={ClipboardList} label={`${orders.filter((order) => order.status !== 'completed').length} live`} />
                <MetricChip icon={ReceiptText} label={`${loyverseQueue.filter((entry) => entry.status === 'failed').length} sync`} tone="warn" />
                <MetricChip icon={isOnline ? Wifi : WifiOff} label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'ok' : 'warn'} />
                <MetricChip icon={TimerReset} label={service.delayMinutes ? `${service.delayMinutes}m delay` : titleCase(service.status)} tone={service.status === 'paused' ? 'warn' : 'ok'} />
                {!SAFE_MODE ? (
                  <MetricChip
                    icon={LoaderCircle}
                    label={
                      realtimeStatus === 'subscribed'
                        ? 'Realtime live'
                        : realtimeStatus === 'error'
                          ? 'Realtime error'
                          : 'Realtime connecting'
                    }
                    tone={realtimeStatus === 'error' ? 'warn' : 'ok'}
                  />
                ) : (
                  <MetricChip icon={LoaderCircle} label="Safe mode" tone="warn" />
                )}
                {currentUserEmail ? (
                  <div className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                    {currentUserEmail}
                  </div>
                ) : null}
                {onLogout ? (
                  <Button variant="outline" onClick={onLogout} disabled={loggingOut}>
                    {loggingOut ? 'Signing out…' : 'Logout'}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-11 w-11 rounded-xl p-0"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </header>
          <main className="p-4 sm:p-6">{children}</main>
        </Card>
      </div>

      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/35 transition-opacity',
          drawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-sm transform flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200',
          drawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <div>
            <p className="font-display text-xl font-bold">Navigation</p>
            <p className="mt-1 text-sm text-slate-500">{service.name}</p>
          </div>
          <Button
            variant="outline"
            className="h-11 w-11 rounded-xl p-0"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <nav className="grid gap-2">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isNavItemActive(location.pathname, item.href)

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                    active ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>
      </aside>
    </div>
  )
}
