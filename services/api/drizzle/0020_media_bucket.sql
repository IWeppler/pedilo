-- Bucket público de Supabase Storage para fotos de productos, logos y portadas (ADR 0017).
-- La API sube con la clave secreta (saltea RLS) y la lectura es por URL pública: no hacen
-- falta políticas. Solo WebP (la API reprocesa todo) y hasta 2 MB.
-- En el Postgres local no existe el esquema storage: ahí no hace nada.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('media', 'media', true, 2097152, ARRAY['image/webp'])
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END
$$;
