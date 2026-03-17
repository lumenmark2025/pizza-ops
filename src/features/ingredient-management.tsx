import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Ingredient } from '../types/domain'

function emptyIngredient(): Ingredient {
  return {
    id: '',
    name: '',
    unit: 'g',
    lowStockThreshold: 0,
    active: true,
  }
}

function buildIngredientId(name: string, editingIngredientId: string | null) {
  if (!name.trim()) {
    return ''
  }
  if (editingIngredientId) {
    return editingIngredientId
  }
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function IngredientsAdminPage() {
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const inventoryDefaults = usePizzaOpsStore((state) => state.inventoryDefaults)
  const upsertIngredient = usePizzaOpsStore((state) => state.upsertIngredient)
  const [ingredientDraft, setIngredientDraft] = useState<Ingredient>(emptyIngredient())
  const [ingredientDefaultQuantity, setIngredientDefaultQuantity] = useState(0)
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null)

  function resetIngredientForm() {
    setIngredientDraft(emptyIngredient())
    setIngredientDefaultQuantity(0)
    setEditingIngredientId(null)
  }

  function editIngredient(ingredient: Ingredient) {
    setIngredientDraft(ingredient)
    setIngredientDefaultQuantity(
      inventoryDefaults.find((entry) => entry.ingredientId === ingredient.id)?.quantity ?? 0,
    )
    setEditingIngredientId(ingredient.id)
  }

  function saveIngredient() {
    if (!ingredientDraft.name.trim()) {
      return
    }

    const nextId = buildIngredientId(ingredientDraft.name.trim(), editingIngredientId)
    if (!nextId) {
      return
    }

    const next = {
      ...ingredientDraft,
      id: nextId,
    }

    upsertIngredient(next, ingredientDefaultQuantity, 'manager')
    resetIngredientForm()
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-bold">Ingredient admin</h2>
            <p className="mt-2 text-sm text-slate-500">Create stock items used by pizzas and define their default service load.</p>
          </div>
          <Button variant="outline" onClick={resetIngredientForm}>
            New ingredient
          </Button>
        </div>
        <div className="mt-6 grid gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={editingIngredientId ? 'blue' : 'slate'}>
              {editingIngredientId ? 'Editing ingredient' : 'New ingredient'}
            </Badge>
          </div>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Ingredient name
            <Input value={ingredientDraft.name} onChange={(event) => setIngredientDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Unit
              <Input value={ingredientDraft.unit} onChange={(event) => setIngredientDraft((current) => ({ ...current, unit: event.target.value }))} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Low stock threshold
              <Input type="number" value={ingredientDraft.lowStockThreshold} onChange={(event) => setIngredientDraft((current) => ({ ...current, lowStockThreshold: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Default stock amount
              <Input type="number" value={ingredientDefaultQuantity} onChange={(event) => setIngredientDefaultQuantity(Number(event.target.value))} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Status
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950" value={ingredientDraft.active ? 'active' : 'inactive'} onChange={(event) => setIngredientDraft((current) => ({ ...current, active: event.target.value === 'active' }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveIngredient}>
              {editingIngredientId ? 'Update ingredient' : 'Save ingredient'}
            </Button>
            <Button variant="outline" onClick={resetIngredientForm}>
              Clear form
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-2xl font-bold">Current ingredients</h3>
          <Badge variant="orange">{ingredients.length} ingredients</Badge>
        </div>
        <div className="mt-4 space-y-2">
          {ingredients.map((ingredient) => (
            <div key={ingredient.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
              <div>
                <p className="font-semibold">{ingredient.name}</p>
                <p className="text-sm text-slate-500">{ingredient.unit} · threshold {ingredient.lowStockThreshold}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={ingredient.active === false ? 'slate' : 'green'}>
                  {ingredient.active === false ? 'Inactive' : 'Active'}
                </Badge>
                <Badge variant="slate">{recipes.filter((entry) => entry.ingredientId === ingredient.id).length} recipes</Badge>
                <Button size="sm" variant="outline" onClick={() => editIngredient(ingredient)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
