import type { LoyverseSyncQueueItem, Order } from '../types/domain'

const loyverseApiUrl = import.meta.env.VITE_LOYVERSE_API_URL
const loyverseApiToken = import.meta.env.VITE_LOYVERSE_API_TOKEN

export function buildLoyversePayload(order: Order) {
  return {
    receipt_number: order.reference,
    line_items: order.items,
    total_money: {
      amount: Math.round(order.totalAmount * 100),
      currency: 'GBP',
    },
    note: `Pizza Ops order ${order.reference}`,
  }
}

export async function pushOrderToLoyverse(
  queueItem: LoyverseSyncQueueItem,
  order: Order,
) {
  if (!loyverseApiUrl || !loyverseApiToken) {
    throw new Error('Loyverse environment variables are not configured.')
  }

  const response = await fetch(`${loyverseApiUrl}/receipts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loyverseApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(queueItem.payload ?? buildLoyversePayload(order)),
  })

  if (!response.ok) {
    throw new Error(`Loyverse sync failed with status ${response.status}`)
  }

  return (await response.json()) as { id?: string }
}
