/**
 * Agregador de tablas para drizzle-kit y el cliente de base de datos.
 * Cada módulo es dueño de su `schema.ts`; los módulos no importan tablas de otros módulos.
 */
export * from "../modules/identity/schema";
export * from "../modules/audit/schema";
export * from "../modules/geography/schema";
export * from "../modules/catalog/schema";
export * from "../modules/merchants/schema";
export * from "../modules/menu/schema";
export * from "../modules/orders/schema";
export * from "../modules/notifications/schema";
export * from "../modules/billing/schema";
export * from "../modules/deliveries/schema";
export * from "../modules/claims/schema";
