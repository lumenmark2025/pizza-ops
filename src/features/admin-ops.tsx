import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { AlarmClockCheck, CircleDollarSign, TimerReset } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { getInventorySummary } from '../lib/slot-engine'
import { formatDateTime, formatTime } from '../lib/time'
import { cn, currency, titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Modifier } from '../types/domain'

function StatPanel({ icon: Icon, title, value, detail }: { icon: ComponentType<{ className?: string }>; title: string; value: string; detail: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-orange-100 p-3 text-orange-700"><Icon className="h-5 w-5" /></div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
      </div>
    </Card>
  )
}

export function AdminPage() {
  const service = usePizzaOpsStore((state) => state.service)
  const orders = usePizzaOpsStore((state) => state.orders)
  const customers = usePizzaOpsStore((state) => state.customers)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const payments = usePizzaOpsStore((state) => state.payments)
  const activityLog = usePizzaOpsStore((state) => state.activityLog)
  const addDelay = usePizzaOpsStore((state) => state.addDelay)
  const pauseService = usePizzaOpsStore((state) => state.pauseService)
  const moveOrder = usePizzaOpsStore((state) => state.moveOrder)
  const retryLoyverseSync = usePizzaOpsStore((state) => state.retryLoyverseSync)
  const resetDemo = usePizzaOpsStore((state) => state.resetDemo)
  const updateService = usePizzaOpsStore((state) => state.updateService)
  const createFreshService = usePizzaOpsStore((state) => state.createFreshService)
  const setInventoryQuantity = usePizzaOpsStore((state) => state.setInventoryQuantity)
  const adjustInventoryQuantity = usePizzaOpsStore((state) => state.adjustInventoryQuantity)
  const upsertModifier = usePizzaOpsStore((state) => state.upsertModifier)
  const deleteModifier = usePizzaOpsStore((state) => state.deleteModifier)
  const assignPager = usePizzaOpsStore((state) => state.assignPager)
  const [delayMinutes, setDelayMinutes] = useState(10)
  const [pauseMinutes, setPauseMinutes] = useState(15)
  const [reason, setReason] = useState('')
  const [moveOrderId, setMoveOrderId] = useState(orders[0]?.id ?? '')
  const [moveTime, setMoveTime] = useState(orders[0]?.promisedTime ?? '')
  const [moveReason, setMoveReason] = useState('')
  const [moveWarning, setMoveWarning] = useState<string | null>(null)
  const [pagerOrderId, setPagerOrderId] = useState(orders[0]?.id ?? '')
  const [pagerValue, setPagerValue] = useState('')
  const [serviceForm, setServiceForm] = useState({
    name: service.name,
    date: service.date,
    status: service.status,
    startTime: service.startTime,
    endTime: service.endTime,
    lastCollectionTime: service.lastCollectionTime,
    slotSizeMinutes: service.slotSizeMinutes,
    pizzasPerSlot: service.pizzasPerSlot,
  })
  const [modifierDraft, setModifierDraft] = useState<Modifier>({
    id: '',
    name: '',
    priceDelta: 1,
    menuItemIds: [],
  })
  const inventorySummary = useMemo(() => getInventorySummary(inventory, recipes, menuItems, orders), [inventory, menuItems, orders, recipes])

  useEffect(() => {
    setServiceForm({
      name: service.name,
      date: service.date,
      status: service.status,
      startTime: service.startTime,
      endTime: service.endTime,
      lastCollectionTime: service.lastCollectionTime,
      slotSizeMinutes: service.slotSizeMinutes,
      pizzasPerSlot: service.pizzasPerSlot,
    })
  }, [service])

  function handleMove(override: boolean) {
    const result = moveOrder(moveOrderId, moveTime, moveReason || 'Manual move', override)
    setMoveWarning(result.warning ?? (result.ok ? 'Order moved.' : 'Unable to move order.'))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <StatPanel icon={AlarmClockCheck} title="Service Window" value={`${service.startTime}-${service.endTime}`} detail={`Last slot ${service.lastCollectionTime}`} />
          <StatPanel icon={TimerReset} title="Delay" value={`${service.delayMinutes} mins`} detail={service.pausedUntil ? `Paused until ${formatTime(service.pausedUntil)}` : titleCase(service.status)} />
          <StatPanel icon={CircleDollarSign} title="Payments" value={`${payments.filter((entry) => entry.status === 'paid').length} paid`} detail={`${payments.filter((entry) => entry.status === 'failed').length} failed`} />
        </div>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Service management</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} />
            <Input type="date" value={serviceForm.date} onChange={(event) => setServiceForm((current) => ({ ...current, date: event.target.value }))} />
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={serviceForm.status} onChange={(event) => setServiceForm((current) => ({ ...current, status: event.target.value as typeof service.status }))}>
              {['draft', 'live', 'paused', 'closed'].map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
            </select>
            <Input type="time" value={serviceForm.startTime} onChange={(event) => setServiceForm((current) => ({ ...current, startTime: event.target.value }))} />
            <Input type="time" value={serviceForm.endTime} onChange={(event) => setServiceForm((current) => ({ ...current, endTime: event.target.value }))} />
            <Input type="time" value={serviceForm.lastCollectionTime} onChange={(event) => setServiceForm((current) => ({ ...current, lastCollectionTime: event.target.value }))} />
            <Input type="number" value={serviceForm.slotSizeMinutes} onChange={(event) => setServiceForm((current) => ({ ...current, slotSizeMinutes: Number(event.target.value) }))} />
            <Input type="number" value={serviceForm.pizzasPerSlot} onChange={(event) => setServiceForm((current) => ({ ...current, pizzasPerSlot: Number(event.target.value) }))} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => updateService(serviceForm, 'manager')}>Save service</Button>
            <Button variant="secondary" onClick={() => createFreshService(serviceForm, 'manager')}>Create fresh service</Button>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Pause and delay</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Pause service</p>
              <Input className="mt-3" type="number" value={pauseMinutes} onChange={(event) => setPauseMinutes(Number(event.target.value))} />
              <Textarea className="mt-3" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Button className="mt-3 w-full" variant="warning" onClick={() => pauseService(pauseMinutes, 'manager', reason || 'Operational pause')}>Pause service and shift future orders</Button>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Add delay</p>
              <Input className="mt-3" type="number" value={delayMinutes} onChange={(event) => setDelayMinutes(Number(event.target.value))} />
              <Textarea className="mt-3" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Button className="mt-3 w-full" variant="secondary" onClick={() => addDelay(delayMinutes, 'manager', reason || 'Operational delay')}>Apply delay to future orders</Button>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Manual reslot and pager desk</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3">
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={moveOrderId} onChange={(event) => {
                const nextId = event.target.value
                setMoveOrderId(nextId)
                const match = orders.find((entry) => entry.id === nextId)
                setMoveTime(match?.promisedTime ?? '')
              }}>
                {orders.filter((order) => order.status !== 'completed').map((order) => {
                  const customer = customers.find((entry) => entry.id === order.customerId)
                  return <option key={order.id} value={order.id}>{order.reference} - {customer?.name ?? 'Unknown'}</option>
                })}
              </select>
              <Input value={moveTime} onChange={(event) => setMoveTime(event.target.value)} />
              <Textarea placeholder="Override reason" value={moveReason} onChange={(event) => setMoveReason(event.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => handleMove(false)}>Move with warnings</Button>
                <Button variant="danger" onClick={() => handleMove(true)}>Override move</Button>
              </div>
              {moveWarning ? <p className="text-sm text-slate-600">{moveWarning}</p> : null}
            </div>
            <div className="grid gap-3">
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={pagerOrderId} onChange={(event) => setPagerOrderId(event.target.value)}>
                {orders.filter((order) => order.status !== 'completed').map((order) => (
                  <option key={order.id} value={order.id}>{order.reference}</option>
                ))}
              </select>
              <Input placeholder="Pager number 1-40" value={pagerValue} onChange={(event) => setPagerValue(event.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => assignPager(pagerOrderId, pagerValue ? Number(pagerValue) : null, 'manager')}>Assign pager</Button>
                <Button variant="outline" onClick={() => assignPager(pagerOrderId, null, 'manager')}>Clear pager</Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Inventory management</h2>
            <Badge variant="orange">Reserved / remaining</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {inventorySummary.map((entry) => {
              const ingredient = ingredients.find((item) => item.id === entry.ingredientId)
              if (!ingredient) return null
              return (
                <div key={entry.ingredientId} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{ingredient.name}</p>
                      <p className="text-sm text-slate-500">
                        Reserved {entry.committed} {ingredient.unit} • Remaining {entry.remaining} {ingredient.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => adjustInventoryQuantity(entry.ingredientId, -1, 'manager')}>-</Button>
                      <Input className="w-24 text-center" type="number" value={entry.total} onChange={(event) => setInventoryQuantity(entry.ingredientId, Number(event.target.value), 'manager')} />
                      <Button size="sm" variant="outline" onClick={() => adjustInventoryQuantity(entry.ingredientId, 1, 'manager')}>+</Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Modifiers</h2>
          <div className="mt-4 grid gap-3">
            <Input placeholder="Modifier name" value={modifierDraft.name} onChange={(event) => setModifierDraft((current) => ({ ...current, id: current.id || `mod_${event.target.value.toLowerCase().replace(/\s+/g, '_')}`, name: event.target.value }))} />
            <Input type="number" placeholder="Price delta" value={modifierDraft.priceDelta} onChange={(event) => setModifierDraft((current) => ({ ...current, priceDelta: Number(event.target.value) }))} />
            <div className="flex flex-wrap gap-2">
              {menuItems.map((item) => {
                const active = modifierDraft.menuItemIds.includes(item.id)
                return (
                  <button key={item.id} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', active ? 'border-orange-400 bg-orange-100 text-orange-700' : 'border-slate-300 bg-white text-slate-600')} onClick={() => setModifierDraft((current) => ({
                    ...current,
                    menuItemIds: active ? current.menuItemIds.filter((id) => id !== item.id) : [...current.menuItemIds, item.id],
                  }))}>
                    {item.name}
                  </button>
                )
              })}
            </div>
            <Button onClick={() => {
              upsertModifier(modifierDraft, 'manager')
              setModifierDraft({ id: '', name: '', priceDelta: 1, menuItemIds: [] })
            }}>Save modifier</Button>
          </div>
          <div className="mt-4 space-y-2">
            {modifiers.map((modifier) => (
              <div key={modifier.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-semibold">{modifier.name}</p>
                  <p className="text-sm text-slate-500">+{currency(modifier.priceDelta)} • {modifier.menuItemIds.length} menu items</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setModifierDraft(modifier)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => deleteModifier(modifier.id, 'manager')}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold">Loyverse sync queue</h2>
            <Button size="sm" variant="outline" onClick={resetDemo}>Reset demo</Button>
          </div>
          <div className="mt-4 space-y-3">
            {loyverseQueue.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{entry.orderId}</p>
                  <Badge variant={entry.status === 'failed' ? 'red' : entry.status === 'synced' ? 'green' : 'amber'}>{entry.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">Attempts {entry.attempts} {entry.lastError ? `• ${entry.lastError}` : ''}</p>
                <Button className="mt-3" size="sm" variant="secondary" onClick={() => retryLoyverseSync(entry.id)}>Retry sync</Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Activity log</h2>
          <div className="mt-4 space-y-3">
            {activityLog.slice(0, 12).map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{entry.message}</p>
                  <span className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{entry.actor}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
