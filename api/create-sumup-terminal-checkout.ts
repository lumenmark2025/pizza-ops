import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseServerClient } from './_lib/supabase-server.js'
import { getSumUpConfig, sumupRequest } from './_lib/sumup.js'

type OrderRow = {
  id: string
  reference: string
  customer_name: string | null
  total_pence: number | null
  payment_status: string | null
  payment_method: string | null
}

type SumUpReaderCheckout = {
  id: string
  status?: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return res.status(500).json({ error: 'Missing Supabase server environment variables' })
  }

  const { merchantCode, affiliateKey, terminalId, webhookBaseUrl } = getSumUpConfig()
  if (!merchantCode || !affiliateKey || !terminalId || !webhookBaseUrl) {
    return res.status(500).json({
      error:
        'Missing SumUp terminal configuration. Expected SUMUP_MERCHANT_CODE, SUMUP_AFFILIATE_KEY, SUMUP_SOLO_TERMINAL_ID, and APP_BASE_URL/VERCEL_URL.',
    })
  }

  try {
    const { orderId } = req.body ?? {}

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ error: 'Missing orderId.' })
    }

    const { data, error: orderError } = await supabase
      .from('orders')
      .select('id, reference, customer_name, total_pence, payment_status, payment_method')
      .eq('id', orderId)
      .maybeSingle()

    const order = (data as OrderRow | null) ?? null

    if (orderError) {
      return res.status(500).json({ error: `Order lookup failed. ${orderError.message}` })
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' })
    }

    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Order is already paid.' })
    }

    const checkout = await sumupRequest<SumUpReaderCheckout>(
      `/v0.1/merchants/${merchantCode}/readers/${terminalId}/checkout`,
      {
        method: 'POST',
        body: JSON.stringify({
          affiliate: affiliateKey,
          description: `${order.reference} ${order.customer_name ?? 'card payment'}`.trim(),
          return_url: `${webhookBaseUrl}/api/payments/sumup-webhook`,
          total_amount: {
            currency: 'GBP',
            minor_unit: 2,
            value: Number(order.total_pence ?? 0),
          },
        }),
      },
    )

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'pending',
        payment_method: 'sumup_terminal',
        payment_reference: checkout.id,
      })
      .eq('id', order.id)

    if (updateError) {
      return res.status(500).json({ error: `Order payment state update failed. ${updateError.message}` })
    }

    return res.status(200).json({
      checkoutId: checkout.id,
      paymentStatus: 'pending',
    })
  } catch (error) {
    console.error('create-sumup-terminal-checkout error', error)
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Unexpected SumUp terminal checkout error.',
    })
  }
}
