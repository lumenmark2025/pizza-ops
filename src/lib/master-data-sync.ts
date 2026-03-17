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
import { supabase } from './supabase'

type IngredientRow = {
  id: string
  name: string
  unit: string
  low_stock_threshold?: number | null
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

function isMissingIngredientThresholdColumn(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST204' && error.message?.includes('low_stock_threshold')
}

async function selectIngredientRows() {
  if (!supabase) {
    return { data: null as IngredientRow[] | null, error: null }
  }

  const withThreshold = await supabase
    .from('ingredients')
    .select('id, name, unit, low_stock_threshold, track_stock, active')

  if (!isMissingIngredientThresholdColumn(withThreshold.error)) {
    return withThreshold as { data: IngredientRow[] | null; error: typeof withThreshold.error }
  }

  const fallback = await supabase
    .from('ingredients')
    .select('id, name, unit, track_stock, active')

  return fallback as { data: IngredientRow[] | null; error: typeof fallback.error }
}

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
    lowStockThreshold: Number(row.low_stock_threshold ?? existing?.lowStockThreshold ?? 0),
    active: row.active ?? true,
  }
}

export async function persistIngredientToSupabase(ingredient: Ingredient): Promise<Ingredient | null> {
  if (!supabase) {
    throw new Error('Supabase client is not configured for ingredient writes.')
  }

  const payload = {
    id: ingredient.id,
    name: ingredient.name.trim(),
    unit: ingredient.unit.trim() || 'each',
    low_stock_threshold: Number(ingredient.lowStockThreshold ?? 0),
    track_stock: true,
    active: ingredient.active ?? true,
  }

  const primary = await supabase
    .from('ingredients')
    .upsert(payload)
    .select('id, name, unit, low_stock_threshold, track_stock, active')
    .single()

  if (isMissingIngredientThresholdColumn(primary.error)) {
    const fallback = await supabase
      .from('ingredients')
      .upsert({
        id: ingredient.id,
        name: ingredient.name.trim(),
        unit: ingredient.unit.trim() || 'each',
        track_stock: true,
        active: ingredient.active ?? true,
      })
      .select('id, name, unit, track_stock, active')
      .single()

    if (fallback.error || !fallback.data) {
      throw new Error(fallback.error.message)
    }

    return mapIngredientRow(fallback.data as IngredientRow, ingredient)
  }

  if (primary.error || !primary.data) {
    throw new Error(primary.error.message)
  }

  return mapIngredientRow(primary.data as IngredientRow, ingredient)
}

export async function persistMenuItemToSupabase(menuItem: MenuItem): Promise<MenuItem | null> {
  if (!supabase) {
    throw new Error('Supabase client is not configured for menu item writes.')
  }

  const normalized = normalizeMenuItem(menuItem)
  const payload = {
    id: normalized.id,
    name: normalized.name.trim(),
    category: normalized.category,
    category_slug: normalized.categorySlug,
    description: normalized.description,
    base_price_pence: Math.round(Number(normalized.price ?? 0) * 100),
    sort_order: Number(normalized.sortOrder ?? 0),
    chilli_rating: Number(normalized.chilliRating ?? 0),
    image_url: normalized.imageUrl ?? null,
    active: normalized.active ?? true,
    loyverse_item_id: normalized.loyverseItemId || null,
    is_pizza: !['dips', 'drinks'].includes(resolveMenuCategorySlug(normalized.categorySlug, normalized.category)),
  }

  const { data, error } = await supabase
    .from('menu_items')
    .upsert(payload)
    .select(
      'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
    )
    .single()

  if (error || !data) {
    throw new Error(error.message)
  }

  return mapMenuItemRow(data as MenuItemRow)
}

export async function persistMenuItemRecipesToSupabase(
  menuItemId: string,
  recipeRows: MenuItemRecipe[],
): Promise<MenuItemRecipe[] | null> {
  if (!supabase) {
    throw new Error('Supabase client is not configured for recipe writes.')
  }

  const { error: deleteError } = await supabase
    .from('menu_item_recipes')
    .delete()
    .eq('menu_item_id', menuItemId)

  if (deleteError) {
    throw new Error(deleteError.message)
  }

  const payload = recipeRows
    .filter((entry) => entry.ingredientId && Number(entry.quantity) > 0)
    .map((entry) => ({
      menu_item_id: menuItemId,
      ingredient_id: entry.ingredientId,
      quantity: Number(entry.quantity),
      affects_availability: entry.affectsAvailability !== false,
    }))

  if (payload.length) {
    const { error: insertError } = await supabase.from('menu_item_recipes').insert(payload)
    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  const { data, error } = await supabase
    .from('menu_item_recipes')
    .select('id, menu_item_id, ingredient_id, quantity, affects_availability')
    .eq('menu_item_id', menuItemId)

  if (error) {
    throw new Error(error.message)
  }

  return ((data ?? []) as RecipeRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    affectsAvailability: row.affects_availability !== false,
  }))
}

export async function loadMasterDataFromSupabase(
  existingSnapshot: Pick<ServiceSnapshot, 'ingredients' | 'inventory' | 'inventoryDefaults' | 'modifiers' | 'orders' | 'discountCodes'>,
): Promise<MasterDataPatch | null> {
  if (!supabase) {
    return null
  }

  const [ingredientResult, { data: menuItemRows, error: menuItemError }, { data: recipeRows, error: recipeError }] =
    await Promise.all([
      selectIngredientRows(),
      supabase.from('menu_items').select(
        'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
      ),
      supabase.from('menu_item_recipes').select('id, menu_item_id, ingredient_id, quantity, affects_availability'),
    ])

  const { data: ingredientRows, error: ingredientError } = ingredientResult

  if (ingredientError || menuItemError || recipeError) {
    console.error('loadMasterDataFromSupabase error', { ingredientError, menuItemError, recipeError })
    return null
  }

  const ingredients = ((ingredientRows ?? []) as IngredientRow[]).map((row) =>
    mapIngredientRow(
      row,
      existingSnapshot.ingredients.find((entry) => entry.id === row.id || normalizeNameKey(entry.name) === normalizeNameKey(row.name)),
    ),
  )
  const menuItems = ((menuItemRows ?? []) as MenuItemRow[]).map((row) => mapMenuItemRow(row))
  const recipes = ((recipeRows ?? []) as RecipeRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    affectsAvailability: row.affects_availability !== false,
  }))

  return {
    ingredients,
    menuItems,
    recipes,
    inventory: existingSnapshot.inventory,
    inventoryDefaults: existingSnapshot.inventoryDefaults,
    modifiers: existingSnapshot.modifiers,
    orders: existingSnapshot.orders,
    discountCodes: existingSnapshot.discountCodes,
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
  if (!supabase) {
    return null
  }

  try {
    const [ingredientResult, { data: menuItemRows, error: menuLoadError }] =
      await Promise.all([
        selectIngredientRows(),
        supabase.from('menu_items').select(
          'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
        ),
      ])

    const { data: ingredientRows, error: ingredientLoadError } = ingredientResult

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

      const savedIngredient = await persistIngredientToSupabase({
        ...ingredient,
        id: existing?.id ?? ingredient.id,
      })
      if (!savedIngredient) {
        console.error('syncMasterDataToSupabase ingredient save error', { ingredient })
        return null
      }

      ingredientIdMap.set(ingredient.id, savedIngredient.id)
      syncedIngredients.push(savedIngredient)
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
  } catch (error) {
    console.error('syncMasterDataToSupabase unexpected error', error)
    return null
  }
}
