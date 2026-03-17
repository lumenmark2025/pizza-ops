import type { VercelRequest, VercelResponse } from '@vercel/node'
import { formatOrderReceiptEmail, type ReceiptPayload } from './_lib/order-receipt'
import { getResendClient, getSenderAddress } from './_lib/resend'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let resend
  try {
    resend = getResendClient()
  } catch (error) {
    return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  }

  const payload = req.body as ReceiptPayload | undefined
  if (!payload?.order?.customerEmail || !payload.order.reference) {
    return res.status(400).json({ error: 'Missing receipt payload' })
  }

  try {
    const email = formatOrderReceiptEmail(payload)
    const result = await resend.emails.send({
      from: getSenderAddress(),
      to: [payload.order.customerEmail],
      subject: email.subject,
      html: email.html,
    })

    if (result.error) {
      console.error('send-order-receipt resend error', result.error)
      return res.status(500).json({
        error: result.error.message || 'Receipt sending failed',
      })
    }

    console.info('send-order-receipt success', { id: result.data?.id, orderId: payload.order.id })
    return res.status(200).json({ id: result.data?.id ?? null })
  } catch (error) {
    console.error('send-order-receipt error', error)
    return res.status(500).json({ error: 'Unexpected receipt sending error' })
  }
}
