import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado simétrico para secretos guardados en la base (tokens OAuth de los comercios, ADR 0021).
 * AES-256-GCM con nonce aleatorio por valor; el resultado es "v1.<nonce>.<tag>.<cifrado>" en base64url.
 * La clave (32 bytes en base64) vive solo en el entorno de la API.
 */
export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("La clave de cifrado tiene que ser de 32 bytes (base64)");
  return {
    seal(plain) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
    },
    open(sealed) {
      const [version, nonce, tag, data] = sealed.split(".");
      if (version !== "v1" || !nonce || !tag || !data) throw new Error("Secreto cifrado con formato desconocido");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
