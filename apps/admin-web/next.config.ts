import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Fotos en almacenamiento local (ADR 0017): se sirven reenviando a la API.
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
