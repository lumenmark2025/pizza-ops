import type {
  AppliedDiscountSummary,
  DiscountCode,
  DiscountType,
  MenuItem,
  Order,
  OrderItem,
  PricingSummary,
} from '../types/domain.js'

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

export function normalizeDiscountCodeInput(code: string) {
  return code.trim().toUpperCase()
}

export function calculateDiscountAmount(
  discountType: DiscountType,
  discountValue: number,
  targetAmount: number,
) {
  const safeTarget = Math.max(0, roundCurrency(targetAmount))
  const safeValue = Math.max(0, discountValue)

  if (safeTarget <= 0 || safeValue <= 0) {
    return 0
  }

  if (discountType === 'percentage') {
    return Math.min(safeTarget, roundCurrency((safeTarget * safeValue) / 100))
  }

  return Math.min(safeTarget, roundCurrency(safeValue))
}

export function getOrderItemOriginalUnitPrice(item: OrderItem, menuItems: MenuItem[]) {
  if (typeof item.originalUnitPrice === 'number') {
    return item.originalUnitPrice
  }

  const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
  const modifierTotal = (item.modifiers ?? []).reduce(
    (sum, modifier) => sum + modifier.priceDelta * modifier.quantity,
    0,
  )
  return roundCurrency((menuItem?.price ?? 0) + modifierTotal)
}

export function getOrderItemOriginalLineTotal(item: OrderItem, menuItems: MenuItem[]) {
  return roundCurrency(getOrderItemOriginalUnitPrice(item, menuItems) * item.quantity)
}

export function getOrderItemDiscountAmount(item: OrderItem) {
  return roundCurrency(item.itemDiscountAmount ?? item.appliedDiscountSummary?.appliedAmount ?? 0)
}

export function getOrderItemFinalLineTotal(item: OrderItem, menuItems: MenuItem[]) {
  return roundCurrency(
    Math.max(0, getOrderItemOriginalLineTotal(item, menuItems) - getOrderItemDiscountAmount(item)),
  )
}

export function getOrderPricingSummary(items: OrderItem[], menuItems: MenuItem[], orderDiscountAmount = 0): PricingSummary {
  const subtotalAmount = roundCurrency(
    items.reduce((sum, item) => sum + getOrderItemOriginalLineTotal(item, menuItems), 0),
  )
  const itemDiscountAmount = roundCurrency(
    items.reduce((sum, item) => sum + getOrderItemDiscountAmount(item), 0),
  )
  const safeOrderDiscountAmount = Math.min(
    Math.max(0, roundCurrency(orderDiscountAmount)),
    Math.max(0, roundCurrency(subtotalAmount - itemDiscountAmount)),
  )
  const totalDiscountAmount = roundCurrency(itemDiscountAmount + safeOrderDiscountAmount)
  const finalTotalAmount = roundCurrency(Math.max(0, subtotalAmount - totalDiscountAmount))

  return {
    subtotalAmount,
    itemDiscountAmount,
    orderDiscountAmount: safeOrderDiscountAmount,
    totalDiscountAmount,
    finalTotalAmount,
  }
}

export function buildManualDiscountSummary(input: {
  scope: 'order' | 'item'
  discountType: DiscountType
  discountValue: number
  appliedAmount: number
  source: 'manual_quick_button' | 'manual_custom'
  appliedBy?: string
  appliedAt: string
}): AppliedDiscountSummary {
  const suffix = input.discountType === 'percentage' ? `${input.discountValue}% off` : `£${input.discountValue.toFixed(2)} off`
  return {
    source: input.source,
    scope: input.scope,
    discountType: input.discountType,
    discountValue: input.discountValue,
    appliedAmount: roundCurrency(input.appliedAmount),
    description: `Manual discount applied: ${suffix}`,
    appliedBy: input.appliedBy,
    appliedAt: input.appliedAt,
  }
}

export function buildCodeDiscountSummary(input: {
  scope: 'order' | 'item'
  discountType: DiscountType
  discountValue: number
  appliedAmount: number
  code: string
  discountCodeId: string
  appliedBy?: string
  appliedAt: string
}): AppliedDiscountSummary {
  return {
    source: 'code',
    scope: input.scope,
    discountType: input.discountType,
    discountValue: input.discountValue,
    appliedAmount: roundCurrency(input.appliedAmount),
    code: input.code,
    discountCodeId: input.discountCodeId,
    description: `Code ${input.code} applied`,
    appliedBy: input.appliedBy,
    appliedAt: input.appliedAt,
  }
}

export function validateDiscountCode(input: {
  discountCode: DiscountCode | undefined
  nowIso: string
  items: OrderItem[]
  menuItems: MenuItem[]
  scope: 'order'
}) {
  const { discountCode, nowIso, items, menuItems } = input

  if (!discountCode) {
    return { ok: false as const, error: 'Discount code not found.' }
  }

  if (!discountCode.isActive) {
    return { ok: false as const, error: 'This code is inactive.' }
  }

  if (discountCode.scope === 'item') {
    return { ok: false as const, error: 'This code can only be applied to an item in admin.' }
  }

  if (discountCode.validFrom && nowIso < discountCode.validFrom) {
    return { ok: false as const, error: 'This code is not valid yet.' }
  }

  if (discountCode.validUntil && nowIso > discountCode.validUntil) {
    return { ok: false as const, error: 'This code has expired.' }
  }

  if (discountCode.usageMode === 'single_use' && discountCode.usedCount >= 1) {
    return { ok: false as const, error: 'This code has already been used.' }
  }

  if (
    discountCode.usageMode === 'limited_use' &&
    discountCode.maxUses &&
    discountCode.usedCount >= discountCode.maxUses
  ) {
    return { ok: false as const, error: 'This code has reached its usage limit.' }
  }

  const subtotal = items.reduce((sum, item) => sum + getOrderItemOriginalLineTotal(item, menuItems), 0)
  if (discountCode.minimumOrderValue && subtotal < discountCode.minimumOrderValue) {
    return { ok: false as const, error: `Minimum order value is £${discountCode.minimumOrderValue.toFixed(2)}.` }
  }

  if (discountCode.appliesToMenuItemId) {
    const matchesItem = items.some((item) => item.menuItemId === discountCode.appliesToMenuItemId)
    if (!matchesItem) {
      return { ok: false as const, error: 'This code does not apply to the current basket.' }
    }
  }

  if (discountCode.appliesToCategorySlug) {
    const matchesCategory = items.some((item) => {
      const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
      return menuItem?.categorySlug === discountCode.appliesToCategorySlug
    })
    if (!matchesCategory) {
      return { ok: false as const, error: 'This code does not apply to the current basket.' }
    }
  }

  return { ok: true as const }
}

export function applyItemDiscount(
  item: OrderItem,
  menuItems: MenuItem[],
  summary: AppliedDiscountSummary | null,
) {
  if (!summary) {
    const originalUnitPrice = getOrderItemOriginalUnitPrice(item, menuItems)
    return {
      ...item,
      originalUnitPrice,
      itemDiscountAmount: 0,
      finalUnitPrice: originalUnitPrice,
      appliedDiscountSummary: null,
    }
  }

  const originalUnitPrice = getOrderItemOriginalUnitPrice(item, menuItems)
  const originalLineTotal = roundCurrency(originalUnitPrice * item.quantity)
  const itemDiscountAmount = calculateDiscountAmount(summary.discountType, summary.discountValue, originalLineTotal)
  const finalUnitPrice = item.quantity > 0
    ? roundCurrency((originalLineTotal - itemDiscountAmount) / item.quantity)
    : originalUnitPrice

  return {
    ...item,
    originalUnitPrice,
    itemDiscountAmount,
    finalUnitPrice,
    appliedDiscountSummary: {
      ...summary,
      appliedAmount: itemDiscountAmount,
    },
  }
}

export function getDiscountCodeUsesRemaining(discountCode: DiscountCode) {
  if (discountCode.usageMode === 'unlimited') {
    return 'Unlimited'
  }

  const limit = discountCode.usageMode === 'single_use' ? 1 : discountCode.maxUses ?? 0
  return `${Math.max(limit - discountCode.usedCount, 0)} left`
}

export function getOrderDiscountDisplay(order: Pick<Order, 'appliedDiscountSummary' | 'totalDiscountAmount'>) {
  if (!order.appliedDiscountSummary || !order.totalDiscountAmount) {
    return null
  }

  const label = order.appliedDiscountSummary.source === 'code'
    ? `${order.appliedDiscountSummary.code} applied`
    : order.appliedDiscountSummary.description

  return `${label}: £${order.totalDiscountAmount.toFixed(2)} off`
}
