import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedSnapshot } from '../data/seed'
import { buildLoyversePayload } from '../integrations/loyverse'
import {
  buildCodeDiscountSummary,
  calculateDiscountAmount,
  getOrderPricingSummary,
  normalizeDiscountCodeInput,
  validateDiscountCode,
} from '../lib/discounts'
import {
  deleteModifierFromSupabase,
  loadMasterDataFromSupabase,
  persistIngredientToSupabase,
  persistMenuItemRecipesToSupabase,
  persistMenuItemToSupabase,
  persistModifierToSupabase,
} from '../lib/master-data-sync'
import { normalizeMenuItem } from '../lib/menu'
import { SAFE_MODE } from '../lib/runtime-flags'
import {
  persistLocationToSupabase,
  resolveLocationReference,
  loadLocationsFromSupabase,
  loadOrdersForService,
  loadServiceInventoryFromSupabase,
  loadServicesFromSupabase,
  persistServiceInventoryQuantity,
  persistServiceToSupabase,
  seedServiceInventoryFromDefaults,
} from '../lib/service-data'
import { allocateAcrossSlots, getAvailableSlots } from '../lib/slot-engine'
import {
  canUseRealtimeSync,
  loadRemoteSnapshot,
  persistRemoteSnapshot,
  subscribeToRemoteSnapshot,
} from '../lib/realtime-state'
import { supabase } from '../lib/supabase'
import { addMinutes, combineDateAndTime, formatTime, toIsoNow } from '../lib/time'
import { normalizeEmail } from '../lib/utils'
import type {
  ActivityLogEntry,
  AppliedDiscountSummary,
  BrandingSettings,
  Customer,
  DiscountCode,
  DiscountCodeRedemption,
  Ingredient,
  Location,
  MenuItem,
  MenuItemRecipe,
  Modifier,
  LoyverseSyncQueueItem,
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  ServiceConfig,
  ServiceSnapshot,
} from '../types/domain'

type CreateOrderInput = {
  customerName: string
  mobile?: string
  email?: string
  authUserId?: string | null
  source: OrderSource
  promisedTime: string
  items: OrderItem[]
  paymentMethod: PaymentMethod
  notes?: string
  pagerNumber?: number | null
  appliedOrderDiscount?: AppliedDiscountSummary | null
}

type StoreState = ServiceSnapshot & {
  isOnline: boolean
  remoteReady: boolean
  realtimeStatus: 'idle' | 'connecting' | 'subscribed' | 'error'
  lastRemoteSyncAt: string | null
  masterDataLoadError: string | null
  masterDataLoadWarnings: string[]
  createOrder: (input: CreateOrderInput) => { ok: true; orderId: string; paymentId?: string } | { ok: false; error: string }
  setOnlineStatus: (status: boolean) => void
  updateOrderStatus: (orderId: string, nextStatus: OrderStatus) => void
  updateOrderItemProgress: (orderId: string, itemId: string, direction?: 'forward' | 'backward') => void
  recallCompletedOrder: (orderId?: string) => { ok: boolean; error?: string }
  moveOrder: (orderId: string, promisedTime: string, reason: string, override: boolean) => { ok: boolean; warning?: string }
  addDelay: (minutes: number, actor: string, reason: string) => void
  pauseService: (minutes: number, actor: string, reason: string) => void
  updatePaymentStatus: (paymentId: string, status: PaymentStatus) => void
  updatePaymentCheckout: (paymentId: string, updates: { providerReference?: string; checkoutUrl?: string; status?: PaymentStatus }) => void
  retryLoyverseSync: (queueId: string) => void
  getAvailableTimes: (items: OrderItem[]) => ReturnType<typeof getAvailableSlots>
  resetDemo: () => void
  updateService: (updates: Partial<ServiceConfig>, actor: string) => Promise<void>
  updateServiceLocations: (locations: string[], actor: string) => void
  updateBranding: (branding: BrandingSettings, actor: string) => void
  upsertLocation: (location: Location, actor: string) => Promise<Location>
  createFreshService: (input: Partial<ServiceConfig>, actor: string, options?: { applyInventoryDefaults?: boolean }) => Promise<string>
  loadServiceForEditing: (serviceId: string) => boolean
  duplicateService: (serviceId: string, actor: string) => Promise<string | null>
  archiveService: (serviceId: string, actor: string) => Promise<void>
  upsertIngredient: (ingredient: Ingredient, defaultQuantity: number, actor: string) => Promise<void>
  setInventoryQuantity: (ingredientId: string, quantity: number, actor: string) => Promise<void>
  adjustInventoryQuantity: (ingredientId: string, delta: number, actor: string) => Promise<void>
  setInventoryDefaultQuantity: (ingredientId: string, quantity: number, actor: string) => Promise<void>
  applyInventoryDefaults: (actor: string) => Promise<void>
  upsertMenuItem: (
    menuItem: MenuItem,
    recipeRows: MenuItemRecipe[],
    actor: string,
  ) => Promise<void>
  upsertDiscountCode: (discountCode: DiscountCode, actor: string) => void
  upsertModifier: (modifier: Modifier, actor: string) => Promise<void>
  deleteModifier: (modifierId: string, actor: string) => Promise<void>
  assignPager: (orderId: string, pagerNumber: number | null, actor: string) => { ok: boolean; error?: string }
  getActivePagerNumbers: () => number[]
  hydrateRemote: () => Promise<void>
  startRealtime: () => (() => void) | null
}

const SNAPSHOT_KEYS = [
  'service',
  'services',
  'locations',
  'serviceLocations',
  'branding',
  'ingredients',
  'menuItems',
  'recipes',
  'inventory',
  'inventoryDefaults',
  'modifiers',
  'discountCodes',
  'discountCodeRedemptions',
  'customers',
  'orders',
  'history',
  'payments',
  'loyverseQueue',
  'activityLog',
] as const

const CANONICAL_MASTER_DATA_KEYS = ['ingredients', 'menuItems', 'recipes', 'modifiers'] as const
const RUNTIME_SYNC_KEYS = ['customers', 'orders', 'history', 'payments', 'loyverseQueue', 'activityLog'] as const

let applyingRemoteSnapshot = false
let stopRealtimeSubscription: null | (() => void) = null
let hydrateRemotePromise: Promise<void> | null = null
let hydrateRemoteServiceId: string | null = null
let activeRealtimeServiceId: string | null = null
let snapshotPersistTimer: ReturnType<typeof setTimeout> | null = null

const statusTimestampField: Record<OrderStatus, keyof Order['timestamps']> = {
  taken: 'taken_at',
  prepping: 'prepping_at',
  in_oven: 'in_oven_at',
  ready: 'ready_at',
  completed: 'completed_at',
}

const activeKdsStatuses: OrderStatus[] = ['taken', 'prepping', 'in_oven', 'ready']

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}-4${Math.random().toString(16).slice(2, 5)}-8${Math.random().toString(16).slice(2, 5)}-${Math.random().toString(16).slice(2, 14)}`
}

function createActivity(
  type: ActivityLogEntry['type'],
  actor: string,
  message: string,
  orderId?: string,
): ActivityLogEntry {
  return {
    id: randomId('log'),
    type,
    actor,
    message,
    orderId,
    createdAt: toIsoNow(),
  }
}

function getPersistableSnapshot(state: ServiceSnapshot) {
  const snapshot = {} as ServiceSnapshot

  for (const key of SNAPSHOT_KEYS) {
    ;(snapshot as Record<string, unknown>)[key] = state[key]
  }

  return snapshot
}

function normalizeSnapshot(snapshot: ServiceSnapshot): ServiceSnapshot {
  return {
    ...snapshot,
    menuItems: snapshot.menuItems.map(normalizeMenuItem),
  }
}

function getInitialState(): ServiceSnapshot {
  const snapshot = createDemoState()
  return {
    ...snapshot,
    ingredients: [],
    menuItems: [],
    recipes: [],
    modifiers: [],
  }
}

function getOperationalSnapshot(state: ServiceSnapshot): ServiceSnapshot {
  const snapshot = { ...state } as ServiceSnapshot

  for (const key of CANONICAL_MASTER_DATA_KEYS) {
    ;(snapshot as Record<string, unknown>)[key] = []
  }

  snapshot.service = state.service
  snapshot.services = []
  snapshot.locations = []
  snapshot.serviceLocations = []
  snapshot.inventory = []
  snapshot.inventoryDefaults = []
  snapshot.discountCodes = []
  snapshot.discountCodeRedemptions = []

  return snapshot
}

function getBlankOperationalState(snapshot: ServiceSnapshot, serviceId: string): ServiceSnapshot {
  const targetService = snapshot.services.find((entry) => entry.id === serviceId) ?? snapshot.service

  return normalizeSnapshot({
    ...snapshot,
    service: {
      ...targetService,
      delayMinutes: targetService.delayMinutes ?? 0,
      pausedUntil: targetService.pausedUntil ?? null,
      pauseReason: targetService.pauseReason ?? null,
    },
    inventory: [],
    customers: [],
    orders: [],
    history: [],
    payments: [],
    loyverseQueue: [],
    activityLog: [],
  })
}

function mergeOperationalSnapshot(current: ServiceSnapshot, runtimeSnapshot: ServiceSnapshot): ServiceSnapshot {
  const merged = { ...current } as ServiceSnapshot

  for (const key of RUNTIME_SYNC_KEYS) {
    ;(merged as Record<string, unknown>)[key] = runtimeSnapshot[key]
  }

  return normalizeSnapshot(merged)
}

function shiftOrder(order: Order, minutes: number) {
  return {
    ...order,
    promisedTime: addMinutes(order.promisedTime, minutes),
    slotAllocations: order.slotAllocations.map((allocation) => ({
      ...allocation,
      slotTime: addMinutes(allocation.slotTime, minutes),
    })),
  }
}

function getRecallTargetStatus(order: Order, history: ServiceSnapshot['history']) {
  const latestCompletion = history.find(
    (entry) => entry.orderId === order.id && entry.toStatus === 'completed',
  )

  if (latestCompletion?.fromStatus && activeKdsStatuses.includes(latestCompletion.fromStatus)) {
    return latestCompletion.fromStatus
  }

  if (order.timestamps.ready_at) {
    return 'ready'
  }

  if (order.timestamps.in_oven_at) {
    return 'in_oven'
  }

  if (order.timestamps.prepping_at) {
    return 'prepping'
  }

  return 'taken'
}

function createDemoState(): ServiceSnapshot {
  const baseSnapshot = normalizeSnapshot(seedSnapshot)
  const serviceStart = combineDateAndTime(baseSnapshot.service.date, baseSnapshot.service.startTime)
  const orders: Order[] = [
    {
      id: 'order_1',
      reference: 'PZ-101',
      customerId: 'cust_1',
      customerName: 'Mia',
      customerEmail: 'mia@example.com',
      authUserId: null,
      source: 'walkup',
      status: 'taken',
      promisedTime: addMinutes(serviceStart, 25),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 25), pizzas: 2 }],
      pagerNumber: 4,
      pizzaCount: 2,
      totalAmount: 24.5,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      receiptEmailStatus: 'sent',
      receiptSentAt: addMinutes(serviceStart, -4),
      receiptLastError: null,
      loyaltySyncStatus: 'pending',
      createdAt: addMinutes(serviceStart, -5),
      timestamps: {
        taken_at: addMinutes(serviceStart, -5),
        prepping_at: null,
        in_oven_at: null,
        ready_at: null,
        completed_at: null,
      },
      items: [
        {
          id: 'oi_1',
          menuItemId: 'margherita',
          quantity: 1,
          progressCount: 0,
          modifiers: [{ modifierId: 'mod_extra_cheese', name: 'Extra Cheese', priceDelta: 1.5, quantity: 1 }],
        },
        { id: 'oi_2', menuItemId: 'pepperoni', quantity: 1, progressCount: 0, modifiers: [] },
      ],
    },
    {
      id: 'order_2',
      reference: 'PZ-102',
      customerId: 'cust_2',
      customerName: 'Hassan',
      customerMobile: '07700900123',
      customerEmail: 'hassan@example.com',
      authUserId: null,
      source: 'web',
      status: 'prepping',
      promisedTime: addMinutes(serviceStart, 35),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 35), pizzas: 2 }],
      pagerNumber: null,
      pizzaCount: 2,
      totalAmount: 27,
      paymentStatus: 'authorized',
      paymentMethod: 'sumup_online',
      receiptEmailStatus: 'pending',
      receiptSentAt: null,
      receiptLastError: null,
      loyaltySyncStatus: 'synced',
      createdAt: addMinutes(serviceStart, -10),
      timestamps: {
        taken_at: addMinutes(serviceStart, -10),
        prepping_at: addMinutes(serviceStart, 5),
        in_oven_at: null,
        ready_at: null,
        completed_at: null,
      },
      items: [
        {
          id: 'oi_3',
          menuItemId: 'pepperoni',
          quantity: 2,
          progressCount: 1,
          modifiers: [
            { modifierId: 'mod_extra_pepperoni', name: 'Extra Pepperoni', priceDelta: 2, quantity: 1 },
          ],
        },
      ],
    },
    {
      id: 'order_3',
      reference: 'PZ-103',
      customerId: 'cust_3',
      customerName: 'The Park Family',
      customerEmail: 'parkfamily@example.com',
      authUserId: null,
      source: 'phone',
      status: 'ready',
      promisedTime: addMinutes(serviceStart, 20),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 20), pizzas: 1 }],
      pagerNumber: 7,
      pizzaCount: 1,
      totalAmount: 13.5,
      paymentStatus: 'paid',
      paymentMethod: 'terminal',
      receiptEmailStatus: 'sent',
      receiptSentAt: addMinutes(serviceStart, -16),
      receiptLastError: null,
      loyaltySyncStatus: 'failed',
      createdAt: addMinutes(serviceStart, -18),
      timestamps: {
        taken_at: addMinutes(serviceStart, -18),
        prepping_at: addMinutes(serviceStart, -8),
        in_oven_at: addMinutes(serviceStart, 0),
        ready_at: addMinutes(serviceStart, 14),
        completed_at: null,
      },
      items: [{ id: 'oi_4', menuItemId: 'nduja_hot_honey', quantity: 1, progressCount: 1, modifiers: [] }],
    },
  ]

  return {
    ...baseSnapshot,
    orders,
    payments: [
      {
        id: 'pay_1',
        orderId: 'order_1',
        provider: 'manual',
        method: 'cash',
        status: 'paid',
        amount: 24.5,
        providerReference: 'CASH-101',
        createdAt: addMinutes(serviceStart, -5),
        updatedAt: addMinutes(serviceStart, -5),
      },
      {
        id: 'pay_2',
        orderId: 'order_2',
        provider: 'sumup',
        method: 'sumup_online',
        status: 'authorized',
        amount: 27,
        providerReference: 'SUMUP-102',
        checkoutUrl: '/payments/pay_2',
        createdAt: addMinutes(serviceStart, -10),
        updatedAt: addMinutes(serviceStart, -10),
      },
    ],
    loyverseQueue: [
      {
        id: 'sync_1',
        orderId: 'order_1',
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        lastError: null,
        receiptId: null,
        payload: { orderReference: 'PZ-101' },
      },
      {
        id: 'sync_2',
        orderId: 'order_3',
        status: 'failed',
        attempts: 2,
        lastAttemptAt: addMinutes(serviceStart, 16),
        nextRetryAt: addMinutes(serviceStart, 31),
        lastError: 'Temporary Loyverse API timeout',
        receiptId: null,
        payload: { orderReference: 'PZ-103' },
      },
    ],
    activityLog: [
      {
        id: 'log_1',
        type: 'order_created',
        createdAt: addMinutes(serviceStart, -10),
        actor: 'system',
        orderId: 'order_2',
        message: 'Order PZ-102 created from web checkout.',
      },
      {
        id: 'log_2',
        type: 'status_changed',
        createdAt: addMinutes(serviceStart, 5),
        actor: 'prep',
        orderId: 'order_2',
        message: 'Order PZ-102 moved to prepping.',
      },
    ],
    history: [
      {
        id: 'hist_1',
        orderId: 'order_2',
        fromStatus: 'taken',
        toStatus: 'prepping',
        changedAt: addMinutes(serviceStart, 5),
        changedBy: 'prep',
      },
    ],
  }
}

async function mirrorOrderToSupabase(order: Order, serviceId: string) {
  if (!supabase) {
    return
  }

  const orderNumberMatch = order.reference.match(/(\d+)/)
  const orderNumber = Number(orderNumberMatch?.[1] ?? 0) || Date.now()

  await supabase.from('orders').upsert({
    id: order.id,
    service_id: serviceId,
    customer_id: null,
    order_number: orderNumber,
    customer_name: order.customerName,
    customer_mobile: order.customerMobile,
    customer_email: order.customerEmail,
    auth_user_id: order.authUserId,
    source: order.source,
    status: order.status,
    promised_collection_time: order.promisedTime,
    subtotal_pence: Math.round(Number(order.subtotalAmount ?? 0) * 100),
    discount_pence: Math.round(Number(order.totalDiscountAmount ?? 0) * 100),
    total_pence: Math.round(Number(order.totalAmount ?? 0) * 100),
    applied_discount_code_id: order.appliedDiscountCodeId ?? null,
    applied_discount_summary: order.appliedDiscountSummary ?? null,
    pricing_summary: order.pricingSummary ?? null,
    payment_status: order.paymentStatus,
    payment_method: order.paymentMethod,
    receipt_email_status: order.receiptEmailStatus,
    receipt_sent_at: order.receiptSentAt,
    receipt_last_error: order.receiptLastError,
    loyverse_sync_status: order.loyaltySyncStatus,
    notes: order.notes ?? null,
    created_at: order.createdAt,
    taken_at: order.timestamps.taken_at,
    prepping_at: order.timestamps.prepping_at,
    in_oven_at: order.timestamps.in_oven_at,
    ready_at: order.timestamps.ready_at,
    completed_at: order.timestamps.completed_at,
  })

  await supabase.from('order_items').upsert(
    order.items.map((item) => ({
      id: item.id,
      order_id: order.id,
      menu_item_id: item.menuItemId,
      item_name:
        usePizzaOpsStore.getState().menuItems.find((entry) => entry.id === item.menuItemId)?.name ??
        item.menuItemId,
      quantity: item.quantity,
      unit_price_pence: Math.round(Number(item.originalUnitPrice ?? item.finalUnitPrice ?? 0) * 100),
      line_total_pence: Math.round(
        Number((item.finalUnitPrice ?? item.originalUnitPrice ?? 0) * item.quantity) * 100,
      ),
      original_unit_price_pence: item.originalUnitPrice != null ? Math.round(Number(item.originalUnitPrice) * 100) : null,
      item_discount_pence: Math.round(Number(item.itemDiscountAmount ?? 0) * 100),
      final_unit_price_pence: item.finalUnitPrice != null ? Math.round(Number(item.finalUnitPrice) * 100) : null,
      applied_discount_summary: item.appliedDiscountSummary ?? null,
      status: order.status,
      notes: item.notes ?? null,
    })),
  )

  await supabase.from('order_item_modifiers').delete().in(
    'order_item_id',
    order.items.map((item) => item.id),
  )

  const modifierRows = order.items.flatMap((item) =>
    (item.modifiers ?? []).map((modifier) => ({
      order_item_id: item.id,
      modifier_name: modifier.name,
      price_delta_pence: Math.round(Number(modifier.priceDelta ?? 0) * 100),
    })),
  )

  if (modifierRows.length) {
    await supabase.from('order_item_modifiers').insert(modifierRows)
  }
}

function queueSnapshotSync(snapshot: ServiceSnapshot) {
  if (
    SAFE_MODE ||
    applyingRemoteSnapshot ||
    !canUseRealtimeSync() ||
    !usePizzaOpsStore.getState().remoteReady
  ) {
    return
  }

  if (snapshotPersistTimer) {
    clearTimeout(snapshotPersistTimer)
  }

  snapshotPersistTimer = setTimeout(() => {
    console.info('[pizza-ops] queueSnapshotSync flush', snapshot.service.id)
    void persistRemoteSnapshot(getOperationalSnapshot(snapshot))
  }, 150)
}

export const usePizzaOpsStore = create<StoreState>()(
  persist(
    (set, get) => {
      const commit = (
        updater: (state: StoreState) => Partial<StoreState>,
        options?: { sync?: boolean },
      ) => {
        const current = get()
        const patch = updater(current)
        set(patch)
        const nextState = get()
        if (options?.sync !== false) {
          queueSnapshotSync(getPersistableSnapshot(nextState))
        }
      }

      const sendOrderReceipt = async (orderId: string) => {
        const state = get()
        const order = state.orders.find((entry) => entry.id === orderId)
        if (!order?.customerEmail) {
          return
        }

        if (
          order.receiptEmailStatus === 'sending' ||
          order.receiptEmailStatus === 'sent'
        ) {
          return
        }

        const service = state.services.find((entry) => entry.id === state.service.id) ?? state.service
        const location = state.locations.find((entry) => entry.id === service.locationId)

        commit((current) => ({
          orders: current.orders.map((entry) =>
            entry.id === orderId
              ? { ...entry, receiptEmailStatus: 'sending', receiptLastError: null }
              : entry,
          ),
        }))

        try {
          const response = await fetch('/api/send-order-receipt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              order: {
                id: order.id,
                reference: order.reference,
                customerName: order.customerName ?? '',
                customerEmail: order.customerEmail,
                promisedTime: order.promisedTime,
                paymentMethod: order.paymentMethod,
                totalAmount: order.totalAmount,
                subtotalAmount: order.subtotalAmount ?? order.totalAmount,
                totalDiscountAmount: order.totalDiscountAmount ?? 0,
                notes: order.notes ?? '',
                pagerNumber: order.pagerNumber ?? null,
                items: order.items.map((item) => {
                  const menuItem = state.menuItems.find((entry) => entry.id === item.menuItemId)
                  return {
                    id: item.id,
                    name: menuItem?.name ?? item.menuItemId,
                    quantity: item.quantity,
                    lineTotal:
                      item.quantity *
                      ((item.finalUnitPrice ?? item.originalUnitPrice ?? menuItem?.price ?? 0)),
                    modifiers: (item.modifiers ?? []).map((modifier) => modifier.name),
                  }
                }),
              },
              service: {
                name: service.name,
                date: service.date,
                startTime: service.startTime,
                lastCollectionTime: service.lastCollectionTime,
              },
              location: location
                ? {
                    name: location.name,
                    addressLine1: location.addressLine1,
                    addressLine2: location.addressLine2 ?? '',
                    townCity: location.townCity,
                    postcode: location.postcode,
                  }
                : null,
            }),
          })

          const contentType = response.headers.get('content-type') ?? ''
          const payload = contentType.includes('application/json') ? await response.json() : null

          if (!response.ok) {
            throw new Error(
              payload && typeof payload.error === 'string'
                ? payload.error
                : 'Receipt sending failed.',
            )
          }

          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId
                ? {
                    ...entry,
                    receiptEmailStatus: 'sent',
                    receiptSentAt: toIsoNow(),
                    receiptLastError: null,
                  }
                : entry,
            ),
            activityLog: [
              createActivity('payment_updated', 'receipts', `Receipt sent for ${order.reference}.`, orderId),
              ...current.activityLog,
            ],
          }))
        } catch (error) {
          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId
                ? {
                    ...entry,
                    receiptEmailStatus: 'failed',
                    receiptLastError:
                      error instanceof Error ? error.message : 'Receipt sending failed.',
                  }
                : entry,
            ),
          }))
        }
      }

      const refreshMasterDataFromTables = async () => {
        const currentSnapshot = getPersistableSnapshot(get())
        const result = await loadMasterDataFromSupabase(currentSnapshot)
        if (!result.patch) {
          set({
            masterDataLoadError: result.error ?? 'Master data load failed.',
            masterDataLoadWarnings: result.warnings,
          })
          return
        }

        try {
          const [locations, services] = await Promise.all([
            loadLocationsFromSupabase(),
            loadServicesFromSupabase(),
          ])
          const activeService =
            services.find((entry) => entry.id === get().service.id) ??
            services[0] ??
            currentSnapshot.service
          const inventory = activeService?.id
            ? await loadServiceInventoryFromSupabase(activeService.id, result.patch.ingredients)
            : result.patch.inventoryDefaults.map((entry) => ({ ...entry }))
          const orders = activeService?.id ? await loadOrdersForService(activeService.id) : []

          commit(
            () => ({
              ...result.patch,
              locations,
              services,
              service: activeService,
              serviceLocations: Array.from(new Set(locations.map((entry) => entry.name))),
              inventory,
              orders,
              masterDataLoadError: result.error,
              masterDataLoadWarnings: result.warnings,
            }),
            { sync: false },
          )
        } catch (error) {
          set({
            masterDataLoadError: error instanceof Error ? error.message : 'Backend state load failed.',
            masterDataLoadWarnings: result.warnings,
          })
        }
      }

      return {
        ...getInitialState(),
        isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
        remoteReady: SAFE_MODE,
        realtimeStatus: SAFE_MODE ? 'idle' : 'connecting',
        lastRemoteSyncAt: null,
        masterDataLoadError: null,
        masterDataLoadWarnings: [],
        setOnlineStatus: (status) => set({ isOnline: status }),
        hydrateRemote: async () => {
          if (SAFE_MODE) {
            await refreshMasterDataFromTables()
            set({ remoteReady: true })
            return
          }

          const serviceId = get().service.id
          if (hydrateRemotePromise && hydrateRemoteServiceId === serviceId) {
            return hydrateRemotePromise
          }

          hydrateRemoteServiceId = serviceId
          hydrateRemotePromise = (async () => {
            console.info('[pizza-ops] hydrateRemote invoked')
            await refreshMasterDataFromTables()

            if (!canUseRealtimeSync()) {
              set({ remoteReady: true })
              return
            }

            const current = getPersistableSnapshot(get())
            const blankState = getBlankOperationalState(current, serviceId)
            const blankRemoteState = getOperationalSnapshot(blankState)
            applyingRemoteSnapshot = true
            set({
              ...blankState,
              remoteReady: false,
              realtimeStatus: 'connecting',
            })
            applyingRemoteSnapshot = false

            const remote = await loadRemoteSnapshot(serviceId)
            if (remote) {
              const normalizedRemote = mergeOperationalSnapshot(getPersistableSnapshot(get()), remote)
              const remoteJson = JSON.stringify(getOperationalSnapshot(normalizedRemote))
              const localJson = JSON.stringify(blankRemoteState)

              if (remoteJson !== localJson) {
                applyingRemoteSnapshot = true
                set({
                  ...normalizedRemote,
                  remoteReady: true,
                  lastRemoteSyncAt: toIsoNow(),
                })
                applyingRemoteSnapshot = false
              } else {
                set({ ...blankState, remoteReady: true, lastRemoteSyncAt: toIsoNow() })
              }
              return
            }

            await persistRemoteSnapshot(blankRemoteState)
            set({ ...blankState, remoteReady: true, lastRemoteSyncAt: toIsoNow() })
          })().finally(() => {
            hydrateRemotePromise = null
            hydrateRemoteServiceId = null
          })

          return hydrateRemotePromise
        },
        startRealtime: () => {
          if (SAFE_MODE) {
            return null
          }

          if (!canUseRealtimeSync()) {
            return null
          }

          const serviceId = get().service.id
          if (stopRealtimeSubscription && activeRealtimeServiceId === serviceId) {
            console.info('[pizza-ops] startRealtime skipped duplicate', serviceId)
            return stopRealtimeSubscription
          }

          stopRealtimeSubscription?.()
          activeRealtimeServiceId = serviceId
          set({ realtimeStatus: 'connecting' })
          const stop = subscribeToRemoteSnapshot(
            serviceId,
            (snapshot) => {
              const normalizedSnapshot = mergeOperationalSnapshot(getPersistableSnapshot(get()), snapshot)
              const currentSnapshot = getPersistableSnapshot(get())
              if (
                JSON.stringify(getOperationalSnapshot(currentSnapshot)) ===
                JSON.stringify(getOperationalSnapshot(normalizedSnapshot))
              ) {
                set({ lastRemoteSyncAt: toIsoNow() })
                return
              }

              applyingRemoteSnapshot = true
              set({ ...normalizedSnapshot, lastRemoteSyncAt: toIsoNow() })
              applyingRemoteSnapshot = false
            },
            (status) => {
              set({
                realtimeStatus:
                  status === 'SUBSCRIBED'
                    ? 'subscribed'
                    : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
                      ? 'error'
                      : 'connecting',
              })
            },
          )
          stopRealtimeSubscription = stop
          return () => {
            stop?.()
            if (activeRealtimeServiceId === serviceId) {
              activeRealtimeServiceId = null
              stopRealtimeSubscription = null
            }
            set({ realtimeStatus: 'idle' })
          }
        },
        getAvailableTimes: (items) => {
          const state = get()
          if (!state.service || !state.menuItems.length) {
            return []
          }

          return getAvailableSlots(state.service, state.orders, items, state.menuItems)
        },
        createOrder: (input) => {
          const state = get()
          const capacityUnits = input.items.reduce((count, item) => {
            const menuItem = state.menuItems.find((entry) => entry.id === item.menuItemId)
            return menuItem ? count + item.quantity : count
          }, 0)
          const allocation = allocateAcrossSlots(state.service, state.orders, input.promisedTime, capacityUnits)

          if (!allocation.ok) {
            return { ok: false as const, error: allocation.warning }
          }

          const normalizedEmail = input.email ? normalizeEmail(input.email) : ''
          const existingCustomer =
            state.customers.find(
              (entry) =>
                (normalizedEmail && normalizeEmail(entry.email ?? '') === normalizedEmail) ||
                (!!input.mobile && entry.mobile === input.mobile),
            ) ?? null
          const customer: Customer = {
            id: existingCustomer?.id ?? randomId('cust'),
            name: input.customerName,
            mobile: input.mobile,
            email: normalizedEmail || undefined,
            authUserId: input.authUserId ?? existingCustomer?.authUserId ?? null,
          }
          const now = toIsoNow()
          const orderId = randomUuid()
          const paymentId = randomId('pay')
          const orderItems = input.items.map((item) => ({
            ...item,
            id: randomUuid(),
            progressCount: item.progressCount ?? 0,
            modifiers: item.modifiers ?? [],
          }))
          let appliedOrderDiscount = input.appliedOrderDiscount ?? null
          if (appliedOrderDiscount?.source === 'code' && appliedOrderDiscount.code) {
            const matchedCode = state.discountCodes.find(
              (entry) => normalizeDiscountCodeInput(entry.code) === normalizeDiscountCodeInput(appliedOrderDiscount?.code ?? ''),
            )
            const validation = validateDiscountCode({
              discountCode: matchedCode,
              nowIso: now,
              items: orderItems,
              menuItems: state.menuItems,
              scope: 'order',
            })

            if (!validation.ok) {
              return { ok: false as const, error: validation.error }
            }

            if (!matchedCode) {
              return { ok: false as const, error: 'Discount code not found.' }
            }

            const preOrderPricing = getOrderPricingSummary(orderItems, state.menuItems, 0)
            const appliedAmount = calculateDiscountAmount(
              matchedCode.discountType,
              matchedCode.discountValue,
              preOrderPricing.subtotalAmount - preOrderPricing.itemDiscountAmount,
            )

            appliedOrderDiscount = buildCodeDiscountSummary({
              scope: 'order',
              discountType: matchedCode.discountType,
              discountValue: matchedCode.discountValue,
              appliedAmount,
              code: matchedCode.code,
              discountCodeId: matchedCode.id,
              appliedBy: input.source === 'web' ? 'customer' : 'manager',
              appliedAt: now,
            })
          }

          const pricingSummary = getOrderPricingSummary(
            orderItems,
            state.menuItems,
            appliedOrderDiscount?.appliedAmount ?? 0,
          )
          const totalAmount = pricingSummary.finalTotalAmount

          const paymentStatus: PaymentStatus =
            input.paymentMethod === 'cash' || input.paymentMethod === 'terminal' ? 'paid' : 'pending'
          const orderNumber = 100 + state.orders.length + 1

          const order: Order = {
            id: orderId,
            reference: `PZ-${orderNumber}`,
            customerId: customer.id,
            customerName: customer.name,
            customerMobile: customer.mobile,
            customerEmail: customer.email,
            authUserId: customer.authUserId ?? null,
            source: input.source,
            status: 'taken',
            promisedTime: input.promisedTime,
            slotAllocations: allocation.allocations,
            pagerNumber: input.pagerNumber ?? null,
            pizzaCount: capacityUnits,
            subtotalAmount: pricingSummary.subtotalAmount,
            totalDiscountAmount: pricingSummary.totalDiscountAmount,
            orderDiscountAmount: pricingSummary.orderDiscountAmount,
            totalAmount,
            appliedDiscountCodeId:
              appliedOrderDiscount?.source === 'code' ? appliedOrderDiscount.discountCodeId ?? null : null,
            appliedDiscountSummary: appliedOrderDiscount,
            pricingSummary,
            paymentStatus,
            paymentMethod: input.paymentMethod,
            receiptEmailStatus: customer.email
              ? paymentStatus === 'paid'
                ? 'pending'
                : 'not_requested'
              : 'not_requested',
            receiptSentAt: null,
            receiptLastError: null,
            loyaltySyncStatus: 'pending',
            notes: input.notes,
            createdAt: now,
            timestamps: {
              taken_at: now,
              prepping_at: null,
              in_oven_at: null,
              ready_at: null,
              completed_at: null,
            },
            items: orderItems,
          }

          const payment: PaymentRecord = {
            id: paymentId,
            orderId,
            provider: input.paymentMethod === 'sumup_online' ? 'sumup' : 'manual',
            method: input.paymentMethod,
            status: paymentStatus,
            amount: totalAmount,
            providerReference:
              input.paymentMethod === 'sumup_online' ? paymentId : `LOCAL-${order.reference}`,
            checkoutUrl: input.paymentMethod === 'sumup_online' ? `/payments/${paymentId}` : undefined,
            createdAt: now,
            updatedAt: now,
          }

          const queueItem: LoyverseSyncQueueItem = {
            id: randomId('sync'),
            orderId,
            status: 'pending',
            attempts: 0,
            lastAttemptAt: null,
            nextRetryAt: null,
            lastError: null,
            receiptId: null,
            payload: buildLoyversePayload(order),
          }

          const redemptions: DiscountCodeRedemption[] =
            appliedOrderDiscount?.source === 'code' && appliedOrderDiscount.discountCodeId
              ? [
                  {
                    id: randomId('redeem'),
                    discountCodeId: appliedOrderDiscount.discountCodeId,
                    orderId,
                    orderItemId: null,
                    redeemedAt: now,
                    redeemedBy: input.source === 'web' ? 'customer' : 'manager',
                    codeSnapshot: appliedOrderDiscount.code ?? '',
                    discountTypeSnapshot: appliedOrderDiscount.discountType,
                    discountValueSnapshot: appliedOrderDiscount.discountValue,
                    appliedDiscountAmount: appliedOrderDiscount.appliedAmount,
                  },
                ]
              : []

          commit((current) => ({
            customers: existingCustomer
              ? current.customers.map((entry) =>
                  entry.id === existingCustomer.id
                    ? {
                        ...entry,
                        name: customer.name,
                        mobile: customer.mobile,
                        email: customer.email,
                        authUserId: customer.authUserId ?? null,
                      }
                    : entry,
                )
              : [...current.customers, customer],
            orders: [order, ...current.orders],
            payments: [payment, ...current.payments],
            discountCodes: current.discountCodes.map((entry) =>
              entry.id === appliedOrderDiscount?.discountCodeId
                ? { ...entry, usedCount: entry.usedCount + 1, updatedAt: now }
                : entry,
            ),
            discountCodeRedemptions: [...redemptions, ...current.discountCodeRedemptions],
            loyverseQueue: [queueItem, ...current.loyverseQueue],
            history: [
              {
                id: randomId('hist'),
                orderId,
                fromStatus: null,
                toStatus: 'taken',
                changedAt: now,
                changedBy: 'order_taker',
                note: 'Order placed',
              },
              ...current.history,
            ],
            activityLog: [
              ...(appliedOrderDiscount
                ? [
                    createActivity(
                      'discount_applied',
                      appliedOrderDiscount.appliedBy ?? 'manager',
                      `${order.reference} ${appliedOrderDiscount.description} (£${appliedOrderDiscount.appliedAmount.toFixed(2)}).`,
                      order.id,
                    ),
                  ]
                : []),
              createActivity(
                'order_created',
                'order_taker',
                `${order.reference} booked for ${formatTime(order.promisedTime)}.`,
                order.id,
              ),
              ...current.activityLog,
            ],
          }))

          if (order.paymentStatus === 'paid' && order.customerEmail) {
            void sendOrderReceipt(order.id)
          }

          void mirrorOrderToSupabase(order, state.service.id)

          return {
            ok: true as const,
            orderId,
            paymentId: input.paymentMethod === 'sumup_online' ? paymentId : undefined,
          }
        },
        updateOrderStatus: (orderId, nextStatus) => {
          const state = get()
          const order = state.orders.find((entry) => entry.id === orderId)
          if (!order || order.status === nextStatus) {
            return
          }

          const now = toIsoNow()
          const nextOrder = {
            ...order,
            status: nextStatus,
            timestamps: {
              ...order.timestamps,
              [statusTimestampField[nextStatus]]: now,
            },
          }
          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId ? nextOrder : entry,
            ),
            history: [
              {
                id: randomId('hist'),
                orderId,
                fromStatus: order.status,
                toStatus: nextStatus,
                changedAt: now,
                changedBy: 'service_team',
              },
              ...current.history,
            ],
            activityLog: [
              createActivity('status_changed', 'service_team', `${order.reference} moved to ${nextStatus}.`, orderId),
              ...current.activityLog,
            ],
          }))
          void mirrorOrderToSupabase(nextOrder, state.service.id)
        },
        updateOrderItemProgress: (orderId, itemId, direction = 'forward') => {
          const state = get()
          const order = state.orders.find((entry) => entry.id === orderId)
          const item = order?.items.find((entry) => entry.id === itemId)
          if (!order || !item) {
            return
          }

          const currentProgress = item.progressCount ?? 0
          const nextProgress =
            direction === 'backward'
              ? Math.max(currentProgress - 1, 0)
              : Math.min(currentProgress + 1, item.quantity)
          if (nextProgress === currentProgress) {
            return
          }

          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId
                ? {
                    ...entry,
                    items: entry.items.map((row) =>
                      row.id === itemId ? { ...row, progressCount: nextProgress } : row,
                    ),
                  }
                : entry,
            ),
            activityLog: [
              createActivity(
                'item_progressed',
                'kds',
                `${order.reference} item progress ${nextProgress}/${item.quantity}.`,
                orderId,
              ),
              ...current.activityLog,
            ],
          }))
          const syncedOrder = get().orders.find((entry) => entry.id === orderId)
          if (syncedOrder) {
            void mirrorOrderToSupabase(syncedOrder, state.service.id)
          }
        },
        recallCompletedOrder: (orderId) => {
          const state = get()
          const targetOrder =
            (orderId
              ? state.orders.find((entry) => entry.id === orderId)
              : state.orders
                  .filter((entry) => entry.status === 'completed')
                  .sort(
                    (left, right) =>
                      new Date(right.timestamps.completed_at ?? right.createdAt).getTime() -
                      new Date(left.timestamps.completed_at ?? left.createdAt).getTime(),
                  )[0]) ?? null

          if (!targetOrder) {
            return { ok: false, error: 'No completed order available to recall.' }
          }

          if (targetOrder.status !== 'completed') {
            return { ok: false, error: 'Order is not completed.' }
          }

          const nextStatus = getRecallTargetStatus(targetOrder, state.history)
          const now = toIsoNow()
          const recalledOrder = {
            ...targetOrder,
            status: nextStatus,
            timestamps: {
              ...targetOrder.timestamps,
              completed_at: null,
              [statusTimestampField[nextStatus]]: targetOrder.timestamps[statusTimestampField[nextStatus]] ?? now,
            },
          }

          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === targetOrder.id ? recalledOrder : entry,
            ),
            history: [
              {
                id: randomId('hist'),
                orderId: targetOrder.id,
                fromStatus: 'completed',
                toStatus: nextStatus,
                changedAt: now,
                changedBy: 'kds_recall',
                note: 'Recalled from completed.',
              },
              ...current.history,
            ],
            activityLog: [
              createActivity(
                'status_changed',
                'kds_recall',
                `${targetOrder.reference} recalled to ${nextStatus}.`,
                targetOrder.id,
              ),
              ...current.activityLog,
            ],
          }))
          void mirrorOrderToSupabase(recalledOrder, state.service.id)
          return { ok: true }
        },
        moveOrder: (orderId, promisedTime, reason, override) => {
          const state = get()
          const target = state.orders.find((entry) => entry.id === orderId)
          if (!target) {
            return { ok: false, warning: 'Order not found.' }
          }

          const otherOrders = state.orders.filter((entry) => entry.id !== orderId)
          const allocation = allocateAcrossSlots(state.service, otherOrders, promisedTime, target.pizzaCount)
          if (!allocation.ok && !override) {
            return { ok: false, warning: allocation.warning }
          }

          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId
                ? {
                    ...entry,
                    promisedTime,
                    slotAllocations: allocation.ok
                      ? allocation.allocations
                      : [{ slotTime: promisedTime, pizzas: target.pizzaCount }],
                  }
                : entry,
            ),
            activityLog: [
              createActivity('order_moved', 'manager', `${target.reference} moved to ${formatTime(promisedTime)}. ${reason}${override ? ' Override accepted.' : ''}`, orderId),
              ...current.activityLog,
            ],
          }))
          const syncedOrder = get().orders.find((entry) => entry.id === orderId)
          if (syncedOrder) {
            void mirrorOrderToSupabase(syncedOrder, state.service.id)
          }
          return { ok: true, warning: allocation.ok ? undefined : allocation.warning }
        },
        addDelay: (minutes, actor, reason) => {
          commit((current) => ({
            service: { ...current.service, delayMinutes: current.service.delayMinutes + minutes },
            orders: current.orders.map((order) =>
              order.status !== 'completed' && new Date(order.promisedTime).getTime() >= Date.now()
                ? shiftOrder(order, minutes)
                : order,
            ),
            activityLog: [
              createActivity('delay_added', actor, `Added ${minutes} minute delay. ${reason}`),
              ...current.activityLog,
            ],
          }))
        },
        pauseService: (minutes, actor, reason) => {
          const pausedUntil = addMinutes(toIsoNow(), minutes)
          commit((current) => ({
            service: {
              ...current.service,
              status: 'paused',
              pausedUntil,
              pauseReason: reason,
            },
            orders: current.orders.map((order) =>
              order.status !== 'completed' && new Date(order.promisedTime).getTime() >= Date.now()
                ? shiftOrder(order, minutes)
                : order,
            ),
            activityLog: [
              createActivity('service_paused', actor, `Paused service until ${formatTime(pausedUntil)}. ${reason}`),
              ...current.activityLog,
            ],
          }))
        },
        updatePaymentStatus: (paymentId, status) => {
          const state = get()
          const payment = state.payments.find((entry) => entry.id === paymentId)
          if (!payment) {
            return
          }

          commit((current) => ({
            payments: current.payments.map((entry) =>
              entry.id === paymentId ? { ...entry, status, updatedAt: toIsoNow() } : entry,
            ),
            orders: current.orders.map((entry) =>
              entry.id === payment.orderId
                ? {
                    ...entry,
                    paymentStatus: status,
                    receiptEmailStatus:
                      status === 'paid' && entry.customerEmail
                        ? entry.receiptEmailStatus === 'sent'
                          ? 'sent'
                          : 'pending'
                        : entry.receiptEmailStatus,
                  }
                : entry,
            ),
            activityLog: [
              createActivity('payment_updated', 'payments', `Payment ${payment.providerReference} updated to ${status}.`, payment.orderId),
              ...current.activityLog,
            ],
          }))

          if (status === 'paid') {
            void sendOrderReceipt(payment.orderId)
          }
          const syncedOrder = get().orders.find((entry) => entry.id === payment.orderId)
          if (syncedOrder) {
            void mirrorOrderToSupabase(syncedOrder, state.service.id)
          }
        },
        updatePaymentCheckout: (paymentId, updates) => {
          const state = get()
          const payment = state.payments.find((entry) => entry.id === paymentId)
          if (!payment) {
            return
          }

          const nextStatus = updates.status ?? payment.status
          commit((current) => ({
            payments: current.payments.map((entry) =>
              entry.id === paymentId
                ? {
                    ...entry,
                    providerReference: updates.providerReference ?? entry.providerReference,
                    checkoutUrl: updates.checkoutUrl ?? entry.checkoutUrl,
                    status: nextStatus,
                    updatedAt: toIsoNow(),
                  }
                : entry,
            ),
            orders: current.orders.map((entry) =>
              entry.id === payment.orderId ? { ...entry, paymentStatus: nextStatus } : entry,
            ),
            activityLog: [
              createActivity('payment_updated', 'payments', `Payment ${paymentId} checkout session updated.`, payment.orderId),
              ...current.activityLog,
            ],
          }))
          const syncedOrder = get().orders.find((entry) => entry.id === payment.orderId)
          if (syncedOrder) {
            void mirrorOrderToSupabase(syncedOrder, state.service.id)
          }
        },
        retryLoyverseSync: (queueId) => {
          const state = get()
          const queueItem = state.loyverseQueue.find((entry) => entry.id === queueId)
          if (!queueItem) {
            return
          }

          const now = toIsoNow()
          const isOnline = get().isOnline
          commit((current) => ({
            loyverseQueue: current.loyverseQueue.map((entry) =>
              entry.id === queueId
                ? {
                    ...entry,
                    status: isOnline ? 'processing' : 'failed',
                    attempts: entry.attempts + 1,
                    lastAttemptAt: now,
                    nextRetryAt: isOnline ? null : addMinutes(now, 15),
                    lastError: isOnline ? null : 'Device offline, retry scheduled.',
                  }
                : entry,
            ),
            activityLog: [
              createActivity('loyverse_retry', 'manager', `Retry requested for Loyverse queue ${queueId}.`, queueItem.orderId),
              ...current.activityLog,
            ],
          }))
        },
        updateService: async (updates, actor) => {
          const state = get()
          const resolvedLocation = resolveLocationReference(
            state.locations,
            updates.locationId ?? state.service.locationId,
            updates.locationName ?? state.service.locationName,
          )
          const savedService = await persistServiceToSupabase({
            ...state.service,
            ...updates,
            locationId: resolvedLocation.locationId,
            locationName: resolvedLocation.locationName,
          })

          commit((current) => ({
            service: savedService,
            services: current.services.map((entry) => (entry.id === savedService.id ? savedService : entry)),
            activityLog: [
              createActivity('service_updated', actor, 'Service settings updated.'),
              ...current.activityLog,
            ],
          }))
        },
        updateServiceLocations: (locations, actor) => {
          commit((current) => ({
            serviceLocations: Array.from(new Set(locations.map((entry) => entry.trim()).filter(Boolean))),
            activityLog: [
              createActivity('service_updated', actor, 'Service location options updated.'),
              ...current.activityLog,
            ],
          }))
        },
        updateBranding: (branding, actor) => {
          commit((current) => ({
            branding,
            activityLog: [
              createActivity('service_updated', actor, 'Updated public ordering branding.'),
              ...current.activityLog,
            ],
          }))
        },
        upsertLocation: async (location, actor) => {
          const savedLocation = await persistLocationToSupabase(location)
          const previousLocationId = location.id
          const exists = get().locations.some((entry) => entry.id === savedLocation.id || entry.id === previousLocationId)
          commit((current) => ({
            locations: exists
              ? current.locations.map((entry) =>
                  entry.id === savedLocation.id || entry.id === previousLocationId ? savedLocation : entry,
                )
              : [...current.locations, savedLocation],
            serviceLocations: Array.from(
              new Set(
                (exists
                  ? current.locations.map((entry) =>
                      entry.id === savedLocation.id || entry.id === previousLocationId ? savedLocation.name : entry.name,
                    )
                  : [...current.locations.map((entry) => entry.name), savedLocation.name]).filter(Boolean),
              ),
            ),
            services: current.services.map((entry) =>
              entry.locationId === savedLocation.id || entry.locationId === previousLocationId
                ? { ...entry, locationId: savedLocation.id, locationName: savedLocation.name }
                : entry,
            ),
            service:
              current.service.locationId === savedLocation.id || current.service.locationId === previousLocationId
                ? { ...current.service, locationId: savedLocation.id, locationName: savedLocation.name }
                : current.service,
            activityLog: [
              createActivity('service_updated', actor, `${exists ? 'Updated' : 'Created'} location ${savedLocation.name}.`),
              ...current.activityLog,
            ],
          }))
          return savedLocation
        },
        createFreshService: async (input, actor, options) => {
          const current = get()
          const resolvedLocation = resolveLocationReference(
            current.locations,
            input.locationId ?? current.service.locationId,
            input.locationName ?? current.service.locationName,
          )
          const draftService: ServiceConfig = {
            ...current.service,
            id: '',
            ...input,
            locationName: resolvedLocation.locationName || current.service.locationName,
            locationId: resolvedLocation.locationId || current.service.locationId,
            date: input.date ?? new Date().toISOString().slice(0, 10),
            status: input.status ?? 'draft',
            acceptPublicOrders: input.acceptPublicOrders ?? true,
            publicOrderClosureReason: input.publicOrderClosureReason ?? null,
            delayMinutes: 0,
            pausedUntil: null,
            pauseReason: null,
          }

          const nextService = await persistServiceToSupabase(draftService)
          await seedServiceInventoryFromDefaults(
            nextService.id,
            options?.applyInventoryDefaults === false ? 0 : undefined,
          )

          const inventory = await loadServiceInventoryFromSupabase(nextService.id, current.ingredients)

          commit((currentState) => ({
            service: nextService,
            services: [nextService, ...currentState.services.filter((entry) => entry.id !== nextService.id)],
            inventory,
            orders: [],
            customers: [],
            payments: [],
            loyverseQueue: [],
            history: [],
            activityLog: [createActivity('service_updated', actor, `Created service ${nextService.name}.`)],
          }))
          return nextService.id
        },
        loadServiceForEditing: (serviceId) => {
          const state = get()
          const target = state.services.find((entry) => entry.id === serviceId)
          if (!target) {
            commit((current) => ({
              service: {
                ...current.service,
                id: serviceId,
              },
              inventory: [],
              orders: [],
              customers: [],
              payments: [],
              loyverseQueue: [],
              history: [],
              activityLog: [],
            }), { sync: false })
            return true
          }

          commit((current) => ({
            service: {
              ...target,
              locationName:
                state.locations.find((entry) => entry.id === target.locationId)?.name ?? target.locationName,
              delayMinutes: target.delayMinutes ?? 0,
              pausedUntil: target.pausedUntil ?? null,
              pauseReason: target.pauseReason ?? null,
            },
            inventory: current.inventory,
            orders: serviceId === current.service.id ? current.orders : [],
            customers: serviceId === current.service.id ? current.customers : [],
            payments: serviceId === current.service.id ? current.payments : [],
            loyverseQueue: serviceId === current.service.id ? current.loyverseQueue : [],
            history: serviceId === current.service.id ? current.history : [],
            activityLog: serviceId === current.service.id ? current.activityLog : [],
          }))
          return true
        },
        duplicateService: async (serviceId, actor) => {
          const state = get()
          const source = state.services.find((entry) => entry.id === serviceId)
          if (!source) {
            return null
          }

          const duplicate = {
            ...source,
            name: `${source.name} Copy`,
            status: 'draft' as const,
            acceptPublicOrders: false,
            publicOrderClosureReason: 'Review before opening',
          }

          const resolvedLocation = resolveLocationReference(state.locations, duplicate.locationId, duplicate.locationName)
          const savedDuplicate = await persistServiceToSupabase({
            ...duplicate,
            locationId: resolvedLocation.locationId,
            locationName: resolvedLocation.locationName,
          })
          await seedServiceInventoryFromDefaults(savedDuplicate.id)
          commit((current) => ({
            services: [savedDuplicate, ...current.services],
            activityLog: [
              createActivity('service_updated', actor, `Duplicated service ${source.name}.`),
              ...current.activityLog,
            ],
          }))
          return savedDuplicate.id
        },
        archiveService: async (serviceId, actor) => {
          const current = get()
          const target = current.services.find((entry) => entry.id === serviceId)
          if (!target) {
            return
          }

          const resolvedLocation = resolveLocationReference(current.locations, target.locationId, target.locationName)
          const savedService = await persistServiceToSupabase({
            ...target,
            locationId: resolvedLocation.locationId,
            locationName: resolvedLocation.locationName,
            status: 'closed',
            acceptPublicOrders: false,
          })

          commit((state) => ({
            service: state.service.id === serviceId ? savedService : state.service,
            services: state.services.map((entry) => (entry.id === serviceId ? savedService : entry)),
            activityLog: [
              createActivity('service_updated', actor, `Archived service ${serviceId}.`),
              ...state.activityLog,
            ],
          }))
        },
        upsertIngredient: async (ingredient, defaultQuantity, actor) => {
          const persistedIngredient = await persistIngredientToSupabase({
            ...ingredient,
            defaultStockAmount: defaultQuantity,
          })
          const nextIngredient = persistedIngredient ?? ingredient
          const exists = get().ingredients.some((entry) => entry.id === nextIngredient.id)
          commit((current) => ({
            ingredients: exists
              ? current.ingredients.map((entry) => (entry.id === nextIngredient.id ? nextIngredient : entry))
              : [...current.ingredients, nextIngredient],
            inventoryDefaults: exists
              ? current.inventoryDefaults.map((entry) =>
                  entry.ingredientId === nextIngredient.id ? { ...entry, quantity: defaultQuantity } : entry,
                )
              : [...current.inventoryDefaults, { ingredientId: nextIngredient.id, quantity: defaultQuantity }],
            inventory: exists
              ? current.inventory.map((entry) =>
                  entry.ingredientId === nextIngredient.id && entry.quantity === 0
                    ? { ...entry, quantity: defaultQuantity }
                    : entry,
                )
              : [...current.inventory, { ingredientId: nextIngredient.id, quantity: defaultQuantity }],
            recipes: current.recipes.map((entry) =>
              entry.ingredientId === ingredient.id
                ? { ...entry, ingredientId: nextIngredient.id }
                : entry,
            ),
            activityLog: [
              createActivity('inventory_adjusted', actor, `${exists ? 'Updated' : 'Created'} ingredient ${nextIngredient.name}.`),
              ...current.activityLog,
            ],
          }))
        },
        setInventoryQuantity: async (ingredientId, quantity, actor) => {
          const safeQuantity = Math.max(0, quantity)
          const serviceId = get().service.id
          await persistServiceInventoryQuantity(serviceId, ingredientId, safeQuantity)
          commit((current) => ({
            inventory: current.inventory.some((entry) => entry.ingredientId === ingredientId)
              ? current.inventory.map((entry) =>
                  entry.ingredientId === ingredientId ? { ...entry, quantity: safeQuantity } : entry,
                )
              : [...current.inventory, { ingredientId, quantity: safeQuantity }],
            activityLog: [
              createActivity('inventory_adjusted', actor, `Inventory ${ingredientId} set to ${safeQuantity}.`),
              ...current.activityLog,
            ],
          }))
        },
        adjustInventoryQuantity: async (ingredientId, delta, actor) => {
          const currentEntry = get().inventory.find((entry) => entry.ingredientId === ingredientId)
          const nextQuantity = Math.max(0, (currentEntry?.quantity ?? 0) + delta)
          await get().setInventoryQuantity(ingredientId, nextQuantity, actor)
        },
        setInventoryDefaultQuantity: async (ingredientId, quantity, actor) => {
          const safeQuantity = Math.max(0, quantity)
          const ingredient = get().ingredients.find((entry) => entry.id === ingredientId)
          if (!ingredient) {
            return
          }
          await persistIngredientToSupabase({
            ...ingredient,
            defaultStockAmount: safeQuantity,
          })
          commit((current) => ({
            ingredients: current.ingredients.map((entry) =>
              entry.id === ingredientId ? { ...entry, defaultStockAmount: safeQuantity } : entry,
            ),
            inventoryDefaults: current.inventoryDefaults.map((entry) =>
              entry.ingredientId === ingredientId ? { ...entry, quantity: safeQuantity } : entry,
            ),
            activityLog: [
              createActivity('inventory_adjusted', actor, `Default inventory ${ingredientId} set to ${safeQuantity}.`),
              ...current.activityLog,
            ],
          }))
        },
        applyInventoryDefaults: async (actor) => {
          const current = get()
          await seedServiceInventoryFromDefaults(current.service.id)
          const inventory = await loadServiceInventoryFromSupabase(current.service.id, current.ingredients)
          commit((current) => ({
            inventory,
            activityLog: [
              createActivity('inventory_adjusted', actor, 'Default inventory applied to current service.'),
              ...current.activityLog,
            ],
          }))
        },
        upsertMenuItem: async (menuItem, recipeRows, actor) => {
          const normalizedMenuItem = normalizeMenuItem(menuItem)
          console.info('[menu-save] store upsertMenuItem start', {
            id: normalizedMenuItem.id,
            name: normalizedMenuItem.name,
            recipeCount: recipeRows.length,
          })
          const persistedMenuItem = await persistMenuItemToSupabase(normalizedMenuItem)
          const canonicalMenuItem = persistedMenuItem ?? normalizedMenuItem
          const persistedRecipeRows = await persistMenuItemRecipesToSupabase(
            canonicalMenuItem.id,
            recipeRows.map((entry) => ({
              ...entry,
              menuItemId: canonicalMenuItem.id,
              affectsAvailability: entry.affectsAvailability !== false,
            })),
          )
          const canonicalRecipeRows =
            persistedRecipeRows ??
            recipeRows
              .filter((entry) => entry.quantity > 0)
              .map((entry, index) => ({
                ...entry,
                id: entry.id || `${canonicalMenuItem.id}_recipe_${index + 1}`,
                menuItemId: canonicalMenuItem.id,
                affectsAvailability: entry.affectsAvailability !== false,
              }))
          const exists =
            get().menuItems.some((entry) => entry.id === canonicalMenuItem.id) ||
            get().menuItems.some((entry) => entry.id === normalizedMenuItem.id)
          commit((current) => ({
            menuItems: exists
              ? current.menuItems.map((entry) =>
                  entry.id === canonicalMenuItem.id || entry.id === normalizedMenuItem.id
                    ? canonicalMenuItem
                    : entry,
                )
              : [...current.menuItems, canonicalMenuItem],
            recipes: [
              ...current.recipes.filter(
                (entry) =>
                  entry.menuItemId !== normalizedMenuItem.id &&
                  entry.menuItemId !== canonicalMenuItem.id,
              ),
              ...canonicalRecipeRows,
            ],
            modifiers: current.modifiers.map((modifier) => ({
              ...modifier,
              menuItemIds: modifier.menuItemIds.map((menuItemId) =>
                menuItemId === normalizedMenuItem.id ? canonicalMenuItem.id : menuItemId,
              ),
            })),
            orders: current.orders.map((order) => ({
              ...order,
              items: order.items.map((item) => ({
                ...item,
                menuItemId:
                  item.menuItemId === normalizedMenuItem.id ? canonicalMenuItem.id : item.menuItemId,
              })),
            })),
            discountCodes: current.discountCodes.map((discountCode) => ({
              ...discountCode,
              appliesToMenuItemId:
                discountCode.appliesToMenuItemId === normalizedMenuItem.id
                  ? canonicalMenuItem.id
                  : discountCode.appliesToMenuItemId,
            })),
            activityLog: [
              createActivity('service_updated', actor, `${exists ? 'Updated' : 'Added'} menu item ${canonicalMenuItem.name}.`),
              ...current.activityLog,
            ],
          }))
          console.info('[menu-save] store upsertMenuItem success', {
            id: canonicalMenuItem.id,
            name: canonicalMenuItem.name,
            recipeCount: canonicalRecipeRows.length,
            existed: exists,
          })
        },
        upsertDiscountCode: (discountCode, actor) => {
          const exists = get().discountCodes.some((entry) => entry.id === discountCode.id)
          commit((current) => ({
            discountCodes: exists
              ? current.discountCodes.map((entry) => (entry.id === discountCode.id ? discountCode : entry))
              : [...current.discountCodes, discountCode],
            activityLog: [
              createActivity('discount_applied', actor, `${exists ? 'Updated' : 'Created'} discount code ${discountCode.code}.`),
              ...current.activityLog,
            ],
          }))
        },
        upsertModifier: async (modifier, actor) => {
          const persistedModifier = await persistModifierToSupabase(modifier)
          const nextModifier = persistedModifier ?? modifier
          const exists = get().modifiers.some((entry) => entry.id === nextModifier.id)
          commit((current) => ({
            modifiers: exists
              ? current.modifiers.map((entry) => (entry.id === nextModifier.id ? nextModifier : entry))
              : [...current.modifiers, nextModifier],
            activityLog: [
              createActivity('modifier_updated', actor, `${exists ? 'Updated' : 'Created'} modifier ${nextModifier.name}.`),
              ...current.activityLog,
            ],
          }))
        },
        deleteModifier: async (modifierId, actor) => {
          await deleteModifierFromSupabase(modifierId)
          commit((current) => ({
            modifiers: current.modifiers.filter((entry) => entry.id !== modifierId),
            activityLog: [
              createActivity('modifier_updated', actor, `Deleted modifier ${modifierId}.`),
              ...current.activityLog,
            ],
          }))
        },
        assignPager: (orderId, pagerNumber, actor) => {
          const current = get()
          const order = current.orders.find((entry) => entry.id === orderId)
          if (!order) {
            return { ok: false, error: 'Order not found.' }
          }

          if (
            pagerNumber &&
            current.orders.some(
              (entry) =>
                entry.id !== orderId &&
                entry.status !== 'completed' &&
                entry.pagerNumber === pagerNumber,
            )
          ) {
            return { ok: false, error: `Pager ${pagerNumber} is already in use.` }
          }

          commit((state) => ({
            orders: state.orders.map((entry) =>
              entry.id === orderId ? { ...entry, pagerNumber } : entry,
            ),
            activityLog: [
              createActivity('pager_assigned', actor, `${order.reference} pager ${pagerNumber ?? 'cleared'}.`, orderId),
              ...state.activityLog,
            ],
          }))
          const syncedOrder = get().orders.find((entry) => entry.id === orderId)
          if (syncedOrder) {
            void mirrorOrderToSupabase(syncedOrder, current.service.id)
          }
          return { ok: true }
        },
        getActivePagerNumbers: () =>
          get()
            .orders.filter((entry) => entry.status !== 'completed' && entry.pagerNumber)
            .map((entry) => entry.pagerNumber as number),
        resetDemo: () => {
          commit(() => ({ ...getInitialState() }))
        },
      }
    },
    {
      name: 'pizza-ops-mvp',
      merge: (persistedState, currentState) => {
        const mergedState = {
          ...currentState,
          ...(persistedState as Partial<StoreState>),
        } as StoreState

        for (const key of CANONICAL_MASTER_DATA_KEYS) {
          ;(mergedState as Record<string, unknown>)[key] = currentState[key]
        }

        return {
          ...mergedState,
          ...normalizeSnapshot(mergedState),
        }
      },
      partialize: (state) => ({
        branding: state.branding,
        discountCodes: state.discountCodes,
        discountCodeRedemptions: state.discountCodeRedemptions,
      }),
    },
  ),
)
