import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { AlarmClockCheck, CircleDollarSign, TimerReset } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { createTerminalSumUpCheckout } from '../integrations/sumup'
import { getOrderPaymentLabel, isDeferredPreorder } from '../lib/order-flow'
import { isUuidValue } from '../lib/service-data'
import { generateServiceSlots, getAvailableSlots, getInventorySummary } from '../lib/slot-engine'
import { formatDateTime, formatTime } from '../lib/time'
import { titleCase } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Location } from '../types/domain'

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

type PaymentTerminalAdmin = {
  id: string
  provider: string
  readerId: string
  readerName: string
  locationId: string | null
  locationName: string | null
  isActive: boolean
  providerStatus: string
  pairedAt: string | null
  createdAt: string
  updatedAt: string
  metadata: Record<string, unknown>
}

async function fetchPaymentTerminals(locationId?: string | null) {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''
  const response = await fetch(`/api/admin/payment-terminals${query}`)
  const payload = (await response.json().catch(() => null)) as
    | { terminals?: PaymentTerminalAdmin[]; error?: string }
    | null

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to load payment terminals.')
  }

  return payload?.terminals ?? []
}

function truncateReaderId(readerId: string) {
  return readerId.length <= 14 ? readerId : `${readerId.slice(0, 8)}…${readerId.slice(-4)}`
}

function CardReadersPanel({ locations }: { locations: Location[] }) {
  const [selectedLocationId, setSelectedLocationId] = useState(locations[0]?.id ?? '')
  const [readerName, setReaderName] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [terminals, setTerminals] = useState<PaymentTerminalAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedLocationId && locations[0]?.id) {
      setSelectedLocationId(locations[0].id)
    }
  }, [locations, selectedLocationId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchPaymentTerminals()
      .then((next) => {
        if (!cancelled) {
          setTerminals(next)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Unable to load payment terminals.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function pairReader() {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/payment-terminals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode,
          readerName,
          locationId: selectedLocationId || null,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { terminal?: PaymentTerminalAdmin; error?: string }
        | null

      if (!response.ok || !payload?.terminal) {
        throw new Error(payload?.error ?? 'Unable to pair SumUp reader.')
      }

      setPairingCode('')
      setReaderName('')
      setTerminals((current) => [payload.terminal!, ...current.filter((entry) => entry.id !== payload.terminal!.id)])
      setMessage(`Reader paired and assigned to ${payload.terminal.locationName ?? 'this location'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to pair SumUp reader.')
    } finally {
      setSaving(false)
    }
  }

  async function saveReader(next: PaymentTerminalAdmin) {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/payment-terminals', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: next.id,
          readerName: next.readerName,
          locationId: next.locationId,
          isActive: next.isActive,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { terminal?: PaymentTerminalAdmin; error?: string }
        | null

      if (!response.ok || !payload?.terminal) {
        throw new Error(payload?.error ?? 'Unable to update reader.')
      }

      setTerminals((current) => current.map((entry) => (entry.id === payload.terminal!.id ? payload.terminal! : entry)))
      setMessage(`Reader ${payload.terminal.readerName} updated.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update reader.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Payments</p>
      <h2 className="mt-2 font-display text-3xl font-bold">Card readers</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-500">
        Pair SumUp Solo readers using the one-time Cloud API pairing code, then assign each reader to a reusable location. Services inherit the reader from their location when sending card payments to the terminal.
      </p>
      <div className="mt-5 grid gap-4 rounded-2xl border border-slate-200 p-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Assign to location</span>
          <select
            className="h-11 rounded-xl border border-slate-300 bg-white px-3"
            value={selectedLocationId}
            onChange={(event) => setSelectedLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Reader nickname</span>
          <Input value={readerName} onChange={(event) => setReaderName(event.target.value)} placeholder="Front counter Solo" />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Pairing code</span>
          <Input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} placeholder="ABC123" />
        </label>
        <div className="flex items-end">
          <Button
            disabled={saving || !selectedLocationId || !readerName.trim() || !pairingCode.trim()}
            onClick={() => {
              void pairReader()
            }}
          >
            {saving ? 'Pairing...' : 'Pair reader'}
          </Button>
        </div>
      </div>
      {message ? <p className="mt-3 text-sm font-medium text-slate-600">{message}</p> : null}
      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading paired readers...</div>
        ) : terminals.length ? (
          terminals.map((terminal) => (
            <div key={terminal.id} className="grid gap-3 rounded-2xl border border-slate-200 p-4 lg:grid-cols-[1.2fr_1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{terminal.readerName}</p>
                  <Badge variant={terminal.isActive ? 'green' : 'slate'}>{terminal.isActive ? 'Active' : 'Inactive'}</Badge>
                  <Badge variant="blue">{terminal.provider}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">Reader ID {truncateReaderId(terminal.readerId)} · {terminal.providerStatus}</p>
                <p className="mt-1 text-sm text-slate-500">Paired {terminal.pairedAt ? formatDateTime(terminal.pairedAt) : 'Unknown'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-slate-600">Nickname</span>
                  <Input
                    value={terminal.readerName}
                    onChange={(event) =>
                      setTerminals((current) =>
                        current.map((entry) =>
                          entry.id === terminal.id ? { ...entry, readerName: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-slate-600">Assigned location</span>
                  <select
                    className="h-11 rounded-xl border border-slate-300 bg-white px-3"
                    value={terminal.locationId ?? ''}
                    onChange={(event) =>
                      setTerminals((current) =>
                        current.map((entry) =>
                          entry.id === terminal.id
                            ? {
                                ...entry,
                                locationId: event.target.value || null,
                                locationName:
                                  locations.find((location) => location.id === event.target.value)?.name ?? null,
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-2 lg:justify-end">
                <Button
                  variant={terminal.isActive ? 'outline' : 'secondary'}
                  onClick={() => {
                    void saveReader({ ...terminal, isActive: !terminal.isActive })
                  }}
                  disabled={saving}
                >
                  {terminal.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  onClick={() => {
                    void saveReader(terminal)
                  }}
                  disabled={saving}
                >
                  Save
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No paired readers yet. Pair a Solo above to store it in Pizza Ops.</div>
        )}
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
  const collectOrderPayment = usePizzaOpsStore((state) => state.collectOrderPayment)
  const updatePaymentCheckout = usePizzaOpsStore((state) => state.updatePaymentCheckout)

  const [delayMinutes, setDelayMinutes] = useState(10)
  const [pauseMinutes, setPauseMinutes] = useState(15)
  const [reason, setReason] = useState('')
  const [moveOrderId, setMoveOrderId] = useState(orders[0]?.id ?? '')
  const [moveTime, setMoveTime] = useState(orders[0]?.promisedTime ?? '')
  const [moveReason, setMoveReason] = useState('')
  const [moveWarning, setMoveWarning] = useState<string | null>(null)
  const [pagerOrderId, setPagerOrderId] = useState(orders[0]?.id ?? '')
  const [pagerValue, setPagerValue] = useState('')
  const [recalledOrderId, setRecalledOrderId] = useState('')
  const [recalledPagerValue, setRecalledPagerValue] = useState('')
  const [orderActionMessage, setOrderActionMessage] = useState<string | null>(null)
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
  const preorderOrders = useMemo(
    () => sortedOrders.filter((order) => isDeferredPreorder(order)),
    [sortedOrders],
  )
  const recalledOrder = useMemo(
    () => preorderOrders.find((order) => order.id === recalledOrderId) ?? null,
    [preorderOrders, recalledOrderId],
  )

  async function sendOrderToTerminal(orderId: string) {
    const payment = payments.find((entry) => entry.orderId === orderId)

    try {
      if (payment) {
        await updatePaymentCheckout(payment.id, {
          status: 'pending',
        })
      } else {
        const result = await collectOrderPayment(orderId, {
          paymentMethod: 'sumup_terminal',
          actor: 'manager',
        })

        if (!result.ok) {
          return result
        }
      }

      const checkout = await createTerminalSumUpCheckout({ orderId })
      const nextPayment = usePizzaOpsStore.getState().payments.find((entry) => entry.orderId === orderId)
      if (nextPayment) {
        await usePizzaOpsStore.getState().updatePaymentCheckout(nextPayment.id, {
          providerReference: checkout.checkoutId,
          status: 'pending',
        })
      }

      return { ok: true as const }
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'Unable to start terminal payment.',
      }
    }
  }

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

  useEffect(() => {
    if (!preorderOrders.length) {
      setRecalledOrderId('')
      setRecalledPagerValue('')
      return
    }

    if (!preorderOrders.some((order) => order.id === recalledOrderId)) {
      setRecalledOrderId(preorderOrders[0].id)
      setRecalledPagerValue(preorderOrders[0].pagerNumber ? String(preorderOrders[0].pagerNumber) : '')
    }
  }, [preorderOrders, recalledOrderId])

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
              <h2 className="font-display text-2xl font-bold">Preorder recall desk</h2>
              <p className="mt-1 text-sm text-slate-500">Use this to find unpaid preorders, assign a pager if needed, then capture payment and release them into the live kitchen workflow.</p>
            </div>
            <Badge variant="amber">{preorderOrders.length} preorders</Badge>
          </div>
          {preorderOrders.length ? (
            <div className="mt-4 grid gap-3">
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={recalledOrderId} onChange={(event) => {
                const nextOrder = preorderOrders.find((order) => order.id === event.target.value)
                setRecalledOrderId(event.target.value)
                setRecalledPagerValue(nextOrder?.pagerNumber ? String(nextOrder.pagerNumber) : '')
                setOrderActionMessage(null)
              }}>
                {preorderOrders.map((order) => <option key={order.id} value={order.id}>{order.reference} - {order.customerName} - {formatTime(order.promisedTime)}</option>)}
              </select>
              {recalledOrder ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{recalledOrder.reference} · {recalledOrder.customerName}</p>
                      <p className="mt-1 text-sm text-slate-600">{recalledOrder.items.map((item) => `${item.quantity}x ${menuItems.find((entry) => entry.id === item.menuItemId)?.name ?? item.menuItemId}`).join(', ')}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="amber">Preorder</Badge>
                        <Badge variant="slate">Unpaid</Badge>
                        <Badge variant={recalledOrder.pagerNumber ? 'blue' : 'slate'}>
                          {recalledOrder.pagerNumber ? `Pager ${recalledOrder.pagerNumber}` : 'No pager assigned'}
                        </Badge>
                      </div>
                    </div>
                    <Link to={`/ops/${service.id}?customerName=${encodeURIComponent(recalledOrder.customerName ?? '')}&mobile=${encodeURIComponent(recalledOrder.customerMobile ?? '')}&email=${encodeURIComponent(recalledOrder.customerEmail ?? '')}&source=manual&notes=${encodeURIComponent(`Add-on for ${recalledOrder.reference}`)}`}>
                      <Button size="sm" variant="outline">Open add-on order</Button>
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <Input value={recalledPagerValue} placeholder="Pager number (optional)" onChange={(event) => setRecalledPagerValue(event.target.value)} />
                    <Button variant="outline" onClick={() => {
                      setOrderActionMessage(null)
                      void assignPager(recalledOrder.id, recalledPagerValue ? Number(recalledPagerValue) : null, 'manager').then((result) => {
                        setOrderActionMessage(result.ok ? 'Pager saved.' : result.error ?? 'Pager save failed.')
                      })
                    }}>Save pager</Button>
                    <Button variant="secondary" onClick={() => {
                      setOrderActionMessage(null)
                      void collectOrderPayment(recalledOrder.id, { paymentMethod: 'cash', actor: 'manager' }).then((result) => {
                        setOrderActionMessage(result.ok ? 'Preorder paid with cash and released to ops screens.' : result.error)
                      })
                    }}>Take cash</Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => {
                      setOrderActionMessage(null)
                      void sendOrderToTerminal(recalledOrder.id).then((result) => {
                        setOrderActionMessage(result.ok ? 'Waiting for payment on terminal. The preorder stays out of ops screens until webhook confirmation.' : result.error)
                      })
                    }}>Send to card terminal</Button>
                  </div>
                  {orderActionMessage ? <p className="mt-3 text-sm font-medium text-slate-600">{orderActionMessage}</p> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No unpaid preorders for this service.</div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold">Service orders</h2>
              <p className="mt-1 text-sm text-slate-500">Durable orders loaded for this service from Supabase-backed order tables. Unpaid preorders stay out of KDS/customer-board until payment is captured here.</p>
            </div>
            <Badge variant="blue">{sortedOrders.length} orders</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {sortedOrders.length ? sortedOrders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{order.reference} · {order.customerName}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatTime(order.promisedTime)} · {titleCase(order.status)} · {titleCase(order.source)} · {getOrderPaymentLabel(order)}</p>
                    <p className="mt-1 text-sm text-slate-500">{order.items.map((item) => `${item.quantity}x ${menuItems.find((entry) => entry.id === item.menuItemId)?.name ?? item.menuItemId}`).join(', ')}</p>
                    {order.notes ? <p className="mt-2 text-sm text-slate-500">{order.notes}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={isEditableOrder(order) || isDeferredPreorder(order) ? 'green' : 'slate'}>
                        {isEditableOrder(order) || isDeferredPreorder(order) ? 'Editable now' : 'Locked'}
                      </Badge>
                      {isDeferredPreorder(order) ? <Badge variant="amber">Preorder recall available</Badge> : null}
                      {order.paymentStatus !== 'paid' && !isDeferredPreorder(order) ? <Badge variant="amber">Payment pending</Badge> : null}
                      {!isEditableOrder(order) ? <Badge variant="amber">Use a new add-on order after prep starts</Badge> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {order.paymentMethod === 'sumup_terminal' && order.paymentStatus !== 'paid' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSaveError(null)
                          void sendOrderToTerminal(order.id).then((result) => {
                            setSaveError(result.ok ? null : result.error)
                          })
                        }}
                      >
                        {order.paymentStatus === 'failed' ? 'Retry card terminal' : 'Resend to terminal'}
                      </Button>
                    ) : null}
                    {order.paymentStatus !== 'paid' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSaveError(null)
                          void collectOrderPayment(order.id, { paymentMethod: 'cash', actor: 'manager' }).then((result) => {
                            setSaveError(result.ok ? null : result.error)
                          })
                        }}
                      >
                        Take cash
                      </Button>
                    ) : null}
                    <Link to={`/ops/${service.id}?customerName=${encodeURIComponent(order.customerName ?? '')}&mobile=${encodeURIComponent(order.customerMobile ?? '')}&email=${encodeURIComponent(order.customerEmail ?? '')}&source=manual&notes=${encodeURIComponent(`Add-on for ${order.reference}`)}`}>
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
                <Button onClick={() => {
                  void assignPager(pagerOrderId, pagerValue ? Number(pagerValue) : null, 'manager').then((result) => {
                    if (!result.ok) {
                      setSaveError(result.error ?? 'Pager save failed.')
                    } else {
                      setSaveError(null)
                    }
                  })
                }}>Assign pager</Button>
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
  const locations = usePizzaOpsStore((state) => state.locations)
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

      <CardReadersPanel locations={locations.filter((entry) => entry.active)} />
    </div>
  )
}
