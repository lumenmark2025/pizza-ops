import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { cn, currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Modifier } from '../types/domain'

function emptyModifier(): Modifier {
  return {
    id: '',
    name: '',
    priceDelta: 0,
    stockIngredientId: null,
    stockQuantity: 0,
    maxPerPizza: 1,
    menuItemIds: [],
    appliesToAllPizzas: true,
  }
}

export function ModifiersAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const masterDataLoadError = usePizzaOpsStore((state) => state.masterDataLoadError)
  const masterDataLoadWarnings = usePizzaOpsStore((state) => state.masterDataLoadWarnings)
  const upsertModifier = usePizzaOpsStore((state) => state.upsertModifier)
  const deleteModifier = usePizzaOpsStore((state) => state.deleteModifier)
  const [modifierDraft, setModifierDraft] = useState<Modifier>(emptyModifier())
  const [saveError, setSaveError] = useState<string | null>(null)

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Modifiers</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Global modifier admin</h2>
        <p className="mt-2 text-sm text-slate-500">
          These modifiers are shared across all services. Use clear labels so the team understands price, stock use, and limits immediately.
        </p>
        {masterDataLoadError ? (
          <p className="mt-4 text-sm font-medium text-rose-600">{masterDataLoadError}</p>
        ) : null}
        {masterDataLoadWarnings.map((warning) => (
          <p key={warning} className="mt-4 text-sm font-medium text-amber-700">{warning}</p>
        ))}
        <div className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-slate-600">Modifier name</span>
            <Input value={modifierDraft.name} onChange={(event) => setModifierDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-slate-600">Price change</span>
            <Input type="number" value={modifierDraft.priceDelta} onChange={(event) => setModifierDraft((current) => ({ ...current, priceDelta: Number(event.target.value) }))} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Stock ingredient used</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={modifierDraft.stockIngredientId ?? ''} onChange={(event) => setModifierDraft((current) => ({ ...current, stockIngredientId: event.target.value || null }))}>
                <option value="">No stock item linked</option>
                {ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Amount required from stock</span>
              <Input type="number" value={modifierDraft.stockQuantity ?? 0} onChange={(event) => setModifierDraft((current) => ({ ...current, stockQuantity: Number(event.target.value) }))} />
            </label>
          </div>
          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-slate-600">Maximum allowed per pizza</span>
            <Input type="number" value={modifierDraft.maxPerPizza ?? 1} onChange={(event) => setModifierDraft((current) => ({ ...current, maxPerPizza: Number(event.target.value) }))} />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={modifierDraft.appliesToAllPizzas ?? false} onChange={(event) => setModifierDraft((current) => ({ ...current, appliesToAllPizzas: event.target.checked, menuItemIds: event.target.checked ? [] : current.menuItemIds }))} />
            Available on all pizzas
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-slate-600">Specific pizzas</span>
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
          </div>
          <div className="flex gap-2">
            <Button onClick={() => {
              void (async () => {
                try {
                  setSaveError(null)
                  await upsertModifier(modifierDraft, 'manager')
                  setModifierDraft(emptyModifier())
                } catch (error) {
                  setSaveError(error instanceof Error ? error.message : 'Modifier save failed.')
                }
              })()
            }}>
              Save modifier
            </Button>
            <Button variant="outline" onClick={() => setModifierDraft(emptyModifier())}>
              Clear form
            </Button>
          </div>
          {saveError ? <p className="text-sm font-medium text-rose-600">{saveError}</p> : null}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-2xl font-bold">Current modifiers</h3>
          <Badge variant="orange">{modifiers.length}</Badge>
        </div>
        <div className="mt-4 space-y-3">
          {modifiers.map((modifier) => {
            const stockIngredient = ingredients.find((entry) => entry.id === modifier.stockIngredientId)
            return (
              <div key={modifier.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{modifier.name}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {currency(modifier.priceDelta)} · Max {modifier.maxPerPizza ?? 1} per pizza
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {stockIngredient
                        ? `${modifier.stockQuantity ?? 0} ${stockIngredient.unit} of ${stockIngredient.name}`
                        : 'No stock item linked'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {modifier.appliesToAllPizzas ? 'All pizzas' : `${modifier.menuItemIds.length} specific pizzas`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setModifierDraft(modifier)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => {
                      void (async () => {
                        try {
                          setSaveError(null)
                          await deleteModifier(modifier.id, 'manager')
                        } catch (error) {
                          setSaveError(error instanceof Error ? error.message : 'Modifier delete failed.')
                        }
                      })()
                    }}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
