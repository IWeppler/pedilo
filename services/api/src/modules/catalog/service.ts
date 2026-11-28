import type { MerchantCategory } from "@pedilo/domain";
import { and, asc, eq, type SQL } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { slugify } from "../../lib/slug";
import { type Actor, recordAudit } from "../audit/service";
import { categories, CategoryKind, type CategoryRow } from "./schema";

export interface CategoryDto {
  id: string;
  parentId: string | null;
  kind: CategoryKind;
  name: string;
  slug: string;
  commissionCategory: MerchantCategory | null;
  sortOrder: number;
  active: boolean;
  /** Posición como tipo de comida en el inicio de la app; null = no aparece (solo de producto). */
  featuredOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  kind: CategoryKind;
  name: string;
  slug?: string | undefined;
  parentId?: string | null | undefined;
  commissionCategory?: MerchantCategory | null | undefined;
  sortOrder?: number | undefined;
  active?: boolean | undefined;
  featuredOrder?: number | null | undefined;
}

/** `kind` no se puede cambiar: rompería la jerarquía y los rubros asignados. */
export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, "kind">>;

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    commissionCategory: row.commissionCategory ?? null,
    sortOrder: row.sortOrder,
    active: row.active,
    featuredOrder: row.featuredOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ordering = [asc(categories.sortOrder), asc(categories.name)];

/**
 * Categorías visibles al público: activas y con todos sus ancestros activos
 * (desactivar un padre oculta a toda su rama).
 */
export async function listPublicCategories(db: Db, kind?: CategoryKind, featured?: boolean): Promise<CategoryDto[]> {
  // Tipos de comida del inicio: en su posición, no en el orden del catálogo.
  if (featured) {
    const all = await listPublicCategories(db, kind);
    return all.filter((c) => c.featuredOrder !== null).sort((a, b) => a.featuredOrder! - b.featuredOrder! || a.name.localeCompare(b.name, "es"));
  }
  const rows = await db
    .select()
    .from(categories)
    .where(kind ? eq(categories.kind, kind) : undefined)
    .orderBy(...ordering);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const isVisible = (row: CategoryRow): boolean => {
    let current: CategoryRow | undefined = row;
    for (let depth = 0; current && depth < 50; depth++) {
      if (!current.active) return false;
      if (!current.parentId) return true;
      current = byId.get(current.parentId);
    }
    return false;
  };
  return rows.filter((r) => isVisible(r) && (featured === undefined || r.featuredOrder === null)).map(toCategoryDto);
}

export async function listAllCategories(db: Db, kind?: CategoryKind): Promise<CategoryDto[]> {
  const filter: SQL | undefined = kind ? eq(categories.kind, kind) : undefined;
  const rows = await db.select().from(categories).where(filter).orderBy(...ordering);
  return rows.map(toCategoryDto);
}

/**
 * La categoría y todas las de su rama (p. ej. «Bebidas» incluye «Cervezas» si cuelga de ella), para
 * filtrar por un tipo de comida sin que el comercio tenga que elegir el padre.
 */
export async function categoryBranchIds(db: DbOrTx, id: string): Promise<string[]> {
  const rows = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  const out: string[] = [];
  const queue = rows.some((r) => r.id === id) ? [id] : [];
  while (queue.length && out.length < 1000) {
    const next = queue.shift()!;
    out.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return out;
}

export async function getCategory(db: DbOrTx, id: string): Promise<CategoryDto> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  if (!row) throw notFound("Categoría");
  return toCategoryDto(row);
}

export async function createCategory(db: Db, input: CreateCategoryInput, actor: Actor): Promise<CategoryDto> {
  assertCommissionCategoryAllowed(input.kind, input.commissionCategory);
  assertFeaturedAllowed(input.kind, input.featuredOrder);
  try {
    return await db.transaction(async (tx) => {
      if (input.parentId) await assertValidParent(tx, input.kind, input.parentId, null);

      const [row] = await tx
        .insert(categories)
        .values({
          kind: input.kind,
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          parentId: input.parentId ?? null,
          commissionCategory: input.commissionCategory ?? null,
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.active !== undefined && { active: input.active }),
          ...(input.featuredOrder !== undefined && { featuredOrder: input.featuredOrder }),
        })
        .returning();
      if (!row) throw new Error("insert sin resultado");

      const dto = toCategoryDto(row);
      await recordAudit(tx, actor, {
        action: "category.create",
        entityType: "category",
        entityId: row.id,
        after: dto,
      });
      return dto;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una categoría de ese tipo con ese slug");
    throw err;
  }
}

export async function updateCategory(
  db: Db,
  id: string,
  input: UpdateCategoryInput,
  actor: Actor,
): Promise<CategoryDto> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(categories).where(eq(categories.id, id)).for("update");
      if (!current) throw notFound("Categoría");

      if (input.commissionCategory !== undefined) {
        assertCommissionCategoryAllowed(current.kind, input.commissionCategory);
      }
      if (input.parentId) await assertValidParent(tx, current.kind, input.parentId, id);
      assertFeaturedAllowed(current.kind, input.featuredOrder);

      const [row] = await tx
        .update(categories)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.commissionCategory !== undefined && { commissionCategory: input.commissionCategory }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.active !== undefined && { active: input.active }),
          ...(input.featuredOrder !== undefined && { featuredOrder: input.featuredOrder }),
        })
        .where(eq(categories.id, id))
        .returning();
      if (!row) throw notFound("Categoría");

      const dto = toCategoryDto(row);
      await recordAudit(tx, actor, {
        action: "category.update",
        entityType: "category",
        entityId: id,
        before: toCategoryDto(current),
        after: dto,
      });
      return dto;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una categoría de ese tipo con ese slug");
    throw err;
  }
}

function assertCommissionCategoryAllowed(kind: CategoryKind, value: MerchantCategory | null | undefined) {
  if (value && kind !== CategoryKind.MERCHANT) {
    throw badRequest("Solo los rubros (kind MERCHANT) tienen categoría de comisión");
  }
}

function assertFeaturedAllowed(kind: CategoryKind, featuredOrder: number | null | undefined) {
  if (featuredOrder !== undefined && featuredOrder !== null && kind !== CategoryKind.PRODUCT) {
    throw badRequest("Solo las categorías de producto se muestran como tipo de comida en la app");
  }
}

/**
 * El padre debe existir, ser del mismo tipo y no crear un ciclo
 * (una categoría no puede quedar debajo de sí misma ni de un descendiente).
 */
async function assertValidParent(tx: DbOrTx, kind: CategoryKind, parentId: string, selfId: string | null) {
  if (parentId === selfId) throw badRequest("Una categoría no puede ser su propio padre");

  const sameKind = await tx
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.kind, kind)));
  const parentOf = new Map(sameKind.map((c) => [c.id, c.parentId]));

  if (!parentOf.has(parentId)) {
    throw badRequest("La categoría padre no existe o es de otro tipo", { parentId });
  }
  if (selfId) {
    let cursor: string | null | undefined = parentId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === selfId) throw badRequest("Ese cambio de padre crearía un ciclo");
      cursor = parentOf.get(cursor);
    }
  }
}
