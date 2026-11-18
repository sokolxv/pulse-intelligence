/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pulse: {
          bg: '#0A0A0C',
          bgSoft: '#101014',
          surface: '#141419',
          surfaceHover: '#1C1C22',
          panel: '#1F1F26',
          panelHover: '#282832',
          border: '#232329',
          borderStrong: '#35353E',
          accent: '#F5F5F7',
          accentSoft: '#FFFFFF',
          accentDim: '#A8A8B3',
          accentMuted: '#6E6E78',
          cream: '#F5F5F7',
          creamDim: '#DBDBE0',
          text: '#EDEDF2',
          textMuted: '#A8A8B3',
          muted: '#71717B',
          green: '#8CA58A',
          greenDim: '#66796A',
          red: '#C08A7E',
          yellow: '#C8A87E',
          orange: '#B99776',
          purple: '#A79BB2',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 18px rgba(245, 245, 247, 0.14)',
        'glow-gold': '0 0 18px rgba(245, 245, 247, 0.14)',
        'glow-green': '0 0 15px rgba(140, 165, 138, 0.16)',
        soft: '0 4px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(244, 244, 246, 0.04) inset',
        card: '0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(244, 244, 246, 0.05) inset',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        'scan': 'scan 2s linear infinite',
        'fade-up': 'fade-up 0.22s cubic-bezier(0.22, 0.9, 0.3, 1) both',
        'shimmer': 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.12)' },
        },
      },
    },
  },
  plugins: [],
};
