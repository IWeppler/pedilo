import { and, asc, eq } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { slugify } from "../../lib/slug";
import { type Actor, recordAudit } from "../audit/service";
import { cities, type CityRow } from "./schema";

export interface CityDto {
  id: string;
  name: string;
  slug: string;
  province: string;
  country: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCityInput {
  name: string;
  province: string;
  slug?: string | undefined;
  timezone?: string | undefined;
  active?: boolean | undefined;
}

export type UpdateCityInput = Partial<CreateCityInput>;

export function toCityDto(row: CityRow): CityDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    province: row.province,
    country: row.country,
    timezone: row.timezone,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listActiveCities(db: Db): Promise<CityDto[]> {
  const rows = await db.select().from(cities).where(eq(cities.active, true)).orderBy(asc(cities.name));
  return rows.map(toCityDto);
}

export async function listAllCities(db: Db): Promise<CityDto[]> {
  const rows = await db.select().from(cities).orderBy(asc(cities.name));
  return rows.map(toCityDto);
}

export async function getCity(db: DbOrTx, id: string): Promise<CityDto> {
  const [row] = await db.select().from(cities).where(eq(cities.id, id));
  if (!row) throw notFound("Ciudad");
  return toCityDto(row);
}

/** Ciudad activa por slug, o null. Para rutas públicas. */
export async function findActiveCityBySlug(db: DbOrTx, slug: string): Promise<CityDto | null> {
  const [row] = await db
    .select()
    .from(cities)
    .where(and(eq(cities.slug, slug), eq(cities.active, true)));
  return row ? toCityDto(row) : null;
}

export async function createCity(db: Db, input: CreateCityInput, actor: Actor): Promise<CityDto> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cities)
        .values({
          name: input.name,
          province: input.province,
          slug: input.slug ?? slugify(input.name),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.active !== undefined && { active: input.active }),
        })
        .returning();
      if (!row) throw new Error("insert sin resultado");
      const dto = toCityDto(row);
      await recordAudit(tx, actor, { action: "city.create", entityType: "city", entityId: row.id, after: dto });
      return dto;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una ciudad con ese slug");
    throw err;
  }
}

export async function updateCity(db: Db, id: string, input: UpdateCityInput, actor: Actor): Promise<CityDto> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(cities).where(eq(cities.id, id)).for("update");
      if (!current) throw notFound("Ciudad");

      const [row] = await tx
        .update(cities)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.province !== undefined && { province: input.province }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.active !== undefined && { active: input.active }),
        })
        .where(eq(cities.id, id))
        .returning();
      if (!row) throw notFound("Ciudad");

      const dto = toCityDto(row);
      await recordAudit(tx, actor, {
        action: "city.update",
        entityType: "city",
        entityId: id,
        before: toCityDto(current),
        after: dto,
      });
      return dto;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una ciudad con ese slug");
    throw err;
  }
}
