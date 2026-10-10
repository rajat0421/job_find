/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Shared design tokens (pre-launch redesign) for the dark theme's
      // surface hierarchy — previously each page redefined the same raw hex
      // values (#0a0a12/#12121c/#0f0f1a/#1a1a28) independently. Centralizing
      // them here means a future palette tweak is a one-line change instead
      // of a site-wide find/replace. Text/accent/status colors intentionally
      // keep using Tailwind's built-in slate/violet/emerald/amber/red
      // palettes, which were already used consistently — no need to
      // reinvent a second naming scheme for those.
      colors: {
        surface: '#0a0a12',    // page background
        card: '#12121c',       // primary card/panel surface
        'card-soft': '#0f0f1a', // nested/secondary surface (e.g. an inactive option tile)
        field: '#1a1a28',      // form input background
      },
    },
  },
  plugins: [],
}

