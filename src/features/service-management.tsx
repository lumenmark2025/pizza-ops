import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { ServiceEditPanel } from './admin-ops'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import { titleCase } from '../lib/utils'
import type { ServiceConfig } from '../types/domain'

function ServiceForm({
  initialValue,
  submitLabel,
  onSubmit,
}: {
  initialValue: ServiceConfig
  submitLabel: string
  onSubmit: (value: Partial<ServiceConfig>, applyDefaults: boolean) => void
}) {
  const serviceLocations = usePizzaOpsStore((state) => state.serviceLocations)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const [applyDefaults, setApplyDefaults] = useState(true)
  const [form, setForm] = useState({
    name: initialValue.name,
    locationName: initialValue.locationName,
    date: initialValue.date,
    status: initialValue.status,
    acceptPublicOrders: initialValue.acceptPublicOrders,
    publicOrderClosureReason: initialValue.publicOrderClosureReason ?? '',
    startTime: initialValue.startTime,
    endTime: initialValue.endTime,
    lastCollectionTime: initialValue.lastCollectionTime,
    slotSizeMinutes: initialValue.slotSizeMinutes,
    pizzasPerSlot: initialValue.pizzasPerSlot,
  })

  useEffect(() => {
    setForm({
      name: initialValue.name,
      locationName: initialValue.locationName,
      date: initialValue.date,
      status: initialValue.status,
      acceptPublicOrders: initialValue.acceptPublicOrders,
      publicOrderClosureReason: initialValue.publicOrderClosureReason ?? '',
      startTime: initialValue.startTime,
      endTime: initialValue.endTime,
      lastCollectionTime: initialValue.lastCollectionTime,
      slotSizeMinutes: initialValue.slotSizeMinutes,
      pizzasPerSlot: initialValue.pizzasPerSlot,
    })
  }, [initialValue])

  return (
    <Card className="mx-auto max-w-5xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Services</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{submitLabel}</h2>
          <p className="mt-2 text-sm text-slate-500">Create or edit the service details before opening the service for operational control.</p>
        </div>
        <Badge variant="blue">{menuItems.length} menu items available</Badge>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Popup/location preset</span>
          <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={form.locationName} onChange={(event) => setForm((current) => ({ ...current, locationName: event.target.value, name: current.name || event.target.value }))}>
            {serviceLocations.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Service name</span>
          <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Service date</span>
          <Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Service start</span>
          <Input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Service end</span>
          <Input type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Last collection slot</span>
          <Input type="time" value={form.lastCollectionTime} onChange={(event) => setForm((current) => ({ ...current, lastCollectionTime: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Slot length</span>
          <Input type="number" value={form.slotSizeMinutes} onChange={(event) => setForm((current) => ({ ...current, slotSizeMinutes: Number(event.target.value) }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Pizzas per slot</span>
          <Input type="number" value={form.pizzasPerSlot} onChange={(event) => setForm((current) => ({ ...current, pizzasPerSlot: Number(event.target.value) }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Service status</span>
          <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ServiceConfig['status'] }))}>
            {['draft', 'live', 'paused', 'closed'].map((status) => (
              <option key={status} value={status}>
                {titleCase(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Public ordering</span>
          <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={form.acceptPublicOrders ? 'open' : 'closed'} onChange={(event) => setForm((current) => ({ ...current, acceptPublicOrders: event.target.value === 'open' }))}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">
          <span className="font-semibold text-slate-600">Public order closure reason</span>
          <Textarea placeholder="Shown when public ordering is closed" value={form.publicOrderClosureReason} onChange={(event) => setForm((current) => ({ ...current, publicOrderClosureReason: event.target.value }))} />
        </label>
      </div>
      <div className="mt-5 rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Menu and inventory</p>
        <p className="mt-2 text-sm text-slate-500">This service will use the current menu set. Inventory defaults can be copied in at creation time.</p>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" checked={applyDefaults} onChange={(event) => setApplyDefaults(event.target.checked)} />
          Apply default inventory to this service
        </label>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => onSubmit({ ...form, publicOrderClosureReason: form.acceptPublicOrders ? null : form.publicOrderClosureReason || 'Public ordering temporarily closed' }, applyDefaults)}>
          Save service
        </Button>
        <Link to="/admin/services">
          <Button variant="secondary">Back to services</Button>
        </Link>
      </div>
    </Card>
  )
}

export function ServicesListPage() {
  const navigate = useNavigate()
  const services = usePizzaOpsStore((state) => state.services)
  const service = usePizzaOpsStore((state) => state.service)
  const duplicateService = usePizzaOpsStore((state) => state.duplicateService)
  const archiveService = usePizzaOpsStore((state) => state.archiveService)

  const upcomingServices = useMemo(
    () =>
      [...services].sort((left, right) =>
        `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`),
      ),
    [services],
  )

  return (
    <div className="grid gap-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Services</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Upcoming services</h2>
            <p className="mt-2 text-sm text-slate-500">Scan upcoming popups, create a new service, or jump into an operational edit screen.</p>
          </div>
          <Link to="/admin/services/new">
            <Button>Create service</Button>
          </Link>
        </div>
      </Card>

      <div className="grid gap-3">
        {upcomingServices.map((entry) => (
          <Card key={entry.id} className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-2xl font-bold">{entry.name}</h3>
                  <Badge variant={entry.status === 'live' ? 'green' : entry.status === 'closed' ? 'slate' : 'amber'}>{entry.status}</Badge>
                  <Badge variant={entry.acceptPublicOrders ? 'blue' : 'red'}>
                    {entry.acceptPublicOrders ? 'Public ordering open' : 'Public ordering closed'}
                  </Badge>
                  {entry.id === service.id ? <Badge variant="orange">Active service</Badge> : null}
                </div>
                <p className="text-sm text-slate-500">{entry.locationName}</p>
                <p className="text-sm text-slate-500">{entry.date} · {entry.startTime} to {entry.endTime} · Last slot {entry.lastCollectionTime}</p>
                <p className="text-sm text-slate-500">Menu: current active menu set</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/admin/services/${entry.id}`}>
                  <Button>Edit service</Button>
                </Link>
                <Button variant="secondary" onClick={() => {
                  const duplicateId = duplicateService(entry.id, 'manager')
                  if (duplicateId) {
                    navigate(`/admin/services/${duplicateId}`)
                  }
                }}>
                  Duplicate
                </Button>
                <Button variant="outline" onClick={() => archiveService(entry.id, 'manager')}>
                  Cancel/archive
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function ServiceNewPage() {
  const navigate = useNavigate()
  const service = usePizzaOpsStore((state) => state.service)
  const createFreshService = usePizzaOpsStore((state) => state.createFreshService)

  const initialValue = useMemo<ServiceConfig>(
    () => ({
      ...service,
      id: 'new_service',
      name: '',
      status: 'draft',
      acceptPublicOrders: false,
      publicOrderClosureReason: '',
      delayMinutes: 0,
      pausedUntil: null,
      pauseReason: null,
    }),
    [service],
  )

  return (
    <ServiceForm
      initialValue={initialValue}
      submitLabel="Create service"
      onSubmit={(value, applyDefaults) => {
        const nextId = createFreshService(value, 'manager', {
          applyInventoryDefaults: applyDefaults,
        })
        navigate(`/admin/services/${nextId}`)
      }}
    />
  )
}

export function ServiceEditPage() {
  const { serviceId } = useParams()
  const loadServiceForEditing = usePizzaOpsStore((state) => state.loadServiceForEditing)
  const services = usePizzaOpsStore((state) => state.services)

  useEffect(() => {
    if (serviceId) {
      loadServiceForEditing(serviceId)
    }
  }, [loadServiceForEditing, serviceId])

  if (!serviceId || !services.some((entry) => entry.id === serviceId)) {
    return <Navigate to="/admin/services" replace />
  }

  return <ServiceEditPanel />
}
