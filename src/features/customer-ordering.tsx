import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { createHostedSumUpCheckout } from '../integrations/sumup'
import { getOrderItemsTotal } from '../lib/order-calculations'
import { getMenuAvailability } from '../lib/slot-engine'
import { formatTime } from '../lib/time'
import { cn, currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { OrderItem, PaymentStatus } from '../types/domain'

const PUBLIC_DRAFT_KEY = 'pizza_ops_public_order_draft_v1'

type PublicDraft = {
  serviceId: string | null
  basket: OrderItem[]
  customerName: string
  mobile: string
  notes: string
  selectedTime: string
}

type PizzaEditorState = {
  menuItemId: string
  basketItemId?: string
  quantity: number
  selectedModifierIds: string[]
}

const EMPTY_DRAFT: PublicDraft = {
  serviceId: null,
  basket: [],
  customerName: '',
  mobile: '',
  notes: '',
  selectedTime: '',
}

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

function readDraft() {
  if (typeof window === 'undefined') {
    return EMPTY_DRAFT
  }

  try {
    const raw = window.sessionStorage.getItem(PUBLIC_DRAFT_KEY)
    return raw ? ({ ...EMPTY_DRAFT, ...JSON.parse(raw) } as PublicDraft) : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}

function usePublicDraft() {
  const [draft, setDraft] = useState<PublicDraft>(() => readDraft())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify(draft))
  }, [draft])

  return {
    draft,
    patchDraft: (updates: Partial<PublicDraft>) =>
      setDraft((current) => ({ ...current, ...updates })),
    resetDraft: () => setDraft(EMPTY_DRAFT),
  }
}

function useEligibleServices() {
  const services = usePizzaOpsStore((state) => state.services)
  return useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const maxDate = new Date(today)
    maxDate.setDate(today.getDate() + 5)

    return services.filter((entry) => {
      const serviceDate = new Date(`${entry.date}T00:00:00`)
      return serviceDate >= today && serviceDate <= maxDate && entry.status !== 'closed'
    })
  }, [services])
}

function CustomerShell({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fde7d6,transparent_30%),linear-gradient(180deg,#fffdf8_0%,#fff7ed_100%)] px-4 py-6 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-[28px] border border-white/70 bg-white/85 px-5 py-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-orange-600">{eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            Fresh wood-fired pizza, clear collection times, and the right pickup location every time.
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}

function ServiceStatusBadge({
  acceptPublicOrders,
  status,
}: {
  acceptPublicOrders: boolean
  status: string
}) {
  if (!acceptPublicOrders) {
    return <Badge variant="red">Not accepting orders</Badge>
  }

  return <Badge variant={status === 'live' ? 'green' : 'blue'}>{status === 'live' ? 'Ordering open' : 'Pre-orders open'}</Badge>
}

function PizzaEditor({
  open,
  menuItemId,
  basketItemId,
  quantity,
  selectedModifierIds,
  onClose,
  onSave,
}: {
  open: boolean
  menuItemId: string | null
  basketItemId?: string
  quantity: number
  selectedModifierIds: string[]
  onClose: () => void
  onSave: (state: PizzaEditorState) => void
}) {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const menuItem = menuItems.find((entry) => entry.id === menuItemId)
  const eligibleModifiers = useMemo(() => {
    if (!menuItem) {
      return []
    }

    return modifiers.filter((modifier) =>
      modifier.appliesToAllPizzas
        ? menuItem.category === 'pizza'
        : modifier.menuItemIds.includes(menuItem.id),
    )
  }, [menuItem, modifiers])

  const [localQuantity, setLocalQuantity] = useState(quantity)
  const [localModifierIds, setLocalModifierIds] = useState<string[]>(selectedModifierIds)

  useEffect(() => {
    setLocalQuantity(quantity)
    setLocalModifierIds(selectedModifierIds)
  }, [quantity, selectedModifierIds, menuItemId, basketItemId])

  if (!open || !menuItem) {
    return null
  }

  const modifierTotal = eligibleModifiers
    .filter((modifier) => localModifierIds.includes(modifier.id))
    .reduce((sum, modifier) => sum + modifier.priceDelta, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-5 shadow-[0_40px_120px_rgba(15,23,42,0.25)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-600">Add to order</p>
            <h2 className="mt-2 font-display text-3xl font-bold">{menuItem.name}</h2>
            <p className="mt-2 text-sm text-slate-600">{menuItem.description}</p>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Base price</p>
          <p className="mt-1 text-2xl font-bold">{currency(menuItem.price)}</p>
        </div>
        {eligibleModifiers.length ? (
          <div className="mt-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Modifiers</p>
            <div className="mt-3 grid gap-2">
              {eligibleModifiers.map((modifier) => {
                const active = localModifierIds.includes(modifier.id)
                return (
                  <button
                    key={modifier.id}
                    className={cn(
                      'flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition',
                      active ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                    onClick={() =>
                      setLocalModifierIds((current) =>
                        active ? current.filter((entry) => entry !== modifier.id) : [...current, modifier.id],
                      )
                    }
                  >
                    <span className="font-semibold">{modifier.name}</span>
                    <span className="text-sm text-slate-500">
                      {modifier.priceDelta >= 0 ? '+' : ''}
                      {currency(modifier.priceDelta)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {!basketItemId ? (
          <div className="mt-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Quantity</p>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="outline" onClick={() => setLocalQuantity((current) => Math.max(1, current - 1))}>-</Button>
              <div className="rounded-2xl border border-slate-200 px-5 py-3 text-lg font-bold">{localQuantity}</div>
              <Button variant="outline" onClick={() => setLocalQuantity((current) => current + 1)}>+</Button>
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-4 text-white">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-300">Item total</p>
            <p className="mt-1 text-2xl font-bold">{currency((menuItem.price + modifierTotal) * localQuantity)}</p>
          </div>
          <Button
            className="bg-orange-500 text-white hover:bg-orange-400"
            onClick={() =>
              onSave({
                menuItemId: menuItem.id,
                basketItemId,
                quantity: localQuantity,
                selectedModifierIds: localModifierIds,
              })
            }
          >
            {basketItemId ? 'Save pizza' : 'Add to order'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function CustomerOrderPage() {
  const eligibleServices = useEligibleServices()
  const locations = usePizzaOpsStore((state) => state.locations)

  const groupedLocations = useMemo(
    () =>
      locations
        .filter((location) => eligibleServices.some((service) => service.locationId === location.id))
        .map((location) => ({
          location,
          services: eligibleServices.filter((service) => service.locationId === location.id),
        })),
    [eligibleServices, locations],
  )

  return (
    <CustomerShell eyebrow="Public Ordering" title="Choose where you’re collecting from">
      <div className="grid gap-4">
        {groupedLocations.map(({ location, services }) => (
          <Card key={location.id} className="overflow-hidden rounded-[28px] border-white/70 bg-white/90 p-0">
            <div className="border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-3xl font-bold">{location.name}</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    {location.addressLine1}
                    {location.addressLine2 ? `, ${location.addressLine2}` : ''}, {location.townCity} {location.postcode}
                  </p>
                </div>
                <Link to={`/order/location/${location.id}`}>
                  <Button variant="secondary">View services</Button>
                </Link>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
              {services.map((service) => (
                <Link key={service.id} to={`/order/service/${service.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{service.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{service.date} · {service.startTime} to {service.lastCollectionTime}</p>
                    </div>
                    <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
                  </div>
                  <p className="mt-3 text-sm text-slate-500">
                    {service.acceptPublicOrders
                      ? service.status === 'live'
                        ? 'Ordering is open now.'
                        : 'Pre-orders are available.'
                      : service.publicOrderClosureReason ?? 'Not currently accepting orders.'}
                  </p>
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </CustomerShell>
  )
}

export function CustomerLocationPage() {
  const { locationId } = useParams()
  const eligibleServices = useEligibleServices()
  const locations = usePizzaOpsStore((state) => state.locations)
  const location = locations.find((entry) => entry.id === locationId)
  const services = eligibleServices.filter((entry) => entry.locationId === locationId)

  if (!location) {
    return <Navigate to="/order" replace />
  }

  return (
    <CustomerShell eyebrow="Choose Service" title={location.name}>
      <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
        <p className="text-sm text-slate-600">
          {location.addressLine1}
          {location.addressLine2 ? `, ${location.addressLine2}` : ''}, {location.townCity} {location.postcode}
        </p>
        <div className="mt-5 grid gap-3">
          {services.map((service) => (
            <Link key={service.id} to={`/order/service/${service.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{service.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{service.date} · {service.startTime} to {service.lastCollectionTime}</p>
                </div>
                <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-5">
          <Link to="/order">
            <Button variant="outline">Back to locations</Button>
          </Link>
        </div>
      </Card>
    </CustomerShell>
  )
}

export function CustomerServicePage() {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const orders = usePizzaOpsStore((state) => state.orders)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const { draft, patchDraft } = usePublicDraft()
  const [editor, setEditor] = useState<PizzaEditorState | null>(null)

  useEffect(() => {
    if (serviceId && service.id !== serviceId) {
      loadServiceForEditing(serviceId)
    }
  }, [loadServiceForEditing, service.id, serviceId])

  useEffect(() => {
    if (serviceId && draft.serviceId !== serviceId) {
      patchDraft({ serviceId, basket: [], selectedTime: '' })
    }
  }, [draft.serviceId, patchDraft, serviceId])

  if (!serviceId) {
    return <Navigate to="/order" replace />
  }

  const location = locations.find((entry) => entry.id === service.locationId)
  const availability = getMenuAvailability(inventory, recipes, menuItems, orders)
  const groupedMenu = {
    pizzas: menuItems.filter((item) => item.category === 'pizza'),
    sides: menuItems.filter((item) => item.category === 'side'),
  }
  const basketTotal = getOrderItemsTotal(draft.basket, menuItems)

  function openNewPizza(menuItemId: string) {
    setEditor({
      menuItemId,
      quantity: 1,
      selectedModifierIds: [],
    })
  }

  function openExistingPizza(itemId: string) {
    const item = draft.basket.find((entry) => entry.id === itemId)
    if (!item) {
      return
    }

    setEditor({
      menuItemId: item.menuItemId,
      basketItemId: item.id,
      quantity: 1,
      selectedModifierIds: item.modifiers?.map((entry) => entry.modifierId) ?? [],
    })
  }

  function savePizza(state: PizzaEditorState) {
    const eligibleModifiers = modifiers.filter((modifier) =>
      modifier.appliesToAllPizzas
        ? menuItems.find((item) => item.id === state.menuItemId)?.category === 'pizza'
        : modifier.menuItemIds.includes(state.menuItemId),
    )
    const nextModifiers = eligibleModifiers
      .filter((modifier) => state.selectedModifierIds.includes(modifier.id))
      .map((modifier) => ({
        modifierId: modifier.id,
        name: modifier.name,
        priceDelta: modifier.priceDelta,
        quantity: 1,
      }))

    if (state.basketItemId) {
      patchDraft({
        basket: draft.basket.map((entry) =>
          entry.id === state.basketItemId ? { ...entry, modifiers: nextModifiers } : entry,
        ),
      })
    } else {
      const newItems = Array.from({ length: state.quantity }, () => ({
        id: `${state.menuItemId}_${crypto.randomUUID()}`,
        menuItemId: state.menuItemId,
        quantity: 1,
        modifiers: nextModifiers.map((entry) => ({ ...entry })),
      }))

      patchDraft({ basket: [...draft.basket, ...newItems] })
    }

    setEditor(null)
  }

  return (
    <CustomerShell eyebrow="Build Order" title={service.name}>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4">
          <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Collect from</p>
                <h2 className="mt-2 font-display text-3xl font-bold">{location?.name ?? service.locationName}</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {location?.addressLine1}
                  {location?.addressLine2 ? `, ${location.addressLine2}` : ''}, {location?.townCity} {location?.postcode}
                </p>
                <p className="mt-2 text-sm text-slate-600">{service.date} · {service.startTime} to {service.lastCollectionTime}</p>
              </div>
              <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
            </div>
            {!service.acceptPublicOrders ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {service.publicOrderClosureReason ?? 'This service is not currently accepting online orders.'}
              </div>
            ) : null}
          </Card>

          <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Menu</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Pick your pizzas</h2>
              </div>
              <Link to={`/order/location/${service.locationId}`}>
                <Button variant="outline">Change service</Button>
              </Link>
            </div>
            <div className="mt-5 grid gap-5">
              {(['pizzas', 'sides'] as const).map((groupKey) => {
                const items = groupedMenu[groupKey]
                if (!items.length) {
                  return null
                }

                return (
                  <div key={groupKey}>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{groupKey}</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {items.map((menuItem) => {
                        const itemAvailability = availability.find((entry) => entry.menuItemId === menuItem.id)
                        return (
                          <button
                            key={menuItem.id}
                            className={cn(
                              'rounded-[24px] border p-4 text-left transition',
                              itemAvailability?.available
                                ? 'border-slate-200 bg-slate-50 hover:bg-white'
                                : 'border-rose-200 bg-rose-50 text-slate-400',
                            )}
                            onClick={() => openNewPizza(menuItem.id)}
                            disabled={!itemAvailability?.available || !service.acceptPublicOrders}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="font-display text-2xl font-semibold">{menuItem.name}</h4>
                                <p className="mt-1 text-sm text-slate-600">{menuItem.description}</p>
                              </div>
                              <span className="text-xl font-bold">{currency(menuItem.price)}</span>
                            </div>
                            <p className="mt-4 text-sm font-semibold text-orange-700">
                              {itemAvailability?.available ? 'Customize and add' : 'Sold out'}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Your order</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Basket</h2>
          <div className="mt-5 space-y-3">
            {draft.basket.length ? (
              draft.basket.map((item) => {
                const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
                if (!menuItem) {
                  return null
                }

                return (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{menuItem.name}</p>
                        {item.modifiers?.length ? (
                          <p className="mt-1 text-sm text-slate-500">
                            {item.modifiers.map((modifier) => modifier.name).join(', ')}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-slate-500">Standard build</p>
                        )}
                      </div>
                      <p className="font-semibold">{currency(getOrderItemsTotal([item], menuItems))}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openExistingPizza(item.id)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => patchDraft({ basket: draft.basket.filter((entry) => entry.id !== item.id) })}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Choose a pizza to start your order.
              </p>
            )}
          </div>
          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Total</p>
              <p className="text-3xl font-bold">{currency(basketTotal)}</p>
            </div>
            <Button className="mt-4 w-full bg-orange-500 text-white hover:bg-orange-400" disabled={!draft.basket.length || !service.acceptPublicOrders} onClick={() => navigate('/order/checkout')}>
              Continue to checkout
            </Button>
          </div>
        </Card>
      </div>

      <PizzaEditor
        open={Boolean(editor)}
        menuItemId={editor?.menuItemId ?? null}
        basketItemId={editor?.basketItemId}
        quantity={editor?.quantity ?? 1}
        selectedModifierIds={editor?.selectedModifierIds ?? []}
        onClose={() => setEditor(null)}
        onSave={savePizza}
      />
    </CustomerShell>
  )
}

export function CustomerCheckoutPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const createOrder = usePizzaOpsStore((state) => state.createOrder)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)
  const getAvailableTimes = usePizzaOpsStore((state) => state.getAvailableTimes)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const { draft, patchDraft, resetDraft } = usePublicDraft()
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (draft.serviceId && service.id !== draft.serviceId) {
      loadServiceForEditing(draft.serviceId)
    }
  }, [draft.serviceId, loadServiceForEditing, service.id])

  const location = locations.find((entry) => entry.id === service.locationId)
  const availableSlots = useMemo(() => getAvailableTimes(draft.basket), [draft.basket, getAvailableTimes])
  const total = getOrderItemsTotal(draft.basket, menuItems)

  useEffect(() => {
    if (!draft.selectedTime && availableSlots[0]) {
      patchDraft({ selectedTime: availableSlots[0].promisedTime })
      return
    }

    if (draft.selectedTime && !availableSlots.some((slot) => slot.promisedTime === draft.selectedTime)) {
      patchDraft({ selectedTime: availableSlots[0]?.promisedTime ?? '' })
    }
  }, [availableSlots, draft.selectedTime, patchDraft])

  if (!draft.serviceId || !draft.basket.length) {
    return <Navigate to="/order" replace />
  }

  async function handlePay() {
    if (!draft.customerName.trim()) {
      setMessage('Please enter your name.')
      return
    }

    if (!draft.selectedTime) {
      setMessage('Please choose a collection time.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    const result = createOrder({
      customerName: draft.customerName,
      mobile: draft.mobile,
      source: 'web',
      promisedTime: draft.selectedTime,
      items: draft.basket,
      paymentMethod: 'sumup_online',
      notes: draft.notes,
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
        description: `${service.name} order for ${draft.customerName}`,
      })

      updatePaymentCheckout(result.paymentId, {
        providerReference: checkout.checkoutId,
        checkoutUrl: checkout.hostedCheckoutUrl,
        status: 'pending',
      })

      resetDraft()
      window.location.assign(checkout.hostedCheckoutUrl)
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : 'Unable to start SumUp checkout.'
      setMessage(`${nextMessage} Your basket is still saved, so you can retry.`)
      setIsSubmitting(false)
    }
  }

  return (
    <CustomerShell eyebrow="Checkout" title="Confirm your collection details">
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
          <h2 className="font-display text-3xl font-bold">Your order</h2>
          <div className="mt-5 space-y-3">
            {draft.basket.map((item) => {
              const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
              if (!menuItem) {
                return null
              }

              return (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{menuItem.name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {item.modifiers?.length
                          ? item.modifiers.map((modifier) => modifier.name).join(', ')
                          : 'Standard build'}
                      </p>
                    </div>
                    <p className="font-semibold">{currency(getOrderItemsTotal([item], menuItems))}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Total</p>
            <p className="mt-1 text-3xl font-bold">{currency(total)}</p>
          </div>
        </Card>

        <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Collection</p>
              <h2 className="mt-2 font-display text-3xl font-bold">{location?.name ?? service.locationName}</h2>
            </div>
            <Link to={`/order/service/${draft.serviceId}`}>
              <Button variant="outline">Back to menu</Button>
            </Link>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {location?.addressLine1}
            {location?.addressLine2 ? `, ${location.addressLine2}` : ''}, {location?.townCity} {location?.postcode}
          </p>
          <div className="mt-5 grid gap-3">
            <Input placeholder="Your name" value={draft.customerName} onChange={(event) => patchDraft({ customerName: event.target.value })} />
            <Input placeholder="Mobile number (optional)" value={draft.mobile} onChange={(event) => patchDraft({ mobile: event.target.value })} />
            <Textarea placeholder="Notes for the team" value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} />
          </div>
          <div className="mt-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Collection time</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {availableSlots.slice(0, 8).map((slot) => (
                <button
                  key={slot.promisedTime}
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-left transition',
                    draft.selectedTime === slot.promisedTime
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                  onClick={() => patchDraft({ selectedTime: slot.promisedTime })}
                >
                  <p className="font-semibold">{formatTime(slot.promisedTime)}</p>
                  <p className="text-xs text-slate-500">Collection slot</p>
                </button>
              ))}
            </div>
          </div>
          <Button className="mt-6 w-full bg-orange-500 text-white hover:bg-orange-400" size="lg" disabled={isSubmitting || !service.acceptPublicOrders} onClick={() => void handlePay()}>
            {isSubmitting ? 'Starting secure checkout...' : 'Pay securely'}
          </Button>
          {message ? <p className="mt-3 text-sm text-rose-600">{message}</p> : null}
        </Card>
      </div>
    </CustomerShell>
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
      updatePaymentStatus(payment.id, requestedStatus as PaymentStatus)
    }
  }, [payment, searchParams, updatePaymentStatus])

  if (!order || !payment) {
    return <Navigate to="/order" replace />
  }

  const paymentStatus =
    getPaymentStatusFromQuery(searchParams.get('status')) ??
    getPaymentStatusFromQuery(searchParams.get('result')) ??
    payment.status

  return (
    <CustomerShell eyebrow="Order Status" title={paymentStatus === 'paid' ? 'Payment confirmed' : paymentStatus === 'failed' ? 'Payment failed' : 'Payment pending'}>
      <Card className="mx-auto max-w-2xl rounded-[28px] border-white/70 bg-white/90 p-6">
        <Badge variant={paymentStatus === 'paid' ? 'green' : paymentStatus === 'failed' ? 'red' : 'amber'}>
          {paymentStatus}
        </Badge>
        <div className="mt-5 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">Order number</p>
            <p className="mt-1 text-2xl font-bold">{order.reference}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Collection time</p>
            <p className="mt-1 text-2xl font-bold">{formatTime(order.promisedTime)}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/order">
            <Button variant="secondary">Start another order</Button>
          </Link>
          <Link to="/board">
            <Button>View live order board</Button>
          </Link>
        </div>
      </Card>
    </CustomerShell>
  )
}
