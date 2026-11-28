"use client";

import type { MenuProduct, MenuSection, ProductBody } from "@pedilo/api-client";
import { type FormState, initialFormState, minorToPesosInput, parsePesosToMinor } from "@pedilo/web-utils";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";

import { NativeSelect } from "@/components/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Estado editable: precios como texto (lo que tipea el comercio, en pesos) y una `key` local por fila.
interface VariantRow {
  key: string;
  id?: string;
  name: string;
  price: string;
  available: boolean;
}
interface OptionRow {
  key: string;
  id?: string;
  name: string;
  price: string;
  maxQuantity: number;
  available: boolean;
}
interface GroupRow {
  key: string;
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: OptionRow[];
}
interface Draft {
  name: string;
  description: string;
  sectionId: string;
  /** Tipo de producto (categoría global): con eso aparece en los filtros de la app (ADR 0027). */
  categoryId: string;
  price: string;
  available: boolean;
  active: boolean;
  variants: VariantRow[];
  groups: GroupRow[];
}

function fromProduct(p: MenuProduct | undefined, defaultSectionId: string | undefined): Draft {
  if (!p) {
    return {
      name: "",
      description: "",
      sectionId: defaultSectionId ?? "",
      categoryId: "",
      price: "",
      available: true,
      active: true,
      variants: [],
      groups: [],
    };
  }
  return {
    name: p.name,
    description: p.description ?? "",
    sectionId: p.sectionId ?? "",
    categoryId: p.categoryId ?? "",
    price: minorToPesosInput(p.priceMinor),
    available: p.available,
    active: p.active,
    variants: p.variants.map((v) => ({ key: v.id, id: v.id, name: v.name, price: minorToPesosInput(v.priceMinor), available: v.available })),
    groups: p.modifierGroups.map((g) => ({
      key: g.id,
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.modifiers.map((m) => ({
        key: m.id,
        id: m.id,
        name: m.name,
        price: minorToPesosInput(m.priceDeltaMinor),
        maxQuantity: m.maxQuantity,
        available: m.available,
      })),
    })),
  };
}

/** Convierte el borrador al body de la API. Devuelve errores de montos tipeados mal. */
function toBody(d: Draft): { body?: ProductBody; error?: string } {
  const money = (label: string, raw: string, required: boolean): number | string => {
    const v = parsePesosToMinor(raw);
    if (v === undefined) return required ? `${label}: falta el precio` : 0;
    return Number.isNaN(v) ? `${label}: monto inválido («${raw}»)` : v;
  };
  const errors: string[] = [];
  const num = (r: number | string) => (typeof r === "string" ? (errors.push(r), 0) : r);

  const hasVariants = d.variants.length > 0;
  const body: ProductBody = {
    name: d.name.trim(),
    description: d.description.trim() || null,
    sectionId: d.sectionId || null,
    categoryId: d.categoryId || null,
    // Con variantes el precio del producto no se usa: se guarda el de la primera variante como referencia.
    priceMinor: hasVariants ? 0 : num(money("Precio", d.price, true)),
    available: d.available,
    active: d.active,
    variants: d.variants.map((v) => ({
      ...(v.id && { id: v.id }),
      name: v.name.trim(),
      priceMinor: num(money(`Variante «${v.name || "sin nombre"}»`, v.price, true)),
      available: v.available,
    })),
    modifierGroups: d.groups.map((g) => ({
      ...(g.id && { id: g.id }),
      name: g.name.trim(),
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.options.map((o) => ({
        ...(o.id && { id: o.id }),
        name: o.name.trim(),
        priceDeltaMinor: num(money(`Opción «${o.name || "sin nombre"}»`, o.price, false)),
        maxQuantity: o.maxQuantity,
        available: o.available,
      })),
    })),
  };
  if (hasVariants) body.priceMinor = body.variants[0]?.priceMinor ?? 0;
  return errors.length ? { error: errors.join(". ") + "." } : { body };
}

/** Categoría global de producto, como la devuelve `GET /v1/categories?kind=PRODUCT`. */
export interface ProductType {
  id: string;
  parentId: string | null;
  name: string;
}

export function ProductEditor({
  action,
  sections,
  productTypes,
  product,
  defaultSectionId,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  sections: MenuSection[];
  productTypes: ProductType[];
  product?: MenuProduct;
  defaultSectionId?: string | undefined;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [draft, setDraft] = useState<Draft>(() => fromProduct(product, defaultSectionId));
  const [clientError, setClientError] = useState<string | null>(null);
  const counter = useRef(0);
  const newKey = () => `new-${++counter.current}`;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setVariant = (key: string, patch: Partial<VariantRow>) =>
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  const setGroup = (key: string, patch: Partial<GroupRow>) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) }));
  const setOption = (groupKey: string, key: string, patch: Partial<OptionRow>) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.key === groupKey ? { ...g, options: g.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) } : g,
      ),
    }));

  const message = clientError ?? state.message;

  return (
    // onSubmit + startTransition: evita el reseteo automático de React 19 sobre un editor controlado.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const { body, error } = toBody(draft);
        if (error || !body) {
          setClientError(error ?? "Revisá el producto.");
          return;
        }
        setClientError(null);
        const data = new FormData();
        data.set("product", JSON.stringify(body));
        startTransition(() => formAction(data));
      }}
      className="grid gap-6"
    >
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Producto</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" value={draft.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} maxLength={80} placeholder="Pizza muzzarella" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Descripción (opcional)</Label>
            <textarea
              id="description"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              maxLength={500}
              rows={2}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sectionId">Sección</Label>
            <NativeSelect id="sectionId" value={draft.sectionId} onChange={(e) => set({ sectionId: e.target.value })}>
              <option value="">Sin sección («Otros»)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (oculta)"}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="categoryId">Tipo de producto</Label>
            <NativeSelect id="categoryId" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })} aria-describedby="categoryId-hint">
              <option value="">Sin elegir</option>
              {groupTypes(productTypes).map((g) =>
                g.children.length === 0 ? (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ) : (
                  <optgroup key={g.id} label={g.name}>
                    <option value={g.id}>{g.name} (en general)</option>
                    {g.children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </NativeSelect>
            <p id="categoryId-hint" className="text-sm text-muted-foreground">
              Con esto tu comercio aparece cuando alguien busca «Hamburguesas», «Pizzas» o «Bebidas» en la app.
            </p>
          </div>
          {draft.variants.length === 0 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="price">Precio ($)</Label>
              <Input id="price" inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} required placeholder="9000" className="w-40" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Con variantes, el precio lo define cada variante.</p>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.available} onChange={(e) => set({ available: e.target.checked })} className="size-4 accent-primary" />
              Disponible (si lo destildás, queda pausado)
            </label>
            {product && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!draft.active} onChange={(e) => set({ active: !e.target.checked })} className="size-4 accent-primary" />
                Archivado (no se muestra en el menú)
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variantes</CardTitle>
          <CardDescription>Tamaños o presentaciones con precio propio (Chica / Grande). El cliente elige una.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {draft.variants.map((v, i) => (
            <div key={v.key} className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Variante ${i + 1}: nombre`} value={v.name} onChange={(e) => setVariant(v.key, { name: e.target.value })} required maxLength={80} placeholder="Grande" className="w-48" />
              <Input aria-label={`Variante ${i + 1}: precio`} inputMode="decimal" value={v.price} onChange={(e) => setVariant(v.key, { price: e.target.value })} required placeholder="Precio" className="w-32" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={v.available} onChange={(e) => setVariant(v.key, { available: e.target.checked })} className="size-4 accent-primary" />
                Disponible
              </label>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar variante ${v.name || i + 1}`} onClick={() => set({ variants: draft.variants.filter((x) => x.key !== v.key) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({ variants: [...draft.variants, { key: newKey(), name: "", price: draft.variants.length === 0 ? draft.price : "", available: true }] })
              }
            >
              <Plus /> Agregar variante
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opciones y extras</CardTitle>
          <CardDescription>
            Grupos como «Masa» (elegir 1, obligatorio) o «Extras» (opcional, hasta 3). Cada opción puede sumar un recargo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {draft.groups.map((g, gi) => (
            <div key={g.key} className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Grupo</Label>
                  <Input aria-label={`Grupo ${gi + 1}: nombre`} value={g.name} onChange={(e) => setGroup(g.key, { name: e.target.value })} required maxLength={80} placeholder="Extras" className="w-48" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Mínimo</Label>
                  <Input aria-label={`Grupo ${g.name || gi + 1}: mínimo`} type="number" min={0} max={50} value={g.minSelect} onChange={(e) => setGroup(g.key, { minSelect: Number(e.target.value) })} className="w-20" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Máximo</Label>
                  <Input aria-label={`Grupo ${g.name || gi + 1}: máximo`} type="number" min={1} max={50} value={g.maxSelect} onChange={(e) => setGroup(g.key, { maxSelect: Number(e.target.value) })} className="w-20" />
                </div>
                <span className="pb-2 text-xs text-muted-foreground">
                  {g.minSelect > 0 ? `Obligatorio: elegir ${g.minSelect === g.maxSelect ? g.minSelect : `de ${g.minSelect} a ${g.maxSelect}`}` : `Opcional, hasta ${g.maxSelect}`}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Quitar grupo ${g.name || gi + 1}`} onClick={() => set({ groups: draft.groups.filter((x) => x.key !== g.key) })}>
                  <Trash2 />
                </Button>
              </div>
              {g.options.map((o, oi) => (
                <div key={o.key} className="flex flex-wrap items-center gap-2 pl-3">
                  <Input aria-label={`${g.name || "Grupo"}, opción ${oi + 1}: nombre`} value={o.name} onChange={(e) => setOption(g.key, o.key, { name: e.target.value })} required maxLength={80} placeholder="Extra queso" className="w-44" />
                  <Input aria-label={`${g.name || "Grupo"}, opción ${oi + 1}: recargo`} inputMode="decimal" value={o.price} onChange={(e) => setOption(g.key, o.key, { price: e.target.value })} placeholder="+$ 0" className="w-28" />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Hasta
                    <Input aria-label={`${o.name || "Opción"}: cantidad máxima`} type="number" min={1} max={10} value={o.maxQuantity} onChange={(e) => setOption(g.key, o.key, { maxQuantity: Number(e.target.value) })} className="w-16" />
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={o.available} onChange={(e) => setOption(g.key, o.key, { available: e.target.checked })} className="size-4 accent-primary" />
                    Disponible
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar opción ${o.name || oi + 1}`} onClick={() => setGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="pl-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setGroup(g.key, { options: [...g.options, { key: newKey(), name: "", price: "0", maxQuantity: 1, available: true }] })}
                >
                  <Plus /> Agregar opción
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ groups: [...draft.groups, { key: newKey(), name: "", minSelect: 1, maxSelect: 1, options: [] }] })}
            >
              <Plus /> Grupo obligatorio (elegir 1)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ groups: [...draft.groups, { key: newKey(), name: "", minSelect: 0, maxSelect: 3, options: [] }] })}
            >
              <Plus /> Grupo opcional (extras)
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : product ? "Guardar producto" : "Crear producto"}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}

/** Grupos de primer nivel con sus categorías, para el select (dos niveles alcanzan para elegir). */
function groupTypes(types: ProductType[]): Array<ProductType & { children: ProductType[] }> {
  const roots = types.filter((t) => !t.parentId || !types.some((p) => p.id === t.parentId));
  const rootIds = new Set(roots.map((r) => r.id));
  const rootOf = (t: ProductType): string | null => {
    let current: ProductType | undefined = t;
    for (let depth = 0; current && depth < 20; depth++) {
      if (rootIds.has(current.id)) return current.id;
      current = types.find((p) => p.id === current!.parentId);
    }
    return null;
  };
  return roots.map((r) => ({ ...r, children: types.filter((t) => t.id !== r.id && rootOf(t) === r.id) }));
}
