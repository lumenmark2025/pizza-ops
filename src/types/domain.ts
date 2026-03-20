export type OrderStatus = 'taken' | 'prepping' | 'in_oven' | 'ready' | 'completed'
export type OrderSource =
  | 'walkup'
  | 'web'
  | 'phone'
  | 'whatsapp'
  | 'messenger'
  | 'manual'
export type PaymentMethod =
  | 'sumup_online'
  | 'cash'
  | 'terminal'
  | 'manual'
  | 'tap_to_pay'
  | 'preorder'
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'refunded'
export type SyncStatus = 'pending' | 'processing' | 'synced' | 'failed'
export type DiscountType = 'percentage' | 'fixed_amount'
export type DiscountScope = 'order' | 'item' | 'both'
export type DiscountUsageMode = 'single_use' | 'limited_use' | 'unlimited'
export type DiscountSource = 'code' | 'manual_quick_button' | 'manual_custom'

export type ServiceConfig = {
  id: string
  name: string
  locationName: string
  locationId: string
  date: string
  status: 'draft' | 'live' | 'paused' | 'cancelled'
  acceptPublicOrders: boolean
  publicOrderClosureReason: string | null
  startTime: string
  endTime: string
  lastCollectionTime: string
  slotSizeMinutes: number
  pizzasPerSlot: number
  delayMinutes: number
  pausedUntil: string | null
  pauseReason: string | null
}

export type Location = {
  id: string
  name: string
  addressLine1: string
  addressLine2?: string
  townCity: string
  postcode: string
  notes?: string
  active: boolean
}

export type Ingredient = {
  id: string
  name: string
  unit: string
  lowStockThreshold: number
  defaultStockAmount?: number
  active?: boolean
}

export type MenuItem = {
  id: string
  name: string
  category: string
  categorySlug?: 'pizza' | 'garlic-pizza' | 'house-specials' | 'dips' | 'drinks' | null
  sortOrder?: number
  chilliRating?: number
  imageUrl?: string | null
  price: number
  loyverseItemId: string
  description: string
  active?: boolean
}

export type MenuItemRecipe = {
  id: string
  menuItemId: string
  ingredientId: string
  quantity: number
  affectsAvailability?: boolean
}

export type ServiceInventory = {
  ingredientId: string
  quantity: number
}

export type Modifier = {
  id: string
  name: string
  priceDelta: number
  stockIngredientId?: string | null
  stockQuantity?: number
  maxPerPizza?: number
  menuItemIds: string[]
  appliesToAllPizzas?: boolean
}

export type BrandingSettings = {
  logoUrl: string
  introText: string
  orderCtaLabel: string
  primaryColor: string
  secondaryColor: string
  accentTextColor: string
}

export type OrderItemModifier = {
  modifierId: string
  name: string
  priceDelta: number
  quantity: number
}

export type AppliedDiscountSummary = {
  source: DiscountSource
  scope: 'order' | 'item'
  discountType: DiscountType
  discountValue: number
  appliedAmount: number
  description: string
  code?: string
  discountCodeId?: string
  appliedBy?: string
  appliedAt: string
}

export type PricingSummary = {
  subtotalAmount: number
  itemDiscountAmount: number
  orderDiscountAmount: number
  totalDiscountAmount: number
  finalTotalAmount: number
}

export type DiscountCode = {
  id: string
  code: string
  isActive: boolean
  discountType: DiscountType
  discountValue: number
  scope: DiscountScope
  usageMode: DiscountUsageMode
  maxUses?: number | null
  usedCount: number
  validFrom?: string | null
  validUntil?: string | null
  minimumOrderValue?: number | null
  appliesToMenuItemId?: string | null
  appliesToCategorySlug?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export type DiscountCodeRedemption = {
  id: string
  discountCodeId: string
  orderId: string
  orderItemId?: string | null
  redeemedAt: string
  redeemedBy?: string | null
  codeSnapshot: string
  discountTypeSnapshot: DiscountType
  discountValueSnapshot: number
  appliedDiscountAmount: number
}

export type Customer = {
  id: string
  name: string
  mobile?: string
  email?: string
  authUserId?: string | null
}

export type OrderItem = {
  id: string
  menuItemId: string
  quantity: number
  notes?: string
  modifiers?: OrderItemModifier[]
  progressCount?: number
  originalUnitPrice?: number
  itemDiscountAmount?: number
  finalUnitPrice?: number
  appliedDiscountSummary?: AppliedDiscountSummary | null
}

export type SlotAllocation = {
  slotTime: string
  pizzas: number
}

export type OrderStatusTimestamps = {
  taken_at: string
  prepping_at: string | null
  in_oven_at: string | null
  ready_at: string | null
  completed_at: string | null
}

export type Order = {
  id: string
  reference: string
  customerId: string
  customerName?: string
  customerMobile?: string
  customerEmail?: string
  authUserId?: string | null
  source: OrderSource
  status: OrderStatus
  promisedTime: string
  slotAllocations: SlotAllocation[]
  notes?: string
  pizzaCount: number
  subtotalAmount?: number
  totalDiscountAmount?: number
  orderDiscountAmount?: number
  totalAmount: number
  appliedDiscountCodeId?: string | null
  appliedDiscountSummary?: AppliedDiscountSummary | null
  pricingSummary?: PricingSummary
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  receiptEmailStatus?: 'not_requested' | 'pending' | 'sending' | 'sent' | 'failed'
  receiptSentAt?: string | null
  receiptLastError?: string | null
  loyaltySyncStatus: SyncStatus
  createdAt: string
  pagerNumber?: number | null
  timestamps: OrderStatusTimestamps
  items: OrderItem[]
}

export type OrderStatusHistory = {
  id: string
  orderId: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  changedAt: string
  changedBy: string
  note?: string
}

export type PaymentRecord = {
  id: string
  orderId: string
  provider: 'sumup' | 'manual'
  method: PaymentMethod
  status: PaymentStatus
  amount: number
  providerReference: string
  checkoutUrl?: string
  createdAt: string
  updatedAt: string
}

export type LoyverseSyncQueueItem = {
  id: string
  orderId: string
  status: SyncStatus
  attempts: number
  lastAttemptAt: string | null
  nextRetryAt: string | null
  lastError: string | null
  receiptId: string | null
  payload: Record<string, unknown>
}

export type ActivityLogEntry = {
  id: string
  type:
    | 'order_created'
    | 'status_changed'
    | 'order_moved'
    | 'service_paused'
    | 'delay_added'
    | 'payment_updated'
    | 'loyverse_retry'
    | 'inventory_adjusted'
    | 'modifier_updated'
    | 'service_updated'
    | 'pager_assigned'
    | 'item_progressed'
    | 'discount_applied'
    | 'realtime_synced'
  createdAt: string
  actor: string
  orderId?: string
  message: string
}

export type SlotAvailability = {
  promisedTime: string
  remainingCapacity: number
  warning?: string
  allocations: SlotAllocation[]
}

export type ServiceSnapshot = {
  service: ServiceConfig
  services: ServiceConfig[]
  locations: Location[]
  serviceLocations: string[]
  branding: BrandingSettings
  ingredients: Ingredient[]
  menuItems: MenuItem[]
  recipes: MenuItemRecipe[]
  inventory: ServiceInventory[]
  inventoryDefaults: ServiceInventory[]
  modifiers: Modifier[]
  discountCodes: DiscountCode[]
  discountCodeRedemptions: DiscountCodeRedemption[]
  customers: Customer[]
  orders: Order[]
  history: OrderStatusHistory[]
  payments: PaymentRecord[]
  loyverseQueue: LoyverseSyncQueueItem[]
  activityLog: ActivityLogEntry[]
}
