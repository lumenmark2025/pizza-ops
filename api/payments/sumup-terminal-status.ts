import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseServerClient } from '../_lib/supabase-server.js'
import { sumupRequest } from '../_lib/sumup.js'

type SumUpCheckout = {
  id: string
  status?: string | null
  transaction_id?: string | null
}

type OrderRow = {
  id: string
  payment_reference: string | null
  payment_status: string | null
  receipt_email_status: string | null
  customer_email: string | null
}

function mapCheckoutStatus(status?: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()

  if (['paid', 'successful', 'succeeded'].includes(normalized)) {
    return 'paid' as const
  }

  if (['failed', 'cancelled', 'canceled', 'declined'].includes(normalized)) {
    return 'failed' as const
  }

  return 'pending' as const
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return res.status(500).json({ error: 'Missing Supabase server environment variables' })
  }

  const { orderId, checkoutId } = req.body ?? {}

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Missing orderId.' })
  }

  if (!checkoutId || typeof checkoutId !== 'string') {
    return res.status(400).json({ error: 'Missing checkoutId.' })
  }

  try {
    const verifiedCheckout = await sumupRequest<SumUpCheckout>(`/v0.1/checkouts/${checkoutId}`, {
      method: 'GET',
    })
    const nextPaymentStatus = mapCheckoutStatus(verifiedCheckout.status)

    const { data, error: orderError } = await supabase
      .from('orders')
      .select('id, payment_reference, payment_status, receipt_email_status, customer_email')
      .eq('id', orderId)
      .maybeSingle()

    const order = (data as OrderRow | null) ?? null

    if (orderError) {
      return res.status(500).json({ error: `Order lookup failed. ${orderError.message}` })
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' })
    }

    if (order.payment_reference && order.payment_reference !== checkoutId) {
      return res.status(409).json({
        error: 'Order payment reference does not match the terminal checkout being polled.',
      })
    }

    const finalized = nextPaymentStatus !== 'pending'

    if (finalized && order.payment_status !== nextPaymentStatus) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_status: nextPaymentStatus,
          payment_reference: checkoutId,
          receipt_email_status:
            nextPaymentStatus === 'paid' && order.customer_email
              ? order.receipt_email_status === 'sent'
                ? 'sent'
                : 'pending'
              : order.receipt_email_status,
        })
        .eq('id', order.id)

      if (updateError) {
        return res.status(500).json({ error: `Order payment update failed. ${updateError.message}` })
      }
    }

    return res.status(200).json({
      checkoutId,
      providerStatus: verifiedCheckout.status ?? null,
      paymentStatus: nextPaymentStatus,
      finalized,
      transactionId: verifiedCheckout.transaction_id ?? null,
    })
  } catch (error) {
    console.error('sumup-terminal-status error', error)
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Unexpected SumUp terminal status error.',
    })
  }
}
