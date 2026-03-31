import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Location } from '../types/domain'

function LocationForm({
  initialValue,
  onSubmit,
  title,
}: {
  initialValue: Location
  onSubmit: (location: Location) => Promise<void> | void
  title: string
}) {
  const [form, setForm] = useState(initialValue)
  const [saveError, setSaveError] = useState<string | null>(null)

  return (
    <Card className="mx-auto max-w-4xl p-5 sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Locations</p>
      <h2 className="mt-2 font-display text-3xl font-bold">{title}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Location name</span>
          <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Active</span>
          <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">
          <span className="font-semibold text-slate-600">Address line 1</span>
          <Input value={form.addressLine1} onChange={(event) => setForm((current) => ({ ...current, addressLine1: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">
          <span className="font-semibold text-slate-600">Address line 2</span>
          <Input value={form.addressLine2 ?? ''} onChange={(event) => setForm((current) => ({ ...current, addressLine2: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Town / city</span>
          <Input value={form.townCity} onChange={(event) => setForm((current) => ({ ...current, townCity: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-semibold text-slate-600">Postcode</span>
          <Input value={form.postcode} onChange={(event) => setForm((current) => ({ ...current, postcode: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">
          <span className="font-semibold text-slate-600">Ordering phone number</span>
          <Input
            value={form.orderingPhone ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, orderingPhone: event.target.value }))}
            placeholder="Phone number shown on the customer ordering screen"
          />
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">
          <span className="font-semibold text-slate-600">Notes</span>
          <Textarea value={form.notes ?? ''} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => {
          setSaveError(null)
          Promise.resolve(onSubmit(form)).catch((error) => {
            setSaveError(error instanceof Error ? error.message : 'Location save failed.')
          })
        }}>Save location</Button>
        <Link to="/admin/locations">
          <Button variant="secondary">Back to locations</Button>
        </Link>
      </div>
      {saveError ? <p className="mt-3 text-sm font-medium text-rose-600">{saveError}</p> : null}
    </Card>
  )
}

export function LocationsListPage() {
  const locations = usePizzaOpsStore((state) => state.locations)
  const services = usePizzaOpsStore((state) => state.services)

  const ordered = useMemo(() => [...locations].sort((left, right) => left.name.localeCompare(right.name)), [locations])

  return (
    <div className="grid gap-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Locations</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Reusable popup locations</h2>
            <p className="mt-2 text-sm text-slate-500">Locations are reusable places. Services are dated instances that point to one of these places.</p>
          </div>
          <Link to="/admin/locations/new">
            <Button>Create location</Button>
          </Link>
        </div>
      </Card>
      <div className="grid gap-3">
        {ordered.map((location) => (
          <Card key={location.id} className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-2xl font-bold">{location.name}</h3>
                  <Badge variant={location.active ? 'green' : 'slate'}>{location.active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-500">{location.addressLine1}</p>
                {location.addressLine2 ? <p className="text-sm text-slate-500">{location.addressLine2}</p> : null}
                <p className="text-sm text-slate-500">{location.townCity} {location.postcode}</p>
                {location.orderingPhone ? <p className="mt-2 text-sm text-slate-500">{location.orderingPhone}</p> : null}
                <p className="mt-2 text-sm text-slate-500">
                  {services.filter((entry) => entry.locationId === location.id).length} linked services
                </p>
              </div>
              <Link to={`/admin/locations/${location.id}`}>
                <Button>Edit location</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function LocationNewPage() {
  const navigate = useNavigate()
  const upsertLocation = usePizzaOpsStore((state) => state.upsertLocation)

  return (
    <LocationForm
      title="Create location"
      initialValue={{
        id: '',
        name: '',
        addressLine1: '',
        addressLine2: '',
        townCity: '',
        postcode: '',
        orderingPhone: '',
        notes: '',
        active: true,
      }}
      onSubmit={async (location) => {
        const savedLocation = await upsertLocation(location, 'manager')
        navigate(`/admin/locations/${savedLocation.id}`)
      }}
    />
  )
}

export function LocationEditPage() {
  const { locationId } = useParams()
  const navigate = useNavigate()
  const locations = usePizzaOpsStore((state) => state.locations)
  const upsertLocation = usePizzaOpsStore((state) => state.upsertLocation)
  const location = locations.find((entry) => entry.id === locationId)

  if (!location) {
    return <Navigate to="/admin/locations" replace />
  }

  return (
    <LocationForm
      title="Edit location"
      initialValue={location}
      onSubmit={async (next) => {
        const savedLocation = await upsertLocation(next, 'manager')
        navigate(`/admin/locations/${savedLocation.id}`)
      }}
    />
  )
}
