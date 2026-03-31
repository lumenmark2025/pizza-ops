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
    pagerNumber?: number | null
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function formatOrderReceiptEmail(payload: ReceiptPayload) {
  const itemsHtml = payload.order.items
    .map((item) => {
      const modifiers = item.modifiers.length
        ? `<div style="font-size:12px;color:#64748b;margin-top:6px;">${item.modifiers.map(escapeHtml).join(', ')}</div>`
        : ''

      return `<tr>
        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:700;color:#0f172a;font-size:15px;">${item.quantity} x ${escapeHtml(item.name)}</div>
          ${modifiers}
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-weight:700;white-space:nowrap;">${currency(item.lineTotal)}</td>
      </tr>`
    })
    .join('')

  const locationHtml = payload.location
    ? `<div style="margin-top:18px;padding:18px 20px;border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;">
        <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.16em;color:#94a3b8;">Collection point</p>
        <p style="margin:10px 0 0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(payload.location.name)}</p>
        <p style="margin:6px 0 0;color:#475569;line-height:1.6;">${escapeHtml(payload.location.addressLine1)}${payload.location.addressLine2 ? `<br>${escapeHtml(payload.location.addressLine2)}` : ''}<br>${escapeHtml(payload.location.townCity)} ${escapeHtml(payload.location.postcode)}</p>
      </div>`
    : ''

  const pagerHtml =
    typeof payload.order.pagerNumber === 'number'
      ? `<div style="margin-top:18px;padding:14px 18px;border-radius:18px;background:#eff6ff;color:#1d4ed8;font-weight:600;">Pager ${payload.order.pagerNumber}</div>`
      : ''

  const collectionTime = new Date(payload.order.promisedTime).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return {
    subject: `Your North West Pizza Receipt ${payload.order.reference}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:28px 16px;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:28px;padding:32px 28px;border:1px solid #e2e8f0;box-shadow:0 20px 50px rgba(15,23,42,0.08);">
          <div style="padding-bottom:24px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#ea580c;font-weight:700;">North West Pizza</p>
            <h1 style="margin:14px 0 0;font-size:30px;line-height:1.1;">Your receipt</h1>
            <p style="margin:12px 0 0;color:#475569;line-height:1.6;">Thanks ${escapeHtml(payload.order.customerName)}. Your order <strong>${escapeHtml(payload.order.reference)}</strong> has been paid and booked.</p>
          </div>

          <div style="margin-top:24px;padding:22px;border-radius:22px;background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%);">
            <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">
              <div style="min-width:180px;">
                <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:#9a3412;font-weight:700;">Collection time</p>
                <p style="margin:8px 0 0;font-size:30px;font-weight:800;line-height:1;color:#7c2d12;">${collectionTime}</p>
              </div>
              <div style="min-width:180px;">
                <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:#9a3412;font-weight:700;">Service</p>
                <p style="margin:8px 0 0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(payload.service.name)}</p>
                <p style="margin:4px 0 0;color:#475569;">${escapeHtml(payload.service.date)} · ${escapeHtml(payload.service.startTime)}-${escapeHtml(payload.service.lastCollectionTime)}</p>
              </div>
            </div>
            ${locationHtml}
            ${pagerHtml}
          </div>

          <table style="width:100%;border-collapse:collapse;margin-top:26px;">
            <tbody>${itemsHtml}</tbody>
          </table>

          <div style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:18px;">
            <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:10px;"><span>Subtotal</span><span>${currency(payload.order.subtotalAmount)}</span></div>
            <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:10px;"><span>Discount</span><span>-${currency(payload.order.totalDiscountAmount)}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:800;color:#0f172a;"><span>Total paid</span><span>${currency(payload.order.totalAmount)}</span></div>
          </div>

          ${payload.order.notes ? `<div style="margin-top:22px;padding:16px 18px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.16em;color:#94a3b8;font-weight:700;">Order notes</p><p style="margin:10px 0 0;color:#475569;line-height:1.6;">${escapeHtml(payload.order.notes)}</p></div>` : ''}
          <p style="margin-top:22px;color:#475569;line-height:1.6;">Please arrive close to your collection time and have your order reference ready.</p>
        </div>
      </div>
    `,
  }
}

export type { ReceiptPayload }
