/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--ogc-bg)",
        surface: "var(--ogc-surface)",
        border: "var(--ogc-border)",
        fg: "var(--ogc-fg)",
        muted: "var(--ogc-muted)",
        brand: "var(--ogc-brand)",
        "brand-fg": "var(--ogc-brand-fg)",
        danger: "var(--ogc-danger)",
      },
      borderRadius: { ogc: "0.625rem" },
    },
  },
  plugins: [],
};
