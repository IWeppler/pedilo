import { Redirect } from "expo-router";

/** Destino de la pestaña «Carrito». La pestaña abre `/cart`; si se llega acá por link, se redirige. */
export default function BagTab() {
  return <Redirect href="/cart" />;
}
