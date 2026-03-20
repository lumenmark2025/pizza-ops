import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChefHat,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SmartphoneNfc,
  X,
} from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { isReleasedToOps } from '../lib/order-flow'
import { formatTime } from '../lib/time'
import { cn, currency, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Order, OrderStatus } from '../types/domain'

const statusStyles: Record<
  OrderStatus,
  { badge: 'blue' | 'amber' | 'orange' | 'green' | 'slate'; card: string }
> = {
  taken: { badge: 'blue', card: 'border-sky-200 bg-sky-50/70' },
  prepping: { badge: 'amber', card: 'border-amber-200 bg-amber-50/80' },
  in_oven: { badge: 'orange', card: 'border-orange-200 bg-orange-50/80' },
  ready: { badge: 'green', card: 'border-emerald-200 bg-emerald-50/80' },
  completed: { badge: 'slate', card: 'border-slate-200 bg-slate-100/80' },
}

const KDS_ACTIVE_STATUSES: OrderStatus[] = ['taken', 'prepping', 'in_oven']
const BOARD_STATUSES: Array<'taken' | 'prepping' | 'in_oven' | 'ready'> = [
  'taken',
  'prepping',
  'in_oven',
  'ready',
]
const DOUBLE_TAP_WINDOW_MS = 350
const RECENTLY_CLEARED_LIMIT = 5
const KDS2_FEATURED_ORDER_COUNT = 4
const ticketDensityStyles = {
  compact: {
    outer: 'rounded-lg',
    body: 'px-3 py-2.5',
    headerGap: 'gap-2',
    metaText: 'text-[11px]',
    title: 'text-lg',
    infoGap: 'mt-2',
    helperText: 'mt-2 text-[10px]',
    itemList: 'mt-3 space-y-1.5',
    itemButton: 'rounded-md px-2.5 py-2',
    itemTitle: 'text-sm',
    itemNote: 'mt-0.5 text-[11px]',
    progressPill: 'rounded-md px-2 py-0.5 text-[11px]',
    actionButton: 'mt-3 h-10 rounded-md text-sm',
  },
  comfortable: {
    outer: 'rounded-lg',
    body: 'px-3.5 py-3',
    headerGap: 'gap-2.5',
    metaText: 'text-xs',
    title: 'text-xl',
    infoGap: 'mt-2.5',
    helperText: 'mt-2 text-[10px]',
    itemList: 'mt-3 space-y-2',
    itemButton: 'rounded-md px-3 py-2.5',
    itemTitle: 'text-sm',
    itemNote: 'mt-1 text-[11px]',
    progressPill: 'rounded-md px-2 py-0.5 text-[11px]',
    actionButton: 'mt-3 h-10 rounded-md text-sm',
  },
} as const

function sortOrdersByPromise(orders: Order[]) {
  return [...orders].sort(
    (left, right) =>
      new Date(left.promisedTime).getTime() - new Date(right.promisedTime).getTime(),
  )
}

function getCustomerName(
  order: Order,
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers'],
) {
  return (
    order.customerName ??
    customers.find((entry) => entry.id === order.customerId)?.name ??
    'Unknown'
  )
}

function getNextStatus(status: OrderStatus) {
  if (status === 'taken') return 'prepping'
  if (status === 'prepping') return 'in_oven'
  return 'ready'
}

function getCompactMenuItemName(name: string) {
  const compact = name
    .replace(/\bpizza\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (compact.length <= 16) {
    return compact
  }

  return compact.split(' ').slice(0, 2).join(' ')
}

function getCondensedItemSummary(
  order: Order,
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems'],
) {
  return order.items
    .map((item) => {
      const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
      const name = getCompactMenuItemName(menuItem?.name ?? item.menuItemId)
      return `${item.quantity}x ${name}`
    })
    .join(', ')
}

function getWaitLabel(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime()
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000))
  return `${elapsedMinutes}m waiting`
}

function DisplayShell({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false,
  )

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = async () => {
    if (typeof document === 'undefined') {
      return
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await document.documentElement.requestFullscreen()
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col px-2 py-2 sm:px-3 sm:py-3 lg:px-4">
        <header className="sticky top-0 z-20 rounded-xl border border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              {eyebrow ? (
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-orange-200">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className={cn('font-display text-2xl font-bold tracking-tight sm:text-3xl', eyebrow ? 'mt-1' : '')}>
                {title}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions}
              <Button
                variant="secondary"
                className="h-10 rounded-md bg-white px-3 text-sm text-slate-950 hover:bg-orange-50"
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}
                {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              </Button>
            </div>
          </div>
        </header>
        <div className="mt-3 flex-1">{children}</div>
      </div>
    </div>
  )
}

function TicketCard({
  order,
  customerName,
  menuItems,
  actionLabel,
  onAction,
  onProgressItem,
  showProgress,
  density,
}: {
  order: Order
  customerName: string
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  actionLabel: string
  onAction: () => void
  onProgressItem?: (itemId: string) => void
  showProgress?: boolean
  density: keyof typeof ticketDensityStyles
}) {
  const sizing = ticketDensityStyles[density]

  return (
    <Card
      className={cn(
        'overflow-hidden border-slate-300 bg-white text-slate-950 shadow-none',
        sizing.outer,
      )}
    >
      <div className={cn('h-1.5', order.status === 'taken' && 'bg-sky-500', order.status === 'prepping' && 'bg-amber-500', order.status === 'in_oven' && 'bg-orange-500', order.status === 'ready' && 'bg-emerald-500', order.status === 'completed' && 'bg-slate-500')} />
      <div className={sizing.body}>
      <div className={cn('flex items-start justify-between', sizing.headerGap)}>
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn(sizing.metaText, 'font-semibold uppercase tracking-[0.18em] text-slate-500')}>
              {order.reference}
            </p>
            <p className={cn(sizing.metaText, 'font-semibold uppercase tracking-[0.15em] text-slate-500')}>
              {titleCase(order.source)}
            </p>
          </div>
          <h3 className={cn('mt-1 font-display font-bold leading-tight text-slate-950', sizing.title)}>{customerName}</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={statusStyles[order.status].badge}>{order.status}</Badge>
          {order.pagerNumber ? <Badge variant="slate">Pager {order.pagerNumber}</Badge> : null}
        </div>
      </div>
      <div className={cn(sizing.infoGap, 'flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-600')}>
        <span>{formatTime(order.createdAt)} taken</span>
        <span>/</span>
        <span>{formatTime(order.promisedTime)} promised</span>
      </div>
      {showProgress ? (
        <p className={cn(sizing.helperText, 'font-semibold uppercase tracking-[0.14em] text-slate-500')}>
          Tap to mark prep. Double-tap the same item to undo.
        </p>
      ) : null}
      <div className={sizing.itemList}>
        {order.items.map((item) => {
          const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
          const progressCount = item.progressCount ?? 0
          const isComplete = progressCount >= item.quantity

          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                'w-full border border-slate-200 text-left text-slate-950 transition duration-150',
                sizing.itemButton,
                showProgress
                  ? isComplete
                    ? 'bg-emerald-50 ring-2 ring-emerald-400'
                    : 'bg-white hover:bg-slate-50 active:scale-[0.99]'
                  : 'bg-white',
              )}
              onClick={() => showProgress && onProgressItem?.(item.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={cn(sizing.itemTitle, 'font-semibold leading-tight text-slate-950')}>
                    {item.quantity} x {menuItem?.name}
                  </p>
                  {item.modifiers?.length ? (
                    <p className={cn(sizing.itemNote, 'leading-tight text-slate-500')}>
                      {item.modifiers.map((modifier) => modifier.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                {showProgress ? (
                  <div
                    className={cn(
                      'font-semibold',
                      sizing.progressPill,
                      isComplete
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {progressCount}/{item.quantity}
                  </div>
                ) : null}
              </div>
              {showProgress ? (
                <div className="mt-1.5 h-1.5 rounded-sm bg-slate-200">
                  <div
                    className="h-1.5 rounded-sm bg-emerald-500"
                    style={{
                      width: `${Math.max((progressCount / item.quantity) * 100, 4)}%`,
                    }}
                  />
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
      <Button className={cn('w-full', sizing.actionButton)} onClick={onAction}>
        {actionLabel}
      </Button>
      </div>
    </Card>
  )
}

function RecentlyClearedPanel({
  orders,
  customers,
  selectedOrderId,
  onSelectOrder,
  onRecall,
}: {
  orders: Order[]
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  selectedOrderId?: string | null
  onSelectOrder: (orderId: string) => void
  onRecall: (orderId?: string) => void
}) {
  if (!orders.length) {
    return null
  }

  return (
    <Card className="rounded-lg border-white/10 bg-white/10 p-3 text-white sm:p-3.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200">
            Recall
          </p>
          <h2 className="mt-1 font-display text-xl font-bold">Recently cleared orders</h2>
        </div>
        <Button
          variant="secondary"
          className="h-9 rounded-md bg-white px-3 text-slate-950 hover:bg-orange-50"
          onClick={() => onRecall()}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Recall latest
        </Button>
      </div>
      <div className="mt-3 grid gap-2 xl:grid-cols-2">
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            className={cn(
              'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition',
              selectedOrderId === order.id
                ? 'border-orange-300 bg-white/20'
                : 'border-white/10 bg-white/10 hover:bg-white/15',
            )}
            onClick={() => onSelectOrder(order.id)}
          >
            <div>
              <p className="text-sm font-semibold leading-tight">
                {order.reference} - {getCustomerName(order, customers)}
              </p>
              <p className="text-xs text-slate-300">
                Cleared {formatTime(order.timestamps.completed_at ?? order.createdAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 rounded-md bg-white px-2.5 text-slate-950 hover:bg-orange-50"
              onClick={(event) => {
                event.stopPropagation()
                onRecall(order.id)
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </button>
        ))}
      </div>
    </Card>
  )
}

function HistoryDetailPanel({
  order,
  customers,
  menuItems,
  onRecall,
}: {
  order: Order | null
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  onRecall: (orderId?: string) => void
}) {
  return (
    <Card className="rounded-lg border-white/10 bg-white/10 p-4 text-white shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200">
            History
          </p>
          <h2 className="mt-1 font-display text-xl font-bold">
            {order ? `${order.reference} details` : 'No cleared orders yet'}
          </h2>
        </div>
        {order ? (
          <Button
            variant="secondary"
            className="h-9 rounded-md bg-white px-3 text-slate-950 hover:bg-orange-50"
            onClick={() => onRecall(order.id)}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Recall order
          </Button>
        ) : null}
      </div>
      {order ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-lg font-semibold">{getCustomerName(order, customers)}</p>
            <p className="mt-1 text-sm text-slate-300">
              Completed {formatTime(order.timestamps.completed_at ?? order.createdAt)} · Promised {formatTime(order.promisedTime)}
            </p>
          </div>
          <div className="grid gap-2">
            {order.items.map((item) => {
              const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
              return (
                <div key={item.id} className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                  <p className="font-semibold">{item.quantity} x {menuItem?.name ?? item.menuItemId}</p>
                  {item.modifiers?.length ? (
                    <p className="mt-1 text-xs text-slate-300">{item.modifiers.map((modifier) => modifier.name).join(', ')}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
          {order.notes ? <p className="text-sm text-slate-300">{order.notes}</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-300">
          Cleared tickets stay visible here for review and recall. This panel does not disappear when the active queue is empty.
        </p>
      )}
    </Card>
  )
}

function KdsHistoryDrawer({
  open,
  onClose,
  recentlyClearedOrders,
  selectedOrder,
  selectedOrderId,
  customers,
  menuItems,
  onSelectOrder,
  onRecall,
}: {
  open: boolean
  onClose: () => void
  recentlyClearedOrders: Order[]
  selectedOrder: Order | null
  selectedOrderId?: string | null
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  onSelectOrder: (orderId: string) => void
  onRecall: (orderId?: string) => void
}) {
  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/35 transition-opacity',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md transform flex-col border-l border-white/10 bg-slate-950 shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200">
              Recall
            </p>
            <p className="mt-1 font-display text-xl font-bold text-white">History & recall</p>
          </div>
          <Button
            variant="secondary"
            className="h-11 w-11 rounded-xl p-0"
            onClick={onClose}
            aria-label="Close history drawer"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
          <RecentlyClearedPanel
            orders={recentlyClearedOrders}
            customers={customers}
            selectedOrderId={selectedOrderId}
            onSelectOrder={onSelectOrder}
            onRecall={onRecall}
          />
          <HistoryDetailPanel
            order={selectedOrder}
            customers={customers}
            menuItems={menuItems}
            onRecall={onRecall}
          />
        </div>
      </aside>
    </>
  )
}

function KdsQueuePanel({
  orders,
  customers,
  menuItems,
  open,
  onClose,
}: {
  orders: Order[]
  customers: ReturnType<typeof usePizzaOpsStore.getState>['customers']
  menuItems: ReturnType<typeof usePizzaOpsStore.getState>['menuItems']
  open: boolean
  onClose: () => void
}) {
  return (
    <aside
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 z-30 w-full sm:max-w-sm lg:w-[24vw] lg:max-w-[360px] transform transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="pointer-events-auto flex h-full flex-col border-l border-white/10 bg-slate-900/96 p-3 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200">
              KDS 2 Queue
            </p>
            <h2 className="mt-1 font-display text-xl font-bold">Condensed off-screen orders</h2>
          </div>
          <Button variant="secondary" className="h-9 shrink-0 rounded-md px-3" onClick={onClose}>
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {orders.length ? (
            orders.map((order) => (
              <Card key={order.id} className="overflow-hidden rounded-md border-slate-300 bg-white text-slate-950 shadow-none">
                <div className={cn('h-1.5', order.status === 'taken' && 'bg-sky-500', order.status === 'prepping' && 'bg-amber-500', order.status === 'in_oven' && 'bg-orange-500', order.status === 'ready' && 'bg-emerald-500', order.status === 'completed' && 'bg-slate-500')} />
                <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold leading-tight text-slate-950">
                      {order.reference}
                      {order.pagerNumber ? ` / Pager ${order.pagerNumber}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {getCustomerName(order, customers)}
                    </p>
                  </div>
                  <Badge variant={statusStyles[order.status].badge}>
                    {titleCase(order.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-tight text-slate-700">
                  {getCondensedItemSummary(order, menuItems)}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <span>{getWaitLabel(order.createdAt)}</span>
                  <span>/</span>
                  <span>{formatTime(order.createdAt)} created</span>
                </div>
                </div>
              </Card>
            ))
          ) : (
            <Card className="rounded-md border-white/10 bg-white/10 p-3 text-sm text-slate-300 shadow-none">
              No overflow queue right now.
            </Card>
          )}
        </div>
      </div>
    </aside>
  )
}

function KdsSurface({ variant }: { variant: 'classic' | 'queue' }) {
  const service = usePizzaOpsStore((state) => state.service)
  const isOnline = usePizzaOpsStore((state) => state.isOnline)
  const realtimeStatus = usePizzaOpsStore((state) => state.realtimeStatus)
  const masterDataLoadError = usePizzaOpsStore((state) => state.masterDataLoadError)
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const updateOrderItemProgress = usePizzaOpsStore((state) => state.updateOrderItemProgress)
  const recallCompletedOrder = usePizzaOpsStore((state) => state.recallCompletedOrder)
  const [queueOpen, setQueueOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedHistoryOrderId, setSelectedHistoryOrderId] = useState<string | null>(null)
  const tapTimestampsRef = useRef<Record<string, number>>({})
  const ticketDensity = variant === 'classic' ? 'compact' : 'comfortable'

  const activeOrders = sortOrdersByPromise(
    orders.filter((order) => isReleasedToOps(order) && KDS_ACTIVE_STATUSES.includes(order.status)),
  )
  const readyOrders = sortOrdersByPromise(orders.filter((order) => isReleasedToOps(order) && order.status === 'ready'))
  const recentlyClearedOrders = [...orders]
    .filter((order) => isReleasedToOps(order) && order.status === 'completed')
    .sort(
      (left, right) =>
        new Date(right.timestamps.completed_at ?? right.createdAt).getTime() -
        new Date(left.timestamps.completed_at ?? left.createdAt).getTime(),
    )
    .slice(0, RECENTLY_CLEARED_LIMIT)
  const selectedHistoryOrder =
    recentlyClearedOrders.find((order) => order.id === selectedHistoryOrderId) ??
    recentlyClearedOrders[0] ??
    null
  const featuredOrders =
    variant === 'queue' ? activeOrders.slice(0, KDS2_FEATURED_ORDER_COUNT) : activeOrders
  const queueOrders =
    variant === 'queue'
      ? [...activeOrders.slice(KDS2_FEATURED_ORDER_COUNT), ...readyOrders]
      : []

  const handleProgressTap = (orderId: string, itemId: string) => {
    const tapKey = `${orderId}:${itemId}`
    const now = Date.now()
    const lastTap = tapTimestampsRef.current[tapKey] ?? 0
    const direction = now - lastTap <= DOUBLE_TAP_WINDOW_MS ? 'backward' : 'forward'
    tapTimestampsRef.current[tapKey] = now
    updateOrderItemProgress(orderId, itemId, direction)
  }

  const handleRecall = (orderId?: string) => {
    recallCompletedOrder(orderId)
  }

  useEffect(() => {
    if (!recentlyClearedOrders.length) {
      setSelectedHistoryOrderId(null)
      return
    }

    if (
      !selectedHistoryOrderId ||
      !recentlyClearedOrders.some((order) => order.id === selectedHistoryOrderId)
    ) {
      setSelectedHistoryOrderId(recentlyClearedOrders[0].id)
    }
  }, [recentlyClearedOrders, selectedHistoryOrderId])

  return (
    <DisplayShell
      title={`${service.name} · ${service.locationName}`}
      actions={
        <>
          <Card className="min-w-[10rem] rounded-md border-white/10 bg-white/10 px-4 py-3 text-white shadow-none">
            <div className="flex items-center gap-3">
              <ChefHat className="h-4 w-4 text-orange-200" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Active</p>
                <p className="text-5xl font-bold leading-none">{activeOrders.length}</p>
              </div>
            </div>
          </Card>
          <Card className="rounded-md border-white/10 bg-white/10 px-4 py-3 text-white shadow-none">
            <p className="text-sm font-semibold">{service.date}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-300">
              {isOnline ? 'Online' : 'Offline'} · {realtimeStatus === 'subscribed' ? 'Live sync' : realtimeStatus}
            </p>
          </Card>
          <Button
            variant="secondary"
            className="h-10 rounded-md bg-white px-3 text-sm text-slate-950 hover:bg-orange-50"
            onClick={() =>
              setHistoryOpen((current) => {
                const next = !current
                if (next) {
                  setQueueOpen(false)
                }
                return next
              })
            }
          >
            {historyOpen ? (
              <PanelRightClose className="mr-2 h-4 w-4" />
            ) : (
              <PanelRightOpen className="mr-2 h-4 w-4" />
            )}
            {historyOpen ? 'Hide history' : `History (${recentlyClearedOrders.length})`}
          </Button>
          {variant === 'queue' ? (
            <Button
              variant="secondary"
              className="h-10 rounded-md bg-white px-3 text-sm text-slate-950 hover:bg-orange-50"
              onClick={() =>
                setQueueOpen((current) => {
                  const next = !current
                  if (next) {
                    setHistoryOpen(false)
                  }
                  return next
                })
              }
            >
              {queueOpen ? (
                <PanelRightClose className="mr-2 h-4 w-4" />
              ) : (
                <PanelRightOpen className="mr-2 h-4 w-4" />
              )}
              {queueOpen ? 'Hide queue' : `Show queue (${queueOrders.length})`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="relative min-h-[calc(100svh-10rem)] overflow-hidden">
        {masterDataLoadError ? (
          <Card className="mb-3 rounded-lg border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-none">
            {masterDataLoadError}
          </Card>
        ) : null}
        <div
          className={cn(
            'space-y-3 transition-[padding] duration-300',
            variant === 'queue' && queueOpen ? 'lg:pr-[24vw]' : '',
          )}
        >
          {featuredOrders.length ? (
            <div
              className={cn(
                'grid gap-3',
                variant === 'queue'
                  ? 'md:grid-cols-2 2xl:grid-cols-3'
                  : 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
              )}
            >
              {featuredOrders.map((order) => {
                const nextStatus = getNextStatus(order.status)
                return (
                  <TicketCard
                    key={order.id}
                    order={order}
                    customerName={getCustomerName(order, customers)}
                    menuItems={menuItems}
                    density={ticketDensity}
                    actionLabel={`Move to ${titleCase(nextStatus)}`}
                    onAction={() => updateOrderStatus(order.id, nextStatus)}
                    onProgressItem={(itemId) => handleProgressTap(order.id, itemId)}
                    showProgress
                  />
                )
              })}
            </div>
          ) : (
            <Card className="rounded-lg border-white/10 bg-white/10 p-4 text-center text-base text-slate-200">
              No active kitchen tickets.
            </Card>
          )}
        </div>
        <KdsHistoryDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          recentlyClearedOrders={recentlyClearedOrders}
          selectedOrder={selectedHistoryOrder}
          selectedOrderId={selectedHistoryOrder?.id ?? null}
          customers={customers}
          menuItems={menuItems}
          onSelectOrder={setSelectedHistoryOrderId}
          onRecall={handleRecall}
        />
        {variant === 'queue' ? (
          <KdsQueuePanel
            orders={queueOrders}
            customers={customers}
            menuItems={menuItems}
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
          />
        ) : null}
      </div>
    </DisplayShell>
  )
}

export function KdsPage() {
  return <KdsSurface variant="classic" />
}

export function Kds2Page() {
  return <KdsSurface variant="queue" />
}

export function ExpeditorPage() {
  const masterDataLoadError = usePizzaOpsStore((state) => state.masterDataLoadError)
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const updateOrderContact = usePizzaOpsStore((state) => state.updateOrderContact)
  const sendReceiptForOrder = usePizzaOpsStore((state) => state.sendReceiptForOrder)
  const readyOrders = orders.filter((order) => isReleasedToOps(order) && order.status === 'ready')
  const completedOrders = orders.filter((order) => isReleasedToOps(order) && order.status === 'completed').slice(0, 6)
  const [selectedCompletedOrderId, setSelectedCompletedOrderId] = useState<string | null>(null)
  const [receiptEmail, setReceiptEmail] = useState('')
  const [completedActionMessage, setCompletedActionMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!completedOrders.length) {
      setSelectedCompletedOrderId(null)
      setReceiptEmail('')
      return
    }

    const nextSelected =
      completedOrders.find((order) => order.id === selectedCompletedOrderId) ?? completedOrders[0]

    setSelectedCompletedOrderId(nextSelected.id)
    setReceiptEmail(nextSelected.customerEmail ?? '')
  }, [completedOrders, selectedCompletedOrderId])

  const selectedCompletedOrder =
    completedOrders.find((order) => order.id === selectedCompletedOrderId) ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      {masterDataLoadError ? <Card className="p-4 text-sm font-medium text-rose-600 lg:col-span-2">{masterDataLoadError}</Card> : null}
      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Ready for handoff</h2>
        <div className="mt-4 grid gap-3">
          {readyOrders.map((order) => {
            return (
              <TicketCard
                key={order.id}
                order={order}
                customerName={getCustomerName(order, customers)}
                menuItems={menuItems}
                density="comfortable"
                actionLabel="Mark completed"
                onAction={() => updateOrderStatus(order.id, 'completed')}
              />
            )
          })}
        </div>
      </Card>
      <Card className="p-4 sm:p-5">
        <h2 className="font-display text-2xl font-bold">Recently completed</h2>
        <div className="mt-4 space-y-3">
          {completedOrders.map((order) => {
            return (
              <button
                key={order.id}
                type="button"
                className={cn(
                  'w-full rounded-xl border p-4 text-left',
                  selectedCompletedOrderId === order.id
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-slate-200 bg-slate-50',
                )}
                onClick={() => {
                  setSelectedCompletedOrderId(order.id)
                  setReceiptEmail(order.customerEmail ?? '')
                  setCompletedActionMessage(null)
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{getCustomerName(order, customers)}</p>
                    <p className="text-sm text-slate-500">
                      {order.reference}
                      {order.pagerNumber ? ` / Pager ${order.pagerNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant="slate">
                    {formatTime(order.timestamps.completed_at ?? order.createdAt)}
                  </Badge>
                </div>
              </button>
            )
          })}
          {selectedCompletedOrder ? (
            <Card className="border-slate-200 bg-white p-4 shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Completed order detail
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold">
                    {selectedCompletedOrder.reference}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {getCustomerName(selectedCompletedOrder, customers)} / {formatTime(selectedCompletedOrder.promisedTime)}
                  </p>
                </div>
                <Badge variant="slate">
                  {formatTime(selectedCompletedOrder.timestamps.completed_at ?? selectedCompletedOrder.createdAt)}
                </Badge>
              </div>
              <div className="mt-4 space-y-2">
                {selectedCompletedOrder.items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold">
                      {item.quantity} x {menuItems.find((entry) => entry.id === item.menuItemId)?.name ?? item.menuItemId}
                    </p>
                    {item.modifiers?.length ? (
                      <p className="mt-1 text-xs text-slate-500">{item.modifiers.map((modifier) => modifier.name).join(', ')}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3">
                <Input
                  type="email"
                  value={receiptEmail}
                  placeholder="Receipt email"
                  onChange={(event) => setReceiptEmail(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCompletedActionMessage(null)
                      void updateOrderContact(selectedCompletedOrder.id, {
                        customerEmail: receiptEmail,
                        actor: 'expeditor',
                      }).then((result) => {
                        setCompletedActionMessage(result.ok ? 'Email saved to the order.' : result.error)
                      })
                    }}
                  >
                    Save email
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCompletedActionMessage(null)
                      void updateOrderContact(selectedCompletedOrder.id, {
                        customerEmail: receiptEmail,
                        actor: 'expeditor',
                      }).then((result) => {
                        if (!result.ok) {
                          setCompletedActionMessage(result.error)
                          return
                        }

                        void sendReceiptForOrder(selectedCompletedOrder.id).then((receiptResult) => {
                          setCompletedActionMessage(
                            receiptResult.ok ? 'Receipt sent.' : receiptResult.error,
                          )
                        })
                      })
                    }}
                  >
                    Send receipt
                  </Button>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled>
                      Refund item
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      Refund full order
                    </Button>
                  </div>
                  Refund actions are not connected to a durable payment-provider refund flow yet. No item refund or full refund is written from Expeditor in this build.
                </div>
                {completedActionMessage ? (
                  <p className="text-sm font-medium text-slate-600">{completedActionMessage}</p>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

export function CustomerBoardPage() {
  const service = usePizzaOpsStore((state) => state.service)
  const isOnline = usePizzaOpsStore((state) => state.isOnline)
  const realtimeStatus = usePizzaOpsStore((state) => state.realtimeStatus)
  const masterDataLoadError = usePizzaOpsStore((state) => state.masterDataLoadError)
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const grouped: Record<'taken' | 'prepping' | 'in_oven' | 'ready', Order[]> = {
    taken: sortOrdersByPromise(orders.filter((order) => isReleasedToOps(order) && order.status === 'taken')),
    prepping: sortOrdersByPromise(orders.filter((order) => isReleasedToOps(order) && order.status === 'prepping')),
    in_oven: sortOrdersByPromise(orders.filter((order) => isReleasedToOps(order) && order.status === 'in_oven')),
    ready: sortOrdersByPromise(orders.filter((order) => isReleasedToOps(order) && order.status === 'ready')),
  }

  return (
    <DisplayShell
      title={`${service.name} · Collection Board`}
      actions={
        <Card className="rounded-md border-white/10 bg-white/10 px-4 py-3 text-white shadow-none">
          <p className="text-sm font-semibold">{service.locationName}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-300">
            {service.date} · {isOnline ? 'Online' : 'Offline'} · {realtimeStatus === 'subscribed' ? 'Live sync' : realtimeStatus}
          </p>
        </Card>
      }
    >
      {masterDataLoadError ? (
        <Card className="mb-4 rounded-lg border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-none">
          {masterDataLoadError}
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-4">
        {BOARD_STATUSES.map((status) => (
          <Card key={status} className={cn('min-h-[24rem] p-4 sm:p-5', statusStyles[status].card)}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">{titleCase(status)}</h2>
              <Badge variant={statusStyles[status].badge}>{grouped[status].length}</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {grouped[status].map((order) => (
                <div key={order.id} className="rounded-xl bg-white/90 p-4 shadow-sm">
                  <p className="text-xl font-semibold">{getCustomerName(order, customers)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {order.reference} / {formatTime(order.promisedTime)}
                  </p>
                  {order.pagerNumber ? (
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Pager {order.pagerNumber}
                    </p>
                  ) : null}
                </div>
              ))}
              {!grouped[status].length ? (
                <div className="rounded-xl border border-white/60 bg-white/65 p-4 text-sm text-slate-500">
                  No orders in this stage.
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </DisplayShell>
  )
}

export function PaymentPage() {
  const { paymentId } = useParams()
  const payments = usePizzaOpsStore((state) => state.payments)
  const updatePaymentStatus = usePizzaOpsStore((state) => state.updatePaymentStatus)
  const payment = payments.find((entry) => entry.id === paymentId)
  if (!payment) return <Navigate to="/" replace />

  const statusTone =
    payment.status === 'paid'
      ? 'text-emerald-300'
      : payment.status === 'failed'
        ? 'text-rose-300'
        : 'text-amber-300'
  const statusLabel =
    payment.status === 'paid'
      ? 'Payment success'
      : payment.status === 'failed'
        ? 'Payment failed'
        : 'Payment pending'

  return (
    <Card className="mx-auto max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-orange-100 p-3 text-orange-700">
          <SmartphoneNfc className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-orange-600">
            SumUp online payment
          </p>
          <h2 className="font-display text-3xl font-bold">Checkout scaffold</h2>
        </div>
      </div>
      <p className="mt-4 text-slate-600">
        This route stores the payment record and represents the hand-off point to SumUp
        checkout.
      </p>
      <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Payment reference</p>
        <p className="mt-1 text-2xl font-bold">{payment.providerReference}</p>
        <p className="mt-2 text-slate-300">{currency(payment.amount)}</p>
        <p className={cn('mt-3 text-sm font-semibold uppercase tracking-[0.2em]', statusTone)}>
          {statusLabel}
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="success" onClick={() => updatePaymentStatus(payment.id, 'paid')}>
          Simulate payment success
        </Button>
        <Button variant="danger" onClick={() => updatePaymentStatus(payment.id, 'failed')}>
          Simulate payment failure
        </Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>
          Back to order entry
        </Button>
      </div>
    </Card>
  )
}
