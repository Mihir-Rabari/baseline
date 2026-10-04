import type { TenantBranding } from '@packages/validation';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `#1a73e8` to the `h s% l%` triple the theme variables use, or null for anything that is not a plain hex colour. */
export function hexToHslTriple(hex: string): { triple: string; lightness: number; luminance: number } | null {
  if (!HEX.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { triple: `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`, lightness: l, luminance };
}

/** Dark text on light colours and light text on dark ones, by relative luminance (WCAG). */
const readable = (luminance: number) => (luminance > 0.179 ? '240 10% 4%' : '0 0% 98%');

/**
 * Theme variables for a club's palette. Only values that parse as plain hex colours are used, so a
 * stored value can never inject CSS. Foreground colours are picked for contrast.
 */
export function brandingStyle(branding: Pick<TenantBranding, 'primaryColor' | 'secondaryColor' | 'accentColor'> | null): Record<string, string> {
  const style: Record<string, string> = {};
  if (!branding) return style;
  const primary = branding.primaryColor ? hexToHslTriple(branding.primaryColor) : null;
  if (primary) {
    style['--primary'] = primary.triple;
    style['--ring'] = primary.triple;
    style['--primary-foreground'] = readable(primary.luminance);
  }
  const secondary = branding.secondaryColor ? hexToHslTriple(branding.secondaryColor) : null;
  if (secondary) {
    style['--secondary'] = secondary.triple;
    style['--secondary-foreground'] = readable(secondary.luminance);
  }
  const accent = branding.accentColor ? hexToHslTriple(branding.accentColor) : null;
  if (accent) {
    style['--accent'] = accent.triple;
    style['--accent-foreground'] = readable(accent.luminance);
  }
  return style;
}
