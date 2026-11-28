-- Comisión plana (decisión del 2026-11-28, ADR 0033): 3% del subtotal, sin mensualidad y sin tope.
-- Rige desde que corre la migración; los pedidos anteriores conservan la versión con la que se
-- calcularon (v0.4-hypothesis). Los tres planes quedan iguales.
INSERT INTO "pricing_versions" ("id", "brackets", "caps_by_category", "plans", "effective_from", "notes") VALUES (
  'v1-3pct',
  '[{"upToMinor":null,"rateFactorBps":10000}]',
  '{"GASTRONOMY":null,"KIOSK":null,"SUPERMARKET":null,"ELECTRONICS":null,"ENTREPRENEUR":null}',
  '{"EMPRENDEDOR":{"monthlyFeeMinor":0,"baseRateBps":300,"maxBranches":1,"maxUsers":1},"NEGOCIO":{"monthlyFeeMinor":0,"baseRateBps":300,"maxBranches":1,"maxUsers":1},"PRO":{"monthlyFeeMinor":0,"baseRateBps":300,"maxBranches":1,"maxUsers":1}}',
  now(),
  '3% del subtotal, sin mensualidad y sin tope (ADR 0033).'
) ON CONFLICT ("id") DO NOTHING;
