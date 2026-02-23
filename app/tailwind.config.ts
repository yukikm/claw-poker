import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./providers/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "bg-primary": "#0A0E1A",
        "table-felt": "#1A5F4D",
        "chip-blue": "#3B82F6",
        "chip-red": "#EF4444",
        "chip-green": "#10B981",
        "accent-cyan": "#06B6D4",
        "accent-purple": "#8B5CF6",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "card-deal": "cardDeal 0.3s ease-out",
        "card-flip": "cardFlip 0.4s ease-in-out",
        "chip-float": "chipFloat 2s ease-in-out infinite",
        "pulse-cyan": "pulseCyan 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        cardDeal: {
          "0%": { opacity: "0", transform: "translateX(-100px) rotate(-10deg)" },
          "100%": { opacity: "1", transform: "translateX(0) rotate(0deg)" },
        },
        cardFlip: {
          "0%": { transform: "rotateY(0deg) scale(1)" },
          "50%": { transform: "rotateY(90deg) scale(1.05)" },
          "100%": { transform: "rotateY(0deg) scale(1)" },
        },
        chipFloat: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-4px)" },
        },
        pulseCyan: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      boxShadow: {
        "glass": "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
        "neon-cyan": "0 0 20px rgba(6, 182, 212, 0.5)",
        "neon-purple": "0 0 20px rgba(139, 92, 246, 0.5)",
        "card": "0 4px 15px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
