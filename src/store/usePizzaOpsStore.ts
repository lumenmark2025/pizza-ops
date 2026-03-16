import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedSnapshot } from '../data/seed'
import { buildLoyversePayload } from '../integrations/loyverse'
import { getOrderItemsTotal } from '../lib/order-calculations'
import { SAFE_MODE } from '../lib/runtime-flags'
import { allocateAcrossSlots, getAvailableSlots } from '../lib/slot-engine'
import {
  canUseRealtimeSync,
  loadRemoteSnapshot,
  persistRemoteSnapshot,
  subscribeToRemoteSnapshot,
} from '../lib/realtime-state'
import { supabase } from '../lib/supabase'
import { addMinutes, combineDateAndTime, formatTime, toIsoNow } from '../lib/time'
import type {
  ActivityLogEntry,
  Customer,
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
  source: OrderSource
  promisedTime: string
  items: OrderItem[]
  paymentMethod: PaymentMethod
  notes?: string
  pagerNumber?: number | null
}

type StoreState = ServiceSnapshot & {
  isOnline: boolean
  remoteReady: boolean
  createOrder: (input: CreateOrderInput) => { ok: true; orderId: string; paymentId?: string } | { ok: false; error: string }
  setOnlineStatus: (status: boolean) => void
  updateOrderStatus: (orderId: string, nextStatus: OrderStatus) => void
  updateOrderItemProgress: (orderId: string, itemId: string) => void
  moveOrder: (orderId: string, promisedTime: string, reason: string, override: boolean) => { ok: boolean; warning?: string }
  addDelay: (minutes: number, actor: string, reason: string) => void
  pauseService: (minutes: number, actor: string, reason: string) => void
  updatePaymentStatus: (paymentId: string, status: PaymentStatus) => void
  updatePaymentCheckout: (paymentId: string, updates: { providerReference?: string; checkoutUrl?: string; status?: PaymentStatus }) => void
  retryLoyverseSync: (queueId: string) => void
  getAvailableTimes: (items: OrderItem[]) => ReturnType<typeof getAvailableSlots>
  resetDemo: () => void
  updateService: (updates: Partial<ServiceConfig>, actor: string) => void
  updateServiceLocations: (locations: string[], actor: string) => void
  upsertLocation: (location: Location, actor: string) => void
  createFreshService: (input: Partial<ServiceConfig>, actor: string, options?: { applyInventoryDefaults?: boolean }) => string
  loadServiceForEditing: (serviceId: string) => boolean
  duplicateService: (serviceId: string, actor: string) => string | null
  archiveService: (serviceId: string, actor: string) => void
  setInventoryQuantity: (ingredientId: string, quantity: number, actor: string) => void
  adjustInventoryQuantity: (ingredientId: string, delta: number, actor: string) => void
  setInventoryDefaultQuantity: (ingredientId: string, quantity: number, actor: string) => void
  applyInventoryDefaults: (actor: string) => void
  upsertMenuItem: (
    menuItem: MenuItem,
    recipeRows: MenuItemRecipe[],
    actor: string,
  ) => void
  upsertModifier: (modifier: Modifier, actor: string) => void
  deleteModifier: (modifierId: string, actor: string) => void
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
  'ingredients',
  'menuItems',
  'recipes',
  'inventory',
  'inventoryDefaults',
  'modifiers',
  'customers',
  'orders',
  'history',
  'payments',
  'loyverseQueue',
  'activityLog',
] as const

let applyingRemoteSnapshot = false
let stopRealtimeSubscription: null | (() => void) = null
let hydrateRemotePromise: Promise<void> | null = null
let activeRealtimeServiceId: string | null = null
let snapshotPersistTimer: ReturnType<typeof setTimeout> | null = null

const statusTimestampField: Record<OrderStatus, keyof Order['timestamps']> = {
  taken: 'taken_at',
  prepping: 'prepping_at',
  in_oven: 'in_oven_at',
  ready: 'ready_at',
  completed: 'completed_at',
}

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
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

function createDemoState(): ServiceSnapshot {
  const serviceStart = combineDateAndTime(seedSnapshot.service.date, seedSnapshot.service.startTime)
  const orders: Order[] = [
    {
      id: 'order_1',
      reference: 'PZ-101',
      customerId: 'cust_1',
      source: 'walkup',
      status: 'taken',
      promisedTime: addMinutes(serviceStart, 25),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 25), pizzas: 2 }],
      pagerNumber: 4,
      pizzaCount: 2,
      totalAmount: 24.5,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
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
      source: 'web',
      status: 'prepping',
      promisedTime: addMinutes(serviceStart, 35),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 35), pizzas: 2 }],
      pagerNumber: null,
      pizzaCount: 2,
      totalAmount: 27,
      paymentStatus: 'authorized',
      paymentMethod: 'sumup_online',
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
      source: 'phone',
      status: 'ready',
      promisedTime: addMinutes(serviceStart, 20),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 20), pizzas: 1 }],
      pagerNumber: 7,
      pizzaCount: 1,
      totalAmount: 13.5,
      paymentStatus: 'paid',
      paymentMethod: 'terminal',
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
    ...seedSnapshot,
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

async function mirrorOrderToSupabase(order: Order) {
  if (SAFE_MODE || !supabase) {
    return
  }

  await supabase.from('orders').upsert({
    id: order.id,
    customer_id: order.customerId,
    reference: order.reference,
    status: order.status,
    promised_time: order.promisedTime,
    total_amount: order.totalAmount,
    payment_status: order.paymentStatus,
    pager_number: order.pagerNumber,
  })
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
    void persistRemoteSnapshot(snapshot)
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

      return {
        ...createDemoState(),
        isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
        remoteReady: SAFE_MODE,
        setOnlineStatus: (status) => set({ isOnline: status }),
        hydrateRemote: async () => {
          if (SAFE_MODE) {
            set({ remoteReady: true })
            return
          }

          if (hydrateRemotePromise) {
            return hydrateRemotePromise
          }

          hydrateRemotePromise = (async () => {
            console.info('[pizza-ops] hydrateRemote invoked')
            if (!canUseRealtimeSync()) {
              set({ remoteReady: true })
              return
            }

            const current = getPersistableSnapshot(get())
            const remote = await loadRemoteSnapshot(current.service.id)
            if (remote) {
              const localSnapshot = getPersistableSnapshot(get())
              const remoteJson = JSON.stringify(remote)
              const localJson = JSON.stringify(localSnapshot)

              if (remoteJson !== localJson) {
                applyingRemoteSnapshot = true
                set({ ...remote, remoteReady: true })
                applyingRemoteSnapshot = false
              } else {
                set({ remoteReady: true })
              }
              return
            }

            await persistRemoteSnapshot(current)
            set({ remoteReady: true })
          })().finally(() => {
            hydrateRemotePromise = null
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
          const stop = subscribeToRemoteSnapshot(serviceId, (snapshot) => {
            const currentSnapshot = getPersistableSnapshot(get())
            if (JSON.stringify(currentSnapshot) === JSON.stringify(snapshot)) {
              return
            }

            applyingRemoteSnapshot = true
            set({ ...snapshot })
            applyingRemoteSnapshot = false
          })
          stopRealtimeSubscription = stop
          return () => {
            stop?.()
            if (activeRealtimeServiceId === serviceId) {
              activeRealtimeServiceId = null
              stopRealtimeSubscription = null
            }
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
          const pizzaCount = input.items.reduce((count, item) => {
            const menuItem = state.menuItems.find((entry) => entry.id === item.menuItemId)
            return menuItem?.category === 'pizza' ? count + item.quantity : count
          }, 0)
          const allocation = allocateAcrossSlots(state.service, state.orders, input.promisedTime, pizzaCount)

          if (!allocation.ok) {
            return { ok: false as const, error: allocation.warning }
          }

          const customer: Customer = {
            id: randomId('cust'),
            name: input.customerName,
            mobile: input.mobile,
          }
          const now = toIsoNow()
          const orderId = randomId('order')
          const paymentId = randomId('pay')
          const orderItems = input.items.map((item) => ({
            ...item,
            id: randomId('oi'),
            progressCount: item.progressCount ?? 0,
            modifiers: item.modifiers ?? [],
          }))
          const totalAmount = getOrderItemsTotal(orderItems, state.menuItems)

          const paymentStatus: PaymentStatus =
            input.paymentMethod === 'cash' || input.paymentMethod === 'terminal' ? 'paid' : 'pending'

          const order: Order = {
            id: orderId,
            reference: `PZ-${100 + state.orders.length + 1}`,
            customerId: customer.id,
            source: input.source,
            status: 'taken',
            promisedTime: input.promisedTime,
            slotAllocations: allocation.allocations,
            pagerNumber: input.pagerNumber ?? null,
            pizzaCount,
            totalAmount,
            paymentStatus,
            paymentMethod: input.paymentMethod,
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

          commit((current) => ({
            customers: [...current.customers, customer],
            orders: [order, ...current.orders],
            payments: [payment, ...current.payments],
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
              createActivity(
                'order_created',
                'order_taker',
                `${order.reference} booked for ${formatTime(order.promisedTime)}.`,
                order.id,
              ),
              ...current.activityLog,
            ],
          }))

          void mirrorOrderToSupabase(order)

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
          commit((current) => ({
            orders: current.orders.map((entry) =>
              entry.id === orderId
                ? {
                    ...entry,
                    status: nextStatus,
                    timestamps: {
                      ...entry.timestamps,
                      [statusTimestampField[nextStatus]]: now,
                    },
                  }
                : entry,
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
        },
        updateOrderItemProgress: (orderId, itemId) => {
          const state = get()
          const order = state.orders.find((entry) => entry.id === orderId)
          const item = order?.items.find((entry) => entry.id === itemId)
          if (!order || !item) {
            return
          }

          const nextProgress = Math.min((item.progressCount ?? 0) + 1, item.quantity)
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
              createActivity('item_progressed', 'kds', `${order.reference} item progress ${nextProgress}/${item.quantity}.`, orderId),
              ...current.activityLog,
            ],
          }))
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
              entry.id === payment.orderId ? { ...entry, paymentStatus: status } : entry,
            ),
            activityLog: [
              createActivity('payment_updated', 'payments', `Payment ${payment.providerReference} updated to ${status}.`, payment.orderId),
              ...current.activityLog,
            ],
          }))
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
        updateService: (updates, actor) => {
          const locationName = updates.locationId
            ? get().locations.find((entry) => entry.id === updates.locationId)?.name
            : updates.locationName
          commit((current) => ({
            service: { ...current.service, ...updates, ...(locationName ? { locationName } : {}) },
            services: current.services.map((entry) =>
              entry.id === current.service.id
                ? { ...entry, ...updates, ...(locationName ? { locationName } : {}) }
                : entry,
            ),
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
        upsertLocation: (location, actor) => {
          const exists = get().locations.some((entry) => entry.id === location.id)
          commit((current) => ({
            locations: exists
              ? current.locations.map((entry) => (entry.id === location.id ? location : entry))
              : [...current.locations, location],
            serviceLocations: Array.from(
              new Set(
                (exists
                  ? current.locations.map((entry) => (entry.id === location.id ? location.name : entry.name))
                  : [...current.locations.map((entry) => entry.name), location.name]).filter(Boolean),
              ),
            ),
            services: current.services.map((entry) =>
              entry.locationId === location.id
                ? { ...entry, locationName: location.name }
                : entry,
            ),
            service:
              current.service.locationId === location.id
                ? { ...current.service, locationName: location.name }
                : current.service,
            activityLog: [
              createActivity('service_updated', actor, `${exists ? 'Updated' : 'Created'} location ${location.name}.`),
              ...current.activityLog,
            ],
          }))
        },
        createFreshService: (input, actor, options) => {
          const current = get()
          const targetLocation = current.locations.find((entry) => entry.id === input.locationId)
          const nextService: ServiceConfig = {
            ...current.service,
            ...input,
            id: input.id ?? randomId('service'),
            locationName: targetLocation?.name ?? input.locationName ?? current.service.locationName,
            locationId: input.locationId ?? current.service.locationId,
            date: input.date ?? new Date().toISOString().slice(0, 10),
            status: input.status ?? 'draft',
            acceptPublicOrders: input.acceptPublicOrders ?? true,
            publicOrderClosureReason: input.publicOrderClosureReason ?? null,
            delayMinutes: 0,
            pausedUntil: null,
            pauseReason: null,
          }

          commit(() => ({
            ...createDemoState(),
            service: nextService,
            services: [nextService, ...current.services.filter((entry) => entry.id !== nextService.id)],
            serviceLocations: current.serviceLocations,
            inventory:
              options?.applyInventoryDefaults === false
                ? current.inventoryDefaults.map((entry) => ({ ...entry, quantity: 0 }))
                : current.inventoryDefaults.map((entry) => ({ ...entry })),
            inventoryDefaults: current.inventoryDefaults.map((entry) => ({ ...entry })),
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
            return false
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
            inventory: current.inventoryDefaults.map((entry) => ({ ...entry })),
            orders: serviceId === current.service.id ? current.orders : [],
            customers: serviceId === current.service.id ? current.customers : [],
            payments: serviceId === current.service.id ? current.payments : [],
            loyverseQueue: serviceId === current.service.id ? current.loyverseQueue : [],
            history: serviceId === current.service.id ? current.history : [],
            activityLog: serviceId === current.service.id ? current.activityLog : [],
          }))
          return true
        },
        duplicateService: (serviceId, actor) => {
          const state = get()
          const source = state.services.find((entry) => entry.id === serviceId)
          if (!source) {
            return null
          }

          const duplicateId = randomId('service')
          const duplicate = {
            ...source,
            id: duplicateId,
            name: `${source.name} Copy`,
            status: 'draft' as const,
            acceptPublicOrders: false,
            publicOrderClosureReason: 'Review before opening',
          }

          commit((current) => ({
            services: [duplicate, ...current.services],
            activityLog: [
              createActivity('service_updated', actor, `Duplicated service ${source.name}.`),
              ...current.activityLog,
            ],
          }))
          return duplicateId
        },
        archiveService: (serviceId, actor) => {
          commit((current) => ({
            services: current.services.map((entry) =>
              entry.id === serviceId ? { ...entry, status: 'closed', acceptPublicOrders: false } : entry,
            ),
            activityLog: [
              createActivity('service_updated', actor, `Archived service ${serviceId}.`),
              ...current.activityLog,
            ],
          }))
        },
        setInventoryQuantity: (ingredientId, quantity, actor) => {
          const safeQuantity = Math.max(0, quantity)
          commit((current) => ({
            inventory: current.inventory.map((entry) =>
              entry.ingredientId === ingredientId ? { ...entry, quantity: safeQuantity } : entry,
            ),
            activityLog: [
              createActivity('inventory_adjusted', actor, `Inventory ${ingredientId} set to ${safeQuantity}.`),
              ...current.activityLog,
            ],
          }))
        },
        adjustInventoryQuantity: (ingredientId, delta, actor) => {
          const currentEntry = get().inventory.find((entry) => entry.ingredientId === ingredientId)
          const nextQuantity = Math.max(0, (currentEntry?.quantity ?? 0) + delta)
          get().setInventoryQuantity(ingredientId, nextQuantity, actor)
        },
        setInventoryDefaultQuantity: (ingredientId, quantity, actor) => {
          const safeQuantity = Math.max(0, quantity)
          commit((current) => ({
            inventoryDefaults: current.inventoryDefaults.map((entry) =>
              entry.ingredientId === ingredientId ? { ...entry, quantity: safeQuantity } : entry,
            ),
            activityLog: [
              createActivity('inventory_adjusted', actor, `Default inventory ${ingredientId} set to ${safeQuantity}.`),
              ...current.activityLog,
            ],
          }))
        },
        applyInventoryDefaults: (actor) => {
          commit((current) => ({
            inventory: current.inventoryDefaults.map((entry) => ({ ...entry })),
            activityLog: [
              createActivity('inventory_adjusted', actor, 'Default inventory applied to current service.'),
              ...current.activityLog,
            ],
          }))
        },
        upsertMenuItem: (menuItem, recipeRows, actor) => {
          const exists = get().menuItems.some((entry) => entry.id === menuItem.id)
          commit((current) => ({
            menuItems: exists
              ? current.menuItems.map((entry) => (entry.id === menuItem.id ? menuItem : entry))
              : [...current.menuItems, menuItem],
            recipes: [
              ...current.recipes.filter((entry) => entry.menuItemId !== menuItem.id),
              ...recipeRows.filter((entry) => entry.quantity > 0),
            ],
            activityLog: [
              createActivity('service_updated', actor, `${exists ? 'Updated' : 'Added'} menu item ${menuItem.name}.`),
              ...current.activityLog,
            ],
          }))
        },
        upsertModifier: (modifier, actor) => {
          const exists = get().modifiers.some((entry) => entry.id === modifier.id)
          commit((current) => ({
            modifiers: exists
              ? current.modifiers.map((entry) => (entry.id === modifier.id ? modifier : entry))
              : [...current.modifiers, modifier],
            activityLog: [
              createActivity('modifier_updated', actor, `${exists ? 'Updated' : 'Created'} modifier ${modifier.name}.`),
              ...current.activityLog,
            ],
          }))
        },
        deleteModifier: (modifierId, actor) => {
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
          return { ok: true }
        },
        getActivePagerNumbers: () =>
          get()
            .orders.filter((entry) => entry.status !== 'completed' && entry.pagerNumber)
            .map((entry) => entry.pagerNumber as number),
        resetDemo: () => {
          commit(() => ({ ...createDemoState() }))
        },
      }
    },
    {
      name: 'pizza-ops-mvp',
      partialize: (state) => ({
        service: state.service,
        services: state.services,
        locations: state.locations,
        serviceLocations: state.serviceLocations,
        ingredients: state.ingredients,
        menuItems: state.menuItems,
        recipes: state.recipes,
        inventory: state.inventory,
        inventoryDefaults: state.inventoryDefaults,
        modifiers: state.modifiers,
        customers: state.customers,
        orders: state.orders,
        history: state.history,
        payments: state.payments,
        loyverseQueue: state.loyverseQueue,
        activityLog: state.activityLog,
      }),
    },
  ),
)
