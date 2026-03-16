import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { MenuItem } from '../types/domain'

export function MenuAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const upsertMenuItem = usePizzaOpsStore((state) => state.upsertMenuItem)
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItem>({
    id: '',
    name: '',
    category: 'pizza',
    price: 10,
    loyverseItemId: '',
    description: '',
  })
  const [menuRecipeDraft, setMenuRecipeDraft] = useState<Record<string, number>>({})

  function saveMenuItem() {
    if (!menuItemDraft.name.trim()) {
      return
    }

    const id =
      menuItemDraft.id || `menu_${menuItemDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

    upsertMenuItem(
      {
        ...menuItemDraft,
        id,
        loyverseItemId: menuItemDraft.loyverseItemId || `LOY-${id.toUpperCase()}`,
      },
      ingredients.map((ingredient) => ({
        menuItemId: id,
        ingredientId: ingredient.id,
        quantity: Number(menuRecipeDraft[ingredient.id] ?? 0),
      })),
      'manager',
    )

    setMenuItemDraft({
      id: '',
      name: '',
      category: 'pizza',
      price: 10,
      loyverseItemId: '',
      description: '',
    })
    setMenuRecipeDraft({})
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Menu</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Global pizzas and recipes</h2>
          <p className="mt-2 text-sm text-slate-500">Manage menu items globally. Services consume this menu rather than owning their own copies.</p>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="font-display text-2xl font-bold">Menu items</h3>
          <div className="mt-4 space-y-3">
            {menuItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-slate-500">{item.description}</p>
                    <p className="mt-1 text-sm text-slate-500">{currency(item.price)} · {item.category}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMenuItemDraft(item)
                      setMenuRecipeDraft(
                        Object.fromEntries(
                          recipes
                            .filter((entry) => entry.menuItemId === item.id)
                            .map((entry) => [entry.ingredientId, entry.quantity]),
                        ),
                      )
                    }}
                  >
                    Edit
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {recipes.filter((entry) => entry.menuItemId === item.id).map((entry) => {
                    const ingredient = ingredients.find((row) => row.id === entry.ingredientId)
                    return (
                      <Badge key={entry.ingredientId} variant="slate">
                        {ingredient?.name ?? entry.ingredientId}: {entry.quantity}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <h3 className="font-display text-2xl font-bold">Add or edit pizza</h3>
          <div className="mt-4 grid gap-3">
            <Input placeholder="Menu item name" value={menuItemDraft.name} onChange={(event) => setMenuItemDraft((current) => ({ ...current, id: current.id || `menu_${event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name: event.target.value }))} />
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={menuItemDraft.category} onChange={(event) => setMenuItemDraft((current) => ({ ...current, category: event.target.value as MenuItem['category'] }))}>
                <option value="pizza">Pizza</option>
                <option value="side">Side</option>
              </select>
              <Input type="number" value={menuItemDraft.price} onChange={(event) => setMenuItemDraft((current) => ({ ...current, price: Number(event.target.value) }))} />
            </div>
            <Input placeholder="Loyverse item ID (optional)" value={menuItemDraft.loyverseItemId} onChange={(event) => setMenuItemDraft((current) => ({ ...current, loyverseItemId: event.target.value }))} />
            <Textarea placeholder="Description" value={menuItemDraft.description} onChange={(event) => setMenuItemDraft((current) => ({ ...current, description: event.target.value }))} />
            <div className="grid gap-3">
              {ingredients.map((ingredient) => (
                <label key={ingredient.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <span>{ingredient.name}</span>
                  <Input className="w-24 text-center" type="number" value={menuRecipeDraft[ingredient.id] ?? 0} onChange={(event) => setMenuRecipeDraft((current) => ({ ...current, [ingredient.id]: Number(event.target.value) }))} />
                </label>
              ))}
            </div>
            <Button onClick={saveMenuItem}>Save menu item</Button>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl font-bold">Ingredient usage</h3>
            <Badge variant="orange">{ingredients.length} ingredients</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">Ingredients are managed in the Ingredients area and linked here through recipe rows.</p>
          <div className="mt-4 space-y-2">
            {ingredients.map((ingredient) => (
              <div key={ingredient.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
                <div>
                  <p className="font-semibold">{ingredient.name}</p>
                  <p className="text-sm text-slate-500">{ingredient.unit}</p>
                </div>
                <Badge variant="slate">{recipes.filter((entry) => entry.ingredientId === ingredient.id).length} recipes</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
