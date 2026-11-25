/** Genera un par de claves VAPID para Web Push (ADR 0009). Copiar a .env; la privada no se commitea. */
import { generateVAPIDKeys } from "web-push";

const keys = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
