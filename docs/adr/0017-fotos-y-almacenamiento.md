# 0017 — Fotos y almacenamiento de imágenes

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
El menú, la lista de comercios y la página de cada comercio usaban íconos del rubro. Los comercios necesitan subir fotos de productos, logo y portada desde el panel, muchas veces directo desde el celular (fotos de varios MB, con orientación EXIF y ubicación GPS en los metadatos). El hosting de la API todavía no está decidido; la base y el auth ya están en Supabase.

## Opciones consideradas
- **Subida directa del navegador al storage con URL firmada** vs **subida a través de la API**. A través de la API: se valida y se reprocesa siempre (nada llega al storage sin pasar por sharp) y el panel mantiene su regla de que el navegador no habla con servicios externos. Costo: el archivo pasa por la API (hasta 8 MB).
- **Supabase Storage** vs **S3/R2**. Supabase ya está en el stack; un bucket público alcanza para fotos de menú.
- **Guardar la URL** vs **guardar la ruta**. La ruta: el dominio del storage o de la CDN puede cambiar sin migrar datos.

## Decisión
- **Interfaz `MediaStorage`** (`services/api/src/lib/media.ts`) con dos implementaciones:
  - `local` (desarrollo, por defecto): disco en `MEDIA_LOCAL_DIR` (`.media`, ignorado por git), servido por la API en `GET /media/*` con caché inmutable y `Cross-Origin-Resource-Policy: cross-origin`. La ruta se resuelve dentro de la carpeta (sin `..`).
  - `supabase` (obligatorio en producción): API REST de Storage con `SUPABASE_SECRET_KEY` en un bucket público (`SUPABASE_STORAGE_BUCKET`, `media`).
- **Procesamiento con sharp**: se valida por contenido (JPG, PNG, WebP, HEIF/AVIF; mínimo 200 × 200; hasta 8 MB), se corrige la orientación, **se descartan los metadatos** (incluido el GPS) y se guarda en WebP: producto hasta 1200 px, logo 512 × 512, portada 1600 × 640.
- **Ruta nueva por subida** (`merchants/{id}/{nombre}-{aleatorio}.webp`): las cachés nunca muestran la foto vieja. Se guarda primero el archivo, después la base; la foto anterior se borra después de confirmar, y si la base falla se borra la nueva (sin huérfanos en el camino feliz).
- **Rutas**: `PUT/DELETE /merchants/{id}/menu/products/{productId}/image` (catálogo editable) y `PUT/DELETE /merchants/{id}/images/{logo|cover}` (solo el dueño). Body `multipart/form-data`, campo `file`.
- **DTOs** con `imageUrl`, `logoUrl`, `coverUrl`. En modo local son relativas (`/media/...`) y cada cliente las resuelve: la app contra su URL de la API (localhost o la IP de la red), el panel con un rewrite de Next `/media/*` → API.
- **Panel**: subir, cambiar y quitar en la edición de producto y en «Datos del comercio»; miniaturas en el catálogo. Server Actions con `bodySizeLimit: 9mb`.
- **App del cliente**: fotos con `expo-image` (caché en disco) en destacados, lista de comercios (logo), portada del comercio, productos y modal de producto; sin foto, el ícono del rubro como antes.

## Consecuencias
- Para producción hay que crear el bucket público en Supabase y cargar `SUPABASE_SECRET_KEY` (secreta, solo en el servidor). La implementación de Supabase no está probada contra un proyecto real todavía.
- Las fotos de los datos de demo siguen sin imagen: se suben desde el panel.
- **Pendiente:** varias fotos por producto, recorte manual en el panel, limpieza periódica de archivos huérfanos (si se cae el proceso entre subir y guardar), y CDN si el tráfico lo pide.
