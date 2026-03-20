import type { Order, PaymentMethod } from '../types/domain'

export type AdminOrderEntryPaymentOption = PaymentMethod | 'tap_to_pay' | 'preorder'

export function isDeferredPreorder(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>) {
  return order.paymentMethod == null && order.paymentStatus === 'pending'
}

export function isAwaitingOnlineCheckout(
  order: Pick<Order, 'source' | 'paymentMethod' | 'paymentStatus'>,
) {
  return (
    order.source === 'web' &&
    order.paymentMethod === 'sumup_online' &&
    order.paymentStatus === 'pending'
  )
}

export function isReleasedToOps(
  order: Pick<Order, 'source' | 'paymentMethod' | 'paymentStatus'>,
) {
  return !isAwaitingOnlineCheckout(order)
}

export function getOrderPaymentLabel(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>) {
  if (isDeferredPreorder(order)) {
    return 'Preorder'
  }

  if (order.paymentMethod === 'sumup_online') {
    return 'SumUp'
  }

  if (order.paymentMethod === 'cash') {
    return 'Cash'
  }

  if (order.paymentMethod === 'manual') {
    return 'Tap to Pay'
  }

  return 'Unpaid'
}
