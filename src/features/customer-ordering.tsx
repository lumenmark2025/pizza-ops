import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { createHostedSumUpCheckout } from '../integrations/sumup'
import { getMenuAvailability } from '../lib/slot-engine'
import { formatTime } from '../lib/time'
import { cn, currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Modifier, OrderItem } from '../types/domain'

function getPaymentStatusFromQuery(value: string | null) {
  const normalized = value?.toLowerCase()

  if (!normalized) {
    return null
  }

  if (['success', 'paid', 'successful'].includes(normalized)) {
    return 'paid' as const
  }

  if (['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(normalized)) {
    return 'failed' as const
  }

  if (normalized === 'pending') {
    return 'pending' as const
  }

  return null
}

export function CustomerOrderPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const orders = usePizzaOpsStore((state) => state.orders)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const service = usePizzaOpsStore((state) => state.service)
  const services = usePizzaOpsStore((state) => state.services)
  const locations = usePizzaOpsStore((state) => state.locations)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const createOrder = usePizzaOpsStore((state) => state.createOrder)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)
  const getAvailableTimes = usePizzaOpsStore((state) => state.getAvailableTimes)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const [customerName, setCustomerName] = useState('')
  const [mobile, setMobile] = useState('')
  const [notes, setNotes] = useState('')
  const [basket, setBasket] = useState<OrderItem[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const availability = useMemo(
    () => getMenuAvailability(inventory, recipes, menuItems, orders),
    [inventory, menuItems, orders, recipes],
  )
  const eligibleServices = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const maxDate = new Date(today)
    maxDate.setDate(today.getDate() + 5)

    return services.filter((entry) => {
      const serviceDate = new Date(`${entry.date}T00:00:00`)
      return serviceDate >= today && serviceDate <= maxDate && entry.status !== 'closed'
    })
  }, [services])
  const location = useMemo(
    () => locations.find((entry) => entry.id === service.locationId),
    [locations, service.locationId],
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

  useEffect(() => {
    if (eligibleServices.length && !eligibleServices.some((entry) => entry.id === service.id)) {
      loadServiceForEditing(eligibleServices[0].id)
    }
  }, [eligibleServices, loadServiceForEditing, service.id])

  function addToBasket(menuItemId: string) {
    setBasket((current) => {
      const existing = current.find((item) => item.menuItemId === menuItemId)
      return existing
        ? current.map((item) =>
            item.menuItemId === menuItemId
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          )
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

  function getEligibleModifiers(menuItemId: string) {
    const target = menuItems.find((entry) => entry.id === menuItemId)
    return modifiers.filter((modifier) =>
      modifier.appliesToAllPizzas
        ? target?.category === 'pizza'
        : modifier.menuItemIds.includes(menuItemId),
    )
  }

  function toggleModifier(menuItemId: string, modifier: Modifier) {
    setBasket((current) =>
      current.map((item) => {
        if (item.menuItemId !== menuItemId) {
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

  async function handlePay() {
    if (!customerName.trim()) {
      setMessage('Please enter your name.')
      return
    }

    if (!basket.length || !selectedTime) {
      setMessage('Please choose your items and a collection time.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    const result = createOrder({
      customerName,
      mobile,
      source: 'web',
      promisedTime: selectedTime,
      items: basket,
      paymentMethod: 'sumup_online',
      notes,
    })

    if (!result.ok || !result.paymentId) {
      setMessage(result.ok ? 'Unable to create a payment session.' : result.error)
      setIsSubmitting(false)
      return
    }

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
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : 'Unable to start SumUp checkout.'
      setMessage(`${nextMessage} Your basket is still here, so you can retry.`)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden p-0">
          <div className="bg-slate-950 px-5 py-6 text-white sm:px-6">
            <p className="text-xs uppercase tracking-[0.32em] text-orange-200">Order Pizza</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
              {service.name}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Fresh wood-fired pizza. Pick your order, choose a collection slot, and pay
              online.
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              <p className="font-semibold text-white">{location?.name ?? service.locationName}</p>
              <p>{location?.addressLine1}</p>
              {location?.addressLine2 ? <p>{location.addressLine2}</p> : null}
              <p>{location ? `${location.townCity} ${location.postcode}` : 'Address to be confirmed'}</p>
              <p className="mt-2">{service.date} · {service.startTime} to {service.lastCollectionTime}</p>
            </div>
            {!service.acceptPublicOrders ? (
              <p className="mt-3 rounded-2xl border border-rose-300/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
                Public ordering is currently closed. {service.publicOrderClosureReason ?? 'Please check back later.'}
              </p>
            ) : null}
          </div>
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Available services in the next 5 days</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {eligibleServices.map((entry) => {
                const entryLocation = locations.find((item) => item.id === entry.locationId)
                const active = entry.id === service.id
                return (
                  <button key={entry.id} className={cn('rounded-2xl border px-4 py-3 text-left text-sm transition', active ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-100')} onClick={() => loadServiceForEditing(entry.id)}>
                    <p className="font-semibold">{entryLocation?.name ?? entry.locationName}</p>
                    <p className="text-slate-500">{entry.date} · {entry.startTime}-{entry.lastCollectionTime}</p>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
            {menuItems.map((menuItem) => {
              const itemAvailability = availability.find(
                (entry) => entry.menuItemId === menuItem.id,
              )

              return (
                <Card
                  key={menuItem.id}
                  className={cn(
                    'border p-4 shadow-none',
                    itemAvailability?.available
                      ? 'border-slate-200'
                      : 'border-rose-200 bg-rose-50/80',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-2xl font-semibold">{menuItem.name}</h2>
                      <p className="mt-1 text-sm text-slate-600">{menuItem.description}</p>
                    </div>
                    <Badge variant={menuItem.category === 'pizza' ? 'orange' : 'slate'}>
                      {menuItem.category}
                    </Badge>
                  </div>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xl font-bold">{currency(menuItem.price)}</span>
                    <Button
                      onClick={() => addToBasket(menuItem.id)}
                      disabled={!itemAvailability?.available}
                    >
                      {itemAvailability?.available ? 'Add' : 'Sold out'}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Your basket</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Checkout</h2>
              </div>
              <Badge variant="blue">
                {service.startTime} to {service.lastCollectionTime}
              </Badge>
            </div>

            <div className="mt-5 space-y-3">
              {basket.length ? (
                basket.map((item) => {
                  const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
                  if (!menuItem) {
                    return null
                  }

                  return (
                    <div
                      key={item.menuItemId}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div>
                        <p className="font-semibold">{menuItem.name}</p>
                        <p className="text-sm text-slate-500">{currency(menuItem.price)} each</p>
                        {item.modifiers?.length ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {item.modifiers.map((modifier) => modifier.name).join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}
                        >
                          -
                        </Button>
                        <span className="w-7 text-center font-semibold">{item.quantity}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}
                        >
                          +
                        </Button>
                        {getEligibleModifiers(item.menuItemId).length ? (
                          <Button size="sm" variant="secondary" onClick={() => setExpandedItemId((current) => current === item.menuItemId ? null : item.menuItemId)}>
                            Modify
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                  Add some pizzas to begin your order.
                </p>
              )}
            </div>
            {basket.map((item) => {
              const eligibleModifiers = getEligibleModifiers(item.menuItemId)
              if (!eligibleModifiers.length || expandedItemId !== item.menuItemId) {
                return null
              }

              return (
                <div key={`${item.menuItemId}_mods`} className="mt-3 flex flex-wrap gap-2">
                  {eligibleModifiers.map((modifier) => {
                    const active = item.modifiers?.some((entry) => entry.modifierId === modifier.id)
                    return (
                      <button
                        key={modifier.id}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-semibold',
                          active ? 'border-orange-400 bg-orange-100 text-orange-700' : 'border-slate-300 bg-white text-slate-600',
                        )}
                        onClick={() => toggleModifier(item.menuItemId, modifier)}
                      >
                        {modifier.name} {modifier.priceDelta >= 0 ? '+' : ''}{currency(modifier.priceDelta)}
                      </button>
                    )
                  })}
                </div>
              )
            })}

            <div className="mt-5 grid gap-3">
              <Input
                placeholder="Your name"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
              <Input
                placeholder="Mobile number (optional)"
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
              />
              <Textarea
                placeholder="Notes for the team"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            <div className="mt-5">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Collection times
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {availableSlots.slice(0, 8).map((slot) => (
                  <button
                    key={slot.promisedTime}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-left transition',
                      selectedTime === slot.promisedTime
                        ? 'border-orange-400 bg-orange-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                    onClick={() => setSelectedTime(slot.promisedTime)}
                  >
                    <p className="font-semibold">{formatTime(slot.promisedTime)}</p>
                    <p className="text-xs text-slate-500">
                      Ready to collect at this time
                    </p>
                  </button>
                ))}
              </div>
              {!availableSlots.length ? (
                <p className="mt-3 text-sm text-slate-500">
                  {basket.length
                    ? 'No collection slots are available right now.'
                    : 'Add a pizza to see available collection times.'}
                </p>
              ) : null}
            </div>

            <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between">
                <p className="text-sm uppercase tracking-[0.22em] text-slate-300">Total</p>
                <p className="text-3xl font-bold">{currency(total)}</p>
              </div>
              <Button
                className="mt-4 w-full bg-orange-500 text-white hover:bg-orange-400"
                size="lg"
                onClick={() => void handlePay()}
                disabled={isSubmitting || !service.acceptPublicOrders}
              >
                {isSubmitting ? 'Starting secure checkout...' : service.acceptPublicOrders ? 'Pay securely' : 'Public ordering closed'}
              </Button>
              {message ? <p className="mt-3 text-sm text-orange-200">{message}</p> : null}
            </div>
          </Card>

          <p className="px-2 text-center text-xs text-slate-500">
            By paying, you reserve your collection slot. Live order progress is available on the{' '}
            <Link className="font-semibold text-slate-900 underline" to="/board">
              order board
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

export function CustomerOrderConfirmationPage() {
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const orders = usePizzaOpsStore((state) => state.orders)
  const payments = usePizzaOpsStore((state) => state.payments)
  const updatePaymentStatus = usePizzaOpsStore((state) => state.updatePaymentStatus)

  const order = orders.find((entry) => entry.id === orderId)
  const payment = payments.find((entry) => entry.orderId === orderId)

  useEffect(() => {
    if (!payment) {
      return
    }

    const requestedStatus =
      getPaymentStatusFromQuery(searchParams.get('status')) ??
      getPaymentStatusFromQuery(searchParams.get('result'))

    if (requestedStatus && requestedStatus !== payment.status) {
      updatePaymentStatus(payment.id, requestedStatus)
    }
  }, [payment, searchParams, updatePaymentStatus])

  if (!order || !payment) {
    return <Navigate to="/order" replace />
  }

  const paymentStatus =
    getPaymentStatusFromQuery(searchParams.get('status')) ??
    getPaymentStatusFromQuery(searchParams.get('result')) ??
    payment.status

  const title =
    paymentStatus === 'paid'
      ? 'Payment confirmed'
      : paymentStatus === 'failed'
        ? 'Payment failed'
        : 'Payment pending'
  const tone =
    paymentStatus === 'paid'
      ? 'green'
      : paymentStatus === 'failed'
        ? 'red'
        : 'amber'

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden p-0">
        <div className="bg-slate-950 px-6 py-7 text-white">
          <p className="text-xs uppercase tracking-[0.32em] text-orange-200">Order status</p>
          <h1 className="mt-2 font-display text-4xl font-bold">{title}</h1>
        </div>
        <div className="space-y-5 p-6">
          <Badge variant={tone}>{paymentStatus}</Badge>
          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-500">Order number</p>
              <p className="mt-1 text-2xl font-bold">{order.reference}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Collection time</p>
              <p className="mt-1 text-2xl font-bold">{formatTime(order.promisedTime)}</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            {paymentStatus === 'paid'
              ? 'Your payment was successful. Please arrive at your promised collection time.'
              : paymentStatus === 'failed'
                ? 'Your payment did not complete. You can place the order again or ask the team for help.'
                : 'Your payment is still being confirmed. Refresh this page shortly if needed.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/order">
              <Button variant="secondary">Start another order</Button>
            </Link>
            <Link to="/board">
              <Button>View live order board</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
