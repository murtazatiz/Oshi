import { Platform } from 'react-native';

// ─────────────────────────────────────────────
// Section 7.1 — Colour Palette (light mode)
// ─────────────────────────────────────────────
export interface ColorTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  skeletonBase: string;
  skeletonHighlight: string;
}

const colors: ColorTokens = {
  primary: '#1A1A2E',
  secondary: '#16213E',
  accent: '#E94560',
  background: '#FAFAFA',
  surface: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#E0E0E0',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  skeletonBase: '#E0E0E0',
  skeletonHighlight: '#F5F5F5',
};

// ─────────────────────────────────────────────
// Section 7.4 — Dark Mode Colour Overrides
// All tokens not listed here remain unchanged.
// ─────────────────────────────────────────────
const darkColors: ColorTokens = {
  ...colors,
  background: '#0F0F1A',
  surface: '#1A1A2E',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  border: '#2A2A3E',
  skeletonBase: '#2A2A3E',
  skeletonHighlight: '#3A3A4E',
};

// ─────────────────────────────────────────────
// Section 7.2 — Typography
// fontWeight must be a string for React Native.
// ─────────────────────────────────────────────
export interface TypographyToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '600' | '700';
  lineHeight?: number;
}

export interface TypographyTokens {
  display: TypographyToken;
  heading1: TypographyToken;
  heading2: TypographyToken;
  body: TypographyToken;
  bodySmall: TypographyToken;
  caption: TypographyToken;
  button: TypographyToken;
  code: TypographyToken;
}

const typography: TypographyTokens = {
  /** Sora Bold — app name, hero text, onboarding headlines */
  display: {
    fontFamily: 'Sora-Bold',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  /** Inter SemiBold 24px — screen titles */
  heading1: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  /** Inter SemiBold 18px — section headers, card titles */
  heading2: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 26,
  },
  /** Inter Regular 16px — body text, summaries */
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  /** Inter Regular 14px — metadata, timestamps, tags */
  bodySmall: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  /** Inter Regular 12px — legal text, fine print */
  caption: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  /** Inter SemiBold 16px — all button labels */
  button: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  /** Courier New 14px — technical content only */
  code: {
    fontFamily: 'Courier New',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
};

// ─────────────────────────────────────────────
// Section 7.3 — Spacing
// ─────────────────────────────────────────────
export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

const spacing: SpacingTokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─────────────────────────────────────────────
// Section 7.3 — Border Radius
// ─────────────────────────────────────────────
export interface BorderRadiusTokens {
  sm: number;
  md: number;
  lg: number;
  pill: number;
}

const borderRadius: BorderRadiusTokens = {
  sm: 8,
  md: 16,
  lg: 20,
  pill: 100,
};

// ─────────────────────────────────────────────
// Section 7.3 — Shadows
// iOS uses shadow* props; Android uses elevation.
// shadow.card: 0 2px 12px rgba(0,0,0,0.08)
// ─────────────────────────────────────────────
export interface ShadowToken {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ShadowTokens {
  card: ShadowToken;
}

const shadows: ShadowTokens = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
};

// ─────────────────────────────────────────────
// Composed Theme Object
// ─────────────────────────────────────────────
export interface Theme {
  colors: ColorTokens;
  darkColors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  borderRadius: BorderRadiusTokens;
  shadows: ShadowTokens;
}

export const theme: Theme = {
  colors,
  darkColors,
  typography,
  spacing,
  borderRadius,
  shadows,
};

export default theme;
