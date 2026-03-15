import type {
  MenuItem,
  MenuItemRecipe,
  Order,
  OrderItem,
  ServiceConfig,
  ServiceInventory,
  SlotAllocation,
  SlotAvailability,
} from '../types/domain'
import { addMinutes, combineDateAndTime, isAfterOrEqual } from './time'

function getPizzaCount(items: OrderItem[], menuItems: MenuItem[]) {
  return items.reduce((count, item) => {
    const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
    return menuItem?.category === 'pizza' ? count + item.quantity : count
  }, 0)
}

export function generateServiceSlots(service: ServiceConfig) {
  const slots: string[] = []
  let current = combineDateAndTime(service.date, service.startTime)
  const last = combineDateAndTime(service.date, service.lastCollectionTime)

  while (isAfterOrEqual(last, current)) {
    slots.push(current)
    current = addMinutes(current, service.slotSizeMinutes)
  }

  return slots
}

export function buildSlotLoadMap(service: ServiceConfig, orders: Order[]) {
  const load = new Map<string, number>()
  for (const slot of generateServiceSlots(service)) {
    load.set(slot, 0)
  }

  for (const order of orders) {
    for (const allocation of order.slotAllocations) {
      load.set(
        allocation.slotTime,
        (load.get(allocation.slotTime) ?? 0) + allocation.pizzas,
      )
    }
  }

  return load
}

export function allocateAcrossSlots(
  service: ServiceConfig,
  orders: Order[],
  promisedTime: string,
  pizzaCount: number,
) {
  const slots = generateServiceSlots(service)
  const loadMap = buildSlotLoadMap(service, orders)
  const endIndex = slots.findIndex((slot) => slot === promisedTime)

  if (endIndex === -1) {
    return { ok: false as const, warning: 'Selected slot is outside the service window.' }
  }

  let remaining = pizzaCount
  const allocations: SlotAllocation[] = []

  for (let index = endIndex; index >= 0 && remaining > 0; index -= 1) {
    const slotTime = slots[index]
    const used = loadMap.get(slotTime) ?? 0
    const free = Math.max(service.pizzasPerSlot - used, 0)

    if (free <= 0) {
      continue
    }

    const assigned = Math.min(free, remaining)
    allocations.unshift({ slotTime, pizzas: assigned })
    remaining -= assigned
  }

  if (remaining > 0) {
    return {
      ok: false as const,
      warning: `Need ${remaining} more pizza capacity before ${promisedTime}.`,
    }
  }

  return { ok: true as const, allocations }
}

export function getAvailableSlots(
  service: ServiceConfig,
  orders: Order[],
  items: OrderItem[],
  menuItems: MenuItem[],
) {
  const pizzaCount = getPizzaCount(items, menuItems)
  const slots = generateServiceSlots(service)
  const earliestTime = service.pausedUntil
    ? addMinutes(service.pausedUntil, service.delayMinutes)
    : addMinutes(combineDateAndTime(service.date, service.startTime), service.delayMinutes)

  return slots.reduce<SlotAvailability[]>((accumulator, slot) => {
    if (!isAfterOrEqual(slot, earliestTime)) {
      return accumulator
    }

    const allocation = allocateAcrossSlots(service, orders, slot, pizzaCount)
    if (!allocation.ok) {
      return accumulator
    }

    accumulator.push({
      promisedTime: slot,
      remainingCapacity:
        service.pizzasPerSlot -
        allocation.allocations[allocation.allocations.length - 1].pizzas,
      allocations: allocation.allocations,
    })
    return accumulator
  }, [])
}

export function getInventorySummary(
  inventory: ServiceInventory[],
  recipes: MenuItemRecipe[],
  menuItems: MenuItem[],
  orders: Order[],
) {
  const committed = new Map<string, number>()

  for (const order of orders) {
    for (const item of order.items) {
      const menuItem = menuItems.find((entry) => entry.id === item.menuItemId)
      if (!menuItem) {
        continue
      }

      for (const recipe of recipes.filter((entry) => entry.menuItemId === menuItem.id)) {
        committed.set(
          recipe.ingredientId,
          (committed.get(recipe.ingredientId) ?? 0) + recipe.quantity * item.quantity,
        )
      }
    }
  }

  return inventory.map((entry) => ({
    ingredientId: entry.ingredientId,
    total: entry.quantity,
    committed: committed.get(entry.ingredientId) ?? 0,
    remaining: entry.quantity - (committed.get(entry.ingredientId) ?? 0),
  }))
}

export function getMenuAvailability(
  inventory: ServiceInventory[],
  recipes: MenuItemRecipe[],
  menuItems: MenuItem[],
  orders: Order[],
) {
  const summary = getInventorySummary(inventory, recipes, menuItems, orders)
  const remainingByIngredient = new Map(summary.map((entry) => [entry.ingredientId, entry.remaining]))

  return menuItems.map((item) => {
    const recipeRows = recipes.filter((recipe) => recipe.menuItemId === item.id)
    const limitedBy = recipeRows
      .filter((recipe) => (remainingByIngredient.get(recipe.ingredientId) ?? 0) < recipe.quantity)
      .map((recipe) => recipe.ingredientId)

    return {
      menuItemId: item.id,
      available: limitedBy.length === 0,
      limitedBy,
    }
  })
}
