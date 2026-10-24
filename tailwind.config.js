/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e1a',
        panel: '#131729',
        panel2: '#171c33',
        border: '#252b45',
        text: '#e8eaf3',
        muted: '#8891ab',
        accent: '#6c8bff',
        accent2: '#3ecf8e',
        accent3: '#b17cff',
        accent4: '#ff9f5a',
      },
      spacing: {
        4.5: '1.125rem',
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
};
