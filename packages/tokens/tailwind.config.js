/**
 * Tailwind Token Mapping
 * Maps CSS Custom Properties from tokens.css into Tailwind.
 * Tailwind classes reference token values – never raw values.
 */

const fs = require('fs');
const path = require('path');

// Read tokens.json to dynamically map the structure
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, './tokens.json'), 'utf8'));

function generateTailwindConfig(obj, prefix = '') {
  const config = {};
  for (const [key, value] of Object.entries(obj)) {
    const cleanKey = key.toLowerCase().replace(/[\s/]+/g, '-');
    const fullKey = prefix ? `${prefix}-${cleanKey}` : cleanKey;
    
    if (typeof value === 'object' && value !== null) {
      config[cleanKey] = generateTailwindConfig(value, fullKey);
    } else {
      config[cleanKey] = `var(--${fullKey})`;
    }
  }
  return config;
}

const dynamicTheme = generateTailwindConfig(tokens);

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      ...dynamicTheme,
      // Manual additions for nested Tailwind mappings
      colors: {
        ...dynamicTheme.color
      },
      spacing: {
        ...dynamicTheme.spacing
      },
      screens: {
        'sm': '360px',   // Mobile (Figma Design)
        'md': '600px',   // Tablet
        'lg': '900px',   // Desktop
        'xl': '1200px',  // Large Desktop
        '2xl': '1440px', // Extra Large Desktop
      }
    },
  },
};
