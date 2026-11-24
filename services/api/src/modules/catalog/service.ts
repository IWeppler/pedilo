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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ordering = [asc(categories.sortOrder), asc(categories.name)];

/**
 * Categorías visibles al público: activas y con todos sus ancestros activos
 * (desactivar un padre oculta a toda su rama).
 */
export async function listPublicCategories(db: Db, kind?: CategoryKind): Promise<CategoryDto[]> {
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
  return rows.filter(isVisible).map(toCategoryDto);
}

export async function listAllCategories(db: Db, kind?: CategoryKind): Promise<CategoryDto[]> {
  const filter: SQL | undefined = kind ? eq(categories.kind, kind) : undefined;
  const rows = await db.select().from(categories).where(filter).orderBy(...ordering);
  return rows.map(toCategoryDto);
}

export async function getCategory(db: DbOrTx, id: string): Promise<CategoryDto> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  if (!row) throw notFound("Categoría");
  return toCategoryDto(row);
}

export async function createCategory(db: Db, input: CreateCategoryInput, actor: Actor): Promise<CategoryDto> {
  assertCommissionCategoryAllowed(input.kind, input.commissionCategory);
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

      const [row] = await tx
        .update(categories)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.commissionCategory !== undefined && { commissionCategory: input.commissionCategory }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.active !== undefined && { active: input.active }),
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
