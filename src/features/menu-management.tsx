import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { MenuItem } from '../types/domain'

function emptyDraft(): MenuItem {
  return {
    id: '',
    name: '',
    category: 'pizza',
    price: 10,
    loyverseItemId: '',
    description: '',
  }
}

export function MenuAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const upsertMenuItem = usePizzaOpsStore((state) => state.upsertMenuItem)
  const [selectedMenuItemId, setSelectedMenuItemId] = useState(menuItems[0]?.id ?? '')
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItem>(menuItems[0] ?? emptyDraft())
  const [menuRecipeDraft, setMenuRecipeDraft] = useState<Record<string, number>>(
    Object.fromEntries(
      recipes
        .filter((entry) => entry.menuItemId === menuItems[0]?.id)
        .map((entry) => [entry.ingredientId, entry.quantity]),
    ),
  )

  const recipeSummary = useMemo(
    () =>
      ingredients.map((ingredient) => ({
        ingredient,
        recipeCount: recipes.filter((entry) => entry.ingredientId === ingredient.id).length,
      })),
    [ingredients, recipes],
  )

  function loadMenuItem(item: MenuItem | null) {
    if (!item) {
      setSelectedMenuItemId('')
      setMenuItemDraft(emptyDraft())
      setMenuRecipeDraft({})
      return
    }

    setSelectedMenuItemId(item.id)
    setMenuItemDraft(item)
    setMenuRecipeDraft(
      Object.fromEntries(
        recipes
          .filter((entry) => entry.menuItemId === item.id)
          .map((entry) => [entry.ingredientId, entry.quantity]),
      ),
    )
  }

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

    const saved = {
      ...menuItemDraft,
      id,
      loyverseItemId: menuItemDraft.loyverseItemId || `LOY-${id.toUpperCase()}`,
    }
    loadMenuItem(saved)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Menu</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Global pizzas and recipes</h2>
          <p className="mt-2 text-sm text-slate-500">
            Choose an existing pizza to edit, or start a new one. Recipes define how service stock is consumed.
          </p>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl font-bold">Current pizzas</h3>
            <Button variant="secondary" onClick={() => loadMenuItem(null)}>New pizza</Button>
          </div>
          <div className="mt-4 space-y-3">
            {menuItems.map((item) => (
              <button
                key={item.id}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selectedMenuItemId === item.id
                    ? 'border-orange-400 bg-orange-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
                onClick={() => loadMenuItem(item)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{currency(item.price)}</p>
                    <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{item.category}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl font-bold">Ingredient usage</h3>
            <Badge variant="orange">{ingredients.length} ingredients</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Ingredients are managed globally in the Ingredients area and referenced here in recipe rows.
          </p>
          <div className="mt-4 space-y-2">
            {recipeSummary.map(({ ingredient, recipeCount }) => (
              <div key={ingredient.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
                <div>
                  <p className="font-semibold">{ingredient.name}</p>
                  <p className="text-sm text-slate-500">{ingredient.unit}</p>
                </div>
                <Badge variant="slate">{recipeCount} recipes</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Pizza Editor</p>
              <h3 className="mt-2 font-display text-2xl font-bold">
                {menuItemDraft.id ? `Editing ${menuItemDraft.name}` : 'Create a pizza'}
              </h3>
            </div>
            {menuItemDraft.id ? <Badge variant="blue">{menuItemDraft.id}</Badge> : null}
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Pizza name</span>
              <Input value={menuItemDraft.name} onChange={(event) => setMenuItemDraft((current) => ({ ...current, id: current.id || `menu_${event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name: event.target.value }))} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Category</span>
                <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={menuItemDraft.category} onChange={(event) => setMenuItemDraft((current) => ({ ...current, category: event.target.value as MenuItem['category'] }))}>
                  <option value="pizza">Pizza</option>
                  <option value="side">Side</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Price</span>
                <Input type="number" value={menuItemDraft.price} onChange={(event) => setMenuItemDraft((current) => ({ ...current, price: Number(event.target.value) }))} />
              </label>
            </div>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Description</span>
              <Textarea value={menuItemDraft.description} onChange={(event) => setMenuItemDraft((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Loyverse item ID</span>
              <Input value={menuItemDraft.loyverseItemId} onChange={(event) => setMenuItemDraft((current) => ({ ...current, loyverseItemId: event.target.value }))} />
            </label>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="font-display text-2xl font-bold">Recipe rows</h3>
          <p className="mt-2 text-sm text-slate-500">
            Enter the amount of each ingredient required for one pizza.
          </p>
          <div className="mt-4 grid gap-3">
            {ingredients.map((ingredient) => (
              <label key={ingredient.id} className="grid gap-2 rounded-2xl border border-slate-200 p-4 text-sm sm:grid-cols-[1fr_120px] sm:items-center">
                <div>
                  <p className="font-semibold">{ingredient.name}</p>
                  <p className="text-slate-500">{ingredient.unit}</p>
                </div>
                <Input className="text-center" type="number" value={menuRecipeDraft[ingredient.id] ?? 0} onChange={(event) => setMenuRecipeDraft((current) => ({ ...current, [ingredient.id]: Number(event.target.value) }))} />
              </label>
            ))}
          </div>
          <Button className="mt-5" onClick={saveMenuItem}>Save pizza</Button>
        </Card>
      </div>
    </div>
  )
}
