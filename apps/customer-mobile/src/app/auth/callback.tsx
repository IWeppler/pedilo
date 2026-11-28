import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { AuthHeading, AuthScreen, PrimaryButton } from "@/components/auth-ui";
import { Loading } from "@/components/ui";
import { completeSignInFromUrl } from "@/lib/auth";

/**
 * Vuelta de un link de ingreso (`pedilo://auth/callback?code=…`, ADR 0026): Google o Apple por
 * navegador, confirmación del email o «¿Olvidaste tu contraseña?». Canjea el código y `_layout`
 * lleva a donde corresponde. En web, Supabase lo canjea solo al cargar.
 *
 * Si el link no sirve (venció, ya se usó o se abrió en otro dispositivo), lo dice y vuelve al
 * ingreso en vez de quedarse cargando.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { code, error_description: providerError } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void completeSignInFromUrl(providerError ? undefined : code).then((ok) => {
      if (cancelled) return;
      if (ok) router.replace("/");
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [code, providerError, router]);

  if (!failed) return <Loading />;
  return (
    <AuthScreen>
      <AuthHeading
        title="Este link ya no sirve"
        lede="Puede que haya vencido, que ya lo hayas usado o que lo abriste en otro dispositivo. Pedí uno nuevo desde este celular."
      />
      <PrimaryButton label="Volver a ingresar" onPress={() => router.replace("/")} />
    </AuthScreen>
  );
}
