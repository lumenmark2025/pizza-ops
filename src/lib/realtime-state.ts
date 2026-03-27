import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, supabaseEnabled } from './supabase'
import type { ServiceSnapshot } from '../types/domain'

const TABLE = 'service_runtime_state'

export function canUseRealtimeSync() {
  return Boolean(supabase && supabaseEnabled)
}

export async function loadRemoteSnapshot(serviceId: string) {
  if (!supabase) {
    return null
  }

  console.info('[pizza-ops] loadRemoteSnapshot', serviceId)

  const { data, error } = await supabase
    .from(TABLE)
    .select('state')
    .eq('service_id', serviceId)
    .maybeSingle()

  if (error) {
    console.error('loadRemoteSnapshot', error)
    return null
  }

  return (data?.state as ServiceSnapshot | undefined) ?? null
}

export async function persistRemoteSnapshot(snapshot: ServiceSnapshot) {
  if (!supabase) {
    return
  }

  console.info('[pizza-ops] persistRemoteSnapshot', snapshot.service.id)

  const { error } = await supabase.from(TABLE).upsert({
    service_id: snapshot.service.id,
    state: snapshot,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    console.error('persistRemoteSnapshot', error)
  }
}

export function subscribeToRemoteSnapshot(
  serviceId: string,
  onSnapshot: (snapshot: ServiceSnapshot) => void,
  onStatus?: (status: string) => void,
) {
  if (!supabase) {
    return null
  }

  console.info('[pizza-ops] startRealtime', serviceId)

  const channel: RealtimeChannel = supabase
    .channel(`service-runtime-${serviceId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABLE,
        filter: `service_id=eq.${serviceId}`,
      },
      (payload) => {
        const state = payload.new && 'state' in payload.new ? payload.new.state : null
        if (state) {
          console.info('[pizza-ops] realtime snapshot apply', serviceId)
          onSnapshot(state as ServiceSnapshot)
        }
      },
    )
    .subscribe((status) => {
      onStatus?.(status)
    })

  return () => {
    if (supabase) {
      void supabase.removeChannel(channel)
    }
  }
}

export function subscribeToServiceOpsTables(
  serviceId: string,
  onChange: (table: 'orders' | 'order_items' | 'order_item_modifiers' | 'service_inventory' | 'services') => void,
  onStatus?: (status: string) => void,
) {
  if (!supabase) {
    return null
  }

  const channel: RealtimeChannel = supabase
    .channel(`service-ops-${serviceId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `service_id=eq.${serviceId}`,
      },
      () => onChange('orders'),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'order_items',
      },
      (payload) => {
        const next = payload.new as { order_id?: string } | null
        const previous = payload.old as { order_id?: string } | null
        if ((next?.order_id ?? previous?.order_id) != null) {
          onChange('order_items')
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'order_item_modifiers',
      },
      () => onChange('order_item_modifiers'),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'service_inventory',
        filter: `service_id=eq.${serviceId}`,
      },
      () => onChange('service_inventory'),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'services',
        filter: `id=eq.${serviceId}`,
      },
      () => onChange('services'),
    )
    .subscribe((status) => {
      onStatus?.(status)
    })

  return () => {
    if (supabase) {
      void supabase.removeChannel(channel)
    }
  }
}

export function subscribeToMasterDataTables(
  onChange: (
    table:
      | 'services'
      | 'locations'
      | 'menu_items'
      | 'menu_item_recipes'
      | 'ingredients'
      | 'modifiers'
      | 'menu_item_modifiers'
      | 'discount_codes',
  ) => void,
  onStatus?: (status: string) => void,
) {
  if (!supabase) {
    return null
  }

  const channel: RealtimeChannel = supabase
    .channel('master-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, () => onChange('services'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => onChange('locations'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => onChange('menu_items'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_item_recipes' }, () => onChange('menu_item_recipes'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, () => onChange('ingredients'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'modifiers' }, () => onChange('modifiers'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_item_modifiers' }, () => onChange('menu_item_modifiers'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'discount_codes' }, () => onChange('discount_codes'))
    .subscribe((status) => {
      onStatus?.(status)
    })

  return () => {
    if (supabase) {
      void supabase.removeChannel(channel)
    }
  }
}
