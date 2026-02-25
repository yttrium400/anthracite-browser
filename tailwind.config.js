/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    prefix: "",
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            fontFamily: {
                sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
                display: ['Geist', 'Inter', 'SF Pro Display', '-apple-system', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'monospace'],
            },
            colors: {
                // Dark-first surface layers
                surface: {
                    DEFAULT: '#0A0A0B',
                    secondary: '#111113',
                    tertiary: '#1A1A1D',
                    elevated: '#222225',
                },
                border: {
                    DEFAULT: 'rgba(255,255,255,0.08)',
                    subtle: 'rgba(255,255,255,0.04)',
                    strong: 'rgba(255,255,255,0.12)',
                },
                text: {
                    primary: '#FAFAFA',
                    secondary: '#A1A1AA',
                    tertiary: '#71717A',
                    inverted: '#0A0A0B',
                },
                // Brand — warm brushed gold (Anthracite: coal-dark with mineral lustre)
                brand: {
                    DEFAULT: '#C8A97E',
                    light: '#DFC4A0',
                    dark: '#A8895A',
                    muted: 'rgba(200,169,126,0.12)',
                },
                // Accent colors
                accent: {
                    blue: '#3B82F6',
                    violet: '#8B5CF6',
                    emerald: '#10B981',
                    amber: '#F59E0B',
                    rose: '#EF4444',
                },
                // Semantic
                success: '#22C55E',
                warning: '#F59E0B',
                error: '#EF4444',
                info: '#3B82F6',
            },
            boxShadow: {
                'soft': '0 2px 8px -2px rgba(0,0,0,0.3), 0 4px 16px -4px rgba(0,0,0,0.2)',
                'medium': '0 4px 12px -2px rgba(0,0,0,0.4), 0 8px 24px -4px rgba(0,0,0,0.3)',
                'large': '0 8px 24px -4px rgba(0,0,0,0.5), 0 16px 48px -8px rgba(0,0,0,0.4)',
                'glow': '0 0 20px -4px rgba(200,169,126,0.35)',
                'glow-lg': '0 0 40px -8px rgba(200,169,126,0.4)',
                'glow-brand': '0 0 20px rgba(200,169,126,0.35)',
                'inner-soft': 'inset 0 1px 2px rgba(0,0,0,0.2)',
                'inner-glow': 'inset 0 1px 0 rgba(255,255,255,0.05)',
            },
            borderRadius: {
                '4xl': '2rem',
                '5xl': '2.5rem',
            },
            backdropBlur: {
                'xs': '2px',
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out',
                'fade-in-up': 'fadeInUp 0.4s ease-out',
                'fade-in-down': 'fadeInDown 0.4s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
                'slide-in-left': 'slideInLeft 0.3s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'shimmer': 'shimmer 2s linear infinite',
                'spin-slow': 'spin 3s linear infinite',
                'bounce-soft': 'bounceSoft 1s ease-in-out infinite',
                'gradient': 'gradient 8s ease infinite',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                fadeInDown: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                slideInLeft: {
                    '0%': { opacity: '0', transform: 'translateX(-20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                slideInRight: {
                    '0%': { opacity: '0', transform: 'translateX(20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                pulseSoft: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.6' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                bounceSoft: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-4px)' },
                },
                gradient: {
                    '0%, 100%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 20px rgba(200,169,126,0.25)' },
                    '50%': { boxShadow: '0 0 30px rgba(200,169,126,0.5)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-10px)' },
                },
                breathe: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.8' },
                },
            },
            transitionTimingFunction: {
                'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
                'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                'material': 'cubic-bezier(0.4, 0, 0.2, 1)',
                'ios': 'cubic-bezier(0.32, 0.72, 0, 1)',
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'gradient-conic': 'conic-gradient(from 0deg, var(--tw-gradient-stops))',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
}
