import type { PropsWithChildren, ComponentType } from 'react'
import {
  ClipboardList,
  LoaderCircle,
  MonitorSmartphone,
  PackageCheck,
  Pizza,
  ReceiptText,
  Settings2,
  SmartphoneNfc,
  TimerReset,
  Wifi,
  WifiOff,
  ChefHat,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
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
        tone === 'warn' ? 'bg-amber-400/20 text-amber-100' : 'bg-white/10 text-white',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation()
  const isOnline = usePizzaOpsStore((state) => state.isOnline)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const orders = usePizzaOpsStore((state) => state.orders)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const service = usePizzaOpsStore((state) => state.service)

  if (!remoteReady) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="flex items-center gap-3 px-5 py-4">
          <LoaderCircle className="h-5 w-5 animate-spin text-orange-500" />
          <span className="font-medium">Loading service state…</span>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-3 py-4 text-slate-950 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1600px]">
        <Card className="overflow-hidden border-white/70 bg-white/70">
          <header className="border-b border-white/70 bg-slate-950 px-4 py-4 text-white sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-display text-xs uppercase tracking-[0.4em] text-orange-200">
                  Pizza Van Service Ops
                </p>
                <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
                  {service.name}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MetricChip icon={ClipboardList} label={`${orders.filter((o) => o.status !== 'completed').length} live orders`} />
                <MetricChip icon={ReceiptText} label={`${loyverseQueue.filter((q) => q.status === 'failed').length} sync issues`} tone="warn" />
                <MetricChip icon={isOnline ? Wifi : WifiOff} label={isOnline ? 'Online' : 'Offline cache mode'} tone={isOnline ? 'ok' : 'warn'} />
                <MetricChip icon={TimerReset} label={service.delayMinutes ? `${service.delayMinutes}m delay` : titleCase(service.status)} tone={service.status === 'paused' ? 'warn' : 'ok'} />
              </div>
            </div>
            {SAFE_MODE ? (
              <div className="mt-3 inline-flex rounded-lg border border-amber-300/40 bg-amber-400/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100">
                SAFE MODE: realtime sync disabled
              </div>
            ) : null}
            <nav className="mt-4 flex flex-wrap gap-2">
              {[
                { href: '/', label: 'Order Entry', icon: Pizza },
                { href: '/kds', label: 'KDS', icon: ChefHat },
                { href: '/expeditor', label: 'Expeditor', icon: PackageCheck },
                { href: '/board', label: 'Customer Board', icon: MonitorSmartphone },
                { href: '/admin', label: 'Admin', icon: Settings2 },
                { href: '/admin/services', label: 'Services', icon: ClipboardList },
                { href: '/admin/locations', label: 'Locations', icon: Settings2 },
                { href: '/admin/menu', label: 'Menu', icon: Pizza },
                { href: '/admin/discounts', label: 'Discounts', icon: ReceiptText },
                { href: '/admin/ingredients', label: 'Ingredients', icon: ClipboardList },
                { href: '/admin/modifiers', label: 'Modifiers', icon: Settings2 },
                { href: '/order', label: 'Public Order', icon: SmartphoneNfc },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition',
                      location.pathname === item.href
                        ? 'bg-white text-slate-950'
                        : 'bg-white/10 text-white hover:bg-white/20',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </header>
          <main className="p-4 sm:p-6">{children}</main>
        </Card>
      </div>
    </div>
  )
}
