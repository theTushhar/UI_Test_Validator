/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        light: {
          "primary": "#0f172a",
          "primary-content": "#ffffff",
          "secondary": "#4f46e5",
          "secondary-content": "#ffffff",
          "accent": "#4f46e5",
          "accent-content": "#ffffff",
          "neutral": "#334155",
          "neutral-content": "#f8fafc",
          "base-100": "#ffffff",
          "base-200": "#f8fafc",
          "base-300": "#e2e8f0",
          "base-content": "#0f172a",
          "info": "#64748b",
          "success": "#16a34a",
          "warning": "#d97706",
          "error": "#dc2626",
          "--rounded-btn": "6px",
          "--rounded-box": "8px",
          "--rounded-modal": "8px",
          "--border-btn": "1px",
          "--tab-border": "1px",
          "--tab-radius": "6px",
        }
      }
    ],
    darkTheme: "light",
  },
}
