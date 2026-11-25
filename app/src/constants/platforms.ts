/**
 * Platform constants — the app-side single source of truth.
 *
 * Mirrors backend/src/services/platform.ts (the server's detector). Every
 * platform the backend can emit MUST have an entry here: rendering previously
 * crashed on `facebook` saves because two separate PLATFORM_META copies
 * (OshiCard, ContentDetailScreen) and a third label map (ShareHandlerScreen)
 * each omitted it.
 *
 * Render lookups must go through getPlatformMeta() — never index
 * PLATFORM_META directly with server data, so an unknown value degrades to
 * the 'other' badge instead of a TypeError.
 */

export type Platform =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'web'
  | 'twitter'
  | 'linkedin'
  | 'facebook'
  | 'spotify'
  | 'other';

export interface PlatformMeta {
  label: string;
  icon: string;
  gradient: [string, string];
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  instagram: { label: 'Instagram', icon: '📷', gradient: ['#833AB4', '#FD1D1D'] },
  youtube:   { label: 'YouTube',   icon: '▶️',  gradient: ['#FF0000', '#CC0000'] },
  tiktok:    { label: 'TikTok',    icon: '🎵', gradient: ['#010101', '#69C9D0'] },
  web:       { label: 'Web',       icon: '🌐', gradient: ['#1A1A2E', '#16213E'] },
  twitter:   { label: 'X',         icon: '𝕏',  gradient: ['#14171A', '#657786'] },
  linkedin:  { label: 'LinkedIn',  icon: '💼', gradient: ['#0077B5', '#005885'] },
  facebook:  { label: 'Facebook',  icon: '📘', gradient: ['#1877F2', '#0E5FC1'] },
  spotify:   { label: 'Spotify',   icon: '🎧', gradient: ['#1DB954', '#191414'] },
  other:     { label: 'Link',      icon: '🔗', gradient: ['#1A1A2E', '#666666'] },
};

/** Total lookup: unknown/missing platform renders as the generic link badge. */
export function getPlatformMeta(platform: string | null | undefined): PlatformMeta {
  return PLATFORM_META[(platform ?? 'other') as Platform] ?? PLATFORM_META.other;
}

/**
 * Hostname → platform, matching the backend detector's rules
 * (backend/src/services/platform.ts). Used for optimistic UI before the
 * server responds (e.g. the share handler's source badge).
 */
export function detectPlatformFromUrl(url: string): Platform {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch') || hostname.includes('fb.me')) return 'facebook';
  if (hostname.includes('spotify.com')) return 'spotify';
  return 'web';
}
