import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedSnapshot } from '../data/seed'
import { buildLoyversePayload } from '../integrations/loyverse'
import { allocateAcrossSlots, getAvailableSlots } from '../lib/slot-engine'
import { supabase } from '../lib/supabase'
import { addMinutes, combineDateAndTime, formatTime, toIsoNow } from '../lib/time'
import type {
  ActivityLogEntry,
  Customer,
  LoyverseSyncQueueItem,
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
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
}

type StoreState = ServiceSnapshot & {
  isOnline: boolean
  createOrder: (input: CreateOrderInput) => { ok: true; orderId: string; paymentId?: string } | { ok: false; error: string }
  setOnlineStatus: (status: boolean) => void
  updateOrderStatus: (orderId: string, nextStatus: OrderStatus) => void
  moveOrder: (orderId: string, promisedTime: string, reason: string, override: boolean) => { ok: boolean; warning?: string }
  addDelay: (minutes: number, actor: string, reason: string) => void
  pauseService: (minutes: number, actor: string, reason: string) => void
  updatePaymentStatus: (paymentId: string, status: PaymentStatus) => void
  updatePaymentCheckout: (paymentId: string, updates: { providerReference?: string; checkoutUrl?: string; status?: PaymentStatus }) => void
  retryLoyverseSync: (queueId: string) => void
  getAvailableTimes: (items: OrderItem[]) => ReturnType<typeof getAvailableSlots>
  resetDemo: () => void
}

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
      pizzaCount: 2,
      totalAmount: 23,
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
        { id: 'oi_1', menuItemId: 'margherita', quantity: 1 },
        { id: 'oi_2', menuItemId: 'pepperoni', quantity: 1 },
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
      pizzaCount: 2,
      totalAmount: 25,
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
      items: [{ id: 'oi_3', menuItemId: 'pepperoni', quantity: 2 }],
    },
    {
      id: 'order_3',
      reference: 'PZ-103',
      customerId: 'cust_3',
      source: 'phone',
      status: 'ready',
      promisedTime: addMinutes(serviceStart, 20),
      slotAllocations: [{ slotTime: addMinutes(serviceStart, 20), pizzas: 1 }],
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
      items: [{ id: 'oi_4', menuItemId: 'nduja_hot_honey', quantity: 1 }],
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
        amount: 23,
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
        amount: 25,
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
  if (!supabase) {
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
  })
}

export const usePizzaOpsStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...createDemoState(),
      isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      setOnlineStatus: (status) => set({ isOnline: status }),
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
        const totalAmount = input.items.reduce((sum, item) => {
          const menuItem = state.menuItems.find((entry) => entry.id === item.menuItemId)
          return sum + (menuItem?.price ?? 0) * item.quantity
        }, 0)

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
          items: input.items.map((item) => ({ ...item, id: randomId('oi') })),
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

        set({
          customers: [...state.customers, customer],
          orders: [order, ...state.orders],
          payments: [payment, ...state.payments],
          loyverseQueue: [queueItem, ...state.loyverseQueue],
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
            ...state.history,
          ],
          activityLog: [
            createActivity(
              'order_created',
              'order_taker',
              `${order.reference} booked for ${formatTime(order.promisedTime)}.`,
              order.id,
            ),
            ...state.activityLog,
          ],
        })

        void mirrorOrderToSupabase(order)

        return {
          ok: true as const,
          orderId,
          paymentId: input.paymentMethod === 'sumup_online' ? paymentId : undefined,
        }
      },
      updateOrderStatus: (orderId, nextStatus) => {
        const state = get()
        const now = toIsoNow()
        const order = state.orders.find((entry) => entry.id === orderId)
        if (!order || order.status === nextStatus) {
          return
        }

        set({
          orders: state.orders.map((entry) =>
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
            ...state.history,
          ],
          activityLog: [
            createActivity(
              'status_changed',
              'service_team',
              `${order.reference} moved to ${nextStatus}.`,
              orderId,
            ),
            ...state.activityLog,
          ],
        })
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

        set({
          orders: state.orders.map((entry) =>
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
            createActivity(
              'order_moved',
              'manager',
              `${target.reference} moved to ${formatTime(promisedTime)}. ${reason}${override ? ' Override accepted.' : ''}`,
              orderId,
            ),
            ...state.activityLog,
          ],
        })

        return { ok: true, warning: allocation.ok ? undefined : allocation.warning }
      },
      addDelay: (minutes, actor, reason) => {
        const state = get()
        set({
          service: { ...state.service, delayMinutes: state.service.delayMinutes + minutes },
          activityLog: [
            createActivity('delay_added', actor, `Added ${minutes} minute delay. ${reason}`),
            ...state.activityLog,
          ],
        })
      },
      pauseService: (minutes, actor, reason) => {
        const state = get()
        const pausedUntil = addMinutes(toIsoNow(), minutes)
        set({
          service: { ...state.service, pausedUntil, pauseReason: reason },
          activityLog: [
            createActivity(
              'service_paused',
              actor,
              `Paused service until ${formatTime(pausedUntil)}. ${reason}`,
            ),
            ...state.activityLog,
          ],
        })
      },
      updatePaymentStatus: (paymentId, status) => {
        const state = get()
        const payment = state.payments.find((entry) => entry.id === paymentId)
        if (!payment) {
          return
        }

        set({
          payments: state.payments.map((entry) =>
            entry.id === paymentId ? { ...entry, status, updatedAt: toIsoNow() } : entry,
          ),
          orders: state.orders.map((entry) =>
            entry.id === payment.orderId ? { ...entry, paymentStatus: status } : entry,
          ),
          activityLog: [
            createActivity(
              'payment_updated',
              'payments',
              `Payment ${payment.providerReference} updated to ${status}.`,
              payment.orderId,
            ),
            ...state.activityLog,
          ],
        })
      },
      updatePaymentCheckout: (paymentId, updates) => {
        const state = get()
        const payment = state.payments.find((entry) => entry.id === paymentId)
        if (!payment) {
          return
        }

        const nextStatus = updates.status ?? payment.status

        set({
          payments: state.payments.map((entry) =>
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
          orders: state.orders.map((entry) =>
            entry.id === payment.orderId ? { ...entry, paymentStatus: nextStatus } : entry,
          ),
          activityLog: [
            createActivity(
              'payment_updated',
              'payments',
              `Payment ${paymentId} checkout session updated.`,
              payment.orderId,
            ),
            ...state.activityLog,
          ],
        })
      },
      retryLoyverseSync: (queueId) => {
        const state = get()
        const queueItem = state.loyverseQueue.find((entry) => entry.id === queueId)
        if (!queueItem) {
          return
        }
        const now = toIsoNow()
        const isOnline = get().isOnline
        set({
          loyverseQueue: state.loyverseQueue.map((entry) =>
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
            createActivity(
              'loyverse_retry',
              'manager',
              `Retry requested for Loyverse queue ${queueId}.`,
              queueItem.orderId,
            ),
            ...state.activityLog,
          ],
        })
      },
      resetDemo: () => set({ ...createDemoState() }),
    }),
    {
      name: 'pizza-ops-mvp',
      partialize: (state) => ({
        service: state.service,
        ingredients: state.ingredients,
        menuItems: state.menuItems,
        recipes: state.recipes,
        inventory: state.inventory,
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
