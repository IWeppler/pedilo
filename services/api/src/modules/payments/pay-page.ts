import type { FastifyPluginAsync } from "fastify";

/**
 * Pantalla de pago con tarjeta (ADR 0021, etapa 2): Card Payment Brick de Mercado Pago.
 *
 * La sirve la API en `/pay/{orderId}#t={token de seguimiento}`: el token va en el fragmento (no
 * llega a logs ni a proxies). La app la abre con expo-web-browser y, al terminar, la página vuelve
 * a `pedilo://order/{id}`. La public key se pide sin caché a `/v1/payments/config`; el monto lo
 * muestra el Brick pero el cobro lo calcula el servidor desde el pedido.
 */
const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pagar pedido · Pedilo</title>
<style>
  :root { color-scheme: light; --ink: #1d1a16; --muted: #6b645a; --accent: #e4572e; --bg: #faf7f2; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--ink); }
  main { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .muted { color: var(--muted); margin: 0 0 20px; }
  .total { font-size: 1.75rem; font-weight: 700; margin: 0 0 20px; }
  .box { background: #fff; border-radius: 14px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .state { text-align: center; padding: 32px 8px; }
  .state h2 { margin: 8px 0; font-size: 1.2rem; }
  .btn { display: inline-block; margin-top: 16px; padding: 12px 20px; border-radius: 10px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; border: 0; font-size: 1rem; }
  .error { color: #b42318; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1 id="title">Pagar pedido</h1>
  <p class="muted" id="subtitle">Pago con tarjeta procesado por Mercado Pago.</p>
  <p class="total" id="total" hidden></p>
  <div id="brick"></div>
  <div class="box state" id="state" hidden>
    <h2 id="stateTitle"></h2>
    <p class="muted" id="stateText"></p>
    <a class="btn" id="back" href="#">Volver a Pedilo</a>
    <button class="btn" id="retry" type="button" hidden>Probar con otra tarjeta</button>
  </div>
</main>
<script src="https://sdk.mercadopago.com/js/v2"></script>
<script>
(function () {
  var orderId = location.pathname.split("/").filter(Boolean).pop();
  var token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
  var appUrl = "pedilo://order/" + encodeURIComponent(orderId);
  var brickController = null;
  var $ = function (id) { return document.getElementById(id); };
  $("back").href = appUrl;

  function show(title, text, opts) {
    opts = opts || {};
    $("state").hidden = false;
    $("stateTitle").textContent = title;
    $("stateTitle").className = opts.error ? "error" : "";
    $("stateText").textContent = text || "";
    $("retry").hidden = !opts.retry;
    $("brick").hidden = true;
  }
  function goBack(delayMs) { setTimeout(function () { location.href = appUrl; }, delayMs); }
  function money(minor) {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(minor / 100);
  }
  function api(path, init) {
    init = init || {};
    init.headers = Object.assign({ "x-order-token": token, accept: "application/json" }, init.headers || {});
    init.cache = "no-store";
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    });
  }
  function newKey() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  }

  function handleResult(result) {
    if (result.status === "APPROVED") {
      show("¡Pago aprobado!", "Le avisamos al comercio. Volvé a la app para seguir tu pedido.");
      goBack(1500);
    } else if (result.status === "PENDING") {
      show("Pago en revisión", "Mercado Pago está procesando el pago. Te avisamos en la app cuando se confirme.");
      goBack(2500);
    } else {
      show("El pago no se aprobó", "Revisá los datos o probá con otra tarjeta. No se te cobró nada.", { error: true, retry: true });
    }
  }

  function mountBrick(publicKey, amountMinor) {
    var mp = new MercadoPago(publicKey, { locale: "es-AR" });
    return mp.bricks().create("cardPayment", "brick", {
      initialization: { amount: amountMinor / 100 },
      customization: {
        paymentMethods: { maxInstallments: 1 },
        visual: { style: { theme: "default" } }
      },
      callbacks: {
        onReady: function () {},
        onError: function (error) { console.error("brick", error); },
        onSubmit: function (formData) {
          // Una clave por intento: un doble toque o un reintento de red no cobra dos veces.
          return api("/v1/public/orders/" + orderId + "/payments", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": newKey() },
            body: JSON.stringify({
              token: formData.token,
              paymentMethodId: formData.payment_method_id,
              issuerId: formData.issuer_id ? String(formData.issuer_id) : null,
              payer: {
                email: formData.payer.email,
                identification: { type: formData.payer.identification.type, number: String(formData.payer.identification.number) }
              }
            })
          }).then(function (r) {
            if (r.ok) return handleResult(r.body);
            var reason = r.body && r.body.error && r.body.error.details && r.body.error.details.reason;
            if (reason === "NOT_PAYABLE") { show("Este pedido ya no está esperando el pago", "", {}); return; }
            show("No pudimos procesar el pago", (r.body.error && r.body.error.message) || "Probá de nuevo en unos minutos.", { error: true, retry: true });
          });
        }
      }
    }).then(function (controller) { brickController = controller; });
  }

  var amount = 0, publicKey = "";
  $("retry").addEventListener("click", function () {
    $("state").hidden = true;
    $("brick").hidden = false;
    if (brickController) brickController.unmount();
    mountBrick(publicKey, amount);
  });

  if (!orderId || !token) { show("Link de pago inválido", "Abrí el pago desde la app.", { error: true }); return; }

  Promise.all([
    fetch("/v1/payments/config", { cache: "no-store" }).then(function (r) { return r.json(); }),
    api("/v1/public/orders/" + orderId),
    api("/v1/public/orders/" + orderId + "/payment")
  ]).then(function (all) {
    var config = all[0], order = all[1], payment = all[2];
    if (!config.enabled || !config.publicKey) return show("Pago con tarjeta no disponible", "", { error: true });
    if (!order.ok) return show("No encontramos el pedido", "Abrí el pago desde la app.", { error: true });
    var o = order.body;
    if (o.status !== "PENDING_PAYMENT") {
      if (payment.ok && payment.body.payment && payment.body.payment.status === "APPROVED") return handleResult(payment.body.payment);
      return show("Este pedido ya no está esperando el pago", "", {});
    }
    if (payment.ok && payment.body.payment && payment.body.payment.status === "PENDING") return handleResult(payment.body.payment);
    $("title").textContent = "Pagar pedido " + (o.code || "");
    $("subtitle").textContent = o.merchant && o.merchant.name ? o.merchant.name : $("subtitle").textContent;
    amount = o.totalMinor;
    publicKey = config.publicKey;
    $("total").textContent = money(amount);
    $("total").hidden = false;
    return mountBrick(publicKey, amount);
  }).catch(function () {
    show("Sin conexión", "Revisá tu conexión y volvé a abrir el pago.", { error: true });
  });
})();
</script>
</body>
</html>`;

export const payPageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pay/:orderId", { schema: { hide: true } }, async (_request, reply) =>
    reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store, max-age=0")
      .header("referrer-policy", "no-referrer")
      .send(PAGE),
  );
};
