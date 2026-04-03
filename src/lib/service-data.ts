import { addMinutes } from './time'
import { getSupabaseClientError, supabase, supabaseConfigError } from './supabase'
import type { Ingredient, Location, Order, OrderItem, ServiceConfig, ServiceInventory } from '../types/domain'

type LocationRow = {
  id: string
  name: string
  address_line_1: string
  address_line_2?: string | null
  town_city: string
  postcode: string
  ordering_phone?: string | null
  notes?: string | null
  active?: boolean | null
}

type ServiceRow = {
  id: string
  name: string
  service_date: string
  location_name?: string | null
  location_id?: string | null
  status: ServiceConfig['status']
  accept_public_orders?: boolean | null
  public_order_closure_reason?: string | null
  start_time: string
  end_time: string
  slot_minutes?: number | null
  pizzas_per_slot?: number | null
  pause_until?: string | null
  pause_reason?: string | null
}

type ServiceInventoryRow = {
  id?: string
  service_id: string
  ingredient_id: string
  quantity?: number | null
  starting_quantity?: number | null
  reserved_quantity?: number | null
  used_quantity?: number | null
}

type OrderItemModifierRow = {
  order_item_id?: string
  modifier_name: string
  price_delta_pence?: number | null
  quantity?: number | null
}

type OrderItemRow = {
  id: string
  menu_item_id: string
  item_name: string
  quantity: number
  original_unit_price_pence?: number | null
  item_discount_pence?: number | null
  final_unit_price_pence?: number | null
  progress_count?: number | null
  notes?: string | null
  order_item_modifiers?: OrderItemModifierRow[] | null
}

type OrderRow = {
  id: string
  service_id: string
  order_number: number
  source: Order['source']
  customer_name: string
  customer_mobile?: string | null
  customer_email?: string | null
  auth_user_id?: string | null
  status: Order['status']
  promised_collection_time?: string | null
  subtotal_pence?: number | null
  discount_pence?: number | null
  total_pence?: number | null
  applied_discount_code_id?: string | null
  applied_discount_summary?: Order['appliedDiscountSummary'] | null
  pricing_summary?: Order['pricingSummary'] | null
  payment_status?: Order['paymentStatus'] | null
  payment_method?: Order['paymentMethod'] | null
  payment_reference?: string | null
  receipt_email_status?: Order['receiptEmailStatus'] | null
  receipt_sent_at?: string | null
  receipt_last_error?: string | null
  loyverse_sync_status?: Order['loyaltySyncStatus'] | null
  notes?: string | null
  pager_number?: number | null
  taken_at: string
  prepping_at?: string | null
  in_oven_at?: string | null
  ready_at?: string | null
  completed_at?: string | null
  created_at: string
  order_items?: OrderItemRow[] | null
}

function ensureSupabase(operation: string) {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? getSupabaseClientError(operation))
  }
}

export function isUuidValue(value?: string | null) {
  return typeof value === 'string'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    : false
}

function normalizeName(value?: string | null) {
  return value?.trim().toLowerCase() ?? ''
}

function isMissingColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column: string,
) {
  if (!error) {
    return false
  }

  const message = error.message?.toLowerCase() ?? ''
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    message.includes(`'${column.toLowerCase()}'`) ||
    message.includes(column.toLowerCase())
  )
}

function timeFromIso(value?: string | null) {
  return value ? value.slice(11, 16) : '00:00'
}

function isoFromDateAndTime(date: string, time: string) {
  return `${date}T${time}:00+00:00`
}

function deriveLastCollectionTime(endTimeIso: string, slotMinutes: number) {
  return addMinutes(endTimeIso, -slotMinutes).slice(11, 16)
}

function normalizePaymentMethod(value?: string | null): Order['paymentMethod'] {
  if (value === 'terminal' || value === 'tap_to_pay') {
    return 'sumup_terminal'
  }

  return (value as Order['paymentMethod']) ?? null
}

function normalizeOrderSource(value?: string | null): Order['source'] {
  if (value === 'online') {
    return 'web'
  }

  if (value === 'walkup' || value === 'phone' || value === 'text_message' || value === 'whatsapp' || value === 'messenger' || value === 'manual' || value === 'web') {
    return value
  }

  return 'walkup'
}

export function mapLocationRow(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2 ?? '',
    townCity: row.town_city,
    postcode: row.postcode,
    orderingPhone: row.ordering_phone ?? '',
    notes: row.notes ?? '',
    active: row.active !== false,
  }
}

async function selectLocationsFromSupabase() {
  const primary = await supabase!
    .from('locations')
    .select('id, name, address_line_1, address_line_2, town_city, postcode, ordering_phone, notes, active')
    .order('name', { ascending: true })

  if (!primary.error || !isMissingColumnError(primary.error, 'ordering_phone')) {
    return primary
  }

  return supabase!
    .from('locations')
    .select('id, name, address_line_1, address_line_2, town_city, postcode, notes, active')
    .order('name', { ascending: true })
}

export function mapServiceRow(row: ServiceRow): ServiceConfig {
  const slotSizeMinutes = Number(row.slot_minutes ?? 5)

  return {
    id: row.id,
    name: row.name,
    locationName: row.location_name ?? '',
    locationId: row.location_id ?? '',
    date: row.service_date,
    status: row.status,
    acceptPublicOrders: row.accept_public_orders !== false,
    publicOrderClosureReason: row.public_order_closure_reason ?? null,
    startTime: timeFromIso(row.start_time),
    endTime: timeFromIso(row.end_time),
    lastCollectionTime: deriveLastCollectionTime(row.end_time, slotSizeMinutes),
    slotSizeMinutes,
    pizzasPerSlot: Number(row.pizzas_per_slot ?? 3),
    delayMinutes: 0,
    pausedUntil: row.pause_until ?? null,
    pauseReason: row.pause_reason ?? null,
  }
}

export async function loadLocationsFromSupabase() {
  ensureSupabase('Location load')

  const { data, error } = await selectLocationsFromSupabase()

  if (error) {
    throw new Error(`Location load failed. ${error.message}`)
  }

  return ((data ?? []) as LocationRow[]).map(mapLocationRow)
}

export async function persistLocationToSupabase(location: Partial<Location>) {
  ensureSupabase('Location save')

  const payload = {
    ...(location.id && isUuidValue(location.id) ? { id: location.id } : {}),
    name: location.name?.trim() ?? '',
    address_line_1: location.addressLine1?.trim() ?? '',
    address_line_2: location.addressLine2?.trim() || null,
    town_city: location.townCity?.trim() ?? '',
    postcode: location.postcode?.trim() ?? '',
    ordering_phone: location.orderingPhone?.trim() || null,
    notes: location.notes?.trim() || null,
    active: location.active !== false,
  }

  const primary = await supabase!
    .from('locations')
    .upsert(payload)
    .select('id, name, address_line_1, address_line_2, town_city, postcode, ordering_phone, notes, active')
    .single()

  const fallback =
    primary.error && isMissingColumnError(primary.error, 'ordering_phone')
      ? await supabase!
          .from('locations')
          .upsert({
            ...(location.id && isUuidValue(location.id) ? { id: location.id } : {}),
            name: location.name?.trim() ?? '',
            address_line_1: location.addressLine1?.trim() ?? '',
            address_line_2: location.addressLine2?.trim() || null,
            town_city: location.townCity?.trim() ?? '',
            postcode: location.postcode?.trim() ?? '',
            notes: location.notes?.trim() || null,
            active: location.active !== false,
          })
          .select('id, name, address_line_1, address_line_2, town_city, postcode, notes, active')
          .single()
      : null

  const data = (fallback ?? primary).data
  const error = (fallback ?? primary).error

  if (error || !data) {
    throw new Error(`Location save failed. ${error?.message ?? 'Unknown Supabase error.'}`)
  }

  return mapLocationRow(data as LocationRow)
}

export function resolveLocationReference(
  locations: Location[],
  locationId?: string | null,
  locationName?: string | null,
) {
  const persistedLocations = locations.filter((entry) => isUuidValue(entry.id))
  const exactMatch = persistedLocations.find((entry) => entry.id === locationId)
  if (exactMatch) {
    return { locationId: exactMatch.id, locationName: exactMatch.name }
  }

  const legacyMatch = locations.find((entry) => entry.id === locationId)
  const byName =
    persistedLocations.find((entry) => normalizeName(entry.name) === normalizeName(legacyMatch?.name)) ??
    persistedLocations.find((entry) => normalizeName(entry.name) === normalizeName(locationName))

  if (byName) {
    return { locationId: byName.id, locationName: byName.name }
  }

  if (!locationId && !locationName) {
    return { locationId: '', locationName: '' }
  }

  throw new Error(
    `Service save failed. Selected location is not backed by a persisted Supabase UUID: ${locationId ?? locationName ?? 'unknown location'}`,
  )
}

export async function loadServicesFromSupabase() {
  ensureSupabase('Service load')

  const { data, error } = await supabase!
    .from('services')
    .select('id, name, service_date, location_name, location_id, status, accept_public_orders, public_order_closure_reason, start_time, end_time, slot_minutes, pizzas_per_slot, pause_until, pause_reason')
    .order('service_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    throw new Error(`Service load failed. ${error.message}`)
  }

  return ((data ?? []) as ServiceRow[]).map(mapServiceRow)
}

export async function persistServiceToSupabase(service: Partial<ServiceConfig>) {
  ensureSupabase('Service save')

  if (service.locationId && !isUuidValue(service.locationId)) {
    throw new Error(`Service save failed. Location id must be a UUID, received ${service.locationId}.`)
  }

  const payload = {
    ...(service.id ? { id: service.id } : {}),
    name: service.name?.trim() ?? '',
    service_date: service.date,
    location_name: service.locationName ?? null,
    location_id: service.locationId || null,
    status: service.status ?? 'draft',
    accept_public_orders: service.acceptPublicOrders ?? false,
    public_order_closure_reason: service.acceptPublicOrders ? null : service.publicOrderClosureReason ?? null,
    start_time: isoFromDateAndTime(service.date ?? new Date().toISOString().slice(0, 10), service.startTime ?? '17:00'),
    end_time: isoFromDateAndTime(service.date ?? new Date().toISOString().slice(0, 10), service.endTime ?? '20:00'),
    slot_minutes: Number(service.slotSizeMinutes ?? 5),
    pizzas_per_slot: Number(service.pizzasPerSlot ?? 3),
    pause_until: service.pausedUntil ?? null,
    pause_reason: service.pauseReason ?? null,
  }

  const { data, error } = await supabase!
    .from('services')
    .upsert(payload)
    .select('id, name, service_date, location_name, location_id, status, accept_public_orders, public_order_closure_reason, start_time, end_time, slot_minutes, pizzas_per_slot, pause_until, pause_reason')
    .single()

  if (error || !data) {
    throw new Error(`Service save failed. ${error?.message ?? 'Unknown Supabase error.'}`)
  }

  return mapServiceRow(data as ServiceRow)
}

export async function deleteServiceFromSupabase(serviceId: string) {
  ensureSupabase('Service delete')

  const runtimeDelete = await supabase!
    .from('service_runtime_state')
    .delete()
    .eq('service_id', serviceId)

  if (runtimeDelete.error) {
    throw new Error(`Service delete failed. ${runtimeDelete.error.message}`)
  }

  const slotsDelete = await supabase!
    .from('service_slots')
    .delete()
    .eq('service_id', serviceId)

  if (slotsDelete.error) {
    throw new Error(`Service delete failed. ${slotsDelete.error.message}`)
  }

  const inventoryDelete = await supabase!
    .from('service_inventory')
    .delete()
    .eq('service_id', serviceId)

  if (inventoryDelete.error) {
    throw new Error(`Service delete failed. ${inventoryDelete.error.message}`)
  }

  const ordersDelete = await supabase!
    .from('orders')
    .delete()
    .eq('service_id', serviceId)

  if (ordersDelete.error) {
    throw new Error(`Service delete failed. ${ordersDelete.error.message}`)
  }

  const serviceDelete = await supabase!
    .from('services')
    .delete()
    .eq('id', serviceId)

  if (serviceDelete.error) {
    throw new Error(`Service delete failed. ${serviceDelete.error.message}`)
  }
}

async function selectIngredientsWithDefaults(): Promise<Array<{ id: string; default_stock_amount: number }>> {
  ensureSupabase('Ingredient defaults load')

  const withDefault = await supabase!
    .from('ingredients')
    .select('id, default_stock_amount')

  if (!withDefault.error) {
    return ((withDefault.data ?? []) as Array<{ id: string; default_stock_amount?: number | null }>).map((row) => ({
      id: row.id,
      default_stock_amount: Number(row.default_stock_amount ?? 0),
    }))
  }

  const fallback = await supabase!
    .from('ingredients')
    .select('id')

  if (fallback.error) {
    throw new Error(`Ingredient defaults load failed. ${fallback.error.message}`)
  }

  return (fallback.data ?? []).map((row) => ({ ...row, default_stock_amount: 0 }))
}

export async function seedServiceInventoryFromDefaults(serviceId: string, quantityOverride?: number) {
  ensureSupabase('Service inventory seed')

  const ingredients = await selectIngredientsWithDefaults()

  const rows = ingredients.map((ingredient) => ({
    service_id: serviceId,
    ingredient_id: ingredient.id,
    quantity: quantityOverride ?? Number(ingredient.default_stock_amount ?? 0),
    starting_quantity: quantityOverride ?? Number(ingredient.default_stock_amount ?? 0),
    reserved_quantity: 0,
    used_quantity: 0,
  }))

  if (!rows.length) {
    return
  }

  const primary = await supabase!
    .from('service_inventory')
    .upsert(rows, { onConflict: 'service_id,ingredient_id' })

  if (!primary.error) {
    return
  }

  if (!isMissingColumnError(primary.error, 'quantity')) {
    throw new Error(`Service inventory seed failed. ${primary.error.message}`)
  }

  const fallback = await supabase!
    .from('service_inventory')
    .upsert(
      rows.map((row) => ({
        service_id: row.service_id,
        ingredient_id: row.ingredient_id,
        starting_quantity: row.starting_quantity,
        reserved_quantity: 0,
        used_quantity: 0,
      })),
      { onConflict: 'service_id,ingredient_id' },
    )

  if (fallback.error) {
    throw new Error(`Service inventory seed failed. ${fallback.error.message}`)
  }
}

export async function loadServiceInventoryFromSupabase(
  serviceId: string,
  ingredients: Ingredient[],
) {
  ensureSupabase('Service inventory load')

  const selectRows = async () => {
    const quantityResult = await supabase!
      .from('service_inventory')
      .select('service_id, ingredient_id, quantity, starting_quantity, reserved_quantity, used_quantity')
      .eq('service_id', serviceId)

    const fallbackResult =
      isMissingColumnError(quantityResult.error, 'quantity')
        ? await supabase!
            .from('service_inventory')
            .select('service_id, ingredient_id, starting_quantity, reserved_quantity, used_quantity')
            .eq('service_id', serviceId)
        : null

    return fallbackResult ?? quantityResult
  }

  let result = await selectRows()

  if (result.error) {
    throw new Error(`Service inventory load failed. ${result.error.message}`)
  }

  if (((result.data ?? []) as ServiceInventoryRow[]).length === 0 && ingredients.length) {
    await seedServiceInventoryFromDefaults(serviceId)
    result = await selectRows()

    if (result.error) {
      throw new Error(`Service inventory load failed. ${result.error.message}`)
    }
  }

  const rowMap = new Map(
    ((result.data ?? []) as ServiceInventoryRow[]).map((row) => [
      row.ingredient_id,
      Number(row.quantity ?? row.starting_quantity ?? 0),
    ]),
  )

  return ingredients.map<ServiceInventory>((ingredient) => ({
    ingredientId: ingredient.id,
    quantity: rowMap.get(ingredient.id) ?? 0,
  }))
}

export async function persistServiceInventoryQuantity(
  serviceId: string,
  ingredientId: string,
  quantity: number,
) {
  ensureSupabase('Service inventory save')

  const payload = {
    service_id: serviceId,
    ingredient_id: ingredientId,
    quantity,
    starting_quantity: quantity,
  }

  const primary = await supabase!
    .from('service_inventory')
    .upsert(payload, { onConflict: 'service_id,ingredient_id' })

  if (!primary.error) {
    return
  }

  if (!isMissingColumnError(primary.error, 'quantity')) {
    throw new Error(`Service inventory save failed. ${primary.error.message}`)
  }

  const fallback = await supabase!
    .from('service_inventory')
    .upsert(
      {
        service_id: serviceId,
        ingredient_id: ingredientId,
        starting_quantity: quantity,
      },
      { onConflict: 'service_id,ingredient_id' },
    )

  if (fallback.error) {
    throw new Error(`Service inventory save failed. ${fallback.error.message}`)
  }
}

export async function loadOrdersForService(serviceId: string) {
  ensureSupabase('Service order load')

  const { data, error } = await supabase!
    .from('orders')
    .select('id, service_id, order_number, source, customer_name, customer_mobile, customer_email, auth_user_id, status, promised_collection_time, subtotal_pence, discount_pence, total_pence, applied_discount_code_id, applied_discount_summary, pricing_summary, payment_status, payment_method, payment_reference, receipt_email_status, receipt_sent_at, receipt_last_error, loyverse_sync_status, notes, pager_number, taken_at, prepping_at, in_oven_at, ready_at, completed_at, created_at, order_items(id, menu_item_id, item_name, quantity, original_unit_price_pence, item_discount_pence, final_unit_price_pence, progress_count, notes, order_item_modifiers(order_item_id, modifier_name, price_delta_pence, quantity))')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Service order load failed. ${error.message}`)
  }

  return ((data ?? []) as OrderRow[]).map((row) => {
    const items = (row.order_items ?? []).map<OrderItem>((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      quantity: item.quantity,
      notes: item.notes ?? '',
      progressCount: item.progress_count ?? 0,
      originalUnitPrice: Number(item.original_unit_price_pence ?? 0) / 100 || undefined,
      itemDiscountAmount: Number(item.item_discount_pence ?? 0) / 100 || undefined,
      finalUnitPrice: Number(item.final_unit_price_pence ?? 0) / 100 || undefined,
      modifiers: (item.order_item_modifiers ?? []).map((modifier) => ({
        modifierId: modifier.modifier_name,
        name: modifier.modifier_name,
        priceDelta: Number(modifier.price_delta_pence ?? 0) / 100,
        quantity: modifier.quantity ?? 1,
      })),
    }))

    return {
      id: row.id,
      reference: `PZ-${row.order_number}`,
      customerId: row.id,
      customerName: row.customer_name,
      customerMobile: row.customer_mobile ?? undefined,
      customerEmail: row.customer_email ?? undefined,
      authUserId: row.auth_user_id ?? null,
      source: normalizeOrderSource(row.source),
      status: row.status,
      promisedTime: row.promised_collection_time ?? row.created_at,
      slotAllocations: [],
      notes: row.notes ?? '',
      pizzaCount: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotalAmount: Number(row.subtotal_pence ?? 0) / 100,
      totalDiscountAmount: Number(row.discount_pence ?? 0) / 100,
      orderDiscountAmount: Number(row.discount_pence ?? 0) / 100,
      totalAmount: Number(row.total_pence ?? 0) / 100,
      appliedDiscountCodeId: row.applied_discount_code_id ?? null,
      appliedDiscountSummary: row.applied_discount_summary ?? null,
      pricingSummary: row.pricing_summary ?? undefined,
      paymentStatus: (row.payment_status as Order['paymentStatus']) ?? 'pending',
      paymentMethod: normalizePaymentMethod(row.payment_method),
      paymentReference: row.payment_reference ?? null,
      receiptEmailStatus: row.receipt_email_status ?? 'not_requested',
      receiptSentAt: row.receipt_sent_at ?? null,
      receiptLastError: row.receipt_last_error ?? null,
      loyaltySyncStatus: row.loyverse_sync_status ?? 'pending',
      createdAt: row.created_at,
      pagerNumber: row.pager_number ?? null,
      timestamps: {
        taken_at: row.taken_at,
        prepping_at: row.prepping_at ?? null,
        in_oven_at: row.in_oven_at ?? null,
        ready_at: row.ready_at ?? null,
        completed_at: row.completed_at ?? null,
      },
      items,
    }
  })
}
