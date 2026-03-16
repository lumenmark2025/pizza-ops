import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { createHostedSumUpCheckout } from '../integrations/sumup'
import { getOrderItemsTotal } from '../lib/order-calculations'
import { getMenuAvailability } from '../lib/slot-engine'
import { formatTime } from '../lib/time'
import { cn, currency, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Modifier, OrderItem, OrderSource, PaymentMethod } from '../types/domain'

const orderSources: OrderSource[] = ['walkup', 'web', 'phone', 'whatsapp', 'messenger', 'manual']
const paymentMethods: PaymentMethod[] = ['sumup_online', 'cash', 'terminal', 'manual']

function ServiceBanner() {
  const service = usePizzaOpsStore((state) => state.service)

  if (!service.delayMinutes && !service.pausedUntil && service.status === 'live') {
    return null
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong>{titleCase(service.status)}</strong>
      {service.delayMinutes ? ` • ${service.delayMinutes} minute delay` : ''}
      {service.pausedUntil ? ` • Paused until ${formatTime(service.pausedUntil)}` : ''}
      {service.pauseReason ? ` • ${service.pauseReason}` : ''}
    </div>
  )
}

export function OrderEntryPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
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
  const [pagerNumber, setPagerNumber] = useState<string>('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const availability = useMemo(
    () => getMenuAvailability(inventory, recipes, menuItems, orders),
    [inventory, menuItems, orders, recipes],
  )
  const activePagerNumbers = useMemo(
    () =>
      orders
        .filter((entry) => entry.status !== 'completed' && entry.pagerNumber)
        .map((entry) => entry.pagerNumber as number),
    [orders],
  )
  const availableSlots = useMemo(() => getAvailableTimes(basket), [basket, getAvailableTimes])
  const total = useMemo(() => getOrderItemsTotal(basket, menuItems), [basket, menuItems])

  useEffect(() => {
    if (!selectedTime && availableSlots[0]) {
      setSelectedTime(availableSlots[0].promisedTime)
    }
  }, [availableSlots, selectedTime])

  function addToBasket(menuItemId: string) {
    setBasket((current) => [
      ...current,
      { id: `${menuItemId}_${current.length + 1}`, menuItemId, quantity: 1, modifiers: [], progressCount: 0 },
    ])
  }

  function updateQuantity(itemId: string, quantity: number) {
    setBasket((current) =>
      current
        .map((item) => (item.id === itemId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    )
  }

  function toggleModifier(itemId: string, modifier: Modifier) {
    setBasket((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item
        }

        const existing = item.modifiers?.find((entry) => entry.modifierId === modifier.id)
        return {
          ...item,
          modifiers: existing
            ? item.modifiers?.filter((entry) => entry.modifierId !== modifier.id)
            : [
                ...(item.modifiers ?? []),
                {
                  modifierId: modifier.id,
                  name: modifier.name,
                  priceDelta: modifier.priceDelta,
                  quantity: 1,
                },
              ],
        }
      }),
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

    const result = createOrder({
      customerName,
      mobile,
      source,
      promisedTime: selectedTime,
      items: basket,
      paymentMethod,
      notes,
      pagerNumber: source === 'walkup' && pagerNumber ? Number(pagerNumber) : null,
    })
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

        window.location.assign(checkout.hostedCheckoutUrl)
        return
      } catch (error) {
        setMessage(
          `${error instanceof Error ? error.message : 'Unable to start SumUp checkout.'} The order is saved and the basket has been kept.`,
        )
        setIsSubmitting(false)
        return
      }
    }

    setBasket([])
    setCustomerName('')
    setMobile('')
    setNotes('')
    setPagerNumber('')
    setMessage(`Order created for ${formatTime(selectedTime)}.`)
    setIsSubmitting(false)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="p-4 sm:p-5">
        <ServiceBanner />
        <div className="mt-5 flex items-center justify-between">
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
                  <Button onClick={() => addToBasket(menuItem.id)} disabled={!itemAvailability?.available}>
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
          {source === 'walkup' ? (
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={pagerNumber} onChange={(event) => setPagerNumber(event.target.value)}>
              <option value="">No pager assigned</option>
              {Array.from({ length: 40 }, (_, index) => index + 1).map((pager) => (
                <option key={pager} value={pager} disabled={activePagerNumbers.includes(pager)}>
                  Pager {pager} {activePagerNumbers.includes(pager) ? '(In use)' : ''}
                </option>
              ))}
            </select>
          ) : null}
          <Textarea placeholder="Notes, modifiers, handoff details" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <div className="mt-5 space-y-3">
          {basket.length ? basket.map((item) => {
            const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
            const eligibleModifiers = modifiers.filter((modifier) => modifier.menuItemIds.includes(item.menuItemId))
            if (!menuItem) return null
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{menuItem.name}</p>
                    <p className="text-sm text-slate-500">{currency(menuItem.price)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</Button>
                    <span className="w-6 text-center font-semibold">{item.quantity}</span>
                    <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</Button>
                  </div>
                </div>
                {eligibleModifiers.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {eligibleModifiers.map((modifier) => {
                      const active = item.modifiers?.some((entry) => entry.modifierId === modifier.id)
                      return (
                        <button
                          key={modifier.id}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-semibold',
                            active ? 'border-orange-400 bg-orange-100 text-orange-700' : 'border-slate-300 bg-white text-slate-600',
                          )}
                          onClick={() => toggleModifier(item.id, modifier)}
                        >
                          {modifier.name} +{currency(modifier.priceDelta)}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
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
              {basket.length ? 'No collection slots available right now.' : 'Add a pizza to load valid collection times.'}
            </p>
          ) : null}
          <Button className="mt-4 w-full" size="lg" onClick={() => void submitOrder()} disabled={isSubmitting}>
            {isSubmitting ? 'Starting checkout...' : paymentMethod === 'sumup_online' ? 'Pay with SumUp' : 'Place order'}
          </Button>
          {message ? <p className="mt-3 text-sm text-orange-200">{message}</p> : null}
        </div>
      </Card>
    </div>
  )
}
