import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  AlarmClockCheck,
  ChefHat,
  CircleDollarSign,
  ClipboardList,
  MonitorSmartphone,
  PackageCheck,
  Pizza,
  ReceiptText,
  Settings2,
  SmartphoneNfc,
  TimerReset,
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { getInventorySummary, getMenuAvailability } from './lib/slot-engine'
import { createHostedSumUpCheckout } from './integrations/sumup'
import { formatDateTime, formatTime } from './lib/time'
import { cn, currency, titleCase } from './lib/utils'
import { usePizzaOpsStore } from './store/usePizzaOpsStore'
import type { Order, OrderItem, OrderSource, OrderStatus, PaymentMethod } from './types/domain'

const orderSources: OrderSource[] = ['walkup', 'web', 'phone', 'whatsapp', 'messenger', 'manual']
const paymentMethods: PaymentMethod[] = ['sumup_online', 'cash', 'terminal', 'manual']
const statusStyles: Record<OrderStatus, { badge: 'blue' | 'amber' | 'orange' | 'green' | 'slate'; card: string }> = {
  taken: { badge: 'blue', card: 'border-sky-200 bg-sky-50/70' },
  prepping: { badge: 'amber', card: 'border-amber-200 bg-amber-50/80' },
  in_oven: { badge: 'orange', card: 'border-orange-200 bg-orange-50/80' },
  ready: { badge: 'green', card: 'border-emerald-200 bg-emerald-50/80' },
  completed: { badge: 'slate', card: 'border-slate-200 bg-slate-100/80' },
}

function App() {
  const setOnlineStatus = usePizzaOpsStore((state) => state.setOnlineStatus)

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

  return (
    <div className="min-h-screen px-3 py-4 text-slate-950 sm:px-4 lg:px-6">
      <AppFrame />
    </div>
  )
}

function AppFrame() {
  const location = useLocation()
  const isOnline = usePizzaOpsStore((state) => state.isOnline)
  const orders = usePizzaOpsStore((state) => state.orders)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)

  return (
    <div className="mx-auto max-w-[1600px]">
      <Card className="overflow-hidden border-white/70 bg-white/70">
        <header className="border-b border-white/70 bg-slate-950 px-4 py-4 text-white sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-display text-xs uppercase tracking-[0.4em] text-orange-200">
                Pizza Van Service Ops
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
                Bolton-le-Sands Public Service
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MetricChip icon={ClipboardList} label={`${orders.filter((o) => o.status !== 'completed').length} live orders`} />
              <MetricChip icon={ReceiptText} label={`${loyverseQueue.filter((q) => q.status === 'failed').length} sync issues`} tone="warn" />
              <MetricChip icon={isOnline ? Wifi : WifiOff} label={isOnline ? 'Online' : 'Offline cache mode'} tone={isOnline ? 'ok' : 'warn'} />
            </div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-2">
            {[
              { href: '/', label: 'Order Entry', icon: Pizza },
              { href: '/kds', label: 'KDS', icon: ChefHat },
              { href: '/expeditor', label: 'Expeditor', icon: PackageCheck },
              { href: '/board', label: 'Customer Board', icon: MonitorSmartphone },
              { href: '/admin', label: 'Admin', icon: Settings2 },
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
        <main className="p-4 sm:p-6">
          <Routes>
            <Route path="/" element={<OrderEntryPage />} />
            <Route path="/kds" element={<KdsPage />} />
            <Route path="/expeditor" element={<ExpeditorPage />} />
            <Route path="/board" element={<CustomerBoardPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/payments/:paymentId" element={<PaymentPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </Card>
    </div>
  )
}

function OrderEntryPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const orders = usePizzaOpsStore((state) => state.orders)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const service = usePizzaOpsStore((state) => state.service)
  const createOrder = usePizzaOpsStore((state) => state.createOrder)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)
  const getAvailableTimes = usePizzaOpsStore((state) => state.getAvailableTimes)
  const [customerName, setCustomerName] = useState('')
  const [mobile, setMobile] = useState('')
  const [source, setSource] = useState<OrderSource>('walkup')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('sumup_online')
  const [notes, setNotes] = useState('')
  const [basket, setBasket] = useState<OrderItem[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const availability = useMemo(
    () => getMenuAvailability(inventory, recipes, menuItems, orders),
    [inventory, menuItems, orders, recipes],
  )
  const availableSlots = useMemo(() => getAvailableTimes(basket), [basket, getAvailableTimes])
  const total = basket.reduce((sum, item) => {
    const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
    return sum + (menuItem?.price ?? 0) * item.quantity
  }, 0)

  useEffect(() => {
    if (!selectedTime && availableSlots[0]) {
      setSelectedTime(availableSlots[0].promisedTime)
    }
  }, [availableSlots, selectedTime])

  function addToBasket(menuItemId: string) {
    setBasket((current) => {
      const existing = current.find((item) => item.menuItemId === menuItemId)
      return existing
        ? current.map((item) => (item.menuItemId === menuItemId ? { ...item, quantity: item.quantity + 1 } : item))
        : [...current, { id: menuItemId, menuItemId, quantity: 1 }]
    })
  }

  function updateQuantity(menuItemId: string, quantity: number) {
    setBasket((current) =>
      current
        .map((item) => (item.menuItemId === menuItemId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    )
  }

  async function submitOrder() {
    if (!customerName.trim()) {
      setMessage('Customer name is required.')
      return
    }
    if (!basket.length || !selectedTime) {
      setMessage('Basket and collection slot are required.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    const result = createOrder({ customerName, mobile, source, promisedTime: selectedTime, items: basket, paymentMethod, notes })
    if (!result.ok) {
      setMessage(result.error)
      setIsSubmitting(false)
      return
    }

    if (paymentMethod === 'sumup_online' && result.paymentId) {
      try {
        const checkout = await createHostedSumUpCheckout({
          orderId: result.orderId,
          amount: total,
          description: `${service.name} order for ${customerName}`,
        })

        updatePaymentCheckout(result.paymentId, {
          providerReference: checkout.checkoutId,
          checkoutUrl: checkout.hostedCheckoutUrl,
          status: 'pending',
        })

        setBasket([])
        setCustomerName('')
        setMobile('')
        setNotes('')
        window.location.assign(checkout.hostedCheckoutUrl)
        return
      } catch (error) {
        const nextMessage =
          error instanceof Error
            ? error.message
            : 'Unable to start SumUp checkout. The order is still saved and the basket has been kept.'

        setMessage(`${nextMessage} The order is saved; you can retry payment from the same basket.`)
        setIsSubmitting(false)
        return
      }
    }

    setMessage(`Order created for ${formatTime(selectedTime)}.`)
    setBasket([])
    setCustomerName('')
    setMobile('')
    setNotes('')
    setIsSubmitting(false)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Order Entry</p>
            <h2 className="mt-1 font-display text-2xl font-bold">Build baskets fast on tablet</h2>
          </div>
          <Badge variant="blue">{service.startTime} to {service.lastCollectionTime}</Badge>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {menuItems.map((menuItem) => {
            const itemAvailability = availability.find((entry) => entry.menuItemId === menuItem.id)
            return (
              <Card key={menuItem.id} className={cn('border p-4', itemAvailability?.available ? 'border-white/70' : 'border-rose-200 bg-rose-50/80')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold">{menuItem.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{menuItem.description}</p>
                  </div>
                  <Badge variant={menuItem.category === 'pizza' ? 'orange' : 'slate'}>{menuItem.category}</Badge>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xl font-bold">{currency(menuItem.price)}</span>
                  <Button onClick={() => addToBasket(menuItem.id)} disabled={!itemAvailability?.available} variant={itemAvailability?.available ? 'default' : 'outline'}>
                    {itemAvailability?.available ? 'Add' : 'Sold out'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Basket and customer</h2>
        <div className="mt-4 grid gap-3">
          <Input placeholder="Customer name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <Input placeholder="Mobile (optional)" value={mobile} onChange={(event) => setMobile(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={source} onChange={(event) => setSource(event.target.value as OrderSource)}>
              {orderSources.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {paymentMethods.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
          </div>
          <Textarea placeholder="Notes, modifiers, handoff details" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <div className="mt-5 space-y-3">
          {basket.length ? basket.map((item) => {
            const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
            if (!menuItem) return null
            return (
              <div key={item.menuItemId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <p className="font-semibold">{menuItem.name}</p>
                  <p className="text-sm text-slate-500">{currency(menuItem.price)} each</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}>-</Button>
                  <span className="w-6 text-center font-semibold">{item.quantity}</span>
                  <Button size="sm" variant="outline" onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}>+</Button>
                </div>
              </div>
            )
          }) : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Add pizzas to build the basket.</p>}
        </div>
        <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Collection slot</p>
            <p className="text-2xl font-bold">{currency(total)}</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {availableSlots.slice(0, 8).map((slot) => (
              <button
                key={slot.promisedTime}
                className={cn('rounded-xl border px-3 py-3 text-left transition', selectedTime === slot.promisedTime ? 'border-orange-300 bg-orange-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10')}
                onClick={() => setSelectedTime(slot.promisedTime)}
              >
                <p className="font-semibold">{formatTime(slot.promisedTime)}</p>
                <p className="text-xs text-slate-300">Internal load across {slot.allocations.length} slot{slot.allocations.length > 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
          {!availableSlots.length ? (
            <p className="mt-3 text-sm text-slate-300">
              {basket.length
                ? 'No collection slots available right now.'
                : 'Add a pizza to load valid collection times.'}
            </p>
          ) : null}
          <Button className="mt-4 w-full" size="lg" onClick={() => void submitOrder()} disabled={isSubmitting}>
            {isSubmitting
              ? 'Starting checkout...'
              : paymentMethod === 'sumup_online'
                ? 'Pay with SumUp'
                : 'Place order'}
          </Button>
          {message ? <p className="mt-3 text-sm text-orange-200">{message}</p> : null}
        </div>
      </Card>
    </div>
  )
}

function KdsPage() {
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const activeOrders = orders.filter((order) => ['taken', 'prepping', 'in_oven'].includes(order.status))

  return <div className="grid gap-4 lg:grid-cols-3">{activeOrders.map((order) => {
    const customer = customers.find((entry) => entry.id === order.customerId)
    const nextStatus = order.status === 'taken' ? 'prepping' : order.status === 'prepping' ? 'in_oven' : 'ready'
    return <TicketCard key={order.id} order={order} customerName={customer?.name ?? 'Unknown'} menuItems={menuItems} actionLabel={`Move to ${titleCase(nextStatus)}`} onAction={() => updateOrderStatus(order.id, nextStatus)} />
  })}</div>
}

function ExpeditorPage() {
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
            return <TicketCard key={order.id} order={order} customerName={customer?.name ?? 'Unknown'} menuItems={menuItems} actionLabel="Mark completed" onAction={() => updateOrderStatus(order.id, 'completed')} />
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
                    <p className="text-sm text-slate-500">{order.reference}</p>
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

function CustomerBoardPage() {
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
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}

function AdminPage() {
  const service = usePizzaOpsStore((state) => state.service)
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const payments = usePizzaOpsStore((state) => state.payments)
  const activityLog = usePizzaOpsStore((state) => state.activityLog)
  const addDelay = usePizzaOpsStore((state) => state.addDelay)
  const pauseService = usePizzaOpsStore((state) => state.pauseService)
  const moveOrder = usePizzaOpsStore((state) => state.moveOrder)
  const retryLoyverseSync = usePizzaOpsStore((state) => state.retryLoyverseSync)
  const resetDemo = usePizzaOpsStore((state) => state.resetDemo)
  const [delayMinutes, setDelayMinutes] = useState(10)
  const [pauseMinutes, setPauseMinutes] = useState(15)
  const [reason, setReason] = useState('')
  const [moveOrderId, setMoveOrderId] = useState(orders[0]?.id ?? '')
  const [moveTime, setMoveTime] = useState(orders[0]?.promisedTime ?? '')
  const [moveReason, setMoveReason] = useState('')
  const [moveWarning, setMoveWarning] = useState<string | null>(null)
  const inventorySummary = useMemo(() => getInventorySummary(inventory, recipes, menuItems, orders), [inventory, menuItems, orders, recipes])

  function handleMove(override: boolean) {
    const result = moveOrder(moveOrderId, moveTime, moveReason || 'Manual move', override)
    setMoveWarning(result.warning ?? (result.ok ? 'Order moved.' : 'Unable to move order.'))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <StatPanel icon={AlarmClockCheck} title="Service Window" value={`${service.startTime}-${service.endTime}`} detail={`Last slot ${service.lastCollectionTime}`} />
          <StatPanel icon={TimerReset} title="Delay" value={`${service.delayMinutes} mins`} detail={service.pausedUntil ? `Paused until ${formatTime(service.pausedUntil)}` : 'Live service'} />
          <StatPanel icon={CircleDollarSign} title="Payments" value={`${payments.filter((entry) => entry.status === 'paid').length} paid`} detail={`${payments.filter((entry) => entry.status === 'failed').length} failed`} />
        </div>
        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Service controls</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Pause service</p>
              <Input className="mt-3" type="number" value={pauseMinutes} onChange={(event) => setPauseMinutes(Number(event.target.value))} />
              <Textarea className="mt-3" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Button className="mt-3 w-full" variant="warning" onClick={() => pauseService(pauseMinutes, 'manager', reason || 'Operational pause')}>Pause service</Button>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Add delay</p>
              <Input className="mt-3" type="number" value={delayMinutes} onChange={(event) => setDelayMinutes(Number(event.target.value))} />
              <Textarea className="mt-3" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Button className="mt-3 w-full" variant="secondary" onClick={() => addDelay(delayMinutes, 'manager', reason || 'Operational delay')}>Apply delay</Button>
            </div>
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Manual reslot and overrides</h2>
            <Badge variant="amber">Advisory warnings only</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={moveOrderId} onChange={(event) => {
              const nextId = event.target.value
              setMoveOrderId(nextId)
              const match = orders.find((entry) => entry.id === nextId)
              setMoveTime(match?.promisedTime ?? '')
            }}>
              {orders.filter((order) => order.status !== 'completed').map((order) => {
                const customer = customers.find((entry) => entry.id === order.customerId)
                return <option key={order.id} value={order.id}>{order.reference} - {customer?.name ?? 'Unknown'}</option>
              })}
            </select>
            <Input value={moveTime} onChange={(event) => setMoveTime(event.target.value)} />
            <Textarea placeholder="Override reason" value={moveReason} onChange={(event) => setMoveReason(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => handleMove(false)}>Move with warning checks</Button>
              <Button variant="danger" onClick={() => handleMove(true)}>Override and force move</Button>
            </div>
            {moveWarning ? <p className="text-sm text-slate-600">{moveWarning}</p> : null}
          </div>
        </Card>
      </div>
      <div className="grid gap-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Inventory pressure</h2>
            <Badge variant="orange">Recipe-based</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {inventorySummary.map((entry) => {
              const ingredient = ingredients.find((item) => item.id === entry.ingredientId)
              const isLow = entry.remaining <= (ingredient?.lowStockThreshold ?? 0)
              return (
                <div key={entry.ingredientId}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{ingredient?.name}</span>
                    <span className={cn(isLow && 'text-rose-600')}>{entry.remaining} {ingredient?.unit} left</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-200">
                    <div className={cn('h-2 rounded-full', isLow ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${Math.max((entry.remaining / entry.total) * 100, 6)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Loyverse sync queue</h2>
            <Button size="sm" variant="outline" onClick={resetDemo}>Reset demo</Button>
          </div>
          <div className="mt-4 space-y-3">
            {loyverseQueue.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{entry.orderId}</p>
                  <Badge variant={entry.status === 'failed' ? 'red' : entry.status === 'synced' ? 'green' : 'amber'}>{entry.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">Attempts {entry.attempts} {entry.lastError ? `• ${entry.lastError}` : ''}</p>
                <Button className="mt-3" size="sm" variant="secondary" onClick={() => retryLoyverseSync(entry.id)}>Retry sync</Button>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Activity log</h2>
          <div className="mt-4 space-y-3">
            {activityLog.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{entry.message}</p>
                  <span className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{entry.actor}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function PaymentPage() {
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
      <p className="mt-4 text-slate-600">This route stores the payment record and represents the hand-off point to SumUp checkout. In production, redirect to the real SumUp checkout URL and consume webhook updates back into the payments table.</p>
      <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Payment reference</p>
        <p className="mt-1 text-2xl font-bold">{payment.providerReference}</p>
        <p className="mt-2 text-slate-300">{currency(payment.amount)}</p>
        <p className={cn('mt-3 text-sm font-semibold uppercase tracking-[0.2em]', statusTone)}>
          {statusLabel}
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="success" onClick={() => updatePaymentStatus(payment.id, 'paid')}>Simulate payment success</Button>
        <Button variant="danger" onClick={() => updatePaymentStatus(payment.id, 'failed')}>Simulate payment failure</Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>Back to order entry</Button>
      </div>
    </Card>
  )
}

function TicketCard({
  order,
  customerName,
  menuItems,
  actionLabel,
  onAction,
}: {
  order: Order
  customerName: string
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Card className={cn('p-4 sm:p-5', statusStyles[order.status].card)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{order.reference}</p>
          <h3 className="font-display text-2xl font-bold">{customerName}</h3>
        </div>
        <Badge variant={statusStyles[order.status].badge}>{order.status}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
        <span>{formatTime(order.createdAt)} taken</span>
        <span>•</span>
        <span>{formatTime(order.promisedTime)} promised</span>
      </div>
      <div className="mt-4 space-y-2">
        {order.items.map((item) => {
          const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
          return <div key={item.id} className="rounded-xl bg-white/90 px-3 py-2"><div className="flex items-center justify-between"><p className="font-semibold">{menuItem?.name}</p><p className="text-sm text-slate-500">x{item.quantity}</p></div></div>
        })}
      </div>
      <Button className="mt-4 w-full" onClick={onAction}>{actionLabel}</Button>
    </Card>
  )
}

function MetricChip({ icon: Icon, label, tone }: { icon: ComponentType<{ className?: string }>; label: string; tone?: 'ok' | 'warn' }) {
  return <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold', tone === 'warn' ? 'bg-amber-400/20 text-amber-100' : 'bg-white/10 text-white')}><Icon className="h-4 w-4" />{label}</div>
}

function StatPanel({ icon: Icon, title, value, detail }: { icon: ComponentType<{ className?: string }>; title: string; value: string; detail: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-orange-100 p-3 text-orange-700"><Icon className="h-5 w-5" /></div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
      </div>
    </Card>
  )
}

export default App
