import { Badge } from "@/components/ui/badge";

export function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="secondary">Activa</Badge> : <Badge variant="outline">Inactiva</Badge>;
}
