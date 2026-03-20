import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { AlarmClockCheck, CircleDollarSign, TimerReset } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { isUuidValue } from '../lib/service-data'
import { generateServiceSlots, getAvailableSlots, getInventorySummary } from '../lib/slot-engine'
import { formatDateTime, formatTime } from '../lib/time'
import { titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'

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

export function ServiceEditPanel() {
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations).filter((entry) => isUuidValue(entry.id))
  const orders = usePizzaOpsStore((state) => state.orders)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const inventory = usePizzaOpsStore((state) => state.inventory)
  const inventoryDefaults = usePizzaOpsStore((state) => state.inventoryDefaults)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const payments = usePizzaOpsStore((state) => state.payments)
  const activityLog = usePizzaOpsStore((state) => state.activityLog)
  const addDelay = usePizzaOpsStore((state) => state.addDelay)
  const pauseService = usePizzaOpsStore((state) => state.pauseService)
  const moveOrder = usePizzaOpsStore((state) => state.moveOrder)
  const retryLoyverseSync = usePizzaOpsStore((state) => state.retryLoyverseSync)
  const resetDemo = usePizzaOpsStore((state) => state.resetDemo)
  const updateService = usePizzaOpsStore((state) => state.updateService)
  const updateOrderStatus = usePizzaOpsStore((state) => state.updateOrderStatus)
  const setInventoryQuantity = usePizzaOpsStore((state) => state.setInventoryQuantity)
  const adjustInventoryQuantity = usePizzaOpsStore((state) => state.adjustInventoryQuantity)
  const applyInventoryDefaults = usePizzaOpsStore((state) => state.applyInventoryDefaults)
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serviceForm, setServiceForm] = useState({
    name: service.name,
    locationId: isUuidValue(service.locationId) ? service.locationId : '',
    date: service.date,
    status: service.status,
    acceptPublicOrders: service.acceptPublicOrders,
    publicOrderClosureReason: service.publicOrderClosureReason ?? '',
    startTime: service.startTime,
    endTime: service.endTime,
    lastCollectionTime: service.lastCollectionTime,
    slotSizeMinutes: service.slotSizeMinutes,
    pizzasPerSlot: service.pizzasPerSlot,
  })

  const inventorySummary = useMemo(() => getInventorySummary(inventory, recipes, menuItems, orders), [inventory, menuItems, orders, recipes])
  const sortedOrders = useMemo(
    () => [...orders].sort((left, right) => new Date(left.promisedTime).getTime() - new Date(right.promisedTime).getTime()),
    [orders],
  )
  const location = useMemo(() => locations.find((entry) => entry.id === service.locationId), [locations, service.locationId])
  const moveTarget = useMemo(() => orders.find((entry) => entry.id === moveOrderId), [moveOrderId, orders])
  const availableMoveSlots = useMemo(() => {
    if (!moveTarget) return []
    return getAvailableSlots(service, orders.filter((entry) => entry.id !== moveTarget.id), moveTarget.items, menuItems)
  }, [menuItems, moveTarget, orders, service])
  const fallbackMoveSlots = useMemo(() => generateServiceSlots(service), [service])
  const isEditableOrder = (order: (typeof orders)[number]) => order.status === 'taken'

  useEffect(() => {
    setServiceForm({
      name: service.name,
      locationId: isUuidValue(service.locationId) ? service.locationId : '',
      date: service.date,
      status: service.status,
      acceptPublicOrders: service.acceptPublicOrders,
      publicOrderClosureReason: service.publicOrderClosureReason ?? '',
      startTime: service.startTime,
      endTime: service.endTime,
      lastCollectionTime: service.lastCollectionTime,
      slotSizeMinutes: service.slotSizeMinutes,
      pizzasPerSlot: service.pizzasPerSlot,
    })
  }, [service])

  useEffect(() => {
    if (serviceForm.locationId || !locations.length) {
      return
    }

    setServiceForm((current) => ({
      ...current,
      locationId: locations[0].id,
    }))
  }, [locations, serviceForm.locationId])

  useEffect(() => {
    if (!orders.length) {
      setMoveOrderId('')
      setPagerOrderId('')
      return
    }
    if (!orders.some((entry) => entry.id === moveOrderId)) {
      setMoveOrderId(orders[0].id)
      setMoveTime(orders[0].promisedTime)
    }
    if (!orders.some((entry) => entry.id === pagerOrderId)) {
      setPagerOrderId(orders[0].id)
    }
  }, [moveOrderId, orders, pagerOrderId])

  function handleMove(override: boolean) {
    const result = moveOrder(moveOrderId, moveTime, moveReason || 'Manual move', override)
    setMoveWarning(result.warning ?? (result.ok ? 'Order moved.' : 'Unable to move order.'))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <StatPanel icon={AlarmClockCheck} title="Service Window" value={`${service.startTime}-${service.endTime}`} detail={`${location?.name ?? service.locationName} - Last slot ${service.lastCollectionTime}`} />
          <StatPanel icon={TimerReset} title="Delay" value={`${service.delayMinutes} mins`} detail={service.pausedUntil ? `Paused until ${formatTime(service.pausedUntil)}` : titleCase(service.status)} />
          <StatPanel icon={CircleDollarSign} title="Payments" value={`${payments.filter((entry) => entry.status === 'paid').length} paid`} detail={`${payments.filter((entry) => entry.status === 'failed').length} failed`} />
        </div>

        {location ? (
          <Card className="p-4 sm:p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Selected location</p>
            <h2 className="mt-2 font-display text-2xl font-bold">{location.name}</h2>
            <p className="mt-2 text-sm text-slate-500">{location.addressLine1}</p>
            {location.addressLine2 ? <p className="text-sm text-slate-500">{location.addressLine2}</p> : null}
            <p className="text-sm text-slate-500">{location.townCity} {location.postcode}</p>
            {location.notes ? <p className="mt-2 text-sm text-slate-500">{location.notes}</p> : null}
          </Card>
        ) : null}

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Service details</h2>
          <p className="mt-2 text-sm text-slate-500">Update the dated service session and public ordering controls.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Service name</span><Input value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Location</span><select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={serviceForm.locationId} onChange={(event) => setServiceForm((current) => ({ ...current, locationId: event.target.value }))}>{locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Service date</span><Input type="date" value={serviceForm.date} onChange={(event) => setServiceForm((current) => ({ ...current, date: event.target.value }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Service status</span><select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={serviceForm.status} onChange={(event) => setServiceForm((current) => ({ ...current, status: event.target.value as typeof service.status }))}>{['draft', 'live', 'paused', 'cancelled'].map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Start time</span><Input type="time" value={serviceForm.startTime} onChange={(event) => setServiceForm((current) => ({ ...current, startTime: event.target.value }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">End time</span><Input type="time" value={serviceForm.endTime} onChange={(event) => setServiceForm((current) => ({ ...current, endTime: event.target.value }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Last collection slot</span><Input type="time" value={serviceForm.lastCollectionTime} onChange={(event) => setServiceForm((current) => ({ ...current, lastCollectionTime: event.target.value }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Slot length</span><Input type="number" value={serviceForm.slotSizeMinutes} onChange={(event) => setServiceForm((current) => ({ ...current, slotSizeMinutes: Number(event.target.value) }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Pizzas per slot</span><Input type="number" value={serviceForm.pizzasPerSlot} onChange={(event) => setServiceForm((current) => ({ ...current, pizzasPerSlot: Number(event.target.value) }))} /></label>
            <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Public ordering</span><select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={serviceForm.acceptPublicOrders ? 'open' : 'closed'} onChange={(event) => setServiceForm((current) => ({ ...current, acceptPublicOrders: event.target.value === 'open' }))}><option value="open">Open</option><option value="closed">Closed</option></select></label>
            <label className="grid gap-2 text-sm sm:col-span-2"><span className="font-semibold text-slate-600">Public order closure reason</span><Textarea value={serviceForm.publicOrderClosureReason} placeholder="Shown on the customer ordering page when public orders are closed" onChange={(event) => setServiceForm((current) => ({ ...current, publicOrderClosureReason: event.target.value }))} /></label>
          </div>
          <Button className="mt-4" onClick={() => {
            setSaveError(null)
            void updateService({ ...serviceForm, locationName: locations.find((entry) => entry.id === serviceForm.locationId)?.name ?? service.locationName, publicOrderClosureReason: serviceForm.acceptPublicOrders ? null : serviceForm.publicOrderClosureReason || 'Public ordering temporarily closed' }, 'manager').catch((error) => {
              setSaveError(error instanceof Error ? error.message : 'Service save failed.')
            })
          }}>Save service changes</Button>
          {saveError ? <p className="mt-3 text-sm font-medium text-rose-600">{saveError}</p> : null}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Pause and delay controls</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input type="number" value={delayMinutes} onChange={(event) => setDelayMinutes(Number(event.target.value))} />
            <Button onClick={() => addDelay(delayMinutes, 'manager', reason || 'Operational delay')}>Add delay to future orders</Button>
            <Input type="number" value={pauseMinutes} onChange={(event) => setPauseMinutes(Number(event.target.value))} />
            <Button variant="secondary" onClick={() => pauseService(pauseMinutes, 'manager', reason || 'Service pause')}>Pause service</Button>
            <div className="sm:col-span-2"><Textarea value={reason} placeholder="Reason for delay or pause" onChange={(event) => setReason(event.target.value)} /></div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Inventory management</h2>
          <div className="mt-4 space-y-3">
            {inventorySummary.map((entry) => {
              const ingredient = ingredients.find((item) => item.id === entry.ingredientId)
              return (
                <div key={entry.ingredientId} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold">{ingredient?.name ?? entry.ingredientId}</p>
                      <p className="text-sm text-slate-500">Reserved {entry.committed} - Remaining {entry.remaining}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { void adjustInventoryQuantity(entry.ingredientId, -1, 'manager').catch((error) => setSaveError(error instanceof Error ? error.message : 'Inventory update failed.')) }}>-</Button>
                      <Input className="w-24 text-center" type="number" value={entry.total} onChange={(event) => { void setInventoryQuantity(entry.ingredientId, Number(event.target.value), 'manager').catch((error) => setSaveError(error instanceof Error ? error.message : 'Inventory update failed.')) }} />
                      <Button size="sm" variant="outline" onClick={() => { void adjustInventoryQuantity(entry.ingredientId, 1, 'manager').catch((error) => setSaveError(error instanceof Error ? error.message : 'Inventory update failed.')) }}>+</Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div><h2 className="font-display text-2xl font-bold">Ingredient default stock</h2><p className="mt-1 text-sm text-slate-500">Global defaults live on ingredients and are copied into this service when you apply defaults.</p></div>
            <Button variant="secondary" onClick={() => { void applyInventoryDefaults('manager').catch((error) => setSaveError(error instanceof Error ? error.message : 'Apply defaults failed.')) }}>Apply defaults to service</Button>
          </div>
          <div className="mt-4 space-y-3">
            {inventoryDefaults.map((entry) => {
              const ingredient = ingredients.find((item) => item.id === entry.ingredientId)
              return (
                <div key={entry.ingredientId} className="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
                  <div><p className="font-semibold">{ingredient?.name ?? entry.ingredientId}</p><p className="text-sm text-slate-500">Edit in Ingredients admin to change the default.</p></div>
                  <div className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700">{entry.quantity}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-4">
            <Link to="/admin/ingredients"><Button variant="outline">Open ingredients</Button></Link>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold">Service orders</h2>
              <p className="mt-1 text-sm text-slate-500">Durable orders loaded for this service from Supabase-backed order tables. Orders stay editable only while still taken. Once prep starts, add extras as a new follow-on order.</p>
            </div>
            <Badge variant="blue">{sortedOrders.length} orders</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {sortedOrders.length ? sortedOrders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{order.reference} · {order.customerName}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatTime(order.promisedTime)} · {titleCase(order.status)} · {titleCase(order.source)} · {titleCase(order.paymentMethod.replaceAll('_', ' '))}</p>
                    <p className="mt-1 text-sm text-slate-500">{order.items.map((item) => `${item.quantity}x ${menuItems.find((entry) => entry.id === item.menuItemId)?.name ?? item.menuItemId}`).join(', ')}</p>
                    {order.notes ? <p className="mt-2 text-sm text-slate-500">{order.notes}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={isEditableOrder(order) || order.paymentMethod === 'preorder' ? 'green' : 'slate'}>
                        {isEditableOrder(order) || order.paymentMethod === 'preorder' ? 'Editable now' : 'Locked'}
                      </Badge>
                      {!isEditableOrder(order) ? <Badge variant="amber">Use a new add-on order after prep starts</Badge> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link to={`/ops/${service.id}?customerName=${encodeURIComponent(order.customerName ?? '')}&mobile=${encodeURIComponent(order.customerMobile ?? '')}&email=${encodeURIComponent(order.customerEmail ?? '')}&source=manual&payment=preorder&notes=${encodeURIComponent(`Add-on for ${order.reference}`)}`}>
                      <Button size="sm" variant="outline">{isEditableOrder(order) ? 'Continue in order entry' : 'New add-on order'}</Button>
                    </Link>
                    {order.status !== 'prepping' ? <Button size="sm" variant="secondary" onClick={() => updateOrderStatus(order.id, 'prepping')}>Prep</Button> : null}
                    {order.status !== 'in_oven' ? <Button size="sm" variant="secondary" onClick={() => updateOrderStatus(order.id, 'in_oven')}>Oven</Button> : null}
                    {order.status !== 'ready' ? <Button size="sm" variant="secondary" onClick={() => updateOrderStatus(order.id, 'ready')}>Ready</Button> : null}
                    {order.status !== 'completed' ? <Button size="sm" onClick={() => updateOrderStatus(order.id, 'completed')}>Complete</Button> : null}
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No durable orders loaded for this service.</div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Global menu and modifiers</h2>
          <p className="mt-2 text-sm text-slate-500">Menu, ingredients, and modifiers are managed globally outside this service.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/admin/menu"><Button variant="secondary">Open menu</Button></Link>
            <Link to="/admin/discounts"><Button variant="secondary">Open discounts</Button></Link>
            <Link to="/admin/ingredients"><Button variant="secondary">Open ingredients</Button></Link>
            <Link to="/admin/modifiers"><Button variant="secondary">Open modifiers</Button></Link>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-display text-2xl font-bold">Manual reslot and pager desk</h2>
          <div className="mt-4 grid gap-3">
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={moveOrderId} onChange={(event) => setMoveOrderId(event.target.value)}>{orders.map((order) => <option key={order.id} value={order.id}>{order.reference} - {order.customerId}</option>)}</select>
            <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={moveTime} onChange={(event) => setMoveTime(event.target.value)}>{(availableMoveSlots.length ? availableMoveSlots.map((slot) => slot.promisedTime) : fallbackMoveSlots).map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}</select>
            <Textarea value={moveReason} placeholder="Reason for manual move" onChange={(event) => setMoveReason(event.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => handleMove(false)}>Move order</Button>
              <Button variant="secondary" onClick={() => handleMove(true)}>Move with override</Button>
            </div>
            {moveWarning ? <p className="text-sm text-slate-500">{moveWarning}</p> : null}
            <div className="border-t border-slate-200 pt-3">
              <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3" value={pagerOrderId} onChange={(event) => setPagerOrderId(event.target.value)}>{orders.map((order) => <option key={order.id} value={order.id}>{order.reference} - {order.customerId}</option>)}</select>
              <div className="mt-3 flex gap-2">
                <Input value={pagerValue} placeholder="Pager number" onChange={(event) => setPagerValue(event.target.value)} />
                <Button onClick={() => assignPager(pagerOrderId, pagerValue ? Number(pagerValue) : null, 'manager')}>Assign pager</Button>
              </div>
            </div>
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
                <p className="mt-1 text-sm text-slate-500">Attempts {entry.attempts}{entry.lastError ? ` - ${entry.lastError}` : ''}</p>
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

export function AdminPage() {
  const service = usePizzaOpsStore((state) => state.service)
  const services = usePizzaOpsStore((state) => state.services)
  const orders = usePizzaOpsStore((state) => state.orders)
  const payments = usePizzaOpsStore((state) => state.payments)
  const loyverseQueue = usePizzaOpsStore((state) => state.loyverseQueue)
  const branding = usePizzaOpsStore((state) => state.branding)
  const updateBranding = usePizzaOpsStore((state) => state.updateBranding)
  const syncIssues = loyverseQueue.filter((entry) => entry.status === 'failed').length
  const [brandingForm, setBrandingForm] = useState(branding)

  useEffect(() => {
    setBrandingForm(branding)
  }, [branding])

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Ops Dashboard</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Admin overview</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Use services for dated trading sessions, locations for reusable popups, and menu, ingredients, and modifiers as global configuration.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/admin/services"><Button>Open services</Button></Link>
            <Link to="/admin/locations"><Button variant="secondary">Open locations</Button></Link>
            <Link to="/admin/menu"><Button variant="secondary">Open menu</Button></Link>
            <Link to="/admin/discounts"><Button variant="secondary">Open discounts</Button></Link>
            <Link to="/admin/ingredients"><Button variant="secondary">Open ingredients</Button></Link>
            <Link to="/admin/modifiers"><Button variant="secondary">Open modifiers</Button></Link>
            <Link to={`/admin/services/${service.id}`}><Button variant="outline">Open active service</Button></Link>
          </div>
        </Card>
        <div className="grid gap-4">
          <StatPanel icon={AlarmClockCheck} title="Services" value={`${services.length}`} detail={`${services.filter((entry) => entry.status === 'live').length} live`} />
          <StatPanel icon={CircleDollarSign} title="Orders" value={`${orders.length}`} detail={`${payments.filter((entry) => entry.status === 'paid').length} paid payments`} />
          <StatPanel icon={TimerReset} title="Sync issues" value={`${syncIssues}`} detail="Failed Loyverse queue entries" />
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Customer Ordering Brand</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Logo, intro copy, and colors</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">Control the public ordering CTA text, top intro message, logo area, and public-facing color scheme here.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Logo URL</span><Input value={brandingForm.logoUrl} onChange={(event) => setBrandingForm((current) => ({ ...current, logoUrl: event.target.value }))} /></label>
          <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">CTA button text</span><Input value={brandingForm.orderCtaLabel} onChange={(event) => setBrandingForm((current) => ({ ...current, orderCtaLabel: event.target.value }))} /></label>
          <label className="grid gap-2 text-sm lg:col-span-2"><span className="font-semibold text-slate-600">Intro text</span><Textarea value={brandingForm.introText} onChange={(event) => setBrandingForm((current) => ({ ...current, introText: event.target.value }))} /></label>
          <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Primary color</span><Input value={brandingForm.primaryColor} onChange={(event) => setBrandingForm((current) => ({ ...current, primaryColor: event.target.value }))} /></label>
          <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Secondary background color</span><Input value={brandingForm.secondaryColor} onChange={(event) => setBrandingForm((current) => ({ ...current, secondaryColor: event.target.value }))} /></label>
          <label className="grid gap-2 text-sm"><span className="font-semibold text-slate-600">Accent text color</span><Input value={brandingForm.accentTextColor} onChange={(event) => setBrandingForm((current) => ({ ...current, accentTextColor: event.target.value }))} /></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => updateBranding(brandingForm, 'manager')}>Save public brand</Button>
          <Button variant="outline" onClick={() => setBrandingForm(branding)}>Reset form</Button>
        </div>
      </Card>
    </div>
  )
}
