import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveActiveReaderId } from './_lib/payment-terminals.js'
import { getSupabaseServerClient } from './_lib/supabase-server.js'
import { getSumUpConfig, sumupRequest } from './_lib/sumup.js'

type OrderRow = {
  id: string
  order_number: number | null
  customer_name: string | null
  total_pence: number | null
  payment_status: string | null
  payment_method: string | null
}

type SumUpReaderCheckout = {
  id?: string | null
  status?: string | null
  data?: {
    client_transaction_id?: string | null
  } | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return res.status(500).json({ error: 'Missing Supabase server environment variables' })
  }

  const { merchantCode, affiliateKey, affiliateAppId, webhookBaseUrl } = getSumUpConfig()
  if (!merchantCode || !affiliateKey || !affiliateAppId || !webhookBaseUrl) {
    return res.status(500).json({
      error:
        'Missing SumUp terminal configuration. Expected SUMUP_MERCHANT_CODE, SUMUP_AFFILIATE_KEY, SUMUP_APP_ID/SUMUP_AFFILIATE_APP_ID, and APP_BASE_URL/VERCEL_URL.',
    })
  }

  if (!webhookBaseUrl.startsWith('https://')) {
    return res.status(500).json({
      error: 'SumUp return_url must be HTTPS. Set APP_BASE_URL/VERCEL_URL to an https origin.',
    })
  }

  try {
    const { orderId } = req.body ?? {}

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ error: 'Missing orderId.' })
    }

    const { data, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, total_pence, payment_status, payment_method')
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

    const orderReference =
      typeof order.order_number === 'number' && Number.isFinite(order.order_number)
        ? `PZ-${order.order_number}`
        : order.id

    const activeTerminalId = await resolveActiveReaderId(supabase, 'sumup')

    if (!activeTerminalId) {
      return res.status(409).json({
        error: 'No active SumUp reader is configured. Pair a reader in Admin and set it active first.',
      })
    }

    const checkoutPayload = {
      affiliate: {
        app_id: affiliateAppId,
        foreign_transaction_id: order.id,
        key: affiliateKey,
      },
      description: `${orderReference} ${order.customer_name ?? 'card payment'}`.trim(),
      return_url: `${webhookBaseUrl}/api/payments/sumup-webhook`,
      total_amount: {
        currency: 'GBP',
        minor_unit: 2,
        value: Number(order.total_pence ?? 0),
      },
    }

    console.info('sumup-terminal-checkout request', {
      merchantCode,
      readerId: activeTerminalId,
      payload: {
        ...checkoutPayload,
        affiliate: {
          app_id: checkoutPayload.affiliate.app_id,
          foreign_transaction_id: checkoutPayload.affiliate.foreign_transaction_id,
          key: '[redacted]',
        },
      },
    })

    const checkout = await sumupRequest<SumUpReaderCheckout>(
      `/v0.1/merchants/${merchantCode}/readers/${activeTerminalId}/checkout`,
      {
        method: 'POST',
        body: JSON.stringify(checkoutPayload),
      },
    )

    console.info('sumup-terminal-checkout response body', checkout)

    const clientTransactionId = checkout.data?.client_transaction_id ?? null

    if (!clientTransactionId) {
      return res.status(502).json({
        error: 'SumUp checkout response was missing a client transaction identifier.',
      })
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'pending',
        payment_method: 'sumup_terminal',
        payment_reference: clientTransactionId,
      })
      .eq('id', order.id)

    if (updateError) {
      return res.status(500).json({ error: `Order payment state update failed. ${updateError.message}` })
    }

    return res.status(200).json({
      clientTransactionId,
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
