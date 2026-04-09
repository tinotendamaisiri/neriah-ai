import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Neriah brand colours — single source of truth
        teal: {
          DEFAULT: '#0D7377',
          dark:    '#085041',
          deep:    '#04342C',
          light:   '#E1F5EE',
          mid:     '#9FE1CB',
          600:     '#0F6E56',
        },
        amber: {
          DEFAULT: '#F5A623',
          light:   '#FFF3E0',
          dark:    '#854F0B',
        },
        dark:     '#2C2C2A',
        mid:      '#6B6B6B',
        'off-white': '#F8F8F6',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        body:    ['DM Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(32px, 6vw, 56px)', { lineHeight: '1.1', letterSpacing: '-1.5px' }],
        'display-lg': ['clamp(26px, 4vw, 40px)', { lineHeight: '1.2', letterSpacing: '-0.5px' }],
        'display-md': ['clamp(20px, 3vw, 28px)', { lineHeight: '1.25', letterSpacing: '-0.3px' }],
      },
      spacing: {
        'section': '80px',
        'section-sm': '56px',
      },
      borderRadius: {
        'card': '16px',
        'pill': '24px',
      },
      animation: {
        'fade-up':    'fadeUp 0.6s ease forwards',
        'flicker':    'flicker 0.7s ease-in-out infinite alternate',
        'flow-down':  'flowDown 1.5s linear infinite',
        'engine-ring':'engineRing 3s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'dot-pulse':  'dotPulse 1.2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        flicker: {
          '0%':   { transform: 'translateX(-50%) scaleY(1) scaleX(1)' },
          '100%': { transform: 'translateX(-51%) scaleY(0.82) scaleX(0.88)' },
        },
        flowDown: {
          '0%':   { top: '-5px',          opacity: '0' },
          '10%':  { opacity: '1' },
          '85%':  { opacity: '1' },
          '100%': { top: 'calc(100% + 5px)', opacity: '0' },
        },
        engineRing: {
          '0%, 100%': { opacity: '0.2', transform: 'scale(1)' },
          '50%':      { opacity: '0.6', transform: 'scale(1.02)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.7', transform: 'translateX(-50%) scale(1)' },
          '50%':      { opacity: '1',   transform: 'translateX(-50%) scale(1.2)' },
        },
        dotPulse: {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%':      { opacity: '1',   transform: 'scale(1.3)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
