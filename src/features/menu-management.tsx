import { useMemo, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { ChilliRating } from '../components/chilli-rating'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import {
  MENU_CATEGORY_OPTIONS,
  getMenuCategoryLabel,
  getMenuItemImageUrl,
  getMenuItemSortOrder,
  normalizeMenuItem,
  sortMenuItems,
} from '../lib/menu'
import { currency } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { MenuItem, MenuItemRecipe } from '../types/domain'

function emptyDraft(): MenuItem {
  return normalizeMenuItem({
    id: '',
    name: '',
    category: 'pizza',
    categorySlug: 'pizza',
    sortOrder: 0,
    chilliRating: 0,
    imageUrl: null,
    price: 10,
    loyverseItemId: '',
    description: '',
    active: true,
  })
}

function MenuImagePreview({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const resolvedImageUrl = getMenuItemImageUrl({ imageUrl })

  return (
    <div className="flex h-28 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      {resolvedImageUrl ? (
        <img src={resolvedImageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-slate-400">
          <ImageIcon className="h-5 w-5" />
          <span>No image</span>
        </div>
      )}
    </div>
  )
}

function createRecipeRow(menuItemId = '', ingredientId = ''): MenuItemRecipe {
  return {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `recipe_${Math.random().toString(36).slice(2, 10)}`,
    menuItemId,
    ingredientId,
    quantity: 0,
    affectsAvailability: true,
  }
}

function buildRecipeDraft(recipes: MenuItemRecipe[], menuItemId?: string) {
  return recipes
    .filter((entry) => entry.menuItemId === menuItemId)
    .map((entry) => ({
      ...entry,
      id: entry.id || createRecipeRow(entry.menuItemId, entry.ingredientId).id,
      affectsAvailability: entry.affectsAvailability !== false,
    }))
}

export function MenuAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const ingredients = usePizzaOpsStore((state) => state.ingredients)
  const recipes = usePizzaOpsStore((state) => state.recipes)
  const upsertMenuItem = usePizzaOpsStore((state) => state.upsertMenuItem)
  const sortedMenuItems = useMemo(() => sortMenuItems(menuItems.map(normalizeMenuItem)), [menuItems])
  const [selectedMenuItemId, setSelectedMenuItemId] = useState(sortedMenuItems[0]?.id ?? '')
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItem>(sortedMenuItems[0] ?? emptyDraft())
  const [menuRecipeDraft, setMenuRecipeDraft] = useState<MenuItemRecipe[]>(
    buildRecipeDraft(recipes, sortedMenuItems[0]?.id),
  )

  const recipeSummary = useMemo(
    () =>
      ingredients.map((ingredient) => ({
        ingredient,
        recipeCount: recipes.filter((entry) => entry.ingredientId === ingredient.id).length,
      })),
    [ingredients, recipes],
  )

  function loadMenuItem(item: MenuItem | null, sourceRecipes = recipes) {
    if (!item) {
      setSelectedMenuItemId('')
      setMenuItemDraft(emptyDraft())
      setMenuRecipeDraft([])
      return
    }

    const normalizedItem = normalizeMenuItem(item)
    setSelectedMenuItemId(normalizedItem.id)
    setMenuItemDraft(normalizedItem)
    setMenuRecipeDraft(buildRecipeDraft(sourceRecipes, normalizedItem.id))
  }

  function saveMenuItem() {
    if (!menuItemDraft.name.trim()) {
      return
    }

    const id =
      menuItemDraft.id || `menu_${menuItemDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

    const saved = normalizeMenuItem({
      ...menuItemDraft,
      id,
      category: menuItemDraft.categorySlug ?? menuItemDraft.category,
      loyverseItemId: menuItemDraft.loyverseItemId || `LOY-${id.toUpperCase()}`,
    })

    const savedRecipeRows = menuRecipeDraft
      .filter((entry) => entry.ingredientId && Number(entry.quantity) > 0)
      .map((entry) => ({
        ...entry,
        menuItemId: id,
        quantity: Number(entry.quantity),
        affectsAvailability: entry.affectsAvailability !== false,
      }))

    upsertMenuItem(
      saved,
      savedRecipeRows,
      'manager',
    )

    loadMenuItem(saved, savedRecipeRows)
  }

  function toggleMenuVisibility(item: MenuItem) {
    const normalizedItem = normalizeMenuItem(item)
    upsertMenuItem(
      {
        ...normalizedItem,
        active: normalizedItem.active === false,
      },
      recipes
        .filter((entry) => entry.menuItemId === normalizedItem.id)
        .map((entry) => ({ ...entry })),
      'manager',
    )

    if (selectedMenuItemId === normalizedItem.id) {
      setMenuItemDraft((current) =>
        normalizeMenuItem({
          ...current,
          active: normalizedItem.active === false,
        }),
      )
    }
  }

  function addRecipeRow() {
    setMenuRecipeDraft((current) => [...current, createRecipeRow(menuItemDraft.id)])
  }

  function updateRecipeRow(recipeId: string, updates: Partial<MenuItemRecipe>) {
    setMenuRecipeDraft((current) =>
      current.map((entry) =>
        entry.id === recipeId
          ? {
              ...entry,
              ...updates,
            }
          : entry,
      ),
    )
  }

  function removeRecipeRow(recipeId: string) {
    setMenuRecipeDraft((current) => current.filter((entry) => entry.id !== recipeId))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-3xl font-bold">Global menu items and recipes</h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage customer-facing categories, chilli ratings, imagery, pricing, and recipe rows in one place.
          </p>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl font-bold">Current menu items</h3>
            <Button variant="secondary" onClick={() => loadMenuItem(null)}>New item</Button>
          </div>
          <div className="mt-4 space-y-3">
            {sortedMenuItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 transition ${
                  selectedMenuItemId === item.id
                    ? 'border-orange-400 bg-orange-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-24 shrink-0">
                    <MenuImagePreview imageUrl={item.imageUrl} name={item.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button className="w-full text-left" onClick={() => loadMenuItem(item)}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{item.name}</p>
                          <ChilliRating rating={item.chilliRating ?? 0} />
                        </div>
                        <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500">{item.description || 'No description yet.'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{currency(item.price)}</p>
                        <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
                          {getMenuCategoryLabel(item.categorySlug, item.category)}
                        </p>
                      </div>
                    </div>
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={item.active === false ? 'slate' : 'green'}>
                        {item.active === false ? 'Hidden from ordering' : 'Shown on menu'}
                      </Badge>
                      <Badge variant="slate">Sort {getMenuItemSortOrder(item)}</Badge>
                      <Button
                        size="sm"
                        variant={item.active === false ? 'outline' : 'secondary'}
                        onClick={() => toggleMenuVisibility(item)}
                      >
                        {item.active === false ? 'Show on menu' : 'Hide from menu'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
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
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Menu Editor</p>
              <h3 className="mt-2 font-display text-2xl font-bold">
                {menuItemDraft.id ? `Editing ${menuItemDraft.name}` : 'Create a menu item'}
              </h3>
            </div>
            {menuItemDraft.id ? <Badge variant="blue">{menuItemDraft.id}</Badge> : null}
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Item name</span>
              <Input value={menuItemDraft.name} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, id: current.id || `menu_${event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Description</span>
              <Textarea value={menuItemDraft.description} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, description: event.target.value }))} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Category</span>
                <select
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950"
                  value={menuItemDraft.categorySlug ?? 'pizza'}
                  onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, category: event.target.value, categorySlug: event.target.value as MenuItem['categorySlug'] }))}
                >
                  {MENU_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Price</span>
                <Input type="number" min="0" step="0.01" value={menuItemDraft.price} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, price: Number(event.target.value) }))} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Chilli rating</span>
                <select
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950"
                  value={menuItemDraft.chilliRating ?? 0}
                  onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, chilliRating: Number(event.target.value) }))}
                >
                  <option value={0}>0 = None</option>
                  <option value={1}>1 = 🌶</option>
                  <option value={2}>2 = 🌶🌶</option>
                  <option value={3}>3 = 🌶🌶🌶</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Sort order</span>
                <Input type="number" value={menuItemDraft.sortOrder ?? 0} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, sortOrder: Number(event.target.value) }))} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Image URL</span>
                <Input value={menuItemDraft.imageUrl ?? ''} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, imageUrl: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-slate-600">Show on menu</span>
                <div className="flex h-11 items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950">
                  <input
                    type="checkbox"
                    checked={menuItemDraft.active !== false}
                    onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, active: event.target.checked }))}
                  />
                  <span>{menuItemDraft.active === false ? 'Hidden from customer and order-entry menus' : 'Visible on customer and order-entry menus'}</span>
                </div>
              </label>
            </div>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Loyverse item ID</span>
              <Input value={menuItemDraft.loyverseItemId} onChange={(event) => setMenuItemDraft((current) => normalizeMenuItem({ ...current, loyverseItemId: event.target.value }))} />
            </label>
            <div className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Image preview</span>
              <MenuImagePreview imageUrl={menuItemDraft.imageUrl} name={menuItemDraft.name || 'Menu item preview'} />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Spice preview</span>
              <ChilliRating rating={menuItemDraft.chilliRating ?? 0} showNoneLabel />
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl font-bold">Recipe rows</h3>
              <p className="mt-2 text-sm text-slate-500">
                Each ingredient is saved as its own recipe line. Turn off availability blocking for garnish-style items.
              </p>
            </div>
            <Button variant="secondary" onClick={addRecipeRow}>Add ingredient</Button>
          </div>
          <div className="mt-4 grid gap-3">
            {menuRecipeDraft.length ? (
              menuRecipeDraft.map((recipeRow) => {
                const selectedIngredientIds = new Set(
                  menuRecipeDraft
                    .filter((entry) => entry.id !== recipeRow.id && entry.ingredientId)
                    .map((entry) => entry.ingredientId),
                )

                return (
                  <div
                    key={recipeRow.id}
                    className="grid gap-4 rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="grid gap-4 sm:grid-cols-[1.3fr_120px_auto] sm:items-end">
                      <label className="grid gap-2 text-sm">
                        <span className="font-semibold text-slate-600">Ingredient</span>
                        <select
                          className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950"
                          value={recipeRow.ingredientId}
                          onChange={(event) =>
                            updateRecipeRow(recipeRow.id, { ingredientId: event.target.value })
                          }
                        >
                          <option value="">Select an ingredient</option>
                          {ingredients
                            .filter(
                              (ingredient) =>
                                ingredient.id === recipeRow.ingredientId ||
                                !selectedIngredientIds.has(ingredient.id),
                            )
                            .map((ingredient) => (
                              <option key={ingredient.id} value={ingredient.id}>
                                {ingredient.name} ({ingredient.unit})
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-semibold text-slate-600">Quantity</span>
                        <Input
                          className="text-center"
                          type="number"
                          min="0"
                          step="0.01"
                          value={recipeRow.quantity}
                          onChange={(event) =>
                            updateRecipeRow(recipeRow.id, {
                              quantity: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <Button variant="outline" onClick={() => removeRecipeRow(recipeRow.id)}>
                        Remove
                      </Button>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={recipeRow.affectsAvailability !== false}
                        onChange={(event) =>
                          updateRecipeRow(recipeRow.id, {
                            affectsAvailability: event.target.checked,
                          })
                        }
                      />
                      <span>
                        <span className="block font-semibold text-slate-700">Affects availability</span>
                        <span className="block text-slate-500">
                          If off, this ingredient still uses stock but will not hide the menu item when out of stock.
                        </span>
                      </span>
                    </label>
                  </div>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No recipe rows yet. Add ingredients to build this menu item.
              </div>
            )}
          </div>
          <Button className="mt-5" onClick={saveMenuItem}>Save menu item</Button>
        </Card>
      </div>
    </div>
  )
}
