import { fromPriceMinor, MerchantStatus, validateMenuProduct } from "@pedilo/domain";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { AppError, badRequest, conflict, ErrorCode, notFound } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { getCategory } from "../catalog/service";
import { findApprovedMerchantBySlug, getMerchantAccess, type PublicMerchantDto } from "../merchants/service";
import {
  type MenuSectionRow,
  menuSections,
  type ModifierGroupRow,
  modifierGroups,
  type ModifierRow,
  modifiers,
  type ProductRow,
  products,
  type ProductVariantRow,
  productVariants,
} from "./schema";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface SectionDto {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface VariantDto {
  id: string;
  name: string;
  priceMinor: number;
  available: boolean;
}

export interface ModifierDto {
  id: string;
  name: string;
  priceDeltaMinor: number;
  maxQuantity: number;
  available: boolean;
}

export interface ModifierGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: ModifierDto[];
}

export interface ProductDto {
  id: string;
  sectionId: string | null;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
  /** Precio "desde" para listados (variante disponible más barata o precio del producto). */
  fromPriceMinor: number;
  available: boolean;
  active: boolean;
  sortOrder: number;
  variants: VariantDto[];
  modifierGroups: ModifierGroupDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MenuDto {
  sections: SectionDto[];
  products: ProductDto[];
}

export interface PublicMenuSectionDto {
  /** null = productos sin sección ("Otros"). */
  id: string | null;
  name: string;
  products: Omit<ProductDto, "active" | "sortOrder" | "createdAt" | "updatedAt">[];
}

export interface PublicMerchantMenuDto {
  merchant: PublicMerchantDto;
  sections: PublicMenuSectionDto[];
}

const toSectionDto = (s: MenuSectionRow): SectionDto => ({
  id: s.id,
  name: s.name,
  sortOrder: s.sortOrder,
  active: s.active,
});

function assemble(
  rows: ProductRow[],
  variants: ProductVariantRow[],
  groups: ModifierGroupRow[],
  mods: ModifierRow[],
): ProductDto[] {
  const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;
  return rows.map((p) => {
    const vs = variants
      .filter((v) => v.productId === p.id)
      .sort(bySort)
      .map((v) => ({ id: v.id, name: v.name, priceMinor: v.priceMinor, available: v.available }));
    const gs = groups
      .filter((g) => g.productId === p.id)
      .sort(bySort)
      .map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifiers: mods
          .filter((m) => m.groupId === g.id)
          .sort(bySort)
          .map((m) => ({
            id: m.id,
            name: m.name,
            priceDeltaMinor: m.priceDeltaMinor,
            maxQuantity: m.maxQuantity,
            available: m.available,
          })),
      }));
    return {
      id: p.id,
      sectionId: p.sectionId,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      fromPriceMinor: fromPriceMinor({ priceMinor: p.priceMinor, variants: vs }),
      available: p.available,
      active: p.active,
      sortOrder: p.sortOrder,
      variants: vs,
      modifierGroups: gs,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

async function loadProducts(db: DbOrTx, merchantId: string, productIds?: string[]): Promise<ProductDto[]> {
  const rows = await db
    .select()
    .from(products)
    .where(
      productIds
        ? and(eq(products.merchantId, merchantId), inArray(products.id, productIds))
        : eq(products.merchantId, merchantId),
    )
    .orderBy(asc(products.sortOrder), asc(products.name));
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [variants, groups] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
    db.select().from(modifierGroups).where(inArray(modifierGroups.productId, ids)),
  ]);
  const mods = groups.length
    ? await db.select().from(modifiers).where(inArray(modifiers.groupId, groups.map((g) => g.id)))
    : [];
  return assemble(rows, variants, groups, mods);
}

async function loadProduct(db: DbOrTx, merchantId: string, productId: string): Promise<ProductDto> {
  const [product] = await loadProducts(db, merchantId, [productId]);
  if (!product) throw notFound("Producto");
  return product;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

/** El catálogo se edita en cualquier estado salvo suspendido (ADR 0006). */
function assertCatalogEditable(status: MerchantStatus) {
  if (status === MerchantStatus.SUSPENDED) {
    throw conflict("El comercio está suspendido", { reason: "SUSPENDED" });
  }
}

async function editAccess(tx: Tx, merchantId: string, userId: string) {
  const access = await getMerchantAccess(tx, merchantId, userId, { owner: true, lock: true });
  assertCatalogEditable(access.status);
  return access;
}

async function assertSectionOfMerchant(db: DbOrTx, merchantId: string, sectionId: string) {
  const [row] = await db
    .select({ id: menuSections.id })
    .from(menuSections)
    .where(and(eq(menuSections.id, sectionId), eq(menuSections.merchantId, merchantId)));
  if (!row) throw badRequest("La sección no existe en este comercio", { field: "sectionId" });
}

async function assertProductCategory(db: DbOrTx, categoryId: string) {
  try {
    const category = await getCategory(db, categoryId);
    if (category.kind !== "PRODUCT" || !category.active) {
      throw badRequest("Categoría de producto inválida", { field: "categoryId" });
    }
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.NOT_FOUND) {
      throw badRequest("Categoría de producto inválida", { field: "categoryId" });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/** Menú completo para el comercio (incluye pausados y archivados). */
export async function getMerchantMenu(db: Db, merchantId: string, userId: string): Promise<MenuDto> {
  await getMerchantAccess(db, merchantId, userId);
  const [sections, productList] = await Promise.all([
    db
      .select()
      .from(menuSections)
      .where(eq(menuSections.merchantId, merchantId))
      .orderBy(asc(menuSections.sortOrder), asc(menuSections.name)),
    loadProducts(db, merchantId),
  ]);
  return { sections: sections.map(toSectionDto), products: productList };
}

/**
 * Menú público de un comercio aprobado: secciones activas con sus productos activos
 * (los pausados aparecen con `available: false`). Sin sección → "Otros", al final.
 */
export async function getPublicMerchantMenu(db: Db, slug: string): Promise<PublicMerchantMenuDto> {
  const merchant = await findApprovedMerchantBySlug(db, slug);
  if (!merchant) throw notFound("Comercio");

  const [sections, productList] = await Promise.all([
    db
      .select()
      .from(menuSections)
      .where(and(eq(menuSections.merchantId, merchant.id), eq(menuSections.active, true)))
      .orderBy(asc(menuSections.sortOrder), asc(menuSections.name)),
    loadProducts(db, merchant.id),
  ]);
  const visible = productList
    .filter((p) => p.active)
    .map(({ active: _a, sortOrder: _s, createdAt: _c, updatedAt: _u, ...rest }) => rest);

  const result: PublicMenuSectionDto[] = sections
    .map((s) => ({ id: s.id, name: s.name, products: visible.filter((p) => p.sectionId === s.id) }))
    .filter((s) => s.products.length > 0);
  // Los productos de secciones desactivadas se ocultan; los que no tienen sección van a "Otros".
  const unsectioned = visible.filter((p) => p.sectionId === null);
  if (unsectioned.length > 0) result.push({ id: null, name: "Otros", products: unsectioned });
  return { merchant, sections: result };
}

/**
 * Para el módulo de pedidos: productos ACTIVOS del comercio con sus variantes y modificadores,
 * listos para `priceSelection`. Los ids que no existan o estén archivados no aparecen en el mapa.
 */
export async function getProductsForOrder(
  db: DbOrTx,
  merchantId: string,
  productIds: string[],
): Promise<Map<string, ProductDto>> {
  if (productIds.length === 0) return new Map();
  const list = await loadProducts(db, merchantId, [...new Set(productIds)]);
  return new Map(list.filter((p) => p.active).map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

export interface SectionInput {
  name: string;
  sortOrder?: number | undefined;
  active?: boolean | undefined;
}

export async function createSection(db: Db, merchantId: string, input: SectionInput, actor: Actor): Promise<SectionDto> {
  return db.transaction(async (tx) => {
    await editAccess(tx, merchantId, actor.userId);
    const [row] = await tx
      .insert(menuSections)
      .values({
        merchantId,
        name: input.name,
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.active !== undefined && { active: input.active }),
      })
      .returning();
    if (!row) throw new Error("insert sin resultado");
    const dto = toSectionDto(row);
    await recordAudit(tx, actor, { action: "menu.section.create", entityType: "menu_section", entityId: row.id, after: dto });
    return dto;
  });
}

export async function updateSection(
  db: Db,
  merchantId: string,
  sectionId: string,
  input: Partial<SectionInput>,
  actor: Actor,
): Promise<SectionDto> {
  return db.transaction(async (tx) => {
    await editAccess(tx, merchantId, actor.userId);
    const [current] = await tx
      .select()
      .from(menuSections)
      .where(and(eq(menuSections.id, sectionId), eq(menuSections.merchantId, merchantId)));
    if (!current) throw notFound("Sección");
    const [row] = await tx
      .update(menuSections)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.active !== undefined && { active: input.active }),
      })
      .where(eq(menuSections.id, sectionId))
      .returning();
    if (!row) throw notFound("Sección");
    const dto = toSectionDto(row);
    await recordAudit(tx, actor, {
      action: "menu.section.update",
      entityType: "menu_section",
      entityId: sectionId,
      before: toSectionDto(current),
      after: dto,
    });
    return dto;
  });
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export interface VariantInput {
  id?: string | undefined;
  name: string;
  priceMinor: number;
  available?: boolean | undefined;
}

export interface ModifierInput {
  id?: string | undefined;
  name: string;
  priceDeltaMinor: number;
  maxQuantity?: number | undefined;
  available?: boolean | undefined;
}

export interface ModifierGroupInput {
  id?: string | undefined;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: ModifierInput[];
}

export interface ProductInput {
  name: string;
  description?: string | null | undefined;
  sectionId?: string | null | undefined;
  categoryId?: string | null | undefined;
  priceMinor: number;
  available?: boolean | undefined;
  active?: boolean | undefined;
  sortOrder?: number | undefined;
  variants: VariantInput[];
  modifierGroups: ModifierGroupInput[];
}

/** Valida con las reglas de dominio (ADR 0006); las rutas del problema van en `details.problems`. */
function validateProductInput(input: ProductInput) {
  const problems = validateMenuProduct({
    name: input.name,
    priceMinor: input.priceMinor,
    variants: input.variants.map((v) => ({ name: v.name, priceMinor: v.priceMinor, available: v.available ?? true })),
    modifierGroups: input.modifierGroups.map((g) => ({
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.modifiers.map((m) => ({
        name: m.name,
        priceDeltaMinor: m.priceDeltaMinor,
        maxQuantity: m.maxQuantity ?? 1,
        available: m.available ?? true,
      })),
    })),
  });
  if (problems.length > 0) throw badRequest("El producto tiene errores", { problems });
}

async function assertReferences(tx: Tx, merchantId: string, input: Pick<ProductInput, "sectionId" | "categoryId">) {
  if (input.sectionId) await assertSectionOfMerchant(tx, merchantId, input.sectionId);
  if (input.categoryId) await assertProductCategory(tx, input.categoryId);
}

const unknownId = (kind: string, id: string) => badRequest(`${kind} inexistente en este producto`, { id });

/**
 * Sincroniza variantes y grupos/modificadores del producto con lo enviado:
 * con id → se actualiza (debe pertenecer a ESTE producto/grupo); sin id → se crea; lo que no vino → se borra.
 */
async function syncChildren(tx: Tx, productId: string, input: ProductInput) {
  // --- Variantes ---
  const existingVariants = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, productId));
  const variantIds = new Set(existingVariants.map((v) => v.id));
  for (const v of input.variants) if (v.id && !variantIds.has(v.id)) throw unknownId("Variante", v.id);

  const keepVariants = input.variants.flatMap((v) => (v.id ? [v.id] : []));
  await tx
    .delete(productVariants)
    .where(
      keepVariants.length
        ? and(eq(productVariants.productId, productId), notInArray(productVariants.id, keepVariants))
        : eq(productVariants.productId, productId),
    );
  for (const [i, v] of input.variants.entries()) {
    const values = { name: v.name, priceMinor: v.priceMinor, available: v.available ?? true, sortOrder: i };
    if (v.id) await tx.update(productVariants).set(values).where(eq(productVariants.id, v.id));
    else await tx.insert(productVariants).values({ productId, ...values });
  }

  // --- Grupos y modificadores ---
  const existingGroups = await tx.select({ id: modifierGroups.id }).from(modifierGroups).where(eq(modifierGroups.productId, productId));
  const groupIds = new Set(existingGroups.map((g) => g.id));
  const existingMods = groupIds.size
    ? await tx
        .select({ id: modifiers.id, groupId: modifiers.groupId })
        .from(modifiers)
        .where(inArray(modifiers.groupId, [...groupIds]))
    : [];
  const modGroup = new Map(existingMods.map((m) => [m.id, m.groupId]));
  for (const g of input.modifierGroups) {
    if (g.id && !groupIds.has(g.id)) throw unknownId("Grupo", g.id);
    for (const m of g.modifiers) {
      if (m.id && (!g.id || modGroup.get(m.id) !== g.id)) throw unknownId("Opción", m.id);
    }
  }

  const keepGroups = input.modifierGroups.flatMap((g) => (g.id ? [g.id] : []));
  await tx
    .delete(modifierGroups)
    .where(
      keepGroups.length
        ? and(eq(modifierGroups.productId, productId), notInArray(modifierGroups.id, keepGroups))
        : eq(modifierGroups.productId, productId),
    );

  for (const [gi, g] of input.modifierGroups.entries()) {
    const groupValues = { name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: gi };
    let groupId = g.id;
    if (groupId) {
      await tx.update(modifierGroups).set(groupValues).where(eq(modifierGroups.id, groupId));
      const keepMods = g.modifiers.flatMap((m) => (m.id ? [m.id] : []));
      await tx
        .delete(modifiers)
        .where(keepMods.length ? and(eq(modifiers.groupId, groupId), notInArray(modifiers.id, keepMods)) : eq(modifiers.groupId, groupId));
    } else {
      const [created] = await tx.insert(modifierGroups).values({ productId, ...groupValues }).returning({ id: modifierGroups.id });
      groupId = created!.id;
    }
    for (const [mi, m] of g.modifiers.entries()) {
      const values = {
        name: m.name,
        priceDeltaMinor: m.priceDeltaMinor,
        maxQuantity: m.maxQuantity ?? 1,
        available: m.available ?? true,
        sortOrder: mi,
      };
      if (m.id) await tx.update(modifiers).set(values).where(eq(modifiers.id, m.id));
      else await tx.insert(modifiers).values({ groupId, ...values });
    }
  }
}

export async function createProduct(db: Db, merchantId: string, input: ProductInput, actor: Actor): Promise<ProductDto> {
  validateProductInput(input);
  // Al crear, ningún hijo puede traer id.
  if (input.variants.some((v) => v.id) || input.modifierGroups.some((g) => g.id || g.modifiers.some((m) => m.id))) {
    throw badRequest("Un producto nuevo no puede traer ids de variantes ni opciones");
  }
  return db.transaction(async (tx) => {
    await editAccess(tx, merchantId, actor.userId);
    await assertReferences(tx, merchantId, input);
    const [row] = await tx
      .insert(products)
      .values({
        merchantId,
        name: input.name,
        description: input.description ?? null,
        sectionId: input.sectionId ?? null,
        categoryId: input.categoryId ?? null,
        priceMinor: input.priceMinor,
        ...(input.available !== undefined && { available: input.available }),
        ...(input.active !== undefined && { active: input.active }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      })
      .returning();
    if (!row) throw new Error("insert sin resultado");
    await syncChildren(tx, row.id, input);
    const dto = await loadProduct(tx, merchantId, row.id);
    await recordAudit(tx, actor, { action: "menu.product.create", entityType: "product", entityId: row.id, after: dto });
    return dto;
  });
}

/** Reemplaza el producto completo (datos, variantes y modificadores). */
export async function replaceProduct(
  db: Db,
  merchantId: string,
  productId: string,
  input: ProductInput,
  actor: Actor,
): Promise<ProductDto> {
  validateProductInput(input);
  return db.transaction(async (tx) => {
    await editAccess(tx, merchantId, actor.userId);
    const before = await loadProduct(tx, merchantId, productId);
    await assertReferences(tx, merchantId, input);
    await tx
      .update(products)
      .set({
        name: input.name,
        description: input.description ?? null,
        sectionId: input.sectionId ?? null,
        categoryId: input.categoryId ?? null,
        priceMinor: input.priceMinor,
        available: input.available ?? before.available,
        active: input.active ?? before.active,
        sortOrder: input.sortOrder ?? before.sortOrder,
      })
      .where(eq(products.id, productId));
    await syncChildren(tx, productId, input);
    const dto = await loadProduct(tx, merchantId, productId);
    await recordAudit(tx, actor, { action: "menu.product.update", entityType: "product", entityId: productId, before, after: dto });
    return dto;
  });
}

/** Pausar / reanudar rápido, sin reenviar el producto completo (US-203). */
export async function setProductAvailability(
  db: Db,
  merchantId: string,
  productId: string,
  available: boolean,
  actor: Actor,
): Promise<ProductDto> {
  return db.transaction(async (tx) => {
    await editAccess(tx, merchantId, actor.userId);
    const [row] = await tx
      .update(products)
      .set({ available })
      .where(and(eq(products.id, productId), eq(products.merchantId, merchantId)))
      .returning({ id: products.id });
    if (!row) throw notFound("Producto");
    await recordAudit(tx, actor, {
      action: available ? "menu.product.resume" : "menu.product.pause",
      entityType: "product",
      entityId: productId,
      after: { available },
    });
    return loadProduct(tx, merchantId, productId);
  });
}
