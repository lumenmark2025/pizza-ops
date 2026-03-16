import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Ingredient } from '../types/domain'

export function IngredientsAdminPage() {
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const upsertIngredient = usePizzaOpsStore((state) => state.upsertIngredient)
  const [ingredientDraft, setIngredientDraft] = useState<Ingredient>({
    id: '',
    name: '',
    unit: 'g',
    lowStockThreshold: 0,
    active: true,
  })
  const [ingredientDefaultQuantity, setIngredientDefaultQuantity] = useState(0)

  function saveIngredient() {
    if (!ingredientDraft.name.trim()) {
      return
    }

    const next = {
      ...ingredientDraft,
      id: ingredientDraft.id || `ing_${ingredientDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    }

    upsertIngredient(next, ingredientDefaultQuantity, 'manager')
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
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Ingredients</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Ingredient admin</h2>
        <p className="mt-2 text-sm text-slate-500">Create stock items used by pizzas and define their default service load.</p>
        <div className="mt-6 grid gap-3">
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
                <Button size="sm" variant="outline" onClick={() => setIngredientDraft(ingredient)}>
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
