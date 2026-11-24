import { defineStateMachine } from "./state-machine";

/** Alta y ciclo de vida del comercio. SPEC §4.1 (onboarding verificado) y US-101. */

export const MerchantStatus = {
  /** Recién registrado: el comercio completa datos, sucursal, horarios y zonas. */
  DRAFT: "DRAFT",
  /** Enviado a revisión: lo revisa el equipo de Pedilo. No se edita mientras tanto. */
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  /** Rechazado con motivo: el comercio corrige y vuelve a enviar. */
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type MerchantStatus = (typeof MerchantStatus)[keyof typeof MerchantStatus];

const S = MerchantStatus;

export const merchantStateMachine = defineStateMachine<MerchantStatus>("merchant", {
  [S.DRAFT]: [S.PENDING_REVIEW],
  [S.PENDING_REVIEW]: [S.APPROVED, S.REJECTED],
  [S.REJECTED]: [S.PENDING_REVIEW],
  [S.APPROVED]: [S.SUSPENDED],
  [S.SUSPENDED]: [S.APPROVED],
});

/** El comercio puede editar todos sus datos de perfil solo antes de ser aprobado. */
export function canEditFullProfile(status: MerchantStatus): boolean {
  return status === S.DRAFT || status === S.REJECTED;
}

export const MerchantRole = {
  OWNER: "OWNER",
  OPERATOR: "OPERATOR",
} as const;
export type MerchantRole = (typeof MerchantRole)[keyof typeof MerchantRole];

// ---------------------------------------------------------------------------
// Checklist de onboarding
// ---------------------------------------------------------------------------

export const OnboardingIssue = {
  /** No hay ninguna sucursal activa. */
  NO_ACTIVE_BRANCH: "NO_ACTIVE_BRANCH",
  /** Una sucursal activa no tiene horarios cargados. */
  BRANCH_WITHOUT_HOURS: "BRANCH_WITHOUT_HOURS",
  /** Una sucursal activa no acepta retiro ni tiene envío con al menos una zona activa. */
  BRANCH_WITHOUT_FULFILLMENT: "BRANCH_WITHOUT_FULFILLMENT",
} as const;
export type OnboardingIssue = (typeof OnboardingIssue)[keyof typeof OnboardingIssue];

export interface BranchReadiness {
  id: string;
  active: boolean;
  hoursCount: number;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
  activeZonesCount: number;
}

export interface OnboardingProblem {
  issue: OnboardingIssue;
  branchId?: string;
}

/**
 * Qué falta para poder enviar el comercio a revisión. Lista vacía = listo.
 * Cada sucursal activa debe tener horarios y al menos una forma de entrega.
 */
export function onboardingProblems(branches: readonly BranchReadiness[]): OnboardingProblem[] {
  const active = branches.filter((b) => b.active);
  if (active.length === 0) return [{ issue: OnboardingIssue.NO_ACTIVE_BRANCH }];

  const problems: OnboardingProblem[] = [];
  for (const b of active) {
    if (b.hoursCount === 0) problems.push({ issue: OnboardingIssue.BRANCH_WITHOUT_HOURS, branchId: b.id });
    const canDeliver = b.acceptsDelivery && b.activeZonesCount > 0;
    if (!b.acceptsPickup && !canDeliver) {
      problems.push({ issue: OnboardingIssue.BRANCH_WITHOUT_FULFILLMENT, branchId: b.id });
    }
  }
  return problems;
}
