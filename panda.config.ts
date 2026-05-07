import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  preflight: true,
  include: ["./src/**/*.{ts,tsx,js,jsx}"],
  exclude: ["./styled-system/**/*"],
  outdir: "styled-system",
  importMap: "styled-system",
  globalCss: {
    ":root": {
      color: "#111827",
      background: "#f9fafb",
      fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
      fontSynthesis: "none",
      textRendering: "optimizeLegibility",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
    },
    body: {
      margin: "0",
    },
  },
});
