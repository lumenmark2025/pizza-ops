import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  buildCodeDiscountSummary,
  calculateDiscountAmount,
  normalizeDiscountCodeInput,
  getOrderPricingSummary,
  validateDiscountCode,
} from '../src/lib/discounts.js'
import type { DiscountCode, MenuItem, OrderItem } from '../src/types/domain.js'

type DiscountCodeRow = {
  id: string
  code: string
  is_active: boolean
  discount_type: 'percentage' | 'fixed_amount'
  discount_value: number
  scope: 'order' | 'item' | 'both'
  usage_mode: 'single_use' | 'limited_use' | 'unlimited'
  max_uses: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
  minimum_order_value: number | null
  applies_to_menu_item_id: string | null
  applies_to_category_slug: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

type MenuItemRow = {
  id: string
  name: string
  category: string
  category_slug: MenuItem['categorySlug']
  price: number
  description: string
  active: boolean | null
}

function mapDiscountCode(row: DiscountCodeRow): DiscountCode {
  return {
    id: row.id,
    code: row.code,
    isActive: row.is_active,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value ?? 0),
    scope: row.scope,
    usageMode: row.usage_mode,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    minimumOrderValue: row.minimum_order_value == null ? null : Number(row.minimum_order_value),
    appliesToMenuItemId: row.applies_to_menu_item_id,
    appliesToCategorySlug: row.applies_to_category_slug,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categorySlug: row.category_slug ?? null,
    price: Number(row.price ?? 0),
    description: row.description ?? '',
    loyverseItemId: '',
    active: row.active ?? true,
  }
}

function getSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return res.status(500).json({ error: 'Missing Supabase server environment variables' })
  }

  try {
    const { code, items } = req.body ?? {}
    const normalizedCode = typeof code === 'string' ? normalizeDiscountCodeInput(code) : ''
    const orderItems = Array.isArray(items) ? (items as OrderItem[]) : []

    if (!normalizedCode) {
      return res.status(400).json({ error: 'Enter a discount code.' })
    }

    if (!orderItems.length) {
      return res.status(400).json({ error: 'Add items before applying a code.' })
    }

    const menuItemIds = Array.from(
      new Set(
        orderItems
          .map((item) => item?.menuItemId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )

    if (!menuItemIds.length) {
      return res.status(400).json({ error: 'This basket could not be validated.' })
    }

    const [{ data: discountRows, error: discountError }, { data: menuRows, error: menuError }] =
      await Promise.all([
        supabase
          .from('discount_codes')
          .select(
            'id, code, is_active, discount_type, discount_value, scope, usage_mode, max_uses, used_count, valid_from, valid_until, minimum_order_value, applies_to_menu_item_id, applies_to_category_slug, notes, created_at, updated_at',
          )
          .ilike('code', normalizedCode)
          .limit(5),
        supabase
          .from('menu_items')
          .select('id, name, category, category_slug, price, description, active')
          .in('id', menuItemIds),
      ])

    if (discountError || menuError) {
      console.error('validate-discount-code query error', { discountError, menuError })
      return res.status(500).json({ error: 'Unable to validate this code right now.' })
    }

    const discountCode = (discountRows ?? [])
      .map((row) => mapDiscountCode(row as DiscountCodeRow))
      .find((row) => normalizeDiscountCodeInput(row.code) === normalizedCode)

    const menuItems = (menuRows ?? []).map((row) => mapMenuItem(row as MenuItemRow))

    if (menuItems.length !== menuItemIds.length) {
      return res.status(400).json({ error: 'Some basket items are no longer available.' })
    }

    const nowIso = new Date().toISOString()
    const validation = validateDiscountCode({
      discountCode,
      nowIso,
      items: orderItems,
      menuItems,
      scope: 'order',
    })

    if (!validation.ok || !discountCode) {
      return res.status(400).json({ error: validation.ok ? 'Discount code not found.' : validation.error })
    }

    const pricingBeforeDiscount = getOrderPricingSummary(orderItems, menuItems, 0)
    const appliedAmount = calculateDiscountAmount(
      discountCode.discountType,
      discountCode.discountValue,
      pricingBeforeDiscount.subtotalAmount - pricingBeforeDiscount.itemDiscountAmount,
    )
    const appliedOrderDiscount = buildCodeDiscountSummary({
      scope: 'order',
      discountType: discountCode.discountType,
      discountValue: discountCode.discountValue,
      appliedAmount,
      code: discountCode.code,
      discountCodeId: discountCode.id,
      appliedBy: 'customer',
      appliedAt: nowIso,
    })
    const pricingSummary = getOrderPricingSummary(orderItems, menuItems, appliedAmount)

    return res.status(200).json({
      ok: true,
      appliedOrderDiscount,
      pricingSummary,
      message: `${discountCode.code} applied.`,
    })
  } catch (error) {
    console.error('validate-discount-code error', error)
    return res.status(500).json({ error: 'Unexpected server error' })
  }
}
