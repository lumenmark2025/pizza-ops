import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { isUuidValue } from '../lib/service-data'
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
  onSubmit: (value: Partial<ServiceConfig>, applyDefaults: boolean) => Promise<void> | void
}) {
  const allLocations = usePizzaOpsStore((state) => state.locations)
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const locations = useMemo(
    () => allLocations.filter((entry) => entry.active && isUuidValue(entry.id)),
    [allLocations],
  )
  const [applyDefaults, setApplyDefaults] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: initialValue.name,
    locationId: isUuidValue(initialValue.locationId) ? initialValue.locationId : '',
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
      locationId: isUuidValue(initialValue.locationId) ? initialValue.locationId : '',
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

  useEffect(() => {
    if (form.locationId || !locations.length) {
      return
    }

    setForm((current) => ({
      ...current,
      locationId: locations[0].id,
      name: current.name || locations[0].name,
    }))
  }, [form.locationId, locations])

  const selectedLocation = locations.find((entry) => entry.id === form.locationId)

  return (
    <Card className="mx-auto max-w-5xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Services</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{submitLabel}</h2>
          <p className="mt-2 text-sm text-slate-500">Create or edit a dated service that references one saved popup location.</p>
        </div>
        <Badge variant="blue">{menuItems.length} menu items in current menu</Badge>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Location</span>
          <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={form.locationId} onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value, name: current.name || locations.find((entry) => entry.id === event.target.value)?.name || '' }))}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
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
            {['draft', 'live', 'paused', 'cancelled'].map((status) => (
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
      {selectedLocation ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">{selectedLocation.name}</p>
          <p>{selectedLocation.addressLine1}</p>
          {selectedLocation.addressLine2 ? <p>{selectedLocation.addressLine2}</p> : null}
          <p>{selectedLocation.townCity} {selectedLocation.postcode}</p>
        </div>
      ) : null}
      <div className="mt-5 rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Menu and inventory</p>
        <p className="mt-2 text-sm text-slate-500">This service uses the current menu set. Default inventory can be copied in at creation time.</p>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" checked={applyDefaults} onChange={(event) => setApplyDefaults(event.target.checked)} />
          Apply default inventory to this service
        </label>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => {
          setSubmitError(null)
          Promise.resolve(
            onSubmit({ ...form, publicOrderClosureReason: form.acceptPublicOrders ? null : form.publicOrderClosureReason || 'Public ordering temporarily closed' }, applyDefaults),
          ).catch((error) => {
            setSubmitError(error instanceof Error ? error.message : 'Service save failed.')
          })
        }}>
          Save service
        </Button>
        <Link to="/admin/services">
          <Button variant="secondary">Back to services</Button>
        </Link>
      </div>
      {submitError ? <p className="mt-3 text-sm font-medium text-rose-600">{submitError}</p> : null}
    </Card>
  )
}

export function ServicesListPage() {
  const navigate = useNavigate()
  const services = usePizzaOpsStore((state) => state.services)
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const duplicateService = usePizzaOpsStore((state) => state.duplicateService)
  const archiveService = usePizzaOpsStore((state) => state.archiveService)
  const deleteServicePermanently = usePizzaOpsStore((state) => state.deleteServicePermanently)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const upcomingServices = useMemo(
    () =>
      [...services].sort((left, right) =>
        `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`),
      ),
    [services],
  )
  const deleteTarget = upcomingServices.find((entry) => entry.id === deleteTargetId) ?? null

  return (
    <div className="grid gap-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Services</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Upcoming services</h2>
            <p className="mt-2 text-sm text-slate-500">Each service is a dated trading instance tied to a reusable location.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/locations">
              <Button variant="secondary">Locations</Button>
            </Link>
            <Link to="/admin/services/new">
              <Button>Create service</Button>
            </Link>
          </div>
        </div>
        {actionError ? <p className="mt-4 text-sm font-medium text-rose-600">{actionError}</p> : null}
      </Card>

      <div className="grid gap-3">
        {upcomingServices.map((entry) => {
          const location = locations.find((item) => item.id === entry.locationId)
          return (
            <Card key={entry.id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-2xl font-bold">{entry.name}</h3>
                    <Badge variant={entry.status === 'live' ? 'green' : entry.status === 'cancelled' ? 'slate' : 'amber'}>{entry.status}</Badge>
                    <Badge variant={entry.acceptPublicOrders ? 'blue' : 'red'}>
                      {entry.acceptPublicOrders ? 'Public ordering open' : 'Public ordering closed'}
                    </Badge>
                    {entry.id === service.id ? <Badge variant="orange">Active service</Badge> : null}
                  </div>
                  <p className="text-sm text-slate-500">{location?.name ?? entry.locationName}</p>
                  <p className="text-sm text-slate-500">{entry.date} · {entry.startTime} to {entry.endTime} · Last slot {entry.lastCollectionTime}</p>
                  <p className="text-sm text-slate-500">
                    {location ? `${location.addressLine1}, ${location.townCity} ${location.postcode}` : 'Location details not set'}
                  </p>
                  <p className="text-sm text-slate-500">Menu: current active menu set</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/admin/services/${entry.id}`}>
                    <Button>Edit service</Button>
                  </Link>
                  <Button variant="secondary" onClick={() => {
                    setActionError(null)
                    void duplicateService(entry.id, 'manager')
                      .then((duplicateId) => {
                        if (duplicateId) {
                          navigate(`/admin/services/${duplicateId}`)
                        }
                      })
                      .catch((error) => {
                        setActionError(error instanceof Error ? error.message : 'Duplicate failed.')
                      })
                  }}>
                    Duplicate
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setActionError(null)
                    void archiveService(entry.id, 'manager').catch((error) => {
                      setActionError(error instanceof Error ? error.message : 'Archive failed.')
                    })
                  }}>
                    Cancel/archive
                  </Button>
                  {entry.status === 'cancelled' ? (
                    <Button
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      variant="outline"
                      onClick={() => {
                        setActionError(null)
                        setDeleteTargetId(entry.id)
                      }}
                    >
                      Delete permanently
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      {deleteTarget ? (
        <>
          <div className="fixed inset-0 z-40 bg-slate-950/45" onClick={() => !isDeleting && setDeleteTargetId(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <Card className="w-full max-w-xl rounded-[28px] p-6 shadow-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-600">Destructive cleanup</p>
              <h2 className="mt-2 font-display text-3xl font-bold">Delete service permanently?</h2>
              <p className="mt-3 text-sm text-slate-600">
                This will permanently remove the service and its linked operational data, including orders, inventory, and related records. This cannot be undone.
              </p>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">{deleteTarget.name}</p>
                <p className="mt-1">{deleteTarget.date} · {deleteTarget.startTime} to {deleteTarget.endTime}</p>
                <p className="mt-1">{locations.find((item) => item.id === deleteTarget.locationId)?.name ?? deleteTarget.locationName}</p>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button variant="outline" disabled={isDeleting} onClick={() => setDeleteTargetId(null)}>
                  Cancel
                </Button>
                <Button
                  className="bg-rose-600 text-white hover:bg-rose-500"
                  disabled={isDeleting}
                  onClick={() => {
                    setActionError(null)
                    setIsDeleting(true)
                    void deleteServicePermanently(deleteTarget.id, 'manager')
                      .then(() => {
                        setDeleteTargetId(null)
                      })
                      .catch((error) => {
                        setActionError(error instanceof Error ? error.message : 'Permanent delete failed.')
                      })
                      .finally(() => {
                        setIsDeleting(false)
                      })
                  }}
                >
                  {isDeleting ? 'Deleting…' : 'Delete permanently'}
                </Button>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function ServiceNewPage() {
  const navigate = useNavigate()
  const service = usePizzaOpsStore((state) => state.service)
  const locations = usePizzaOpsStore((state) => state.locations)
  const createFreshService = usePizzaOpsStore((state) => state.createFreshService)

  const initialValue = useMemo<ServiceConfig>(
    () => ({
      ...service,
      id: '',
      name: '',
      locationId: locations[0]?.id ?? service.locationId,
      locationName: locations[0]?.name ?? service.locationName,
      status: 'draft',
      acceptPublicOrders: false,
      publicOrderClosureReason: '',
      startTime: '17:00',
      endTime: '20:00',
      lastCollectionTime: '19:55',
      delayMinutes: 0,
      pausedUntil: null,
      pauseReason: null,
    }),
    [locations, service],
  )

  return (
    <ServiceForm
      initialValue={initialValue}
      submitLabel="Create service"
      onSubmit={async (value, applyDefaults) => {
        const nextId = await createFreshService(value, 'manager', {
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
  const refreshInventoryForService = usePizzaOpsStore((state) => state.refreshInventoryForService)
  const service = usePizzaOpsStore((state) => state.service)
  const services = usePizzaOpsStore((state) => state.services)
  const [loadingService, setLoadingService] = useState(true)

  useEffect(() => {
    if (!serviceId) {
      setLoadingService(false)
      return
    }

    let cancelled = false
    setLoadingService(true)
    loadServiceForEditing(serviceId)
    void refreshInventoryForService(serviceId)
      .catch(() => {
        // Error is already surfaced through store state for the admin panel.
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingService(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [loadServiceForEditing, refreshInventoryForService, serviceId])

  if (!serviceId) {
    return <Navigate to="/admin/services" replace />
  }

  if (loadingService || service.id !== serviceId || !services.some((entry) => entry.id === serviceId)) {
    return (
      <Card className="mx-auto max-w-5xl p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Services</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Loading service</h2>
        <p className="mt-2 text-sm text-slate-500">Fetching the persisted service and inventory from Supabase.</p>
      </Card>
    )
  }

  return <ServiceEditPanel />
}
