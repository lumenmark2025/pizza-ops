import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { createHostedSumUpCheckout } from '../integrations/sumup'
import {
  applyItemDiscount,
  buildCodeDiscountSummary,
  buildManualDiscountSummary,
  calculateDiscountAmount,
  getOrderItemFinalLineTotal,
  getOrderItemOriginalLineTotal,
  getOrderPricingSummary,
  normalizeDiscountCodeInput,
  validateDiscountCode,
} from '../lib/discounts'
import { MENU_CATEGORY_OPTIONS, isPizzaMenuItem, resolveMenuCategorySlug, sortMenuItems } from '../lib/menu'
import { getMenuAvailability } from '../lib/slot-engine'
import { formatTime } from '../lib/time'
import { cn, currency, isValidEmail, normalizeEmail, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { AppliedDiscountSummary, DiscountCode, Modifier, OrderItem, OrderSource, PaymentMethod } from '../types/domain'

const orderSources: OrderSource[] = ['walkup', 'web', 'phone', 'whatsapp', 'messenger', 'manual']
const paymentMethods: PaymentMethod[] = ['sumup_online', 'tap_to_pay', 'cash', 'preorder']
const paymentMethodLabels: Record<PaymentMethod, string> = {
  sumup_online: 'SumUp',
  tap_to_pay: 'Tap to Pay',
  cash: 'Cash',
  preorder: 'Preorder',
  terminal: 'Tap to Pay',
  manual: 'Manual',
}

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
  const [searchParams] = useSearchParams()
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const discountCodes = usePizzaOpsStore((state) => state.discountCodes)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const customers = usePizzaOpsStore((state) => state.customers)
  const orders = usePizzaOpsStore((state) => state.orders)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const service = usePizzaOpsStore((state) => state.service)
  const masterDataLoadError = usePizzaOpsStore((state) => state.masterDataLoadError)
  const createOrder = usePizzaOpsStore((state) => state.createOrder)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)
  const getAvailableTimes = usePizzaOpsStore((state) => state.getAvailableTimes)
  const [customerName, setCustomerName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState<OrderSource>('walkup')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('sumup_online')
  const [notes, setNotes] = useState('')
  const [basket, setBasket] = useState<OrderItem[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [pagerNumber, setPagerNumber] = useState<string>('')
  const [message, setMessage] = useState<string | null>(null)
  const [discountCodeInput, setDiscountCodeInput] = useState('')
  const [discountMessage, setDiscountMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [orderDiscountDraft, setOrderDiscountDraft] = useState<AppliedDiscountSummary | null>(null)

  const availability = useMemo(
    () => getMenuAvailability(inventory, recipes, menuItems, orders),
    [inventory, menuItems, orders, recipes],
  )
  const activeMenuItems = useMemo(
    () => sortMenuItems(menuItems.filter((entry) => entry.active !== false)),
    [menuItems],
  )
  const groupedMenuItems = useMemo(
    () =>
      MENU_CATEGORY_OPTIONS.map((category) => ({
        ...category,
        items: activeMenuItems.filter(
          (item) => resolveMenuCategorySlug(item.categorySlug, item.category) === category.slug,
        ),
      })).filter((category) => category.items.length > 0),
    [activeMenuItems],
  )
  const activePagerNumbers = useMemo(
    () =>
      orders
        .filter((entry) => entry.status !== 'completed' && entry.pagerNumber)
        .map((entry) => entry.pagerNumber as number),
    [orders],
  )
  const emailSuggestions = useMemo(() => {
    const query = normalizeEmail(email)
    if (!query) {
      return []
    }

    return customers
      .filter((entry) => entry.email && normalizeEmail(entry.email).includes(query))
      .slice()
      .sort((left, right) => normalizeEmail(left.email ?? '').localeCompare(normalizeEmail(right.email ?? '')))
      .slice(0, 6)
  }, [customers, email])

  const resolvedOrderDiscount = useMemo(() => {
    if (!orderDiscountDraft) {
      return null
    }

    const provisionalPricing = getOrderPricingSummary(basket, menuItems, 0)
    return {
      ...orderDiscountDraft,
      appliedAmount: calculateDiscountAmount(
        orderDiscountDraft.discountType,
        orderDiscountDraft.discountValue,
        provisionalPricing.subtotalAmount - provisionalPricing.itemDiscountAmount,
      ),
    }
  }, [basket, menuItems, orderDiscountDraft])

  const availableSlots = useMemo(() => getAvailableTimes(basket), [basket, getAvailableTimes])
  const pricingSummary = useMemo(
    () => getOrderPricingSummary(basket, menuItems, resolvedOrderDiscount?.appliedAmount ?? 0),
    [basket, menuItems, resolvedOrderDiscount],
  )
  const total = pricingSummary.finalTotalAmount

  useEffect(() => {
    if (!selectedTime && availableSlots[0]) {
      setSelectedTime(availableSlots[0].promisedTime)
    }
  }, [availableSlots, selectedTime])

  useEffect(() => {
    const prefillName = searchParams.get('customerName')
    const prefillMobile = searchParams.get('mobile')
    const prefillEmail = searchParams.get('email')
    const prefillNotes = searchParams.get('notes')
    const prefillSource = searchParams.get('source')
    const prefillPayment = searchParams.get('payment')

    if (prefillName) {
      setCustomerName(prefillName)
    }
    if (prefillMobile) {
      setMobile(prefillMobile)
    }
    if (prefillEmail) {
      setEmail(prefillEmail)
    }
    if (prefillNotes) {
      setNotes(prefillNotes)
    }
    if (prefillSource && orderSources.includes(prefillSource as OrderSource)) {
      setSource(prefillSource as OrderSource)
    }
    if (prefillPayment && paymentMethods.includes(prefillPayment as PaymentMethod)) {
      setPaymentMethod(prefillPayment as PaymentMethod)
    }
  }, [searchParams])

  function addToBasket(menuItemId: string) {
    setBasket((current) => [
      ...current,
      { id: `${menuItemId}_${current.length + 1}`, menuItemId, quantity: 1, modifiers: [], progressCount: 0 },
    ])
  }

  function updateQuantity(itemId: string, quantity: number) {
    setBasket((current) =>
      current
        .map((item) =>
          item.id === itemId
            ? applyItemDiscount(
                { ...item, quantity },
                menuItems,
                item.appliedDiscountSummary ?? null,
              )
            : item,
        )
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
        const updatedItem = {
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

        return applyItemDiscount(updatedItem, menuItems, item.appliedDiscountSummary ?? null)
      }),
    )
  }

  function getEligibleModifiers(menuItemId: string) {
    const target = menuItems.find((entry) => entry.id === menuItemId)
    return modifiers.filter((modifier) =>
      modifier.appliesToAllPizzas
        ? isPizzaMenuItem(target)
        : modifier.menuItemIds.includes(menuItemId),
    )
  }

  function applyOrderManualDiscount(percent: number) {
    const appliedAt = new Date().toISOString()
    setOrderDiscountDraft(
      buildManualDiscountSummary({
        scope: 'order',
        discountType: 'percentage',
        discountValue: percent,
        appliedAmount: calculateDiscountAmount(
          'percentage',
          percent,
          pricingSummary.subtotalAmount - pricingSummary.itemDiscountAmount,
        ),
        source: 'manual_quick_button',
        appliedBy: 'manager',
        appliedAt,
      }),
    )
    setDiscountMessage(null)
  }

  function clearOrderDiscount() {
    setOrderDiscountDraft(null)
    setDiscountCodeInput('')
    setDiscountMessage(null)
  }

  function applyItemManualDiscount(itemId: string, percent: number) {
    const appliedAt = new Date().toISOString()
    setBasket((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item
        }

        const originalLineTotal = getOrderItemOriginalLineTotal(item, menuItems)

        return applyItemDiscount(
          item,
          menuItems,
          buildManualDiscountSummary({
            scope: 'item',
            discountType: 'percentage',
            discountValue: percent,
            appliedAmount: calculateDiscountAmount('percentage', percent, originalLineTotal),
            source: 'manual_quick_button',
            appliedBy: 'manager',
            appliedAt,
          }),
        )
      }),
    )
  }

  function clearItemDiscount(itemId: string) {
    setBasket((current) =>
      current.map((item) => (item.id === itemId ? applyItemDiscount(item, menuItems, null) : item)),
    )
  }

  function applyDiscountCode() {
    const normalized = normalizeDiscountCodeInput(discountCodeInput)
    const matchedCode = discountCodes.find(
      (entry) => normalizeDiscountCodeInput(entry.code) === normalized,
    )
    const now = new Date().toISOString()
    const validation = validateDiscountCode({
      discountCode: matchedCode,
      nowIso: now,
      items: basket,
      menuItems,
      scope: 'order',
    })

    if (!validation.ok) {
      setDiscountMessage(validation.error)
      return
    }

    const code = matchedCode as DiscountCode
    setOrderDiscountDraft(
      buildCodeDiscountSummary({
        scope: 'order',
        discountType: code.discountType,
        discountValue: code.discountValue,
        appliedAmount: calculateDiscountAmount(
          code.discountType,
          code.discountValue,
          pricingSummary.subtotalAmount - pricingSummary.itemDiscountAmount,
        ),
        code: code.code,
        discountCodeId: code.id,
        appliedBy: 'manager',
        appliedAt: now,
      }),
    )
    setDiscountMessage(`Code ${code.code} applied.`)
  }

  async function submitOrder() {
    if (!customerName.trim()) {
      setMessage('Customer name is required.')
      return
    }
    if (email.trim() && !isValidEmail(email)) {
      setMessage('Enter a valid email address or leave it blank.')
      return
    }
    if (!basket.length || !selectedTime) {
      setMessage('Basket and collection slot are required.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    const result = await createOrder({
      customerName,
      mobile,
      email,
      source,
      promisedTime: selectedTime,
      items: basket,
      paymentMethod,
      notes,
      pagerNumber: source === 'walkup' && pagerNumber ? Number(pagerNumber) : null,
      appliedOrderDiscount: resolvedOrderDiscount,
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
    setEmail('')
    setNotes('')
    setPagerNumber('')
    setOrderDiscountDraft(null)
    setDiscountCodeInput('')
    setDiscountMessage(null)
    setMessage(`Order created for ${formatTime(selectedTime)}.`)
    setIsSubmitting(false)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="p-4 sm:p-5">
      <ServiceBanner />
      {masterDataLoadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {masterDataLoadError}
        </div>
      ) : null}
        <div className="mt-5 space-y-5">
          {groupedMenuItems.map((category) => (
            <div key={category.slug}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold">{category.label}</h2>
                <Badge variant="slate">{category.items.length}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {category.items.map((menuItem) => {
                  const itemAvailability = availability.find((entry) => entry.menuItemId === menuItem.id)
                  return (
                    <Card key={menuItem.id} className={cn('border p-4', itemAvailability?.available ? 'border-white/70' : 'border-rose-200 bg-rose-50/80')}>
                      <div>
                        <div>
                          <h3 className="font-display text-xl font-semibold">{menuItem.name}</h3>
                          <p className="mt-1 text-sm text-slate-600">{menuItem.description}</p>
                        </div>
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
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Basket and customer</h2>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Order discount</p>
              <p className="mt-1 text-sm text-slate-600">
                {resolvedOrderDiscount
                  ? `${resolvedOrderDiscount.description} (${currency(resolvedOrderDiscount.appliedAmount)} off)`
                  : 'No order-level discount applied'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[10, 20, 50, 100].map((percent) => (
                <Button key={percent} size="sm" variant="secondary" onClick={() => applyOrderManualDiscount(percent)}>
                  {percent}%
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={clearOrderDiscount}>Clear</Button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Input placeholder="Discount or gift voucher code" value={discountCodeInput} onChange={(event) => setDiscountCodeInput(event.target.value)} />
            <Button onClick={applyDiscountCode}>Apply code</Button>
          </div>
          {discountMessage ? <p className="mt-2 text-sm text-slate-500">{discountMessage}</p> : null}
        </div>

        <div className="mt-4 grid gap-3">
          <Input placeholder="Customer name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <Input placeholder="Mobile (optional)" value={mobile} onChange={(event) => setMobile(event.target.value)} />
          <div className="relative">
            <Input placeholder="Email (optional)" value={email} onChange={(event) => setEmail(event.target.value)} />
            {emailSuggestions.length ? (
              <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                {emailSuggestions.map((customer) => (
                  <button
                    key={customer.id}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setEmail(customer.email ?? '')
                      setCustomerName(customer.name)
                      setMobile(customer.mobile ?? '')
                    }}
                  >
                    <span className="font-medium text-slate-900">{customer.email}</span>
                    <span className="text-slate-500">{customer.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={source} onChange={(event) => setSource(event.target.value as OrderSource)}>
              {orderSources.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {paymentMethods.map((option) => <option key={option} value={option}>{paymentMethodLabels[option]}</option>)}
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
            const eligibleModifiers = getEligibleModifiers(item.menuItemId)
            if (!menuItem) return null
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{menuItem.name}</p>
                    <p className="text-sm text-slate-500">
                      {item.appliedDiscountSummary
                        ? `${currency(getOrderItemFinalLineTotal(item, menuItems))} after line discount`
                        : `${currency(menuItem.price)} each`}
                    </p>
                    {item.modifiers?.length ? (
                      <p className="mt-1 text-xs text-slate-500">{item.modifiers.map((modifier) => modifier.name).join(', ')}</p>
                    ) : null}
                    {item.appliedDiscountSummary ? (
                      <p className="mt-1 text-xs font-semibold text-emerald-700">
                        {item.appliedDiscountSummary.description} ({currency(item.itemDiscountAmount ?? 0)} off)
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</Button>
                    <span className="w-6 text-center font-semibold">{item.quantity}</span>
                    <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</Button>
                    {eligibleModifiers.length ? (
                      <Button size="sm" variant="secondary" onClick={() => setExpandedItemId((current) => current === item.id ? null : item.id)}>
                        Modifiers
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[10, 20, 50, 100].map((percent) => (
                    <Button key={percent} size="sm" variant="outline" onClick={() => applyItemManualDiscount(item.id, percent)}>
                      {percent}%
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => clearItemDiscount(item.id)}>Clear</Button>
                </div>
                {eligibleModifiers.length && expandedItemId === item.id ? (
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
                          {modifier.name} {modifier.priceDelta >= 0 ? '+' : ''}{currency(modifier.priceDelta)}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          }) : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Add items to build the basket.</p>}
        </div>

        <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Collection slot</p>
            <p className="text-2xl font-bold">{currency(total)}</p>
          </div>
          <div className="mt-3 grid gap-1 text-sm text-slate-300">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>{currency(pricingSummary.subtotalAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total discount</span>
              <span>-{currency(pricingSummary.totalDiscountAmount)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold text-white">
              <span>Final total</span>
              <span>{currency(pricingSummary.finalTotalAmount)}</span>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {availableSlots.slice(0, 8).map((slot) => (
              <button
                key={slot.promisedTime}
                className={cn('rounded-xl border px-3 py-3 text-left transition', selectedTime === slot.promisedTime ? 'border-orange-300 bg-orange-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10')}
                onClick={() => setSelectedTime(slot.promisedTime)}
              >
                <p className="font-semibold">{formatTime(slot.promisedTime)}</p>
                <p className="text-xs text-slate-300">using {slot.allocations.length} slot{slot.allocations.length > 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
          {!availableSlots.length ? (
            <p className="mt-3 text-sm text-slate-300">
              {basket.length ? 'No collection slots available right now.' : 'Add an item to load valid collection times.'}
            </p>
          ) : null}
          <Button className="mt-4 w-full" size="lg" onClick={() => void submitOrder()} disabled={isSubmitting}>
            {isSubmitting ? 'Starting checkout...' : paymentMethod === 'sumup_online' ? 'Pay with SumUp' : paymentMethod === 'preorder' ? 'Create preorder' : 'Place order'}
          </Button>
          {message ? <p className="mt-3 text-sm text-orange-200">{message}</p> : null}
        </div>
      </Card>
    </div>
  )
}
