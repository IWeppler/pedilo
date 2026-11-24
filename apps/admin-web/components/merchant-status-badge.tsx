import type { MerchantStatus } from "@pedilo/api-client";
import { MERCHANT_STATUS_LABELS } from "@pedilo/web-utils";

import { Badge } from "@/components/ui/badge";

const VARIANTS: Record<MerchantStatus, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING_REVIEW: "default",
  APPROVED: "secondary",
  REJECTED: "destructive",
  DRAFT: "outline",
  SUSPENDED: "destructive",
};

export function MerchantStatusBadge({ status }: { status: MerchantStatus }) {
  return <Badge variant={VARIANTS[status]}>{MERCHANT_STATUS_LABELS[status]}</Badge>;
}
