import { useRouter } from "expo-router";

import { ProfileForm } from "@/components/profile-form";
import { Loading } from "@/components/ui";
import { useCustomerProfile } from "@/lib/api";

/** «Tus datos»: editar nombre, teléfono y dirección guardada (ADR 0026). */
export default function AccountScreen() {
  const router = useRouter();
  const profile = useCustomerProfile(true);
  if (!profile.data) return <Loading />;
  return <ProfileForm initial={profile.data} onDone={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
