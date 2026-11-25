import type { SettlementStatus } from "@pedilo/api-client";
import { SETTLEMENT_STATUS_LABELS } from "@pedilo/domain";

import { Badge } from "@/components/ui/badge";

export function SettlementBadge({ status }: { status: SettlementStatus }) {
  const variant = status === "OVERDUE" ? "destructive" : status === "PAID" ? "secondary" : "outline";
  return <Badge variant={variant}>{SETTLEMENT_STATUS_LABELS[status]}</Badge>;
}
