import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { currency, cn } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Ingredient, MenuItem, Modifier } from '../types/domain'

export function MenuAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const upsertMenuItem = usePizzaOpsStore((state) => state.upsertMenuItem)
  const upsertIngredient = usePizzaOpsStore((state) => state.upsertIngredient)
  const upsertModifier = usePizzaOpsStore((state) => state.upsertModifier)
  const deleteModifier = usePizzaOpsStore((state) => state.deleteModifier)
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItem>({
    id: '',
    name: '',
    category: 'pizza',
    price: 10,
    loyverseItemId: '',
    description: '',
  })
  const [menuRecipeDraft, setMenuRecipeDraft] = useState<Record<string, number>>({})
  const [modifierDraft, setModifierDraft] = useState<Modifier>({
    id: '',
    name: '',
    priceDelta: 1,
    menuItemIds: [],
    appliesToAllPizzas: true,
  })
  const [ingredientDraft, setIngredientDraft] = useState<Ingredient>({
    id: '',
    name: '',
    unit: 'g',
    lowStockThreshold: 0,
    active: true,
  })
  const [ingredientDefaultQuantity, setIngredientDefaultQuantity] = useState(0)

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

  function saveIngredient() {
    if (!ingredientDraft.name.trim()) {
      return
    }

    const nextIngredient = {
      ...ingredientDraft,
      id: ingredientDraft.id || `ing_${ingredientDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    }

    upsertIngredient(nextIngredient, ingredientDefaultQuantity, 'manager')
    setIngredientDraft({
      id: '',
      name: '',
      unit: 'g',
      lowStockThreshold: 0,
      active: true,
    })
    setIngredientDefaultQuantity(0)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Menu</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Pizzas and recipes</h2>
          <p className="mt-2 text-sm text-slate-500">Manage menu items, the ingredients they consume, and how stock depletion is calculated.</p>
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
                  <Button size="sm" variant="outline" onClick={() => {
                    setMenuItemDraft(item)
                    setMenuRecipeDraft(
                      Object.fromEntries(
                        recipes
                          .filter((entry) => entry.menuItemId === item.id)
                          .map((entry) => [entry.ingredientId, entry.quantity]),
                      ),
                    )
                  }}>
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
            <h3 className="font-display text-2xl font-bold">Ingredients</h3>
            <Badge variant="orange">{ingredients.length} ingredients</Badge>
          </div>
          <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Add ingredient</p>
            <Input placeholder="Ingredient name" value={ingredientDraft.name} onChange={(event) => setIngredientDraft((current) => ({ ...current, id: current.id || `ing_${event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name: event.target.value }))} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Unit" value={ingredientDraft.unit} onChange={(event) => setIngredientDraft((current) => ({ ...current, unit: event.target.value }))} />
              <Input type="number" placeholder="Low stock threshold" value={ingredientDraft.lowStockThreshold} onChange={(event) => setIngredientDraft((current) => ({ ...current, lowStockThreshold: Number(event.target.value) }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="number" placeholder="Default stock amount" value={ingredientDefaultQuantity} onChange={(event) => setIngredientDefaultQuantity(Number(event.target.value))} />
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={ingredientDraft.active ? 'active' : 'inactive'} onChange={(event) => setIngredientDraft((current) => ({ ...current, active: event.target.value === 'active' }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <Button onClick={saveIngredient}>Save ingredient</Button>
          </div>
          <div className="mt-4 space-y-2">
            {ingredients.map((ingredient) => (
              <div key={ingredient.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-semibold">{ingredient.name}</p>
                  <p className="text-sm text-slate-500">{ingredient.unit} · threshold {ingredient.lowStockThreshold}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={ingredient.active === false ? 'slate' : 'green'}>
                    {ingredient.active === false ? 'Inactive' : 'Active'}
                  </Badge>
                  <Badge variant="slate">{recipes.filter((entry) => entry.ingredientId === ingredient.id).length} recipes</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="font-display text-2xl font-bold">Modifiers</h3>
          <div className="mt-4 grid gap-3">
            <Input placeholder="Modifier name" value={modifierDraft.name} onChange={(event) => setModifierDraft((current) => ({ ...current, id: current.id || `mod_${event.target.value.toLowerCase().replace(/\s+/g, '_')}`, name: event.target.value }))} />
            <Input type="number" placeholder="Price delta" value={modifierDraft.priceDelta} onChange={(event) => setModifierDraft((current) => ({ ...current, priceDelta: Number(event.target.value) }))} />
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <input type="checkbox" checked={modifierDraft.appliesToAllPizzas ?? false} onChange={(event) => setModifierDraft((current) => ({ ...current, appliesToAllPizzas: event.target.checked, menuItemIds: event.target.checked ? [] : current.menuItemIds }))} />
              Available on all pizzas
            </label>
            <div className="flex flex-wrap gap-2">
              {menuItems.map((item) => {
                const active = modifierDraft.menuItemIds.includes(item.id)
                return (
                  <button key={item.id} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', active ? 'border-orange-400 bg-orange-100 text-orange-700' : 'border-slate-300 bg-white text-slate-600')} onClick={() => setModifierDraft((current) => ({
                    ...current,
                    menuItemIds: active ? current.menuItemIds.filter((id) => id !== item.id) : [...current.menuItemIds, item.id],
                  }))} disabled={modifierDraft.appliesToAllPizzas}>
                    {item.name}
                  </button>
                )
              })}
            </div>
            <Button onClick={() => {
              upsertModifier(modifierDraft, 'manager')
              setModifierDraft({ id: '', name: '', priceDelta: 1, menuItemIds: [], appliesToAllPizzas: true })
            }}>
              Save modifier
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            {modifiers.map((modifier) => (
              <div key={modifier.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-semibold">{modifier.name}</p>
                  <p className="text-sm text-slate-500">{modifier.appliesToAllPizzas ? 'All pizzas' : `${modifier.menuItemIds.length} menu items`}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setModifierDraft(modifier)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => deleteModifier(modifier.id, 'manager')}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
