import type { SupabaseClient } from '@supabase/supabase-js'

export type PaymentTerminalRow = {
  id: string
  provider: string
  reader_id: string
  reader_name: string
  location_id: string | null
  is_active: boolean
  provider_status: string | null
  paired_at: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  locations?: { name?: string | null } | { name?: string | null }[] | null
}

export function mapPaymentTerminalAdminDto(row: PaymentTerminalRow) {
  const location =
    Array.isArray(row.locations)
      ? row.locations[0] ?? null
      : row.locations ?? null

  return {
    id: row.id,
    provider: row.provider,
    readerId: row.reader_id,
    readerName: row.reader_name,
    locationId: row.location_id,
    locationName: location?.name ?? null,
    isActive: row.is_active,
    providerStatus: row.provider_status ?? 'unknown',
    pairedAt: row.paired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ?? {},
  }
}

export async function listPaymentTerminals(
  supabase: SupabaseClient,
  options?: { locationId?: string | null },
) {
  let query = supabase
    .from('payment_terminals')
    .select(
      'id, provider, reader_id, reader_name, location_id, is_active, provider_status, paired_at, metadata, created_at, updated_at, locations(name)',
    )
    .order('paired_at', { ascending: false })

  if (options?.locationId) {
    query = query.eq('location_id', options.locationId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Payment terminal load failed. ${error.message}`)
  }

  return ((data ?? []) as PaymentTerminalRow[]).map(mapPaymentTerminalAdminDto)
}

export async function resolveAssignedReaderId(
  supabase: SupabaseClient,
  locationId: string | null | undefined,
  provider = 'sumup',
) {
  if (!locationId) {
    return null
  }

  const { data, error } = await supabase
    .from('payment_terminals')
    .select('reader_id')
    .eq('provider', provider)
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Assigned reader lookup failed. ${error.message}`)
  }

  return (data as { reader_id?: string | null } | null)?.reader_id ?? null
}
