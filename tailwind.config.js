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
      // 4px-based spacing scale — see DESIGN.md "Spacing System"
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '40px',
        '3xl': '48px',
        '4xl': '64px',
        '5xl': '96px',
        '6xl': '128px',
        section: '192px',
      },
      // Radius scale — see DESIGN.md "Border Radius Scale"; matches existing
      // DaisyUI --rounded-btn (6px) / --rounded-box (8px) at sm/md.
      borderRadius: {
        none: '0px',
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        'pill-sm': '64px',
        pill: '100px',
      },
      // 5-level elevation system — see DESIGN.md "Elevation & Depth".
      // Values are CSS vars (base.css :root) so shadow tint follows the
      // existing theme's base-content color instead of a literal black.
      boxShadow: {
        'elevation-1': 'var(--elevation-1)',
        'elevation-2': 'var(--elevation-2)',
        'elevation-3': 'var(--elevation-3)',
        'elevation-4': 'var(--elevation-4)',
        'elevation-5': 'var(--elevation-5)',
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
