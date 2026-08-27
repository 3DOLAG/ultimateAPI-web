// ===================================================
// DYNAMIC THEME ENGINE & COLOR PALETTES
// ===================================================

export const THEME_PRESETS = {
  indigo: {
    name: 'Indigo / Neon Purple (Default)',
    primary: '#6366f1',
    hover: '#4f46e5',
    accent: '#818cf8'
  },
  emerald: {
    name: 'Emerald / Green Gaming',
    primary: '#10b981',
    hover: '#059669',
    accent: '#34d399'
  },
  purple: {
    name: 'Royal Purple / Discord Style',
    primary: '#9333ea',
    hover: '#7e22ce',
    accent: '#c084fc'
  },
  crimson: {
    name: 'Crimson / Red Fire',
    primary: '#ef4444',
    hover: '#dc2626',
    accent: '#f87171'
  },
  amber: {
    name: 'Amber / Gold Luxury',
    primary: '#f59e0b',
    hover: '#d97706',
    accent: '#fbbf24'
  },
  cyan: {
    name: 'Cyan / Cyberpunk Neon',
    primary: '#06b6d4',
    hover: '#0891b2',
    accent: '#22d3ee'
  },
  blue: {
    name: 'Ocean Blue',
    primary: '#2563eb',
    hover: '#1d4ed8',
    accent: '#60a5fa'
  },
  rose: {
    name: 'Neon Rose / Pink',
    primary: '#f43f5e',
    hover: '#e11d48',
    accent: '#fb7185'
  }
};

export function hexToRgba(color, opacity = 1) {
  if (!color) return `rgba(99, 102, 241, ${opacity})`;
  if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
  let hex = color.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
}

export function resolveTheme(storeConfig = {}) {
  const presetKey = (storeConfig.themePreset || 'indigo').toLowerCase().trim();
  const base = THEME_PRESETS[presetKey] || THEME_PRESETS.indigo;

  const primary = storeConfig.themePrimaryColor || base.primary;
  const hover = storeConfig.themePrimaryHover || base.hover;
  const accent = storeConfig.themeAccentColor || base.accent;
  const bgPrimary = storeConfig.themeBgColor || '';
  const bgSurface = storeConfig.themeSurfaceColor || '';

  return {
    preset: presetKey in THEME_PRESETS ? presetKey : 'custom',
    primary,
    hover,
    accent,
    subtle: hexToRgba(primary, 0.15),
    border: hexToRgba(primary, 0.35),
    shadow: hexToRgba(primary, 0.3),
    bgPrimary,
    bgSurface
  };
}

export function generateDynamicCss(storeConfig = {}) {
  const theme = resolveTheme(storeConfig);
  return `/* Dynamic Reseller Store Theme (Configured via .env) */
:root {
  --accent-primary: ${theme.primary};
  --accent-hover: ${theme.hover};
  --accent-light: ${theme.accent};
  --accent-subtle: ${theme.subtle};
  --border-accent: ${theme.border};
  --shadow-glow: 0 0 24px -2px ${theme.shadow};
  ${theme.bgPrimary ? `--bg-primary: ${theme.bgPrimary};` : ''}
  ${theme.bgSurface ? `--bg-surface: ${theme.bgSurface};` : ''}
}
`;
}
