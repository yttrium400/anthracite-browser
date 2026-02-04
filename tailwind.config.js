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
                mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'monospace'],
            },
            colors: {
                // Premium neutral palette
                surface: {
                    DEFAULT: '#FFFFFF',
                    secondary: '#FAFAFA',
                    tertiary: '#F5F5F5',
                    elevated: '#FFFFFF',
                },
                border: {
                    DEFAULT: '#E8E8E8',
                    subtle: '#F0F0F0',
                    strong: '#D4D4D4',
                },
                text: {
                    primary: '#1A1A1A',
                    secondary: '#6B6B6B',
                    tertiary: '#9A9A9A',
                    inverted: '#FFFFFF',
                },
                // Brand colors - sophisticated blue-violet
                brand: {
                    DEFAULT: '#6366F1',
                    light: '#818CF8',
                    dark: '#4F46E5',
                    muted: '#EEF2FF',
                },
                // Accent colors
                accent: {
                    blue: '#3B82F6',
                    violet: '#8B5CF6',
                    emerald: '#10B981',
                    amber: '#F59E0B',
                    rose: '#F43F5E',
                },
                // Semantic colors
                success: '#22C55E',
                warning: '#EAB308',
                error: '#EF4444',
                info: '#3B82F6',
            },
            boxShadow: {
                'soft': '0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 4px 16px -4px rgba(0, 0, 0, 0.05)',
                'medium': '0 4px 12px -2px rgba(0, 0, 0, 0.08), 0 8px 24px -4px rgba(0, 0, 0, 0.06)',
                'large': '0 8px 24px -4px rgba(0, 0, 0, 0.1), 0 16px 48px -8px rgba(0, 0, 0, 0.08)',
                'glow': '0 0 24px -4px rgba(99, 102, 241, 0.25)',
                'glow-lg': '0 0 48px -8px rgba(99, 102, 241, 0.3)',
                'inner-soft': 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
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
            },
            transitionTimingFunction: {
                'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
                'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
}
