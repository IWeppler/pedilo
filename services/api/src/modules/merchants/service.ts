import {
  canEditFullProfile,
  closureOn,
  isOpenAtInstant,
  localDateKey,
  validateClosure,
  formatTime,
  merchantStateMachine,
  MerchantRole,
  MerchantStatus,
  normalizeCuit,
  type OnboardingProblem,
  onboardingProblems,
  type OpeningRange,
  parseTime,
  validateSchedule,
} from "@pedilo/domain";
import { and, asc, desc, eq, gte, inArray, like, or, type SQL } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { AppError, badRequest, conflict, ErrorCode, forbidden, notFound } from "../../lib/errors";
import { media, mediaPath, mediaUrl, processImage } from "../../lib/media";
import { slugify } from "../../lib/slug";
import { type Actor, recordAudit } from "../audit/service";
import { getCategory } from "../catalog/service";
import { findActiveCityBySlug, getCity } from "../geography/service";
import { getUserSummaries } from "../identity/service";
import {
  branchClosures,
  type BranchClosureRow,
  branches,
  type BranchRow,
  businessHours,
  type BusinessHoursRow,
  deliveryZones,
  type DeliveryZoneRow,
  merchantMembers,
  type MerchantRow,
  merchants,
} from "./schema";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface MerchantDto {
  id: string;
  displayName: string;
  legalName: string;
  taxId: string;
  slug: string;
  categoryId: string;
  contactPhone: string;
  contactEmail: string | null;
  /** Medios de pago (ADR 0011). */
  payment: PaymentSettingsDto;
  /** Logo y portada (ADR 0017). Relativas a la API en modo local. */
  logoUrl: string | null;
  coverUrl: string | null;
  status: MerchantStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSettingsDto {
  acceptsCash: boolean;
  acceptsTransfer: boolean;
  /** Datos para transferir (null si no cargó ninguno). */
  transfer: { alias: string | null; cbu: string | null; holder: string | null } | null;
}

export interface SchedulingDto {
  enabled: boolean;
  leadMinutes: number;
  maxDays: number;
  /** Pedidos por franja de 30 min; null = sin límite. */
  slotCapacity: number | null;
}

export interface OpeningRangeDto {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface DeliveryZoneDto {
  id: string;
  name: string;
  description: string | null;
  feeMinor: number;
  minOrderMinor: number;
  active: boolean;
}

export interface BranchDto {
  id: string;
  name: string;
  cityId: string;
  addressLine: string;
  addressNotes: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  timezone: string;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
  active: boolean;
  scheduling: SchedulingDto;
  hours: OpeningRangeDto[];
  zones: DeliveryZoneDto[];
  /** Cierres excepcionales vigentes o futuros (ADR 0018). */
  closures: BranchClosureDto[];
}

export interface BranchClosureDto {
  id: string;
  startsOn: string;
  endsOn: string;
  reason: string;
}

export interface MerchantDetailDto extends MerchantDto {
  branches: BranchDto[];
  onboarding: { ready: boolean; problems: OnboardingProblem[] };
}

export interface MyMerchantDto extends MerchantDto {
  role: MerchantRole;
}

export interface AdminMerchantSummaryDto extends MerchantDto {
  owner: { id: string; email: string | null; phone: string | null } | null;
  branchCount: number;
}

export interface AdminMerchantDetailDto extends MerchantDetailDto {
  owner: { id: string; email: string | null; phone: string | null } | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toMerchantDto(row: MerchantRow): MerchantDto {
  return {
    id: row.id,
    displayName: row.displayName,
    legalName: row.legalName,
    taxId: row.taxId,
    slug: row.slug,
    categoryId: row.categoryId,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    payment: {
      acceptsCash: row.acceptsCash,
      acceptsTransfer: row.acceptsTransfer,
      transfer:
        row.transferAlias || row.transferCbu || row.transferHolder
          ? { alias: row.transferAlias, cbu: row.transferCbu, holder: row.transferHolder }
          : null,
    },
    logoUrl: mediaUrl(row.logoPath),
    coverUrl: mediaUrl(row.coverPath),
    status: row.status,
    rejectionReason: row.rejectionReason,
    submittedAt: iso(row.submittedAt),
    reviewedAt: iso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toZoneDto(z: DeliveryZoneRow): DeliveryZoneDto {
  return {
    id: z.id,
    name: z.name,
    description: z.description,
    feeMinor: z.feeMinor,
    minOrderMinor: z.minOrderMinor,
    active: z.active,
  };
}

function toBranchDto(b: BranchRow, hours: BusinessHoursRow[], zones: DeliveryZoneRow[], closures: BranchClosureRow[] = []): BranchDto {
  return {
    id: b.id,
    name: b.name,
    cityId: b.cityId,
    addressLine: b.addressLine,
    addressNotes: b.addressNotes,
    lat: b.lat,
    lng: b.lng,
    phone: b.phone,
    timezone: b.timezone,
    acceptsPickup: b.acceptsPickup,
    acceptsDelivery: b.acceptsDelivery,
    active: b.active,
    scheduling: {
      enabled: b.schedulingEnabled,
      leadMinutes: b.scheduleLeadMinutes,
      maxDays: b.scheduleMaxDays,
      slotCapacity: b.slotCapacity,
    },
    hours: hours
      .filter((h) => h.branchId === b.id)
      .sort((a, c) => a.weekday - c.weekday || a.opensAt - c.opensAt)
      .map((h) => ({ weekday: h.weekday, opensAt: formatTime(h.opensAt), closesAt: formatTime(h.closesAt) })),
    zones: zones
      .filter((z) => z.branchId === b.id)
      .sort((a, c) => a.name.localeCompare(c.name))
      .map(toZoneDto),
    closures: closures
      .filter((c) => c.branchId === b.id)
      .map((c) => ({ id: c.id, startsOn: c.startsOn, endsOn: c.endsOn, reason: c.reason })),
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RegisterMerchantInput {
  displayName: string;
  legalName: string;
  taxId: string;
  categoryId: string;
  contactPhone: string;
  contactEmail?: string | null | undefined;
}

export type UpdateMerchantInput = Partial<RegisterMerchantInput>;

/** Campos que se pueden cambiar con el comercio ya aprobado; el resto requiere nueva revisión. */
const BASIC_PROFILE_FIELDS = ["displayName", "contactPhone", "contactEmail"] as const;

export interface BranchInput {
  name: string;
  cityId: string;
  addressLine: string;
  addressNotes?: string | null | undefined;
  lat?: number | null | undefined;
  lng?: number | null | undefined;
  phone?: string | null | undefined;
  acceptsPickup?: boolean | undefined;
  acceptsDelivery?: boolean | undefined;
  active?: boolean | undefined;
  scheduling?: Partial<SchedulingDto> | undefined;
}

export type UpdateBranchInput = Partial<BranchInput>;

export interface PaymentSettingsInput {
  acceptsCash: boolean;
  acceptsTransfer: boolean;
  transfer?: { alias?: string | null | undefined; cbu?: string | null | undefined; holder?: string | null | undefined } | null | undefined;
}

export interface ZoneInput {
  name: string;
  description?: string | null | undefined;
  feeMinor: number;
  minOrderMinor?: number | undefined;
  active?: boolean | undefined;
}

export type UpdateZoneInput = Partial<ZoneInput>;

// ---------------------------------------------------------------------------
// Pertenencia y reglas de edición
// ---------------------------------------------------------------------------

interface Membership {
  merchant: MerchantRow;
  role: MerchantRole;
}

/**
 * Carga el comercio si el usuario es miembro. Si no lo es, 404 (no 403): no se revela
 * qué comercios existen (SPEC §16, protección contra enumeración).
 */
async function loadMembership(db: DbOrTx, merchantId: string, userId: string, forUpdate = false) {
  const query = db
    .select({ merchant: merchants, role: merchantMembers.role })
    .from(merchants)
    .innerJoin(
      merchantMembers,
      and(eq(merchantMembers.merchantId, merchants.id), eq(merchantMembers.userId, userId)),
    )
    .where(eq(merchants.id, merchantId));
  const [row] = forUpdate ? await query.for("update", { of: merchants }) : await query;
  if (!row) throw notFound("Comercio");
  return row satisfies Membership;
}

async function loadOwnership(db: DbOrTx, merchantId: string, userId: string): Promise<Membership> {
  const m = await loadMembership(db, merchantId, userId, true);
  if (m.role !== MerchantRole.OWNER) throw forbidden("Solo el dueño del comercio puede hacer esto");
  return m;
}

/** Sucursales, horarios y zonas no se tocan mientras el comercio está en revisión o suspendido. */
function assertOperationsEditable(status: MerchantStatus) {
  if (status === MerchantStatus.PENDING_REVIEW) {
    throw conflict("El comercio está en revisión: no se puede modificar hasta que se resuelva", {
      reason: "IN_REVIEW",
    });
  }
  if (status === MerchantStatus.SUSPENDED) {
    throw conflict("El comercio está suspendido", { reason: "SUSPENDED" });
  }
}

async function assertMerchantCategory(db: DbOrTx, categoryId: string) {
  try {
    const category = await getCategory(db, categoryId);
    if (category.kind !== "MERCHANT" || !category.active) throw badRequest("Rubro inválido", { field: "categoryId" });
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.NOT_FOUND) {
      throw badRequest("Rubro inválido", { field: "categoryId" });
    }
    throw err;
  }
}

async function cityTimezone(db: DbOrTx, cityId: string): Promise<string> {
  try {
    const city = await getCity(db, cityId);
    if (!city.active) throw badRequest("Ciudad inactiva", { field: "cityId" });
    return city.timezone;
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.NOT_FOUND) {
      throw badRequest("Ciudad inexistente", { field: "cityId" });
    }
    throw err;
  }
}

async function uniqueMerchantSlug(db: DbOrTx, base: string): Promise<string> {
  const root = base || "comercio";
  const taken = new Set(
    (
      await db
        .select({ slug: merchants.slug })
        .from(merchants)
        .where(or(eq(merchants.slug, root), like(merchants.slug, `${root}-%`)))
    ).map((r) => r.slug),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

async function loadBranchOf(db: DbOrTx, merchantId: string, branchId: string): Promise<BranchRow> {
  const [row] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.merchantId, merchantId)));
  if (!row) throw notFound("Sucursal");
  return row;
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

async function loadDetail(db: DbOrTx, merchant: MerchantRow): Promise<MerchantDetailDto> {
  const branchRows = await db
    .select()
    .from(branches)
    .where(eq(branches.merchantId, merchant.id))
    .orderBy(asc(branches.createdAt));
  const ids = branchRows.map((b) => b.id);
  const [hours, zones, closures] = ids.length
    ? await Promise.all([
        db.select().from(businessHours).where(inArray(businessHours.branchId, ids)),
        db.select().from(deliveryZones).where(inArray(deliveryZones.branchId, ids)),
        currentClosures(db, ids),
      ])
    : [[], [], []];

  const branchDtos = branchRows.map((b) => toBranchDto(b, hours, zones, closures));
  const problems = onboardingProblems(
    branchDtos.map((b) => ({
      id: b.id,
      active: b.active,
      hoursCount: b.hours.length,
      acceptsPickup: b.acceptsPickup,
      acceptsDelivery: b.acceptsDelivery,
      activeZonesCount: b.zones.filter((z) => z.active).length,
    })),
  );
  return { ...toMerchantDto(merchant), branches: branchDtos, onboarding: { ready: problems.length === 0, problems } };
}

export async function listMyMerchants(db: Db, userId: string): Promise<MyMerchantDto[]> {
  const rows = await db
    .select({ merchant: merchants, role: merchantMembers.role })
    .from(merchants)
    .innerJoin(merchantMembers, eq(merchantMembers.merchantId, merchants.id))
    .where(eq(merchantMembers.userId, userId))
    .orderBy(asc(merchants.displayName));
  return rows.map((r) => ({ ...toMerchantDto(r.merchant), role: r.role }));
}

export async function getMerchantForMember(
  db: Db,
  merchantId: string,
  userId: string,
): Promise<MerchantDetailDto & { role: MerchantRole }> {
  const { merchant, role } = await loadMembership(db, merchantId, userId);
  return { ...(await loadDetail(db, merchant)), role };
}

// ---------------------------------------------------------------------------
// Alta y perfil
// ---------------------------------------------------------------------------

export async function registerMerchant(
  db: Db,
  input: RegisterMerchantInput,
  actor: Actor,
): Promise<MerchantDetailDto> {
  return db.transaction(async (tx) => {
    await assertMerchantCategory(tx, input.categoryId);
    const [row] = await tx
      .insert(merchants)
      .values({
        displayName: input.displayName,
        legalName: input.legalName,
        taxId: normalizeCuit(input.taxId),
        slug: await uniqueMerchantSlug(tx, slugify(input.displayName)),
        categoryId: input.categoryId,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail ?? null,
      })
      .returning();
    if (!row) throw new Error("insert sin resultado");
    await tx.insert(merchantMembers).values({ merchantId: row.id, userId: actor.userId, role: MerchantRole.OWNER });
    await recordAudit(tx, actor, {
      action: "merchant.register",
      entityType: "merchant",
      entityId: row.id,
      after: toMerchantDto(row),
    });
    return loadDetail(tx, row);
  });
}

export async function updateMerchantProfile(
  db: Db,
  merchantId: string,
  input: UpdateMerchantInput,
  actor: Actor,
): Promise<MerchantDetailDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);

    if (!canEditFullProfile(merchant.status)) {
      const restricted = Object.entries(input)
        .filter(([k, v]) => v !== undefined && !(BASIC_PROFILE_FIELDS as readonly string[]).includes(k))
        .map(([k]) => k);
      if (restricted.length > 0) {
        throw conflict("Con el comercio aprobado solo se pueden cambiar nombre visible y contacto", {
          reason: "FIELDS_LOCKED",
          fields: restricted,
        });
      }
    }
    if (input.categoryId !== undefined) await assertMerchantCategory(tx, input.categoryId);

    const [row] = await tx
      .update(merchants)
      .set({
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.legalName !== undefined && { legalName: input.legalName }),
        ...(input.taxId !== undefined && { taxId: normalizeCuit(input.taxId) }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
        ...(input.contactEmail !== undefined && { contactEmail: input.contactEmail }),
      })
      .where(eq(merchants.id, merchantId))
      .returning();
    if (!row) throw notFound("Comercio");
    await recordAudit(tx, actor, {
      action: "merchant.update",
      entityType: "merchant",
      entityId: merchantId,
      before: toMerchantDto(merchant),
      after: toMerchantDto(row),
    });
    return loadDetail(tx, row);
  });
}

/**
 * Medios de pago y datos de transferencia (ADR 0011). Se pueden cambiar con el comercio aprobado:
 * es configuración operativa. Al menos un medio; para transferencia, titular y alias o CBU/CVU.
 */
export async function updatePaymentSettings(
  db: Db,
  merchantId: string,
  input: PaymentSettingsInput,
  actor: Actor,
): Promise<MerchantDetailDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    if (!input.acceptsCash && !input.acceptsTransfer) {
      throw badRequest("Elegí al menos un medio de pago", { field: "acceptsCash" });
    }
    const clean = (v: string | null | undefined) => v?.trim() || null;
    const alias = clean(input.transfer?.alias);
    const cbu = input.transfer?.cbu ? input.transfer.cbu.replace(/\D/g, "") || null : null;
    const holder = clean(input.transfer?.holder);
    if (input.acceptsTransfer) {
      if (!alias && !cbu) throw badRequest("Para transferencias cargá el alias o el CBU/CVU", { field: "transfer.alias" });
      if (!holder) throw badRequest("Indicá el titular de la cuenta", { field: "transfer.holder" });
    }
    if (cbu && cbu.length !== 22) throw badRequest("El CBU/CVU tiene 22 dígitos", { field: "transfer.cbu" });

    const [row] = await tx
      .update(merchants)
      .set({ acceptsCash: input.acceptsCash, acceptsTransfer: input.acceptsTransfer, transferAlias: alias, transferCbu: cbu, transferHolder: holder })
      .where(eq(merchants.id, merchantId))
      .returning();
    if (!row) throw notFound("Comercio");
    await recordAudit(tx, actor, {
      action: "merchant.payment_settings",
      entityType: "merchant",
      entityId: merchantId,
      before: toMerchantDto(merchant).payment,
      after: toMerchantDto(row).payment,
    });
    return loadDetail(tx, row);
  });
}

/**
 * Logo o portada (ADR 0017). Solo el dueño, salvo comercio en revisión o suspendido.
 * `bytes = null` lo quita. El archivo anterior se borra después de confirmar en la base.
 */
export async function setMerchantImage(
  db: Db,
  merchantId: string,
  kind: "logo" | "cover",
  bytes: Buffer | null,
  actor: Actor,
): Promise<MerchantDetailDto> {
  const image = bytes ? await processImage(bytes, kind) : null;
  const path = image ? mediaPath(merchantId, kind) : null;
  if (image && path) await media.put(path, image, "image/webp");
  const column = kind === "logo" ? "logoPath" : "coverPath";

  let previous: string | null = null;
  try {
    const dto = await db.transaction(async (tx) => {
      const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
      assertOperationsEditable(merchant.status);
      previous = merchant[column];
      const [row] = await tx.update(merchants).set({ [column]: path }).where(eq(merchants.id, merchantId)).returning();
      await recordAudit(tx, actor, {
        action: `merchant.${kind}${path ? "" : "_remove"}`,
        entityType: "merchant",
        entityId: merchantId,
        before: { [column]: previous },
        after: { [column]: path },
      });
      return loadDetail(tx, row!);
    });
    if (previous && previous !== path) await media.remove(previous).catch(() => undefined);
    return dto;
  } catch (err) {
    if (path) await media.remove(path).catch(() => undefined);
    throw err;
  }
}

/** Datos de transferencia vigentes de un comercio (para copiarlos al pedido). Null si no acepta transferencias. */
export async function getTransferDetails(
  db: DbOrTx,
  merchantId: string,
): Promise<{ alias: string | null; cbu: string | null; holder: string } | null> {
  const [row] = await db
    .select({
      acceptsTransfer: merchants.acceptsTransfer,
      alias: merchants.transferAlias,
      cbu: merchants.transferCbu,
      holder: merchants.transferHolder,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId));
  if (!row?.acceptsTransfer || !row.holder) return null;
  return { alias: row.alias, cbu: row.cbu, holder: row.holder };
}

/** Borrador o rechazado → en revisión, solo si el checklist de onboarding está completo. */
export async function submitMerchant(db: Db, merchantId: string, actor: Actor): Promise<MerchantDetailDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    if (!merchantStateMachine.canTransition(merchant.status, MerchantStatus.PENDING_REVIEW)) {
      throw conflict("El comercio no se puede enviar a revisión en su estado actual", {
        reason: "INVALID_STATUS",
        status: merchant.status,
      });
    }
    const detail = await loadDetail(tx, merchant);
    if (!detail.onboarding.ready) {
      throw conflict("Faltan datos para enviar a revisión", {
        reason: "ONBOARDING_INCOMPLETE",
        problems: detail.onboarding.problems,
      });
    }
    const [row] = await tx
      .update(merchants)
      .set({ status: MerchantStatus.PENDING_REVIEW, submittedAt: new Date(), rejectionReason: null })
      .where(eq(merchants.id, merchantId))
      .returning();
    if (!row) throw notFound("Comercio");
    await recordAudit(tx, actor, {
      action: "merchant.submit",
      entityType: "merchant",
      entityId: merchantId,
      before: { status: merchant.status },
      after: { status: row.status },
    });
    return { ...detail, ...toMerchantDto(row) };
  });
}

// ---------------------------------------------------------------------------
// Sucursales, horarios y zonas
// ---------------------------------------------------------------------------

export async function createBranch(
  db: Db,
  merchantId: string,
  input: BranchInput,
  actor: Actor,
): Promise<BranchDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    const timezone = await cityTimezone(tx, input.cityId);
    const [row] = await tx
      .insert(branches)
      .values({
        merchantId,
        cityId: input.cityId,
        name: input.name,
        addressLine: input.addressLine,
        addressNotes: input.addressNotes ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        phone: input.phone ?? null,
        timezone,
        ...(input.acceptsPickup !== undefined && { acceptsPickup: input.acceptsPickup }),
        ...(input.acceptsDelivery !== undefined && { acceptsDelivery: input.acceptsDelivery }),
        ...(input.active !== undefined && { active: input.active }),
        ...schedulingColumns(input.scheduling),
      })
      .returning();
    if (!row) throw new Error("insert sin resultado");
    const dto = toBranchDto(row, [], []);
    await recordAudit(tx, actor, { action: "branch.create", entityType: "branch", entityId: row.id, after: dto });
    return dto;
  });
}

function schedulingColumns(s: Partial<SchedulingDto> | undefined) {
  return {
    ...(s?.enabled !== undefined && { schedulingEnabled: s.enabled }),
    ...(s?.leadMinutes !== undefined && { scheduleLeadMinutes: s.leadMinutes }),
    ...(s?.maxDays !== undefined && { scheduleMaxDays: s.maxDays }),
    ...(s?.slotCapacity !== undefined && { slotCapacity: s.slotCapacity }),
  };
}

async function branchDto(db: DbOrTx, row: BranchRow): Promise<BranchDto> {
  const [hours, zones, closures] = await Promise.all([
    db.select().from(businessHours).where(eq(businessHours.branchId, row.id)),
    db.select().from(deliveryZones).where(eq(deliveryZones.branchId, row.id)),
    currentClosures(db, [row.id]),
  ]);
  return toBranchDto(row, hours, zones, closures);
}

/**
 * Cierres que todavía no terminaron. Con un día de margen sobre la fecha UTC: la fecha local de
 * la sucursal puede ir atrás de la UTC; los ya terminados se descartan al usarlos.
 */
function currentClosures(db: DbOrTx, branchIds: string[]) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return db
    .select()
    .from(branchClosures)
    .where(and(inArray(branchClosures.branchId, branchIds), gte(branchClosures.endsOn, yesterday)))
    .orderBy(asc(branchClosures.startsOn));
}

const CLOSURE_ERRORS: Record<string, string> = {
  INVALID_DATE: "Fecha inválida",
  ENDS_BEFORE_START: "La fecha de fin es anterior a la de inicio",
  IN_THE_PAST: "Ese cierre ya pasó",
  TOO_LONG: "Un cierre puede durar hasta 60 días",
};

/** Cierre excepcional de una sucursal (feriado, vacaciones). Fechas en la zona de la sucursal. */
export async function createBranchClosure(
  db: Db,
  merchantId: string,
  branchId: string,
  input: { startsOn: string; endsOn: string; reason: string },
  actor: Actor,
): Promise<BranchDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    const branch = await loadBranchOf(tx, merchantId, branchId);
    const problem = validateClosure(input, localDateKey(new Date(), branch.timezone));
    if (problem) throw badRequest(CLOSURE_ERRORS[problem] ?? problem, { field: problem === "ENDS_BEFORE_START" ? "endsOn" : "startsOn", reason: problem });
    const [row] = await tx
      .insert(branchClosures)
      .values({ branchId, startsOn: input.startsOn, endsOn: input.endsOn, reason: input.reason.trim() })
      .returning();
    await recordAudit(tx, actor, { action: "branch.closure.create", entityType: "branch", entityId: branchId, after: row });
    return branchDto(tx, branch);
  });
}

export async function deleteBranchClosure(
  db: Db,
  merchantId: string,
  branchId: string,
  closureId: string,
  actor: Actor,
): Promise<BranchDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    const branch = await loadBranchOf(tx, merchantId, branchId);
    const [row] = await tx
      .delete(branchClosures)
      .where(and(eq(branchClosures.id, closureId), eq(branchClosures.branchId, branchId)))
      .returning();
    if (!row) throw notFound("Cierre");
    await recordAudit(tx, actor, { action: "branch.closure.delete", entityType: "branch", entityId: branchId, before: row });
    return branchDto(tx, branch);
  });
}

export async function updateBranch(
  db: Db,
  merchantId: string,
  branchId: string,
  input: UpdateBranchInput,
  actor: Actor,
): Promise<BranchDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    const current = await loadBranchOf(tx, merchantId, branchId);
    const timezone = input.cityId !== undefined ? await cityTimezone(tx, input.cityId) : undefined;

    const [row] = await tx
      .update(branches)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.cityId !== undefined && { cityId: input.cityId, timezone }),
        ...(input.addressLine !== undefined && { addressLine: input.addressLine }),
        ...(input.addressNotes !== undefined && { addressNotes: input.addressNotes }),
        ...(input.lat !== undefined && { lat: input.lat }),
        ...(input.lng !== undefined && { lng: input.lng }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.acceptsPickup !== undefined && { acceptsPickup: input.acceptsPickup }),
        ...(input.acceptsDelivery !== undefined && { acceptsDelivery: input.acceptsDelivery }),
        ...(input.active !== undefined && { active: input.active }),
        ...schedulingColumns(input.scheduling),
      })
      .where(eq(branches.id, branchId))
      .returning();
    if (!row) throw notFound("Sucursal");
    const dto = await branchDto(tx, row);
    await recordAudit(tx, actor, {
      action: "branch.update",
      entityType: "branch",
      entityId: branchId,
      before: toBranchDto(current, [], []),
      after: { ...dto, hours: undefined, zones: undefined },
    });
    return dto;
  });
}

/** Reemplaza el horario semanal completo de la sucursal. Lista vacía = sin horario cargado. */
export async function replaceBranchHours(
  db: Db,
  merchantId: string,
  branchId: string,
  ranges: OpeningRangeDto[],
  actor: Actor,
): Promise<BranchDto> {
  const parsed: OpeningRange[] = ranges.map((r, index) => {
    const opensAt = parseTime(r.opensAt);
    const closesAt = parseTime(r.closesAt);
    if (opensAt === null || closesAt === null) {
      throw badRequest("Hora inválida: usar HH:MM", { index });
    }
    return { weekday: r.weekday, opensAt, closesAt };
  });
  const problems = validateSchedule(parsed);
  if (problems.length > 0) throw badRequest("Horario inválido", { problems });

  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    const branch = await loadBranchOf(tx, merchantId, branchId);

    const before = await tx.select().from(businessHours).where(eq(businessHours.branchId, branchId));
    await tx.delete(businessHours).where(eq(businessHours.branchId, branchId));
    if (parsed.length > 0) {
      await tx.insert(businessHours).values(parsed.map((r) => ({ branchId, ...r })));
    }
    const dto = await branchDto(tx, branch);
    await recordAudit(tx, actor, {
      action: "branch.hours.replace",
      entityType: "branch",
      entityId: branchId,
      before: toBranchDto(branch, before, []).hours,
      after: dto.hours,
    });
    return dto;
  });
}

export async function createZone(
  db: Db,
  merchantId: string,
  branchId: string,
  input: ZoneInput,
  actor: Actor,
): Promise<DeliveryZoneDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    await loadBranchOf(tx, merchantId, branchId);
    const [row] = await tx
      .insert(deliveryZones)
      .values({
        branchId,
        name: input.name,
        description: input.description ?? null,
        feeMinor: input.feeMinor,
        ...(input.minOrderMinor !== undefined && { minOrderMinor: input.minOrderMinor }),
        ...(input.active !== undefined && { active: input.active }),
      })
      .returning();
    if (!row) throw new Error("insert sin resultado");
    const dto = toZoneDto(row);
    await recordAudit(tx, actor, { action: "zone.create", entityType: "delivery_zone", entityId: row.id, after: dto });
    return dto;
  });
}

export async function updateZone(
  db: Db,
  merchantId: string,
  branchId: string,
  zoneId: string,
  input: UpdateZoneInput,
  actor: Actor,
): Promise<DeliveryZoneDto> {
  return db.transaction(async (tx) => {
    const { merchant } = await loadOwnership(tx, merchantId, actor.userId);
    assertOperationsEditable(merchant.status);
    await loadBranchOf(tx, merchantId, branchId);
    const [current] = await tx
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.branchId, branchId)));
    if (!current) throw notFound("Zona");

    const [row] = await tx
      .update(deliveryZones)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.feeMinor !== undefined && { feeMinor: input.feeMinor }),
        ...(input.minOrderMinor !== undefined && { minOrderMinor: input.minOrderMinor }),
        ...(input.active !== undefined && { active: input.active }),
      })
      .where(eq(deliveryZones.id, zoneId))
      .returning();
    if (!row) throw notFound("Zona");
    const dto = toZoneDto(row);
    await recordAudit(tx, actor, {
      action: "zone.update",
      entityType: "delivery_zone",
      entityId: zoneId,
      before: toZoneDto(current),
      after: dto,
    });
    return dto;
  });
}

// ---------------------------------------------------------------------------
// Interfaz para otros módulos
// ---------------------------------------------------------------------------

export interface MerchantAccess {
  merchantId: string;
  status: MerchantStatus;
  role: MerchantRole;
}

/**
 * Para otros módulos (p. ej. el menú): verifica que el usuario sea miembro (404 si no) y,
 * con `owner`, que sea dueño (403). Con `lock` bloquea la fila del comercio dentro de la
 * transacción, para serializar ediciones concurrentes.
 */
export async function getMerchantAccess(
  db: DbOrTx,
  merchantId: string,
  userId: string,
  opts: { owner?: boolean; lock?: boolean } = {},
): Promise<MerchantAccess> {
  const { merchant, role } = await loadMembership(db, merchantId, userId, opts.lock ?? false);
  if (opts.owner && role !== MerchantRole.OWNER) throw forbidden("Solo el dueño del comercio puede hacer esto");
  return { merchantId: merchant.id, status: merchant.status, role };
}

/** Nombre visible de varios comercios (para listados de otros módulos). */
export async function getMerchantNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: merchants.id, name: merchants.displayName }).from(merchants).where(inArray(merchants.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Ciudad y teléfono de una sucursal (para el reparto). 404 si no existe. */
export async function getBranchSummary(db: DbOrTx, branchId: string): Promise<{ cityId: string; phone: string | null }> {
  const [row] = await db.select({ cityId: branches.cityId, phone: branches.phone }).from(branches).where(eq(branches.id, branchId));
  if (!row) throw notFound("Sucursal");
  return row;
}

/** Rubro de un comercio (para el tope de comisión). 404 si no existe. */
export async function getMerchantCategoryId(db: DbOrTx, merchantId: string): Promise<string> {
  const [row] = await db.select({ categoryId: merchants.categoryId }).from(merchants).where(eq(merchants.id, merchantId));
  if (!row) throw notFound("Comercio");
  return row.categoryId;
}

export interface PublicBranchDto {
  id: string;
  name: string;
  cityId: string;
  addressLine: string;
  addressNotes: string | null;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
  timezone: string;
  hours: OpeningRangeDto[];
  /** Abierta en este momento, según su horario, sus cierres y su zona horaria. */
  openNow: boolean;
  /** Cerrada hoy por un cierre excepcional (feriado, vacaciones). */
  closedToday: { reason: string; endsOn: string } | null;
  /** Cierres vigentes o próximos (para programar pedidos). */
  closures: Array<{ startsOn: string; endsOn: string; reason: string }>;
  /** Pedidos programados. Las franjas disponibles salen de GET .../slots. */
  scheduling: SchedulingDto;
  zones: Array<Pick<DeliveryZoneDto, "id" | "name" | "description" | "feeMinor" | "minOrderMinor">>;
}

export interface PublicMerchantDto {
  id: string;
  slug: string;
  displayName: string;
  categoryId: string;
  /** Medios de pago que acepta. Los datos de transferencia se ven recién en el pedido. */
  payment: { cash: boolean; transfer: boolean };
  logoUrl: string | null;
  coverUrl: string | null;
  branches: PublicBranchDto[];
}

function branchOpenAt(b: BranchDto, now: Date): boolean {
  const ranges = b.hours.map((h) => ({
    weekday: h.weekday,
    opensAt: parseTime(h.opensAt) ?? 0,
    closesAt: parseTime(h.closesAt) ?? 0,
  }));
  return isOpenAtInstant(ranges, b.closures, b.timezone, now);
}

function closedToday(b: BranchDto, now: Date): { reason: string; endsOn: string } | null {
  const c = closureOn(b.closures, localDateKey(now, b.timezone));
  return c ? { reason: c.reason, endsOn: c.endsOn } : null;
}

function toPublicBranch(b: BranchDto, now: Date): PublicBranchDto {
  return {
    id: b.id,
    name: b.name,
    cityId: b.cityId,
    addressLine: b.addressLine,
    addressNotes: b.addressNotes,
    acceptsPickup: b.acceptsPickup,
    acceptsDelivery: b.acceptsDelivery,
    timezone: b.timezone,
    hours: b.hours,
    openNow: branchOpenAt(b, now),
    closedToday: closedToday(b, now),
    closures: b.closures.filter((c) => c.endsOn >= localDateKey(now, b.timezone)).map(({ startsOn, endsOn, reason }) => ({ startsOn, endsOn, reason })),
    scheduling: b.scheduling,
    zones: b.zones
      .filter((z) => z.active)
      .map(({ id, name, description, feeMinor, minOrderMinor }) => ({ id, name, description, feeMinor, minOrderMinor })),
  };
}

/**
 * Vista pública de un comercio: solo si está APROBADO, con sus sucursales y zonas activas.
 * Sin datos fiscales ni de contacto del dueño.
 */
export async function findApprovedMerchantBySlug(
  db: Db,
  slug: string,
  now: Date = new Date(),
): Promise<PublicMerchantDto | null> {
  const [row] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.slug, slug), eq(merchants.status, MerchantStatus.APPROVED)));
  if (!row) return null;
  const detail = await loadDetail(db, row);
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    categoryId: row.categoryId,
    payment: { cash: row.acceptsCash, transfer: row.acceptsTransfer },
    logoUrl: mediaUrl(row.logoPath),
    coverUrl: mediaUrl(row.coverPath),
    branches: detail.branches.filter((b) => b.active).map((b) => toPublicBranch(b, now)),
  };
}

export interface CityMerchantDto {
  id: string;
  slug: string;
  displayName: string;
  categoryId: string;
  /** Alguna de sus sucursales en la ciudad está abierta ahora. */
  openNow: boolean;
  acceptsPickup: boolean;
  /** Hace envíos: alguna sucursal con envío y al menos una zona activa. */
  acceptsDelivery: boolean;
  /** Envío más barato entre sus zonas activas (centavos), o null si no hace envíos. */
  minDeliveryFeeMinor: number | null;
  logoUrl: string | null;
  coverUrl: string | null;
}

/**
 * Comercios aprobados con al menos una sucursal activa en la ciudad. Abiertos primero,
 * después por nombre. `null` si la ciudad no existe o está inactiva.
 */
export async function listApprovedMerchantsInCity(
  db: Db,
  citySlug: string,
  opts: { categoryId?: string | undefined; now?: Date } = {},
): Promise<CityMerchantDto[] | null> {
  const city = await findActiveCityBySlug(db, citySlug);
  if (!city) return null;
  const now = opts.now ?? new Date();

  const rows = await db
    .selectDistinct({ merchant: merchants })
    .from(merchants)
    .innerJoin(branches, and(eq(branches.merchantId, merchants.id), eq(branches.cityId, city.id), eq(branches.active, true)))
    .where(
      and(
        eq(merchants.status, MerchantStatus.APPROVED),
        opts.categoryId ? eq(merchants.categoryId, opts.categoryId) : undefined,
      ),
    );

  const result: CityMerchantDto[] = [];
  for (const { merchant } of rows) {
    const detail = await loadDetail(db, merchant);
    const here = detail.branches.filter((b) => b.active && b.cityId === city.id).map((b) => toPublicBranch(b, now));
    const fees = here.filter((b) => b.acceptsDelivery).flatMap((b) => b.zones.map((z) => z.feeMinor));
    result.push({
      id: merchant.id,
      slug: merchant.slug,
      displayName: merchant.displayName,
      categoryId: merchant.categoryId,
      openNow: here.some((b) => b.openNow),
      acceptsPickup: here.some((b) => b.acceptsPickup),
      acceptsDelivery: fees.length > 0,
      minDeliveryFeeMinor: fees.length ? Math.min(...fees) : null,
      logoUrl: mediaUrl(merchant.logoPath),
      coverUrl: mediaUrl(merchant.coverPath),
    });
  }
  return result.sort((a, b) => Number(b.openNow) - Number(a.openNow) || a.displayName.localeCompare(b.displayName, "es"));
}

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

async function ownersOf(db: DbOrTx, merchantIds: string[]) {
  if (merchantIds.length === 0) return new Map<string, AdminMerchantSummaryDto["owner"]>();
  const owners = await db
    .select({ merchantId: merchantMembers.merchantId, userId: merchantMembers.userId })
    .from(merchantMembers)
    .where(and(inArray(merchantMembers.merchantId, merchantIds), eq(merchantMembers.role, MerchantRole.OWNER)));
  const users = await getUserSummaries(
    db,
    owners.map((o) => o.userId),
  );
  return new Map(owners.map((o) => [o.merchantId, users.get(o.userId) ?? { id: o.userId, email: null, phone: null }]));
}

export async function listMerchantsForAdmin(db: Db, status?: MerchantStatus): Promise<AdminMerchantSummaryDto[]> {
  const filter: SQL | undefined = status ? eq(merchants.status, status) : undefined;
  const rows = await db
    .select()
    .from(merchants)
    .where(filter)
    // En revisión: el más antiguo primero (cola). El resto: lo más reciente primero.
    .orderBy(status === MerchantStatus.PENDING_REVIEW ? asc(merchants.submittedAt) : desc(merchants.updatedAt));
  const ids = rows.map((r) => r.id);
  const [owners, branchRows] = await Promise.all([
    ownersOf(db, ids),
    ids.length
      ? db.select({ merchantId: branches.merchantId }).from(branches).where(inArray(branches.merchantId, ids))
      : Promise.resolve([]),
  ]);
  const counts = new Map<string, number>();
  for (const b of branchRows) counts.set(b.merchantId, (counts.get(b.merchantId) ?? 0) + 1);
  return rows.map((r) => ({
    ...toMerchantDto(r),
    owner: owners.get(r.id) ?? null,
    branchCount: counts.get(r.id) ?? 0,
  }));
}

export async function getMerchantForAdmin(db: Db, merchantId: string): Promise<AdminMerchantDetailDto> {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!row) throw notFound("Comercio");
  const owners = await ownersOf(db, [row.id]);
  return { ...(await loadDetail(db, row)), owner: owners.get(row.id) ?? null };
}

async function review(
  db: Db,
  merchantId: string,
  to: typeof MerchantStatus.APPROVED | typeof MerchantStatus.REJECTED,
  reason: string | null,
  actor: Actor,
): Promise<AdminMerchantDetailDto> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(merchants).where(eq(merchants.id, merchantId)).for("update");
    if (!current) throw notFound("Comercio");
    if (!merchantStateMachine.canTransition(current.status, to)) {
      throw conflict("Solo se pueden aprobar o rechazar comercios en revisión", {
        reason: "INVALID_STATUS",
        status: current.status,
      });
    }
    await tx
      .update(merchants)
      .set({ status: to, rejectionReason: reason, reviewedAt: new Date(), reviewedBy: actor.userId })
      .where(eq(merchants.id, merchantId));
    await recordAudit(tx, actor, {
      action: to === MerchantStatus.APPROVED ? "merchant.approve" : "merchant.reject",
      entityType: "merchant",
      entityId: merchantId,
      before: { status: current.status },
      after: { status: to, rejectionReason: reason },
    });
  });
  return getMerchantForAdmin(db, merchantId);
}

/**
 * Suspender un comercio aprobado (con motivo) o reactivarlo. Suspendido desaparece de la app y no
 * recibe pedidos nuevos; los que ya tenía en curso los puede terminar. No edita catálogo ni datos.
 */
export async function setMerchantSuspended(
  db: Db,
  merchantId: string,
  suspended: boolean,
  reason: string | null,
  actor: Actor,
): Promise<AdminMerchantDetailDto> {
  const to = suspended ? MerchantStatus.SUSPENDED : MerchantStatus.APPROVED;
  if (suspended && !reason?.trim()) throw badRequest("Indicá el motivo de la suspensión (lo ve el comercio)", { field: "reason" });
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(merchants).where(eq(merchants.id, merchantId)).for("update");
    if (!current) throw notFound("Comercio");
    if (current.status !== (suspended ? MerchantStatus.APPROVED : MerchantStatus.SUSPENDED)) {
      throw conflict(suspended ? "Solo se pueden suspender comercios aprobados" : "El comercio no está suspendido", {
        reason: "INVALID_STATUS",
        status: current.status,
      });
    }
    await tx
      .update(merchants)
      .set({ status: to, rejectionReason: suspended ? reason!.trim() : null })
      .where(eq(merchants.id, merchantId));
    await recordAudit(tx, actor, {
      action: suspended ? "merchant.suspend" : "merchant.reactivate",
      entityType: "merchant",
      entityId: merchantId,
      before: { status: current.status },
      after: { status: to, reason: suspended ? reason!.trim() : null },
    });
  });
  return getMerchantForAdmin(db, merchantId);
}

export const approveMerchant = (db: Db, merchantId: string, actor: Actor) =>
  review(db, merchantId, MerchantStatus.APPROVED, null, actor);

export const rejectMerchant = (db: Db, merchantId: string, reason: string, actor: Actor) =>
  review(db, merchantId, MerchantStatus.REJECTED, reason, actor);
