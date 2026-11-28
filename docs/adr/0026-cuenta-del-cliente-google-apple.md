# 0026 — Cuenta del cliente (Google, Apple o email)

- **Estado:** Aceptada
- **Fecha:** 2026-11-27

## Contexto
El cliente pedía como invitado (ADR 0007): cualquiera podía crear pedidos con un nombre y un teléfono inventados, y sus pedidos vivían solo en el celular donde los hizo. Por seguridad, pedir pasa a requerir una cuenta registrada, con el menor esfuerzo posible: entrar con Google, Apple o email y contraseña. La API ya verifica tokens de Supabase (ADR 0004) y `orders.customer_user_id` ya guarda el usuario si el pedido llega con sesión.

## Opciones consideradas
- **Cuenta opcional** vs **obligatoria**. Obligatoria, desde la primera pantalla: cada pedido queda atado a una persona identificada, lo que frena pedidos falsos y bromas a los comercios.
- **Verificar el teléfono por SMS** vs **verificar el email**. El email: Google y Apple ya lo verifican, y la cuenta con email se confirma con el link que le llega. El SMS cuesta por mensaje y suma un proveedor; el teléfono queda como dato de contacto declarado.
- **Datos de contacto en cada pedido** vs **en la cuenta**. En la cuenta: el checkout no pide nada y la API no acepta otro nombre o teléfono por pedido.
- **Exigirlo solo en la app** vs **en la API**. En la API: si no, cualquiera la llama directo.
- **Google nativo (SDK de Google)** vs **OAuth en el navegador del sistema**. El navegador funciona en Expo Go, en Android e iOS y en web sin módulos nativos; el SDK nativo queda como mejora.
- **Apple por navegador en todos lados** vs **nativo en iPhone**. Supabase y Apple recomiendan el nativo en iOS; en Android no existe, así que ahí va por navegador.
- **Datos en `users`** vs **perfil propio**. `customer_profiles` (nombre y teléfono) separa lo que pide el pedido de la identidad.

## Decisión
- **Ingreso**: Supabase Auth, PKCE. Google: `signInWithOAuth` + `WebBrowser.openAuthSessionAsync` y vuelta por `pedilo://auth/callback` (ruta `auth/callback` por si el sistema abre la app con el link). Apple: `expo-apple-authentication` + `signInWithIdToken` en iPhone (el nombre que Apple da solo la primera vez se guarda en el usuario); OAuth por navegador en Android.
- **Email y contraseña** (en vez de un código por email: es lo que la gente espera y no depende de abrir el correo cada vez): «Ingresar» (`signInWithPassword`) y «Crear cuenta» (`signUp`, mínimo 8 caracteres). La cuenta nueva queda pendiente hasta abrir el link de confirmación, que vuelve a `auth/callback` y abre la sesión; se puede pedir otro. Sin confirmar no se puede ingresar.
- **¿Olvidaste tu contraseña?**: `resetPasswordForEmail` manda un link (la respuesta es la misma exista o no la cuenta). Al abrirlo, Supabase emite `PASSWORD_RECOVERY` y la app muestra solo «Elegí tu contraseña nueva» (`updateUser`) hasta guardarla; después sigue como cualquier ingreso. El evento se escucha al crear el cliente porque en web el link se canjea antes de montar React. Un link vencido, usado o abierto en otro dispositivo (PKCE) muestra «Este link ya no sirve» y vuelve al ingreso.
- **Registro**: después del primer ingreso, nombre, teléfono y dirección de entrega con el punto en el mapa (`PUT /customer/me`). El nombre se precarga con lo que dio Google/Apple. `GET /customer/me` → 404 hasta completarlo. Se edita en «Mis pedidos» → «Tus datos».
- **Pedir requiere cuenta** (`POST /public/orders`): 401 sin sesión y 403 `PROFILE_REQUIRED` sin perfil. Nombre y teléfono del pedido salen del perfil (el body ya no trae `customer`). El límite por IP (ADR 0010) cuenta los intentos con sesión; los anónimos se rechazan antes. Reusar la `Idempotency-Key` de otro cliente da 409 `IDEMPOTENCY_KEY_REUSED` (antes devolvía el pedido ajeno con su token).
- **Pedidos**: quedan en la cuenta. `GET /customer/orders` devuelve los últimos 50 con su token de seguimiento: la app los suma a los del celular y se abren igual que los de invitado.
- **En la app**: sin sesión solo existe el ingreso; con sesión y sin perfil, el registro; recién después los comercios. El checkout no pide datos: muestra a nombre de quién va y, con envío, la dirección guardada con «Cambiar». Una dirección nueva queda guardada en la cuenta para el próximo pedido. Sin las variables de Supabase no se puede entrar.
- **Montos sin decimales en la app del cliente**: `formatARSWhole` (redondeo half-up, SPEC §6.2), solo para mostrar; los cálculos siguen en centavos. También en los avisos de reclamos al cliente. Los paneles siguen con centavos.

## Consecuencias
- **Pendiente para que funcione**: en Supabase, activar los proveedores Google (cliente OAuth web de Google Cloud) y Apple (Services ID + clave; en «Client IDs», el Services ID primero y el bundle `ar.pedilo.customer`), y sumar las Redirect URLs `pedilo://auth/callback` y la de Expo Go (`exp://…/--/auth/callback`). Cargar `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` en la app (y en EAS). Apple nativo necesita un build de iOS.
- Al salir de la cuenta, los pedidos ya traídos quedan en el celular (como los de invitado).
- Los pedidos hechos como invitado antes de este cambio no se asocian solos a ninguna cuenta; sus tokens de seguimiento siguen funcionando.
- Los límites por teléfono (ADR 0010) siguen mirando el teléfono del pedido; con cuentas se podrían pasar a límites por usuario.
- El teléfono es declarado, no verificado: la identidad la da el email verificado.
