import { SmartphoneNfc } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { formatTime } from '../lib/time'
import { cn, currency, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Order, OrderStatus } from '../types/domain'

const statusStyles: Record<OrderStatus, { badge: 'blue' | 'amber' | 'orange' | 'green' | 'slate'; card: string }> = {
  taken: { badge: 'blue', card: 'border-sky-200 bg-sky-50/70' },
  prepping: { badge: 'amber', card: 'border-amber-200 bg-amber-50/80' },
  in_oven: { badge: 'orange', card: 'border-orange-200 bg-orange-50/80' },
  ready: { badge: 'green', card: 'border-emerald-200 bg-emerald-50/80' },
  completed: { badge: 'slate', card: 'border-slate-200 bg-slate-100/80' },
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
        <span>•</span>
        <span>{formatTime(order.promisedTime)} promised</span>
      </div>
      <div className="mt-4 space-y-2">
        {order.items.map((item) => {
          const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
          const progressCount = item.progressCount ?? 0
          const isComplete = progressCount >= item.quantity
          return (
            <button
              key={item.id}
              className={cn(
                'w-full rounded-xl px-3 py-3 text-left transition',
                showProgress
                  ? isComplete
                    ? 'bg-emerald-100 ring-2 ring-emerald-400'
                    : 'bg-white/90 hover:bg-emerald-50'
                  : 'bg-white/90',
              )}
              onClick={() => showProgress && onProgressItem?.(item.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.quantity} x {menuItem?.name}</p>
                  {item.modifiers?.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {item.modifiers.map((modifier) => modifier.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                {showProgress ? (
                  <div className={cn('rounded-full px-3 py-1 text-xs font-semibold', isComplete ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-700')}>
                    {progressCount}/{item.quantity}
                  </div>
                ) : null}
              </div>
              {showProgress ? (
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max((progressCount / item.quantity) * 100, 4)}%` }} />
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
      <Button className="mt-4 w-full" onClick={onAction}>{actionLabel}</Button>
    </Card>
  )
}

export function KdsPage() {
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const updateOrderItemProgress = usePizzaOpsStore((state) => state.updateOrderItemProgress)
  const activeOrders = orders.filter((order) => ['taken', 'prepping', 'in_oven'].includes(order.status))

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {activeOrders.map((order) => {
        const customer = customers.find((entry) => entry.id === order.customerId)
        const nextStatus = order.status === 'taken' ? 'prepping' : order.status === 'prepping' ? 'in_oven' : 'ready'
        return (
          <TicketCard
            key={order.id}
            order={order}
            customerName={customer?.name ?? 'Unknown'}
            menuItems={menuItems}
            actionLabel={`Move to ${titleCase(nextStatus)}`}
            onAction={() => updateOrderStatus(order.id, nextStatus)}
            onProgressItem={(itemId) => updateOrderItemProgress(order.id, itemId)}
            showProgress
          />
        )
      })}
    </div>
  )
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
                      {order.pagerNumber ? ` • Pager ${order.pagerNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant="slate">{formatTime(order.timestamps.completed_at ?? order.createdAt)}</Badge>
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
    taken: orders.filter((order) => order.status === 'taken'),
    prepping: orders.filter((order) => order.status === 'prepping'),
    in_oven: orders.filter((order) => order.status === 'in_oven'),
    ready: orders.filter((order) => order.status === 'ready'),
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {(Object.keys(grouped) as Array<keyof typeof grouped>).map((status) => (
        <Card key={status} className={cn('p-4 sm:p-5', statusStyles[status].card)}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">{titleCase(status)}</h2>
            <Badge variant={statusStyles[status].badge}>{grouped[status].length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {grouped[status].map((order) => {
              const customer = customers.find((entry) => entry.id === order.customerId)
              return (
                <div key={order.id} className="rounded-xl bg-white/90 p-4 shadow-sm">
                  <p className="text-xl font-semibold">{customer?.name ?? 'Unknown'}</p>
                  <p className="mt-1 text-sm text-slate-500">{order.reference} • {formatTime(order.promisedTime)}</p>
                  {order.pagerNumber ? <p className="mt-1 text-xs font-semibold text-slate-500">Pager {order.pagerNumber}</p> : null}
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
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
        <div className="rounded-2xl bg-orange-100 p-3 text-orange-700"><SmartphoneNfc className="h-6 w-6" /></div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-orange-600">SumUp online payment</p>
          <h2 className="font-display text-3xl font-bold">Checkout scaffold</h2>
        </div>
      </div>
      <p className="mt-4 text-slate-600">This route stores the payment record and represents the hand-off point to SumUp checkout.</p>
      <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Payment reference</p>
        <p className="mt-1 text-2xl font-bold">{payment.providerReference}</p>
        <p className="mt-2 text-slate-300">{currency(payment.amount)}</p>
        <p className={cn('mt-3 text-sm font-semibold uppercase tracking-[0.2em]', statusTone)}>{statusLabel}</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="success" onClick={() => updatePaymentStatus(payment.id, 'paid')}>Simulate payment success</Button>
        <Button variant="danger" onClick={() => updatePaymentStatus(payment.id, 'failed')}>Simulate payment failure</Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>Back to order entry</Button>
      </div>
    </Card>
  )
}
