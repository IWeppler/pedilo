ALTER TABLE "categories" ADD COLUMN "featured_order" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_featured_check" CHECK ("categories"."featured_order" IS NULL OR ("categories"."kind" = 'PRODUCT' AND "categories"."featured_order" >= 0));--> statement-breakpoint
-- Tipos de comida del inicio de la app (ADR 0027), en este orden. «Saludable» se crea dentro de
-- «Comidas» (si ese grupo existe; en una base nueva la crea el seed). Solo toca categorías de producto con estos slugs; el admin los cambia después.
INSERT INTO "categories" ("kind", "name", "slug", "parent_id", "sort_order")
SELECT 'PRODUCT', 'Saludable', 'saludable', c."id", 140 FROM "categories" c WHERE c."kind" = 'PRODUCT' AND c."slug" = 'comidas'
ON CONFLICT ("kind", "slug") DO NOTHING;--> statement-breakpoint
UPDATE "categories" SET "featured_order" = v.pos
FROM (VALUES ('hamburguesas', 10), ('pizzas', 20), ('snacks', 30), ('bebidas', 40), ('postres', 50), ('saludable', 60)) AS v(slug, pos)
WHERE "categories"."kind" = 'PRODUCT' AND "categories"."slug" = v.slug;
