/**
 * Extiende `app.json` con lo que sale de variables de entorno (app.json no puede leerlas).
 *
 * - `GOOGLE_MAPS_ANDROID_API_KEY`: clave del Maps SDK for Android para el mapa del seguimiento
 *   (ADR 0022). En Expo Go no hace falta; en los builds de EAS se carga como variable del entorno
 *   (`eas env:create`). Sin clave, el mapa de Android se ve gris en un build propio.
 */
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "" }],
  ],
});
