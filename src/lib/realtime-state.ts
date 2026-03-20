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
  onChange: (table: 'orders' | 'service_inventory' | 'services') => void,
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
