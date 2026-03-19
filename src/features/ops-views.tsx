import { useRef, useState, type ReactNode } from 'react'
import {
  ChefHat,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SmartphoneNfc,
} from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { formatTime } from '../lib/time'
import { cn, currency, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Order, OrderStatus } from '../types/domain'

const statusStyles: Record<
  OrderStatus,
  { badge: 'blue' | 'amber' | 'orange' | 'green' | 'slate'; card: string }
> = {
  taken: { badge: 'blue', card: 'border-sky-200 bg-sky-50/70' },
  prepping: { badge: 'amber', card: 'border-amber-200 bg-amber-50/80' },
  in_oven: { badge: 'orange', card: 'border-orange-200 bg-orange-50/80' },
  ready: { badge: 'green', card: 'border-emerald-200 bg-emerald-50/80' },
  completed: { badge: 'slate', card: 'border-slate-200 bg-slate-100/80' },
}

const KDS_ACTIVE_STATUSES: OrderStatus[] = ['taken', 'prepping', 'in_oven']
const BOARD_STATUSES: Array<'taken' | 'prepping' | 'in_oven' | 'ready'> = [
  'taken',
  'prepping',
  'in_oven',
  'ready',
]
const DOUBLE_TAP_WINDOW_MS = 350
const RECENTLY_CLEARED_LIMIT = 5
const KDS2_FEATURED_ORDER_COUNT = 4

function sortOrdersByPromise(orders: Order[]) {
  return [...orders].sort(
    (left, right) =>
      new Date(left.promisedTime).getTime() - new Date(right.promisedTime).getTime(),
  )
}

function getCustomerName(
  order: Order,
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers'],
) {
  return (
    order.customerName ??
    customers.find((entry) => entry.id === order.customerId)?.name ??
    'Unknown'
  )
}

function getNextStatus(status: OrderStatus) {
  if (status === 'taken') return 'prepping'
  if (status === 'prepping') return 'in_oven'
  return 'ready'
}

function getCompactMenuItemName(name: string) {
  const compact = name
    .replace(/\bpizza\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (compact.length <= 16) {
    return compact
  }

  return compact.split(' ').slice(0, 2).join(' ')
}

function getCondensedItemSummary(
  order: Order,
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems'],
) {
  return order.items
    .map((item) => {
      const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
      const name = getCompactMenuItemName(menuItem?.name ?? item.menuItemId)
      return `${item.quantity}x ${name}`
    })
    .join(', ')
}

function getWaitLabel(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime()
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000))
  return `${elapsedMinutes}m waiting`
}

function DisplayShell({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow: string
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1700px] flex-col px-3 py-4 sm:px-5 lg:px-6">
        <header className="sticky top-0 z-20 rounded-[28px] border border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-orange-200">
                {eyebrow}
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {title}
              </h1>
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </header>
        <div className="mt-4 flex-1">{children}</div>
      </div>
    </div>
  )
}

function TicketCard({
  order,
  customerName,
  menuItems,
  actionLabel,
  onAction,
  onProgressItem,
  showProgress,
}: {
  order: Order
  customerName: string
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  actionLabel: string
  onAction: () => void
  onProgressItem?: (itemId: string) => void
  showProgress?: boolean
}) {
  return (
    <Card className={cn('p-4 sm:p-5', statusStyles[order.status].card)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{order.reference}</p>
          <h3 className="font-display text-2xl font-bold">{customerName}</h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={statusStyles[order.status].badge}>{order.status}</Badge>
          {order.pagerNumber ? <Badge variant="slate">Pager {order.pagerNumber}</Badge> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
        <span>{formatTime(order.createdAt)} taken</span>
        <span>/</span>
        <span>{formatTime(order.promisedTime)} promised</span>
      </div>
      {showProgress ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Tap to mark prep. Double-tap the same item to undo.
        </p>
      ) : null}
      <div className="mt-4 space-y-2">
        {order.items.map((item) => {
          const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
          const progressCount = item.progressCount ?? 0
          const isComplete = progressCount >= item.quantity

          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                'w-full rounded-xl px-3 py-3 text-left transition duration-150',
                showProgress
                  ? isComplete
                    ? 'bg-emerald-100 ring-2 ring-emerald-400'
                    : 'bg-white/90 hover:bg-emerald-50 active:scale-[0.99]'
                  : 'bg-white/90',
              )}
              onClick={() => showProgress && onProgressItem?.(item.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {item.quantity} x {menuItem?.name}
                  </p>
                  {item.modifiers?.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {item.modifiers.map((modifier) => modifier.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                {showProgress ? (
                  <div
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-semibold',
                      isComplete
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {progressCount}/{item.quantity}
                  </div>
                ) : null}
              </div>
              {showProgress ? (
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{
                      width: `${Math.max((progressCount / item.quantity) * 100, 4)}%`,
                    }}
                  />
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
      <Button className="mt-4 w-full" onClick={onAction}>
        {actionLabel}
      </Button>
    </Card>
  )
}

function RecentlyClearedPanel({
  orders,
  customers,
  onRecall,
}: {
  orders: Order[]
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  onRecall: (orderId?: string) => void
}) {
  if (!orders.length) {
    return null
  }

  return (
    <Card className="border-white/10 bg-white/10 p-4 text-white sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-200">
            Recall
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">Recently cleared orders</h2>
        </div>
        <Button
          variant="secondary"
          className="bg-white text-slate-950 hover:bg-orange-50"
          onClick={() => onRecall()}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Recall latest
        </Button>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left transition hover:bg-white/15"
            onClick={() => onRecall(order.id)}
          >
            <div>
              <p className="font-semibold">
                {order.reference} - {getCustomerName(order, customers)}
              </p>
              <p className="text-sm text-slate-300">
                Cleared {formatTime(order.timestamps.completed_at ?? order.createdAt)}
              </p>
            </div>
            <RotateCcw className="h-4 w-4 text-orange-200" />
          </button>
        ))}
      </div>
    </Card>
  )
}

function KdsQueuePanel({
  orders,
  customers,
  menuItems,
  open,
  onClose,
}: {
  orders: Order[]
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  open: boolean
  onClose: () => void
}) {
  return (
    <aside
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 z-30 w-full sm:max-w-md lg:w-[26vw] lg:max-w-[420px] transform transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="pointer-events-auto flex h-full flex-col border-l border-white/10 bg-slate-900/96 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-200">
              KDS 2 Queue
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold">Condensed off-screen orders</h2>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={onClose}>
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {orders.length ? (
            orders.map((order) => (
              <Card key={order.id} className="border-white/10 bg-white/10 p-4 text-white shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {order.reference}
                      {order.pagerNumber ? ` / Pager ${order.pagerNumber}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {getCustomerName(order, customers)}
                    </p>
                  </div>
                  <Badge variant={statusStyles[order.status].badge}>
                    {titleCase(order.status)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-slate-300">
                  {getCondensedItemSummary(order, menuItems)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  <span>{getWaitLabel(order.createdAt)}</span>
                  <span>/</span>
                  <span>{formatTime(order.createdAt)} created</span>
                </div>
              </Card>
            ))
          ) : (
            <Card className="border-white/10 bg-white/10 p-4 text-sm text-slate-300 shadow-none">
              No overflow queue right now.
            </Card>
          )}
        </div>
      </div>
    </aside>
  )
}

function KdsSurface({ variant }: { variant: 'classic' | 'queue' }) {
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const updateOrderItemProgress = usePizzaOpsStore((state) => state.updateOrderItemProgress)
  const recallCompletedOrder = usePizzaOpsStore((state) => state.recallCompletedOrder)
  const [queueOpen, setQueueOpen] = useState(false)
  const tapTimestampsRef = useRef<Record<string, number>>({})

  const activeOrders = sortOrdersByPromise(
    orders.filter((order) => KDS_ACTIVE_STATUSES.includes(order.status)),
  )
  const readyOrders = sortOrdersByPromise(orders.filter((order) => order.status === 'ready'))
  const recentlyClearedOrders = [...orders]
    .filter((order) => order.status === 'completed')
    .sort(
      (left, right) =>
        new Date(right.timestamps.completed_at ?? right.createdAt).getTime() -
        new Date(left.timestamps.completed_at ?? left.createdAt).getTime(),
    )
    .slice(0, RECENTLY_CLEARED_LIMIT)
  const featuredOrders =
    variant === 'queue' ? activeOrders.slice(0, KDS2_FEATURED_ORDER_COUNT) : activeOrders
  const queueOrders =
    variant === 'queue'
      ? [...activeOrders.slice(KDS2_FEATURED_ORDER_COUNT), ...readyOrders]
      : []

  const handleProgressTap = (orderId: string, itemId: string) => {
    const tapKey = `${orderId}:${itemId}`
    const now = Date.now()
    const lastTap = tapTimestampsRef.current[tapKey] ?? 0
    const direction = now - lastTap <= DOUBLE_TAP_WINDOW_MS ? 'backward' : 'forward'
    tapTimestampsRef.current[tapKey] = now
    updateOrderItemProgress(orderId, itemId, direction)
  }

  const handleRecall = (orderId?: string) => {
    recallCompletedOrder(orderId)
  }

  return (
    <DisplayShell
      eyebrow={variant === 'queue' ? 'Kitchen Display 2' : 'Kitchen Display'}
      title={variant === 'queue' ? 'KDS 2 Alternative Layout' : 'Live Kitchen Tickets'}
      actions={
        <>
          <Card className="border-white/10 bg-white/10 px-4 py-3 text-white shadow-none">
            <div className="flex items-center gap-3">
              <ChefHat className="h-5 w-5 text-orange-200" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-300">
                  Active tickets
                </p>
                <p className="text-lg font-bold">{activeOrders.length}</p>
              </div>
            </div>
          </Card>
          {variant === 'queue' ? (
            <Button
              variant="secondary"
              className="bg-white text-slate-950 hover:bg-orange-50"
              onClick={() => setQueueOpen((current) => !current)}
            >
              {queueOpen ? (
                <PanelRightClose className="mr-2 h-4 w-4" />
              ) : (
                <PanelRightOpen className="mr-2 h-4 w-4" />
              )}
              {queueOpen ? 'Hide queue' : `Show queue (${queueOrders.length})`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="relative min-h-[calc(100svh-10rem)] overflow-hidden">
        <div
          className={cn(
            'space-y-4 transition-[padding] duration-300',
            variant === 'queue' && queueOpen ? 'lg:pr-[26vw]' : '',
          )}
        >
          <RecentlyClearedPanel
            orders={recentlyClearedOrders}
            customers={customers}
            onRecall={handleRecall}
          />
          {featuredOrders.length ? (
            <div
              className={cn(
                'grid gap-4',
                variant === 'queue' ? 'xl:grid-cols-2' : 'lg:grid-cols-3',
              )}
            >
              {featuredOrders.map((order) => {
                const nextStatus = getNextStatus(order.status)
                return (
                  <TicketCard
                    key={order.id}
                    order={order}
                    customerName={getCustomerName(order, customers)}
                    menuItems={menuItems}
                    actionLabel={`Move to ${titleCase(nextStatus)}`}
                    onAction={() => updateOrderStatus(order.id, nextStatus)}
                    onProgressItem={(itemId) => handleProgressTap(order.id, itemId)}
                    showProgress
                  />
                )
              })}
            </div>
          ) : (
            <Card className="border-white/10 bg-white/10 p-6 text-center text-lg text-slate-200">
              No active kitchen tickets.
            </Card>
          )}
        </div>
        {variant === 'queue' ? (
          <KdsQueuePanel
            orders={queueOrders}
            customers={customers}
            menuItems={menuItems}
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
          />
        ) : null}
      </div>
    </DisplayShell>
  )
}

export function KdsPage() {
  return <KdsSurface variant="classic" />
}

export function Kds2Page() {
  return <KdsSurface variant="queue" />
}

export function ExpeditorPage() {
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const readyOrders = orders.filter((order) => order.status === 'ready')
  const completedOrders = orders.filter((order) => order.status === 'completed').slice(0, 6)

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Ready for handoff</h2>
        <div className="mt-4 grid gap-3">
          {readyOrders.map((order) => {
            const customer = customers.find((entry) => entry.id === order.customerId)
            return (
              <TicketCard
                key={order.id}
                order={order}
                customerName={customer?.name ?? 'Unknown'}
                menuItems={menuItems}
                actionLabel="Mark completed"
                onAction={() => updateOrderStatus(order.id, 'completed')}
              />
            )
          })}
        </div>
      </Card>
      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Recently completed</h2>
        <div className="mt-4 space-y-3">
          {completedOrders.map((order) => {
            const customer = customers.find((entry) => entry.id === order.customerId)
            return (
              <div key={order.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{customer?.name ?? 'Unknown'}</p>
                    <p className="text-sm text-slate-500">
                      {order.reference}
                      {order.pagerNumber ? ` / Pager ${order.pagerNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant="slate">
                    {formatTime(order.timestamps.completed_at ?? order.createdAt)}
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

export function CustomerBoardPage() {
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const grouped: Record<'taken' | 'prepping' | 'in_oven' | 'ready', Order[]> = {
    taken: sortOrdersByPromise(orders.filter((order) => order.status === 'taken')),
    prepping: sortOrdersByPromise(orders.filter((order) => order.status === 'prepping')),
    in_oven: sortOrdersByPromise(orders.filter((order) => order.status === 'in_oven')),
    ready: sortOrdersByPromise(orders.filter((order) => order.status === 'ready')),
  }

  return (
    <DisplayShell eyebrow="Customer Board" title="Live Collection Board">
      <div className="grid gap-4 lg:grid-cols-4">
        {BOARD_STATUSES.map((status) => (
          <Card key={status} className={cn('min-h-[24rem] p-4 sm:p-5', statusStyles[status].card)}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">{titleCase(status)}</h2>
              <Badge variant={statusStyles[status].badge}>{grouped[status].length}</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {grouped[status].map((order) => (
                <div key={order.id} className="rounded-xl bg-white/90 p-4 shadow-sm">
                  <p className="text-xl font-semibold">{getCustomerName(order, customers)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {order.reference} / {formatTime(order.promisedTime)}
                  </p>
                  {order.pagerNumber ? (
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Pager {order.pagerNumber}
                    </p>
                  ) : null}
                </div>
              ))}
              {!grouped[status].length ? (
                <div className="rounded-xl border border-white/60 bg-white/65 p-4 text-sm text-slate-500">
                  No orders in this stage.
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </DisplayShell>
  )
}

export function PaymentPage() {
  const { paymentId } = useParams()
  const payments = usePizzaOpsStore((state) => state.payments)
  const updatePaymentStatus = usePizzaOpsStore((state) => state.updatePaymentStatus)
  const payment = payments.find((entry) => entry.id === paymentId)
  if (!payment) return <Navigate to="/" replace />

  const statusTone =
    payment.status === 'paid'
      ? 'text-emerald-300'
      : payment.status === 'failed'
        ? 'text-rose-300'
        : 'text-amber-300'
  const statusLabel =
    payment.status === 'paid'
      ? 'Payment success'
      : payment.status === 'failed'
        ? 'Payment failed'
        : 'Payment pending'

  return (
    <Card className="mx-auto max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-orange-100 p-3 text-orange-700">
          <SmartphoneNfc className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-orange-600">
            SumUp online payment
          </p>
          <h2 className="font-display text-3xl font-bold">Checkout scaffold</h2>
        </div>
      </div>
      <p className="mt-4 text-slate-600">
        This route stores the payment record and represents the hand-off point to SumUp
        checkout.
      </p>
      <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Payment reference</p>
        <p className="mt-1 text-2xl font-bold">{payment.providerReference}</p>
        <p className="mt-2 text-slate-300">{currency(payment.amount)}</p>
        <p className={cn('mt-3 text-sm font-semibold uppercase tracking-[0.2em]', statusTone)}>
          {statusLabel}
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="success" onClick={() => updatePaymentStatus(payment.id, 'paid')}>
          Simulate payment success
        </Button>
        <Button variant="danger" onClick={() => updatePaymentStatus(payment.id, 'failed')}>
          Simulate payment failure
        </Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>
          Back to order entry
        </Button>
      </div>
    </Card>
  )
}
