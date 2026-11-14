import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // This is server-side Vite configuration, never a browser-visible API key.
  const env = loadEnv(mode, process.cwd(), "");
  const target = new URL(
    process.env.API_PROXY_TARGET ||
      env.API_PROXY_TARGET ||
      "http://127.0.0.1:8000",
  );
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "API_PROXY_TARGET must be an HTTP(S) origin without credentials or a path",
    );
  }
  return {
    server: {
      port: 5173,
      strictPort: true,
      proxy: { "^/api(?:/|$)": { target: target.origin, changeOrigin: true } },
    },
  };
});
