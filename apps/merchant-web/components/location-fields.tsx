import type { Branch, City } from "@pedilo/api-client";

import { FormField, fieldA11y } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Input } from "@/components/ui/input";

/**
 * Dónde está el comercio y cómo entrega. Por detrás es la única sucursal del comercio (la API
 * admite varias, el panel no las muestra). Lo usan el registro y la página «Local y entregas».
 */
export function LocationFields({
  cities,
  branch,
  values,
  errors,
}: {
  cities: City[];
  branch?: Branch;
  /** Lo que mandó el usuario, si el form volvió con errores. */
  values?: Record<string, string>;
  errors: Record<string, string | undefined>;
}) {
  const value = (key: string, fallback: string) => values?.[key] ?? fallback;
  const checked = (key: string, fallback: boolean) => (values ? values[key] === "on" : fallback);

  return (
    <>
      <FormField id="cityId" label="Ciudad" error={errors.cityId}>
        <NativeSelect {...fieldA11y("cityId", errors.cityId)} defaultValue={value("cityId", branch?.cityId ?? cities[0]?.id ?? "")} required>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}, {c.province}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <FormField id="addressLine" label="Dirección del local" error={errors.addressLine}>
        <Input
          {...fieldA11y("addressLine", errors.addressLine)}
          defaultValue={value("addressLine", branch?.addressLine ?? "")}
          required
          minLength={3}
          maxLength={160}
          placeholder="San Martín 123"
        />
      </FormField>

      <FormField
        id="addressNotes"
        label="Indicaciones (opcional)"
        error={errors.addressNotes}
        hint="Para que te encuentren el cliente que retira y el repartidor."
      >
        <Input
          {...fieldA11y("addressNotes", errors.addressNotes)}
          defaultValue={value("addressNotes", branch?.addressNotes ?? "")}
          maxLength={200}
          placeholder="Frente a la plaza, portón verde"
        />
      </FormField>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Formas de entrega</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsPickup" defaultChecked={checked("acceptsPickup", branch?.acceptsPickup ?? true)} className="size-4 accent-primary" />
          Retiro en el local
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsDelivery" defaultChecked={checked("acceptsDelivery", branch?.acceptsDelivery ?? false)} className="size-4 accent-primary" />
          Envío a domicilio (después cargás las zonas y tarifas)
        </label>
      </fieldset>
    </>
  );
}
