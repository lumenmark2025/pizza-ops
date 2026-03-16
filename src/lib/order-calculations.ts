import type { MenuItem, OrderItem, OrderItemModifier } from '../types/domain'

export function getModifierTotal(modifiers: OrderItemModifier[] = []) {
  return modifiers.reduce(
    (sum, modifier) => sum + modifier.priceDelta * modifier.quantity,
    0,
  )
}

export function getOrderItemUnitPrice(item: OrderItem, menuItems: MenuItem[]) {
  const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
  return (menuItem?.price ?? 0) + getModifierTotal(item.modifiers)
}

export function getOrderItemsTotal(items: OrderItem[], menuItems: MenuItem[]) {
  return items.reduce(
    (sum, item) => sum + getOrderItemUnitPrice(item, menuItems) * item.quantity,
    0,
  )
}
