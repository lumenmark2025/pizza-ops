import type { VercelRequest, VercelResponse } from '@vercel/node'

type ReceiptPayload = {
  order: {
    id: string
    reference: string
    customerName: string
    customerEmail: string
    promisedTime: string
    paymentMethod: string
    totalAmount: number
    subtotalAmount: number
    totalDiscountAmount: number
    notes: string
    items: Array<{
      id: string
      name: string
      quantity: number
      lineTotal: number
      modifiers: string[]
    }>
  }
  service: {
    name: string
    date: string
    startTime: string
    lastCollectionTime: string
  }
  location: {
    name: string
    addressLine1: string
    addressLine2: string
    townCity: string
    postcode: string
  } | null
}

function currency(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value)
}

function formatReceiptHtml(payload: ReceiptPayload) {
  const itemsHtml = payload.order.items
    .map((item) => {
      const modifiers = item.modifiers.length
        ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">${item.modifiers.join(', ')}</div>`
        : ''

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:600;color:#0f172a;">${item.quantity} x ${item.name}</div>
          ${modifiers}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${currency(item.lineTotal)}</td>
      </tr>`
    })
    .join('')

  const locationHtml = payload.location
    ? `<p style="margin:4px 0 0;color:#475569;">${payload.location.name}<br>${payload.location.addressLine1}${payload.location.addressLine2 ? `<br>${payload.location.addressLine2}` : ''}<br>${payload.location.townCity} ${payload.location.postcode}</p>`
    : ''

  return `
    <div style="font-family:Arial,sans-serif;background:#fff7ed;padding:24px;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #fed7aa;">
        <p style="margin:0;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#c2410c;">North West Pizza</p>
        <h1 style="margin:12px 0 0;font-size:28px;">Your receipt</h1>
        <p style="margin:12px 0 0;color:#475569;">Thanks ${payload.order.customerName}. Your order ${payload.order.reference} has been paid and booked.</p>

        <div style="margin-top:24px;padding:16px;border-radius:16px;background:#fff7ed;">
          <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">
            <div>
              <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:#9a3412;">Collection time</p>
              <p style="margin:8px 0 0;font-size:22px;font-weight:700;">${new Date(payload.order.promisedTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <div>
              <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:#9a3412;">Service</p>
              <p style="margin:8px 0 0;font-size:16px;font-weight:600;">${payload.service.name}</p>
              <p style="margin:4px 0 0;color:#475569;">${payload.service.date}</p>
            </div>
          </div>
          ${locationHtml}
        </div>

        <table style="width:100%;border-collapse:collapse;margin-top:24px;">
          <tbody>${itemsHtml}</tbody>
        </table>

        <div style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;">
          <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:8px;"><span>Subtotal</span><span>${currency(payload.order.subtotalAmount)}</span></div>
          <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:8px;"><span>Discount</span><span>-${currency(payload.order.totalDiscountAmount)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;"><span>Total paid</span><span>${currency(payload.order.totalAmount)}</span></div>
        </div>

        ${payload.order.notes ? `<p style="margin-top:20px;color:#475569;"><strong>Notes:</strong> ${payload.order.notes}</p>` : ''}
      </div>
    </div>
  `
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const resendApiKey = process.env.RESEND_API_KEY
  const sender = process.env.RESEND_FROM_EMAIL || 'Pizza Ops <receipts@pizza.northwestpizza.co.uk>'

  if (!resendApiKey) {
    return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  }

  const payload = req.body as ReceiptPayload | undefined
  if (!payload?.order?.customerEmail || !payload.order.reference) {
    return res.status(400).json({ error: 'Missing receipt payload' })
  }

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [payload.order.customerEmail],
        subject: `Your Pizza Ops receipt ${payload.order.reference}`,
        html: formatReceiptHtml(payload),
      }),
    })

    const data = await resendResponse.json()
    if (!resendResponse.ok) {
      return res.status(resendResponse.status).json({
        error: typeof data?.message === 'string' ? data.message : 'Receipt sending failed',
        details: data,
      })
    }

    return res.status(200).json({ id: data.id })
  } catch (error) {
    console.error('send-order-receipt error', error)
    return res.status(500).json({ error: 'Unexpected receipt sending error' })
  }
}
