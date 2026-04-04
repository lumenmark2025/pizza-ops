import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChilliRating } from '../components/chilli-rating'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { validatePublicDiscountCode } from '../integrations/discounts'
import { createHostedSumUpCheckout } from '../integrations/sumup'
import {
  buildCodeDiscountSummary,
  calculateDiscountAmount,
  getOrderPricingSummary,
  normalizeDiscountCodeInput,
  validateDiscountCode,
} from '../lib/discounts'
import {
  MENU_CATEGORY_OPTIONS,
  getMenuCategoryLabel,
  getMenuCategoryShortLabel,
  getMenuItemImageUrl,
  isPizzaMenuItem,
  normalizeMenuItem,
  resolveMenuCategorySlug,
  sortMenuItems,
} from '../lib/menu'
import { getDomainContext } from '../lib/domain-context'
import { getOrderItemsTotal } from '../lib/order-calculations'
import { getMenuAvailability } from '../lib/slot-engine'
import { addMinutes, formatTime } from '../lib/time'
import { cn, currency, isValidEmail } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { AppliedDiscountSummary, DiscountCode, Location, MenuItem, OrderItem, PaymentStatus, PricingSummary, ServiceConfig } from '../types/domain'

const PUBLIC_DRAFT_KEY = 'pizza_ops_public_order_draft_v1'

type PublicDraft = {
  serviceId: string | null
  basket: OrderItem[]
  customerName: string
  mobile: string
  email: string
  notes: string
  discountCode: string
  appliedOrderDiscount: AppliedDiscountSummary | null
  pricingSummary: PricingSummary | null
  selectedTime: string
  paymentState: 'draft' | 'pending_payment' | 'paid' | 'cancelled'
  pendingOrderId: string | null
  pendingPaymentId: string | null
  pendingCheckoutUrl: string | null
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
  email: '',
  notes: '',
  discountCode: '',
  appliedOrderDiscount: null,
  pricingSummary: null,
  selectedTime: '',
  paymentState: 'draft',
  pendingOrderId: null,
  pendingPaymentId: null,
  pendingCheckoutUrl: null,
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

function getDraftResetPatch() {
  return {
    paymentState: 'draft' as const,
    pendingOrderId: null,
    pendingPaymentId: null,
    pendingCheckoutUrl: null,
  }
}

function buildEmptyDraftForService(serviceId: string | null): PublicDraft {
  return {
    ...EMPTY_DRAFT,
    serviceId,
  }
}

function getBasketSignature(basket: OrderItem[]) {
  return JSON.stringify(
    basket.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      modifiers: (item.modifiers ?? []).map((modifier) => ({
        modifierId: modifier.modifierId,
        quantity: modifier.quantity,
      })),
    })),
  )
}

function useCustomerVoucher(
  draft: PublicDraft,
  patchDraft: (updates: Partial<PublicDraft>) => void,
  discountCodes: DiscountCode[],
  menuItems: MenuItem[],
) {
  const [discountCodeInput, setDiscountCodeInput] = useState(draft.discountCode)
  const [discountMessage, setDiscountMessage] = useState<string | null>(null)
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false)

  const pricingSummary = useMemo(
    () => getOrderPricingSummary(draft.basket, menuItems, draft.appliedOrderDiscount?.appliedAmount ?? 0),
    [draft.appliedOrderDiscount?.appliedAmount, draft.basket, menuItems],
  )
  const basketSignature = useMemo(() => getBasketSignature(draft.basket), [draft.basket])

  useEffect(() => {
    setDiscountCodeInput(draft.discountCode)
  }, [draft.discountCode])

  function validateDiscountCodeLocally(codeInput: string) {
    const normalized = normalizeDiscountCodeInput(codeInput)
    const matchedCode = discountCodes.find(
      (entry) => normalizeDiscountCodeInput(entry.code) === normalized,
    )
    const nowIso = new Date().toISOString()
    const validation = validateDiscountCode({
      discountCode: matchedCode,
      nowIso,
      items: draft.basket,
      menuItems,
      scope: 'order',
    })

    if (!validation.ok || !matchedCode) {
      return { ok: false as const, error: validation.ok ? 'Discount code not found.' : validation.error }
    }

    const pricingBeforeDiscount = getOrderPricingSummary(draft.basket, menuItems, 0)
    const appliedAmount = calculateDiscountAmount(
      matchedCode.discountType,
      matchedCode.discountValue,
      pricingBeforeDiscount.subtotalAmount - pricingBeforeDiscount.itemDiscountAmount,
    )

    return {
      ok: true as const,
      appliedOrderDiscount: buildCodeDiscountSummary({
        scope: 'order',
        discountType: matchedCode.discountType,
        discountValue: matchedCode.discountValue,
        appliedAmount,
        code: matchedCode.code,
        discountCodeId: matchedCode.id,
        appliedBy: 'customer',
        appliedAt: nowIso,
      }),
      pricingSummary: getOrderPricingSummary(draft.basket, menuItems, appliedAmount),
      message: `${matchedCode.code} applied.`,
    }
  }

  async function validateCustomerDiscountCode(codeInput: string) {
    const result = await validatePublicDiscountCode({
      code: codeInput,
      items: draft.basket,
    })

    const normalizedError = result.ok ? '' : result.error.toLowerCase()
    if (
      result.ok ||
      !(
        normalizedError.includes('unable to validate this discount code right now') ||
        normalizedError.includes('unable to validate this code right now') ||
        normalizedError.includes('unexpected server error') ||
        normalizedError.includes('missing supabase server environment variables')
      )
    ) {
      return result
    }

    return validateDiscountCodeLocally(codeInput)
  }

  useEffect(() => {
    if (!draft.discountCode) {
      if (draft.appliedOrderDiscount || draft.pricingSummary) {
        patchDraft({
          appliedOrderDiscount: null,
          pricingSummary: getOrderPricingSummary(draft.basket, menuItems, 0),
        })
      }
      return
    }

    if (!draft.basket.length) {
      patchDraft({
        ...getDraftResetPatch(),
        appliedOrderDiscount: null,
        pricingSummary: getOrderPricingSummary([], menuItems, 0),
      })
      return
    }

    let cancelled = false

    async function refreshAppliedDiscount() {
      const result = await validateCustomerDiscountCode(draft.discountCode)

      if (cancelled) {
        return
      }

      if (!result.ok) {
        patchDraft({
          ...getDraftResetPatch(),
          appliedOrderDiscount: null,
          pricingSummary: getOrderPricingSummary(draft.basket, menuItems, 0),
        })
        setDiscountMessage(result.error)
        return
      }

      patchDraft({
        appliedOrderDiscount: result.appliedOrderDiscount,
        pricingSummary: result.pricingSummary,
      })
    }

    void refreshAppliedDiscount()

    return () => {
      cancelled = true
    }
  }, [basketSignature, draft.basket, draft.discountCode, menuItems, patchDraft])

  async function applyDiscountCode() {
    if (isApplyingDiscount) {
      return { ok: false as const }
    }

    if (!discountCodeInput.trim()) {
      setDiscountMessage('Enter a discount or gift voucher code.')
      return { ok: false as const }
    }

    if (!draft.basket.length) {
      setDiscountMessage('Add items before applying a code.')
      return { ok: false as const }
    }

    setIsApplyingDiscount(true)
    setDiscountMessage(null)

    try {
      const resolvedResult = await validateCustomerDiscountCode(discountCodeInput)

      if (!resolvedResult.ok) {
        setDiscountMessage(resolvedResult.error)
        return { ok: false as const, error: resolvedResult.error }
      }

      patchDraft({
        ...getDraftResetPatch(),
        discountCode: discountCodeInput.trim(),
        appliedOrderDiscount: resolvedResult.appliedOrderDiscount,
        pricingSummary: resolvedResult.pricingSummary,
      })
      setDiscountMessage(resolvedResult.message)
      return {
        ok: true as const,
        appliedOrderDiscount: resolvedResult.appliedOrderDiscount,
        pricingSummary: resolvedResult.pricingSummary,
      }
    } finally {
      setIsApplyingDiscount(false)
    }
  }

  function removeDiscountCode() {
    setDiscountCodeInput('')
    setDiscountMessage(null)
    patchDraft({
      ...getDraftResetPatch(),
      discountCode: '',
      appliedOrderDiscount: null,
      pricingSummary: getOrderPricingSummary(draft.basket, menuItems, 0),
    })
  }

  return {
    discountCodeInput,
    setDiscountCodeInput,
    discountMessage,
    setDiscountMessage,
    isApplyingDiscount,
    applyDiscountCode,
    removeDiscountCode,
    pricingSummary,
    validateCustomerDiscountCode,
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
      return (
        !Number.isNaN(serviceDate.getTime()) &&
        serviceDate >= today &&
        serviceDate <= maxDate &&
        entry.status !== 'cancelled' &&
        entry.acceptPublicOrders
      )
    })
  }, [services])
}

function CustomerShell({
  title,
  eyebrow,
  headerContent,
  children,
}: {
  title: string
  eyebrow: string
  headerContent?: React.ReactNode
  children: React.ReactNode
}) {
  const branding = usePizzaOpsStore((state) => state.branding)
  const resolvedTitle = eyebrow === 'Public Ordering' ? 'Order now' : title
  return (
    <div
      className="min-h-screen px-3 py-4 text-slate-950 sm:px-6 sm:py-6"
      style={{
        background: `radial-gradient(circle at top, ${branding.secondaryColor}, transparent 30%), linear-gradient(180deg, #fffdf8 0%, ${branding.secondaryColor} 100%)`,
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 rounded-[28px] border border-white/70 bg-white/85 px-4 py-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:mb-6 sm:px-8 sm:py-6">
          <div className="min-h-16">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="Brand logo" className="h-16 w-auto object-contain" />
            ) : null}
          </div>
          {eyebrow && eyebrow !== 'Public Ordering' ? (
            <p className="text-xs font-semibold uppercase tracking-[0.35em]" style={{ color: branding.accentTextColor }}>
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
            {resolvedTitle}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">{branding.introText}</p>
          {headerContent ? <div className="mt-4">{headerContent}</div> : null}
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

function formatCustomerServiceDateTime(date: string, startTime: string, endTime: string) {
  const start = new Date(`${date}T${startTime}:00`)
  const end = new Date(`${date}T${endTime}:00`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${date} ${startTime} - ${endTime}`
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const startDay = new Date(start)
  startDay.setHours(0, 0, 0, 0)

  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short' })

  const formatCompactTime = (value: Date) =>
    timeFormatter
      .format(value)
      .replace(':00', '')
      .replace(' am', 'am')
      .replace(' pm', 'pm')

  const day = start.getDate()
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? 'st'
      : day % 10 === 2 && day % 100 !== 12
        ? 'nd'
        : day % 10 === 3 && day % 100 !== 13
          ? 'rd'
          : 'th'

  const dayLabel =
    startDay.getTime() === today.getTime()
      ? 'Today'
      : startDay.getTime() === tomorrow.getTime()
        ? 'Tomorrow'
        : `${monthFormatter.format(start)} ${day}${suffix}`

  return `${dayLabel} ${formatCompactTime(start)} - ${formatCompactTime(end)}`
}

function isGlutenFreeBaseModifierName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  return normalized.includes('gluten free')
}

function getCustomerLocationAddress(location?: Location | null) {
  if (!location) {
    return null
  }

  const parts = [
    location.addressLine1?.trim(),
    location.addressLine2?.trim(),
    location.townCity?.trim(),
    location.postcode?.trim(),
  ].filter(Boolean)

  return parts.length ? parts.join(', ') : null
}

function getCustomerOrderingPhone(location?: Location | null) {
  const phone = location?.orderingPhone?.trim()
  return phone?.length ? phone : null
}

function getCustomerServiceCardDisplay(service: ServiceConfig, location?: Location) {
  const title = location?.name?.trim() || service.locationName?.trim() || service.name?.trim() || 'Collection service'
  const locationLine = getCustomerLocationAddress(location) || service.locationName?.trim() || null

  return {
    title,
    locationLine,
    dateTime: formatCustomerServiceDateTime(service.date, service.startTime, service.lastCollectionTime),
  }
}

function MenuItemMedia({
  imageUrl,
  name,
  className,
}: {
  imageUrl?: string | null
  name: string
  className?: string
}) {
  const resolvedImageUrl = getMenuItemImageUrl({ imageUrl })

  return (
    <div className={cn('flex h-32 items-center justify-center overflow-hidden rounded-[22px] bg-slate-100', className)}>
      {resolvedImageUrl ? (
        <img src={resolvedImageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)] text-slate-400">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}
    </div>
  )
}

function CategoryJumpNav({ categorySlugs }: { categorySlugs: string[] }) {
  if (!categorySlugs.length) {
    return null
  }

  return (
    <div className="sticky top-3 z-10 -mx-1 overflow-x-auto pb-1">
      <div className="inline-flex min-w-full gap-2 rounded-2xl border border-white/70 bg-white/90 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        {categorySlugs.map((slug) => (
          <a
            key={slug}
            href={`#menu-category-${slug}`}
            className="whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-orange-100 hover:text-orange-800"
          >
            {getMenuCategoryShortLabel(slug, slug)}
          </a>
        ))}
      </div>
    </div>
  )
}

function VoucherCodeCard({
  discountCodeInput,
  setDiscountCodeInput,
  discountMessage,
  applyDiscountCode,
  removeDiscountCode,
  isApplyingDiscount,
  appliedOrderDiscount,
  pricingSummary,
}: {
  discountCodeInput: string
  setDiscountCodeInput: (value: string) => void
  discountMessage: string | null
  applyDiscountCode: () => Promise<{ ok: boolean }>
  removeDiscountCode: () => void
  isApplyingDiscount: boolean
  appliedOrderDiscount: AppliedDiscountSummary | null
  pricingSummary: PricingSummary
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Discount code</p>
          <p className="mt-1 text-sm text-slate-600">
            {appliedOrderDiscount
              ? `${appliedOrderDiscount.description} (${currency(appliedOrderDiscount.appliedAmount)} off)`
              : 'Enter a gift voucher or discount code.'}
          </p>
        </div>
        {appliedOrderDiscount ? (
          <Button size="sm" variant="outline" onClick={removeDiscountCode}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Enter code"
          value={discountCodeInput}
          onChange={(event) => setDiscountCodeInput(event.target.value)}
        />
        <Button onClick={() => void applyDiscountCode()} disabled={isApplyingDiscount}>
          {isApplyingDiscount ? 'Checking...' : 'Apply'}
        </Button>
      </div>
      {discountMessage ? (
        <p className={cn('mt-2 text-sm', appliedOrderDiscount ? 'text-emerald-700' : 'text-rose-600')}>
          {discountMessage}
        </p>
      ) : null}
      <div className="mt-4 grid gap-1 text-sm text-slate-600">
        <div className="flex items-center justify-between">
          <span>Subtotal</span>
          <span>{currency(pricingSummary.subtotalAmount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Discount</span>
          <span>-{currency(pricingSummary.totalDiscountAmount)}</span>
        </div>
        <div className="flex items-center justify-between font-semibold text-slate-950">
          <span>Total</span>
          <span>{currency(pricingSummary.finalTotalAmount)}</span>
        </div>
      </div>
    </div>
  )
}

function confirmClearBasket() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.confirm('Remove all items and start again?')
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
        ? isPizzaMenuItem(menuItem)
        : modifier.menuItemIds.includes(menuItem.id),
    )
  }, [menuItem, modifiers])

  const [localQuantity, setLocalQuantity] = useState(quantity)
  const [localModifierIds, setLocalModifierIds] = useState<string[]>(selectedModifierIds)

  useEffect(() => {
    setLocalQuantity(quantity)
    setLocalModifierIds(selectedModifierIds)
  }, [quantity, selectedModifierIds, menuItemId, basketItemId])

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return
    }

    const { body, documentElement } = document
    const previousBodyOverflow = body.style.overflow
    const previousBodyTouchAction = body.style.touchAction
    const previousHtmlOverflow = documentElement.style.overflow

    body.style.overflow = 'hidden'
    body.style.touchAction = 'none'
    documentElement.style.overflow = 'hidden'

    return () => {
      body.style.overflow = previousBodyOverflow
      body.style.touchAction = previousBodyTouchAction
      documentElement.style.overflow = previousHtmlOverflow
    }
  }, [open])

  if (!open || !menuItem) {
    return null
  }

  const modifierTotal = eligibleModifiers
    .filter((modifier) => localModifierIds.includes(modifier.id))
    .reduce((sum, modifier) => sum + modifier.priceDelta, 0)
  const glutenFreeBaseSelected = eligibleModifiers.some(
    (modifier) => localModifierIds.includes(modifier.id) && isGlutenFreeBaseModifierName(modifier.name),
  )

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/45">
      <div className="flex h-full items-end justify-center overflow-hidden p-3 sm:items-center">
      <div className="flex h-[min(92vh,48rem)] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-[28px] bg-white p-5 shadow-[0_40px_120px_rgba(15,23,42,0.25)] sm:h-[min(88vh,48rem)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-600">Add to order</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl font-bold">{menuItem.name}</h2>
              <ChilliRating rating={menuItem.chilliRating ?? 0} />
            </div>
            <p className="mt-2 text-sm text-slate-600">{menuItem.description}</p>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-1">
          <MenuItemMedia imageUrl={menuItem.imageUrl} name={menuItem.name} className="mt-5 h-40 shrink-0" />
          <div className="mt-5 shrink-0 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Base price</p>
            <p className="mt-1 text-2xl font-bold">{currency(menuItem.price)}</p>
          </div>
          {eligibleModifiers.length ? (
            <div className="mt-5">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Modifiers</p>
              <div className="mt-3 grid gap-2 pb-1">
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
              {glutenFreeBaseSelected ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Gluten-free base selected. This product is not suitable for those with coeliac disease due to risk of cross-contamination.
                </div>
              ) : null}
            </div>
          ) : null}
          {!basketItemId ? (
            <div className="mt-5 shrink-0">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Quantity</p>
              <div className="mt-3 flex items-center gap-3">
                <Button variant="outline" onClick={() => setLocalQuantity((current) => Math.max(1, current - 1))}>-</Button>
                <div className="rounded-2xl border border-slate-200 px-5 py-3 text-lg font-bold">{localQuantity}</div>
                <Button variant="outline" onClick={() => setLocalQuantity((current) => current + 1)}>+</Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-4 text-white">
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
    </div>
  )
}

export function CustomerOrderPage() {
  const eligibleServices = useEligibleServices()
  const locations = usePizzaOpsStore((state) => state.locations)
  const branding = usePizzaOpsStore((state) => state.branding)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)

  return (
    <CustomerShell eyebrow="Public Ordering" title="Choose where you’re collecting from">
      <div className="grid gap-4">
        {!remoteReady ? (
          <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-6">
            <h2 className="font-display text-2xl font-bold">Loading services</h2>
            <p className="mt-2 text-sm text-slate-600">Refreshing available collection locations and times...</p>
          </Card>
        ) : null}
        {remoteReady && !eligibleServices.length ? (
          <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-6">
            <h2 className="font-display text-2xl font-bold">No services available right now</h2>
            <p className="mt-2 text-sm text-slate-600">
              There are no public-order services available in the current window. This page now stays visible instead of appearing blank when no service matches the current filter.
            </p>
          </Card>
        ) : null}
        {remoteReady ? eligibleServices.map((service) => {
          const location = locations.find((entry) => entry.id === service.locationId)
          const display = getCustomerServiceCardDisplay(service, location)
          return (
            <Link key={service.id} to={`/order/service/${service.id}`} className="block rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:bg-white sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-3xl font-bold">{display.title}</h2>
                  {display.locationLine ? <p className="mt-2 text-sm text-slate-600">{display.locationLine}</p> : null}
                  <p className="mt-2 text-sm text-slate-500">{display.dateTime}</p>
                </div>
                <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {service.acceptPublicOrders ? <div /> : (
                  <p className="text-sm text-slate-500">
                    {service.publicOrderClosureReason ?? 'Not currently accepting orders.'}
                  </p>
                )}
                <Button variant="secondary" style={{ backgroundColor: branding.primaryColor, color: '#fff', borderColor: branding.primaryColor }}>
                  {branding.orderCtaLabel}
                </Button>
              </div>
            </Link>
          )
        }) : null}
      </div>
    </CustomerShell>
  )
}

export function CustomerLocationPage() {
  const { locationId } = useParams()
  const eligibleServices = useEligibleServices()
  const locations = usePizzaOpsStore((state) => state.locations)
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const location = locations.find((entry) => entry.id === locationId)
  const services = eligibleServices.filter((entry) => entry.locationId === locationId)

  if (!remoteReady) {
    return (
      <CustomerShell eyebrow="Choose Service" title="Loading location">
        <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">Refreshing live service times...</Card>
      </CustomerShell>
    )
  }

  if (!location) {
    return <Navigate to="/order" replace />
  }

  return (
    <CustomerShell eyebrow="Choose Service" title={location.name}>
      <Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">
        {getCustomerLocationAddress(location) ? <p className="text-sm text-slate-600">{getCustomerLocationAddress(location)}</p> : null}
        {getCustomerOrderingPhone(location) ? <p className="mt-2 text-sm text-slate-600">Order by phone: {getCustomerOrderingPhone(location)}</p> : null}
        <div className="mt-5 grid gap-3">
          {services.map((service) => {
            const display = getCustomerServiceCardDisplay(service, location)
            return (
              <Link key={service.id} to={`/order/service/${service.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{display.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{display.dateTime}</p>
                  </div>
                  <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
                </div>
              </Link>
            )
          })}
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
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const orders = usePizzaOpsStore((state) => state.orders)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const discountCodes = usePizzaOpsStore((state) => state.discountCodes)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const refreshInventoryForService = usePizzaOpsStore((state) => state.refreshInventoryForService)
  const { draft, patchDraft } = usePublicDraft()
  const [editor, setEditor] = useState<PizzaEditorState | null>(null)
  const [loadingInventory, setLoadingInventory] = useState(true)
  const {
    discountCodeInput,
    setDiscountCodeInput,
    discountMessage,
    isApplyingDiscount,
    applyDiscountCode,
    removeDiscountCode,
    pricingSummary,
  } = useCustomerVoucher(draft, patchDraft, discountCodes, menuItems)

  useEffect(() => {
    if (!serviceId) {
      setLoadingInventory(false)
      return
    }

    let cancelled = false
    setLoadingInventory(true)
    loadServiceForEditing(serviceId)
    void refreshInventoryForService(serviceId)
      .catch(() => {
        // Error is already surfaced through store state.
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInventory(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [loadServiceForEditing, refreshInventoryForService, serviceId])

  useEffect(() => {
    if (serviceId && draft.serviceId !== serviceId) {
      patchDraft({
        serviceId,
        basket: [],
        discountCode: '',
        appliedOrderDiscount: null,
        pricingSummary: null,
        selectedTime: '',
        paymentState: 'draft',
        pendingOrderId: null,
        pendingPaymentId: null,
        pendingCheckoutUrl: null,
      })
    }
  }, [draft.serviceId, patchDraft, serviceId])

  if (!serviceId) {
    return <Navigate to="/order" replace />
  }

  const location = locations.find((entry) => entry.id === service.locationId)
  const serviceDisplay = getCustomerServiceCardDisplay(service, location)
  const availability = getMenuAvailability(inventory, recipes, menuItems, orders)
  const visibleMenuItems = useMemo(
    () => sortMenuItems(menuItems.map(normalizeMenuItem).filter((item) => item.active !== false)),
    [menuItems],
  )
  const categorySections = useMemo(
    () =>
      MENU_CATEGORY_OPTIONS.map((category) => ({
        ...category,
        items: visibleMenuItems.filter(
          (item) => resolveMenuCategorySlug(item.categorySlug, item.category) === category.slug,
        ),
      })).filter((section) => section.items.length > 0),
    [visibleMenuItems],
  )
  const basketTotal = pricingSummary.finalTotalAmount

  if (!remoteReady || loadingInventory || service.id !== serviceId) {
    return <CustomerShell eyebrow="Choose Service" title="Loading service"><Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">Refreshing live menu and availability...</Card></CustomerShell>
  }

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
        ? isPizzaMenuItem(menuItems.find((item) => item.id === state.menuItemId))
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
        ...getDraftResetPatch(),
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

      patchDraft({
        ...getDraftResetPatch(),
        basket: [...draft.basket, ...newItems],
      })
    }

    setEditor(null)
  }

  function clearBasket() {
    if (!confirmClearBasket()) {
      return
    }

    patchDraft(buildEmptyDraftForService(serviceId ?? null))
    setEditor(null)
  }

  return (
    <CustomerShell
      eyebrow="Build Order"
      title={service.name}
      headerContent={
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-600">{serviceDisplay.title}</p>
            {serviceDisplay.locationLine ? <p className="mt-1 text-sm text-slate-600">{serviceDisplay.locationLine}</p> : null}
            {getCustomerOrderingPhone(location) ? <p className="mt-1 text-sm text-slate-600">Order by phone: {getCustomerOrderingPhone(location)}</p> : null}
            <p className="mt-1 text-sm text-slate-600">{serviceDisplay.dateTime}</p>
          </div>
          <ServiceStatusBadge acceptPublicOrders={service.acceptPublicOrders} status={service.status} />
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4">
          {!service.acceptPublicOrders ? (
            <Card className="rounded-[28px] border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 sm:px-6">
              {service.publicOrderClosureReason ?? 'This service is not currently accepting online orders.'}
            </Card>
          ) : null}

          <Card className="rounded-[28px] border-white/70 bg-white/90 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Menu</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Build your order</h2>
              </div>
              <Link to={`/order/location/${service.locationId}`}>
                <Button variant="outline">Change service</Button>
              </Link>
            </div>
            <div className="mt-5 grid gap-5">
              <CategoryJumpNav categorySlugs={categorySections.map((section) => section.slug)} />
              {categorySections.map((section) => (
                <section key={section.slug} id={`menu-category-${section.slug}`} className="scroll-mt-24">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-2xl font-bold">{getMenuCategoryLabel(section.slug, section.slug)}</h3>
                    <Badge variant="slate">{section.items.length}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {section.items.map((menuItem) => {
                      const itemAvailability = availability.find((entry) => entry.menuItemId === menuItem.id)
                      return (
                        <button
                          key={menuItem.id}
                          className={cn(
                            'flex h-full flex-col rounded-[24px] border p-3 text-left transition sm:p-4',
                            itemAvailability?.available
                              ? 'border-slate-200 bg-slate-50 hover:bg-white'
                              : 'border-rose-200 bg-rose-50 text-slate-400',
                          )}
                          onClick={() => openNewPizza(menuItem.id)}
                          disabled={!itemAvailability?.available || !service.acceptPublicOrders}
                        >
                          <MenuItemMedia imageUrl={menuItem.imageUrl} name={menuItem.name} />
                          <div className="mt-4 flex min-h-[5rem] items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-display text-2xl font-semibold">{menuItem.name}</h4>
                                <ChilliRating rating={menuItem.chilliRating ?? 0} />
                              </div>
                              <p className="mt-1 text-sm text-slate-600">{menuItem.description}</p>
                            </div>
                            <span className="shrink-0 text-xl font-bold">{currency(menuItem.price)}</span>
                          </div>
                          <div className="mt-auto pt-4">
                            <p className={cn('text-sm font-semibold', itemAvailability?.available ? 'text-orange-700' : 'text-rose-700')}>
                              {itemAvailability?.available ? 'Customize and add' : 'Sold out'}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </Card>
        </div>

        <Card className="rounded-[28px] border-white/70 bg-white/90 p-4 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Your order</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Basket</h2>
          {draft.paymentState === 'pending_payment' ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              A payment attempt is already in progress. You can still edit this basket and retry checkout if needed.
            </div>
          ) : null}
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
                      <Button size="sm" variant="outline" onClick={() => patchDraft({
                        ...getDraftResetPatch(),
                        basket: draft.basket.filter((entry) => entry.id !== item.id),
                      })}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Choose an item to start your order.
              </p>
            )}
          </div>
          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Total</p>
              <p className="text-3xl font-bold">{currency(basketTotal)}</p>
            </div>
            <div className="mt-3 grid gap-1 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{currency(pricingSummary.subtotalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span>-{currency(pricingSummary.totalDiscountAmount)}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button className="bg-orange-500 text-white hover:bg-orange-400" disabled={!draft.basket.length || !service.acceptPublicOrders} onClick={() => navigate('/order/checkout')}>
                Continue to checkout
              </Button>
              <Button variant="outline" disabled={!draft.basket.length && draft.paymentState !== 'pending_payment'} onClick={clearBasket}>
                Clear basket
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <VoucherCodeCard
              discountCodeInput={discountCodeInput}
              setDiscountCodeInput={setDiscountCodeInput}
              discountMessage={discountMessage}
              applyDiscountCode={applyDiscountCode}
              removeDiscountCode={removeDiscountCode}
              isApplyingDiscount={isApplyingDiscount}
              appliedOrderDiscount={draft.appliedOrderDiscount}
              pricingSummary={pricingSummary}
            />
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
  const navigate = useNavigate()
  const remoteReady = usePizzaOpsStore((state) => state.remoteReady)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const discountCodes = usePizzaOpsStore((state) => state.discountCodes)
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const createOrder = usePizzaOpsStore((state) => state.createOrder)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)
  const getAvailableTimes = usePizzaOpsStore((state) => state.getAvailableTimes)
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const { draft, patchDraft } = usePublicDraft()
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const {
    discountCodeInput,
    setDiscountCodeInput,
    discountMessage,
    setDiscountMessage,
    isApplyingDiscount,
    applyDiscountCode,
    removeDiscountCode,
    pricingSummary,
    validateCustomerDiscountCode,
  } = useCustomerVoucher(draft, patchDraft, discountCodes, menuItems)

  useEffect(() => {
    if (draft.serviceId && service.id !== draft.serviceId) {
      loadServiceForEditing(draft.serviceId)
    }
  }, [draft.serviceId, loadServiceForEditing, service.id])

  const location = locations.find((entry) => entry.id === service.locationId)
  const availableSlots = useMemo(() => getAvailableTimes(draft.basket), [draft.basket, getAvailableTimes])
  const formatCustomerSlotLabel = (promisedTime: string) =>
    `between ${formatTime(addMinutes(promisedTime, -service.slotSizeMinutes))} and ${formatTime(promisedTime)}`
  const total = pricingSummary.finalTotalAmount

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

  if (!remoteReady || service.id !== draft.serviceId) {
    return <CustomerShell eyebrow="Checkout" title="Loading service"><Card className="rounded-[28px] border-white/70 bg-white/90 p-5 sm:p-6">Refreshing live slots and stock...</Card></CustomerShell>
  }

  function clearBasket() {
    if (!confirmClearBasket()) {
      return
    }

    patchDraft(buildEmptyDraftForService(draft.serviceId))
    navigate(`/order/service/${draft.serviceId}`)
  }

  async function handlePay() {
    if (!draft.customerName.trim()) {
      setMessage('Please enter your name.')
      return
    }

    if (!draft.email.trim()) {
      setMessage('Please enter your email for your receipt.')
      return
    }

    if (!isValidEmail(draft.email)) {
      setMessage('Please enter a valid email address.')
      return
    }

    if (!draft.selectedTime) {
      setMessage('Please choose a collection time.')
      return
    }

    setIsSubmitting(true)
    setMessage(null)

    let appliedOrderDiscount = draft.appliedOrderDiscount
    let latestPricingSummary = pricingSummary

    if (draft.discountCode) {
      const validation = await validateCustomerDiscountCode(draft.discountCode)

      if (!validation.ok) {
        patchDraft({
          ...getDraftResetPatch(),
          appliedOrderDiscount: null,
          pricingSummary: getOrderPricingSummary(draft.basket, menuItems, 0),
        })
        setDiscountMessage(validation.error)
        setMessage(validation.error)
        setIsSubmitting(false)
        return
      }

      appliedOrderDiscount = validation.appliedOrderDiscount
      latestPricingSummary = validation.pricingSummary
      patchDraft({
        appliedOrderDiscount,
        pricingSummary: latestPricingSummary,
      })
    }

    const result = await createOrder({
      customerName: draft.customerName,
      mobile: draft.mobile,
      email: draft.email,
      source: 'web',
      promisedTime: draft.selectedTime,
      items: draft.basket,
      paymentMethod: 'sumup_online',
      notes: draft.notes,
      appliedOrderDiscount,
    })

    if (!result.ok || !result.paymentId) {
      setMessage(result.ok ? 'Unable to create a payment session.' : result.error)
      setIsSubmitting(false)
      return
    }

    try {
      const checkout = await createHostedSumUpCheckout({
        orderId: result.orderId,
        amount: latestPricingSummary.finalTotalAmount,
        description: `${service.name} order for ${draft.customerName}`,
      })

      await updatePaymentCheckout(result.paymentId, {
        providerReference: checkout.checkoutId,
        checkoutUrl: checkout.hostedCheckoutUrl,
        status: 'pending',
      })

      patchDraft({
        paymentState: 'pending_payment',
        pendingOrderId: result.orderId,
        pendingPaymentId: result.paymentId,
        pendingCheckoutUrl: checkout.hostedCheckoutUrl,
        pricingSummary: latestPricingSummary,
      })
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
        <Card className="rounded-[28px] border-white/70 bg-white/90 p-4 sm:p-6">
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
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Total</p>
              <p className="text-3xl font-bold">{currency(total)}</p>
            </div>
            <div className="mt-3 grid gap-1 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{currency(pricingSummary.subtotalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span>-{currency(pricingSummary.totalDiscountAmount)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-white">
                <span>Final total</span>
                <span>{currency(pricingSummary.finalTotalAmount)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-[28px] border-white/70 bg-white/90 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Collection</p>
              <h2 className="mt-2 font-display text-3xl font-bold">{location?.name ?? service.locationName}</h2>
            </div>
            <Link to={`/order/service/${draft.serviceId}`}>
              <Button variant="outline">Back to menu</Button>
            </Link>
          </div>
          {getCustomerLocationAddress(location) ? <p className="mt-3 text-sm text-slate-600">{getCustomerLocationAddress(location)}</p> : null}
          {getCustomerOrderingPhone(location) ? <p className="mt-2 text-sm text-slate-600">Order by phone: {getCustomerOrderingPhone(location)}</p> : null}
          <div className="mt-5 grid gap-3">
            <Input placeholder="Your name" value={draft.customerName} onChange={(event) => patchDraft({ customerName: event.target.value })} />
            <Input placeholder="Mobile number (optional)" value={draft.mobile} onChange={(event) => patchDraft({ mobile: event.target.value })} />
            <Input placeholder="Email for your receipt" type="email" value={draft.email} onChange={(event) => patchDraft({ email: event.target.value })} />
            <Textarea placeholder="Notes for the team" value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} />
          </div>
          <div className="mt-5">
            <VoucherCodeCard
              discountCodeInput={discountCodeInput}
              setDiscountCodeInput={setDiscountCodeInput}
              discountMessage={discountMessage}
              applyDiscountCode={applyDiscountCode}
              removeDiscountCode={removeDiscountCode}
              isApplyingDiscount={isApplyingDiscount}
              appliedOrderDiscount={draft.appliedOrderDiscount}
              pricingSummary={pricingSummary}
            />
          </div>
          {draft.paymentState === 'pending_payment' ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You can go back, edit this order, and retry payment. This basket stays saved until payment completes.
            </div>
          ) : null}
          <div className="mt-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Collection time</p>
            <div className="mt-3 max-h-80 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
              {availableSlots.map((slot) => (
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
                  <p className="font-semibold">{formatCustomerSlotLabel(slot.promisedTime)}</p>
                  <p className="text-xs text-slate-500">Collection window</p>
                </button>
              ))}
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button className="bg-orange-500 text-white hover:bg-orange-400" size="lg" disabled={isSubmitting || !service.acceptPublicOrders} onClick={() => void handlePay()}>
              {isSubmitting ? 'Starting secure checkout...' : 'Pay securely'}
            </Button>
            <Button variant="outline" size="lg" disabled={!draft.basket.length && draft.paymentState !== 'pending_payment'} onClick={clearBasket}>
              Clear basket
            </Button>
          </div>
          {message ? <p className="mt-3 text-sm text-rose-600">{message}</p> : null}
        </Card>
      </div>
    </CustomerShell>
  )
}

export function CustomerOrderConfirmationPage() {
  const domainContext = getDomainContext()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orders = usePizzaOpsStore((state) => state.orders)
  const payments = usePizzaOpsStore((state) => state.payments)
  const updatePaymentStatus = usePizzaOpsStore((state) => state.updatePaymentStatus)
  const { patchDraft, resetDraft } = usePublicDraft()

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

    if (requestedStatus === 'paid') {
      resetDraft()
      return
    }

    if (requestedStatus === 'failed') {
      patchDraft({
        paymentState: 'cancelled',
      })
    }
  }, [patchDraft, payment, resetDraft, searchParams, updatePaymentStatus])

  if (!order || !payment) {
    return <Navigate to="/order" replace />
  }

  const paymentStatus =
    getPaymentStatusFromQuery(searchParams.get('status')) ??
    getPaymentStatusFromQuery(searchParams.get('result')) ??
    payment.status

  function clearBasketAndRestart() {
    if (!confirmClearBasket()) {
      return
    }

    patchDraft(buildEmptyDraftForService(null))
    navigate('/order', { replace: true })
  }

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
          {paymentStatus !== 'paid' ? (
            <Button variant="outline" onClick={() => navigate('/order/checkout')}>
              Return to basket
            </Button>
          ) : null}
          {paymentStatus !== 'paid' ? (
            <Button variant="secondary" onClick={clearBasketAndRestart}>
              Start again
            </Button>
          ) : null}
          <Link to="/order">
            <Button variant="secondary">Start another order</Button>
          </Link>
          {domainContext.appMode !== 'customer' ? (
            <Link to="/board">
              <Button>View live order board</Button>
            </Link>
          ) : null}
        </div>
      </Card>
    </CustomerShell>
  )
}
