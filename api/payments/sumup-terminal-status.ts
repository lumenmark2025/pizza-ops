import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSumUpConfig, sumupRequest } from '../_lib/sumup.js'
import { getSupabaseServerClient } from '../_lib/supabase-server.js'

type SumUpTransaction = {
  id: string
  status?: string | null
  client_transaction_id?: string | null
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

  const { orderId, clientTransactionId } = req.body ?? {}

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Missing orderId.' })
  }

  try {
    const { merchantCode } = getSumUpConfig()
    if (!merchantCode) {
      return res.status(500).json({ error: 'Missing SUMUP_MERCHANT_CODE.' })
    }

    console.info('sumup-terminal-status request', {
      merchantCode,
      orderId,
      clientTransactionId: typeof clientTransactionId === 'string' ? clientTransactionId : null,
    })

    const lookupClientTransactionId =
      typeof clientTransactionId === 'string' && clientTransactionId.trim()
        ? clientTransactionId
        : null

    const queryParam = lookupClientTransactionId
      ? `client_transaction_id=${encodeURIComponent(lookupClientTransactionId)}`
      : `foreign_transaction_id=${encodeURIComponent(orderId)}`

    const verifiedTransaction = await sumupRequest<SumUpTransaction>(
      `/v2.1/merchants/${merchantCode}/transactions?${queryParam}`,
      {
        method: 'GET',
      },
    )
    console.info('sumup-terminal-status response body', verifiedTransaction)
    const nextPaymentStatus = mapCheckoutStatus(verifiedTransaction.status)

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

    if (
      lookupClientTransactionId &&
      order.payment_reference &&
      order.payment_reference !== lookupClientTransactionId
    ) {
      return res.status(409).json({
        error: 'Order payment reference does not match the terminal transaction being polled.',
      })
    }

    const finalized = nextPaymentStatus !== 'pending'

    if (finalized && order.payment_status !== nextPaymentStatus) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_status: nextPaymentStatus,
          payment_reference: lookupClientTransactionId ?? order.payment_reference,
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
      clientTransactionId: verifiedTransaction.client_transaction_id ?? lookupClientTransactionId,
      providerStatus: verifiedTransaction.status ?? null,
      paymentStatus: nextPaymentStatus,
      finalized,
      transactionId: verifiedTransaction.id ?? null,
    })
  } catch (error) {
    console.error('sumup-terminal-status error', error)
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Unexpected SumUp terminal status error.',
    })
  }
}
