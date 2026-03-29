import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSumUpConfig, sumupRequest } from '../_lib/sumup.js'
import { getSupabaseServerClient } from '../_lib/supabase-server.js'

type SumUpCheckout = {
  id: string
  status?: string | null
  transaction_id?: string | null
}

type SumUpTransaction = {
  id: string
  client_transaction_id?: string | null
  foreign_transaction_id?: string | null
}

type OrderRow = {
  id: string
  payment_status: string | null
  receipt_email_status: string | null
  customer_email: string | null
}

async function findOrderForWebhook(input: {
  supabase: ReturnType<typeof getSupabaseServerClient>
  checkoutId: string
  transactionId?: string | null
}) {
  const { supabase, checkoutId, transactionId } = input

  const byLegacyCheckoutReference = await supabase
    .from('orders')
    .select('id, payment_status, receipt_email_status, customer_email')
    .eq('payment_reference', checkoutId)
    .maybeSingle()

  if (byLegacyCheckoutReference.data || byLegacyCheckoutReference.error) {
    return byLegacyCheckoutReference
  }

  if (!transactionId) {
    return byLegacyCheckoutReference
  }

  const { merchantCode } = getSumUpConfig()
  if (!merchantCode) {
    return byLegacyCheckoutReference
  }

  const verifiedTransaction = await sumupRequest<SumUpTransaction>(
    `/v2.1/merchants/${merchantCode}/transactions?id=${encodeURIComponent(transactionId)}`,
    {
      method: 'GET',
    },
  )

  if (verifiedTransaction.client_transaction_id) {
    const byClientTransactionId = await supabase
      .from('orders')
      .select('id, payment_status, receipt_email_status, customer_email')
      .eq('payment_reference', verifiedTransaction.client_transaction_id)
      .maybeSingle()

    if (byClientTransactionId.data || byClientTransactionId.error) {
      return byClientTransactionId
    }
  }

  if (verifiedTransaction.foreign_transaction_id) {
    return supabase
      .from('orders')
      .select('id, payment_status, receipt_email_status, customer_email')
      .eq('id', verifiedTransaction.foreign_transaction_id)
      .maybeSingle()
  }

  return byLegacyCheckoutReference
}

function getWebhookCheckoutId(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const payload = body as Record<string, unknown>
  if (typeof payload.id === 'string' && payload.id) {
    return payload.id
  }

  if (typeof payload.checkout_id === 'string' && payload.checkout_id) {
    return payload.checkout_id
  }

  return null
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

  const checkoutId = getWebhookCheckoutId(req.body)
  if (!checkoutId) {
    return res.status(400).json({ error: 'Missing checkout id.' })
  }

  try {
    const verifiedCheckout = await sumupRequest<SumUpCheckout>(`/v0.1/checkouts/${checkoutId}`, {
      method: 'GET',
    })
    const nextPaymentStatus = mapCheckoutStatus(verifiedCheckout.status)

    const { data, error: orderError } = await findOrderForWebhook({
      supabase,
      checkoutId,
      transactionId: verifiedCheckout.transaction_id,
    })

    const order = (data as OrderRow | null) ?? null

    if (orderError) {
      return res.status(500).json({ error: `Webhook order lookup failed. ${orderError.message}` })
    }

    if (!order) {
      return res.status(202).end()
    }

    if (order.payment_status === nextPaymentStatus) {
      return res.status(204).end()
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: nextPaymentStatus,
        receipt_email_status:
          nextPaymentStatus === 'paid' && order.customer_email
            ? order.receipt_email_status === 'sent'
              ? 'sent'
              : 'pending'
            : order.receipt_email_status,
      })
      .eq('id', order.id)

    if (updateError) {
      return res.status(500).json({ error: `Webhook order update failed. ${updateError.message}` })
    }

    if (verifiedCheckout.transaction_id) {
      console.info('sumup-webhook verified transaction', {
        checkoutId,
        transactionId: verifiedCheckout.transaction_id,
        paymentStatus: nextPaymentStatus,
        orderId: order.id,
      })
    }

    return res.status(204).end()
  } catch (error) {
    console.error('sumup-webhook error', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected SumUp webhook error.',
    })
  }
}
