// ─────────────────────────────────────────────────────────────────────────────
// Platform detection — the single source of truth for URL → platform mapping.
//
// Both the POST /saves route (immediate response) and the metadata service
// (authoritative, inside the BullMQ worker) resolve platforms through this
// module, so the two can never drift. Pure, no I/O, no heavy imports — safe
// to pull into any route without dragging cheerio/axios into its import graph.
//
// PRD §3.1.2 — specific platforms are checked before the generic "web"
// fallback. Valid values are enforced by the Supabase CHECK constraint on
// saves.platform.
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Detect the platform from a URL's hostname.
 * Total function: an unparseable URL returns 'other' rather than throwing,
 * so callers on the request path never 500 on odd-but-Zod-valid input.
 */
export function detectPlatform(url: string): Platform {
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
