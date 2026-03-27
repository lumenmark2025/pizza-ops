import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseServerClient } from '../_lib/supabase-server.js'
import { getSumUpConfig, sumupRequest } from '../_lib/sumup.js'
import { listPaymentTerminals, mapPaymentTerminalAdminDto, type PaymentTerminalRow } from '../_lib/payment-terminals.js'

type SumUpReader = {
  id: string
  name: string
  status: string
  metadata?: Record<string, unknown> | null
  device?: {
    identifier?: string | null
    model?: string | null
  } | null
  created_at?: string | null
  updated_at?: string | null
}

async function setSingleActiveReader(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, id: string) {
  const timestamp = new Date().toISOString()
  const { error: clearError } = await supabase
    .from('payment_terminals')
    .update({ is_active: false, updated_at: timestamp })
    .neq('id', id)
    .eq('provider', 'sumup')

  if (clearError) {
    throw new Error(`Unable to clear active readers. ${clearError.message}`)
  }

  const { data, error } = await supabase
    .from('payment_terminals')
    .update({ is_active: true, updated_at: timestamp })
    .eq('id', id)
    .select(
      'id, provider, reader_id, reader_name, location_id, is_active, provider_status, paired_at, metadata, created_at, updated_at, locations(name)',
    )
    .maybeSingle()

  if (error) {
    throw new Error(`Unable to activate reader. ${error.message}`)
  }

  return mapPaymentTerminalAdminDto(data as PaymentTerminalRow)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return res.status(500).json({ error: 'Missing Supabase server environment variables' })
  }

  if (req.method === 'GET') {
    try {
      const terminals = await listPaymentTerminals(supabase)
      return res.status(200).json({ terminals })
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to load payment terminals.',
      })
    }
  }

  if (req.method === 'POST') {
    const { merchantCode } = getSumUpConfig()

    if (!merchantCode) {
      return res.status(500).json({ error: 'Missing SUMUP_MERCHANT_CODE.' })
    }

    try {
      const { pairingCode, readerName } = req.body ?? {}

      if (!pairingCode || typeof pairingCode !== 'string') {
        return res.status(400).json({ error: 'Missing pairingCode.' })
      }

      if (!readerName || typeof readerName !== 'string') {
        return res.status(400).json({ error: 'Missing readerName.' })
      }

      const reader = await sumupRequest<SumUpReader>(`/v0.1/merchants/${merchantCode}/readers`, {
        method: 'POST',
        body: JSON.stringify({
          pairing_code: pairingCode.trim().toUpperCase(),
          name: readerName.trim(),
          metadata: {},
        }),
      })

      const { count: activeReaderCount, error: activeCountError } = await supabase
        .from('payment_terminals')
        .select('id', { count: 'exact', head: true })
        .eq('provider', 'sumup')
        .eq('is_active', true)

      if (activeCountError) {
        return res.status(500).json({ error: `Active reader lookup failed. ${activeCountError.message}` })
      }

      const now = new Date().toISOString()
      const row = {
        provider: 'sumup',
        reader_id: reader.id,
        reader_name: reader.name,
        location_id: null,
        is_active: !activeReaderCount,
        provider_status: reader.status ?? 'paired',
        paired_at: now,
        updated_at: now,
        metadata: {
          ...(reader.metadata ?? {}),
          device_identifier: reader.device?.identifier ?? null,
          device_model: reader.device?.model ?? null,
          sumup_created_at: reader.created_at ?? null,
          sumup_updated_at: reader.updated_at ?? null,
        },
      }

      const { data, error } = await supabase
        .from('payment_terminals')
        .upsert(row, { onConflict: 'reader_id' })
        .select(
          'id, provider, reader_id, reader_name, location_id, is_active, provider_status, paired_at, metadata, created_at, updated_at, locations(name)',
        )
        .maybeSingle()

      if (error) {
        return res.status(500).json({ error: `Reader save failed. ${error.message}` })
      }

      return res.status(200).json({
        terminal: mapPaymentTerminalAdminDto(data as PaymentTerminalRow),
      })
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to pair SumUp reader.',
      })
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, readerName, isActive } = req.body ?? {}

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing id.' })
      }

      if (isActive === true) {
        const terminal = await setSingleActiveReader(supabase, id)
        return res.status(200).json({ terminal })
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      if (typeof readerName === 'string' && readerName.trim()) {
        updates.reader_name = readerName.trim()
      }

      if (typeof isActive === 'boolean') {
        updates.is_active = isActive
      }

      const { data, error } = await supabase
        .from('payment_terminals')
        .update(updates)
        .eq('id', id)
        .select(
          'id, provider, reader_id, reader_name, location_id, is_active, provider_status, paired_at, metadata, created_at, updated_at, locations(name)',
        )
        .maybeSingle()

      if (error) {
        return res.status(500).json({ error: `Reader update failed. ${error.message}` })
      }

      if (isActive === false) {
        const { count: activeReaderCount, error: activeCountError } = await supabase
          .from('payment_terminals')
          .select('id', { count: 'exact', head: true })
          .eq('provider', 'sumup')
          .eq('is_active', true)

        if (activeCountError) {
          return res.status(500).json({ error: `Active reader lookup failed. ${activeCountError.message}` })
        }

        if (!activeReaderCount) {
          return res.status(409).json({ error: 'At least one reader must remain active. Set another reader active first.' })
        }
      }

      return res.status(200).json({
        terminal: mapPaymentTerminalAdminDto(data as PaymentTerminalRow),
      })
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to update payment terminal.',
      })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
