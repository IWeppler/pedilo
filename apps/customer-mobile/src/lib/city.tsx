import { kv } from "./storage";
import { createContext, type ReactNode, use, useCallback, useEffect, useState } from "react";

/** Ciudad elegida por el usuario, guardada en el teléfono (ver `storage.ts`). */
const STORAGE_KEY = "pedilo.city";

export interface SelectedCity {
  slug: string;
  name: string;
}

interface CityContextValue {
  city: SelectedCity | null;
  /** false mientras se lee el almacenamiento al abrir la app. */
  ready: boolean;
  setCity: (city: SelectedCity) => void;
}

const CityContext = createContext<CityContextValue | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCityState] = useState<SelectedCity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    kv.get(STORAGE_KEY)
      .then((raw) => {
        if (raw) setCityState(JSON.parse(raw) as SelectedCity);
      })
      .catch(() => {
        // Sin almacenamiento disponible: se vuelve a elegir la ciudad.
      })
      .finally(() => setReady(true));
  }, []);

  const setCity = useCallback((next: SelectedCity) => {
    setCityState(next);
    kv.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  return <CityContext value={{ city, ready, setCity }}>{children}</CityContext>;
}

export function useCity(): CityContextValue {
  const value = use(CityContext);
  if (!value) throw new Error("useCity debe usarse dentro de <CityProvider>");
  return value;
}
