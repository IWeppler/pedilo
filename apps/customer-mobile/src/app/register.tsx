import { ProfileForm } from "@/components/profile-form";

/**
 * Registro (ADR 0026): después de entrar por primera vez, nombre, teléfono y dirección. Al
 * guardarlos, la app pasa sola a los comercios (la decide `_layout`).
 */
export default function RegisterScreen() {
  return <ProfileForm initial={null} />;
}
