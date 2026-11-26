import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Fotos de productos y del comercio (ADR 0017): la API acepta hasta 8 MB; margen para el multipart.
    serverActions: { bodySizeLimit: "9mb" },
  },
  cacheComponents: true,
  // Fotos en almacenamiento local (ADR 0017): la API devuelve `/media/...`. El navegador nunca
  // habla con la API directo, así que el panel las sirve reenviando a la API.
  rewrites: async () => [
    { source: "/media/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/media/:path*` },
  ],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
