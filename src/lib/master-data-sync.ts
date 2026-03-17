import type {
  DiscountCode,
  Ingredient,
  MenuItem,
  MenuItemRecipe,
  Modifier,
  Order,
  ServiceInventory,
  ServiceSnapshot,
} from '../types/domain'
import { normalizeMenuItem, resolveMenuCategorySlug } from './menu'
import { supabase, supabaseEnabled } from './supabase'

type IngredientRow = {
  id: string
  name: string
  unit: string
  track_stock?: boolean | null
  active?: boolean | null
}

type MenuItemRow = {
  id: string
  name: string
  category?: string | null
  category_slug?: string | null
  description?: string | null
  base_price_pence?: number | null
  sort_order?: number | null
  chilli_rating?: number | null
  image_url?: string | null
  active?: boolean | null
  loyverse_item_id?: string | null
}

type RecipeRow = {
  id: string
  menu_item_id: string
  ingredient_id: string
  quantity: number
  affects_availability?: boolean | null
}

type MasterDataPatch = Pick<
  ServiceSnapshot,
  'ingredients' | 'menuItems' | 'recipes' | 'inventory' | 'inventoryDefaults' | 'modifiers' | 'orders' | 'discountCodes'
>

function isUuid(value?: string | null) {
  return typeof value === 'string'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    : false
}

function normalizeNameKey(value?: string | null) {
  return value?.trim().toLowerCase() ?? ''
}

function mapIngredientRow(row: IngredientRow, existing: Ingredient | undefined): Ingredient {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    lowStockThreshold: existing?.lowStockThreshold ?? 0,
    active: row.active ?? true,
  }
}

function mapMenuItemRow(row: MenuItemRow): MenuItem {
  return normalizeMenuItem({
    id: row.id,
    name: row.name,
    category: row.category ?? row.category_slug ?? 'pizza',
    categorySlug: resolveMenuCategorySlug(row.category_slug, row.category),
    sortOrder: Number(row.sort_order ?? 0),
    chilliRating: Number(row.chilli_rating ?? 0),
    imageUrl: row.image_url ?? null,
    price: Number(row.base_price_pence ?? 0) / 100,
    loyverseItemId: row.loyverse_item_id ?? '',
    description: row.description ?? '',
    active: row.active ?? true,
  })
}

function remapInventoryRows(rows: ServiceInventory[], ingredientIdMap: Map<string, string>) {
  return rows.map((row) => ({
    ...row,
    ingredientId: ingredientIdMap.get(row.ingredientId) ?? row.ingredientId,
  }))
}

function remapModifiers(
  modifiers: Modifier[],
  ingredientIdMap: Map<string, string>,
  menuItemIdMap: Map<string, string>,
): Modifier[] {
  return modifiers.map((modifier) => ({
    ...modifier,
    stockIngredientId: modifier.stockIngredientId
      ? ingredientIdMap.get(modifier.stockIngredientId) ?? modifier.stockIngredientId
      : modifier.stockIngredientId,
    menuItemIds: modifier.menuItemIds.map((menuItemId) => menuItemIdMap.get(menuItemId) ?? menuItemId),
  }))
}

function remapOrders(orders: Order[], menuItemIdMap: Map<string, string>): Order[] {
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      menuItemId: menuItemIdMap.get(item.menuItemId) ?? item.menuItemId,
    })),
  }))
}

function remapDiscountCodes(
  discountCodes: DiscountCode[],
  menuItemIdMap: Map<string, string>,
): DiscountCode[] {
  return discountCodes.map((discountCode) => ({
    ...discountCode,
    appliesToMenuItemId: discountCode.appliesToMenuItemId
      ? menuItemIdMap.get(discountCode.appliesToMenuItemId) ?? discountCode.appliesToMenuItemId
      : discountCode.appliesToMenuItemId,
  }))
}

export async function syncMasterDataToSupabase(snapshot: ServiceSnapshot): Promise<MasterDataPatch | null> {
  if (!supabase || !supabaseEnabled) {
    return null
  }

  const [{ data: ingredientRows, error: ingredientLoadError }, { data: menuItemRows, error: menuLoadError }] =
    await Promise.all([
      supabase.from('ingredients').select('id, name, unit, track_stock, active'),
      supabase.from('menu_items').select(
        'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
      ),
    ])

  if (ingredientLoadError || menuLoadError) {
    console.error('syncMasterDataToSupabase load error', { ingredientLoadError, menuLoadError })
    return null
  }

  const existingIngredients = (ingredientRows ?? []) as IngredientRow[]
  const existingMenuItems = (menuItemRows ?? []) as MenuItemRow[]
  const ingredientById = new Map(existingIngredients.map((row) => [row.id, row]))
  const ingredientByName = new Map(existingIngredients.map((row) => [normalizeNameKey(row.name), row]))
  const menuById = new Map(existingMenuItems.map((row) => [row.id, row]))
  const menuByName = new Map(existingMenuItems.map((row) => [normalizeNameKey(row.name), row]))

  const ingredientIdMap = new Map<string, string>()
  const syncedIngredients: Ingredient[] = []

  for (const ingredient of snapshot.ingredients) {
    const existing =
      (isUuid(ingredient.id) ? ingredientById.get(ingredient.id) : null) ??
      ingredientByName.get(normalizeNameKey(ingredient.name))

    const payload = {
      ...(existing ? { id: existing.id } : {}),
      name: ingredient.name.trim(),
      unit: ingredient.unit.trim() || 'each',
      active: ingredient.active ?? true,
      track_stock: true,
    }

    const operation = existing
      ? supabase.from('ingredients').upsert(payload).select('id, name, unit, track_stock, active').single()
      : supabase.from('ingredients').insert(payload).select('id, name, unit, track_stock, active').single()

    const { data, error } = await operation
    if (error || !data) {
      console.error('syncMasterDataToSupabase ingredient save error', { ingredient, error })
      return null
    }

    ingredientIdMap.set(ingredient.id, data.id)
    syncedIngredients.push(mapIngredientRow(data as IngredientRow, ingredient))
  }

  const menuItemIdMap = new Map<string, string>()
  const syncedMenuItems: MenuItem[] = []

  for (const menuItem of snapshot.menuItems.map(normalizeMenuItem)) {
    const existing =
      (isUuid(menuItem.id) ? menuById.get(menuItem.id) : null) ??
      menuByName.get(normalizeNameKey(menuItem.name))

    const payload = {
      ...(existing ? { id: existing.id } : {}),
      name: menuItem.name.trim(),
      category: menuItem.category,
      category_slug: menuItem.categorySlug,
      description: menuItem.description,
      base_price_pence: Math.round(Number(menuItem.price ?? 0) * 100),
      sort_order: Number(menuItem.sortOrder ?? 0),
      chilli_rating: Number(menuItem.chilliRating ?? 0),
      image_url: menuItem.imageUrl ?? null,
      active: menuItem.active ?? true,
      loyverse_item_id: menuItem.loyverseItemId || null,
      is_pizza: !['dips', 'drinks'].includes(resolveMenuCategorySlug(menuItem.categorySlug, menuItem.category)),
    }

    const operation = existing
      ? supabase
          .from('menu_items')
          .upsert(payload)
          .select('id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id')
          .single()
      : supabase
          .from('menu_items')
          .insert(payload)
          .select('id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id')
          .single()

    const { data, error } = await operation
    if (error || !data) {
      console.error('syncMasterDataToSupabase menu save error', { menuItem, error })
      return null
    }

    menuItemIdMap.set(menuItem.id, data.id)
    syncedMenuItems.push(mapMenuItemRow(data as MenuItemRow))
  }

  const desiredRecipes = new Map<string, MenuItemRecipe>()
  for (const recipe of snapshot.recipes) {
    const menuItemId = menuItemIdMap.get(recipe.menuItemId) ?? recipe.menuItemId
    const ingredientId = ingredientIdMap.get(recipe.ingredientId) ?? recipe.ingredientId
    if (!isUuid(menuItemId) || !isUuid(ingredientId) || Number(recipe.quantity) <= 0) {
      continue
    }

    desiredRecipes.set(`${menuItemId}:${ingredientId}`, {
      ...recipe,
      id: recipe.id,
      menuItemId,
      ingredientId,
      quantity: Number(recipe.quantity),
      affectsAvailability: recipe.affectsAvailability !== false,
    })
  }

  const affectedMenuIds = Array.from(new Set(Array.from(desiredRecipes.values()).map((recipe) => recipe.menuItemId)))

  if (affectedMenuIds.length) {
    const { error: deleteError } = await supabase
      .from('menu_item_recipes')
      .delete()
      .in('menu_item_id', affectedMenuIds)

    if (deleteError) {
      console.error('syncMasterDataToSupabase recipe delete error', deleteError)
      return null
    }

    const recipePayload = Array.from(desiredRecipes.values()).map((recipe) => ({
      menu_item_id: recipe.menuItemId,
      ingredient_id: recipe.ingredientId,
      quantity: recipe.quantity,
      affects_availability: recipe.affectsAvailability !== false,
    }))

    if (recipePayload.length) {
      const { error: insertError } = await supabase.from('menu_item_recipes').insert(recipePayload)
      if (insertError) {
        console.error('syncMasterDataToSupabase recipe insert error', insertError)
        return null
      }
    }
  }

  const { data: persistedRecipes, error: recipeLoadError } = await supabase
    .from('menu_item_recipes')
    .select('id, menu_item_id, ingredient_id, quantity, affects_availability')

  if (recipeLoadError) {
    console.error('syncMasterDataToSupabase recipe load error', recipeLoadError)
    return null
  }

  const syncedRecipes: MenuItemRecipe[] = ((persistedRecipes ?? []) as RecipeRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    affectsAvailability: row.affects_availability !== false,
  }))

  return {
    ingredients: syncedIngredients,
    menuItems: syncedMenuItems,
    recipes: syncedRecipes,
    inventory: remapInventoryRows(snapshot.inventory, ingredientIdMap),
    inventoryDefaults: remapInventoryRows(snapshot.inventoryDefaults, ingredientIdMap),
    modifiers: remapModifiers(snapshot.modifiers as Modifier[], ingredientIdMap, menuItemIdMap),
    orders: remapOrders(snapshot.orders as Order[], menuItemIdMap),
    discountCodes: remapDiscountCodes(snapshot.discountCodes as DiscountCode[], menuItemIdMap),
  }
}
