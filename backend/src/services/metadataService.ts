import axios from 'axios';
import * as cheerio from 'cheerio';
import { fetchYouTubeMetadata, type YouTubeMetadata } from './youtubeService';

// ─────────────────────────────────────────────────────────────────────────────
// URL Metadata Extraction Service
//
// PRD §3.1.2 — Platform-specific behaviour:
//   YouTube:          FULL — YouTube Data API v3
//   Instagram/TikTok: LIMITED — Open Graph tags only (never scrape further)
//   Twitter/X:        PARTIAL — Open Graph title and description
//   LinkedIn:         PARTIAL — Open Graph tags, article content if public
//   Spotify:          FULL — Spotify Embed API
//   Safari/Chrome:    FULL — Open Graph + Cheerio body text extraction
//   Any URL:          FALLBACK — Open Graph + page title + first 500 words
//
// ⚠️ Never attempt to scrape instagram.com, tiktok.com, or twitter.com
//    server-side beyond Open Graph (PRD §3.1.2 — IP ban risk).
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

export interface ContentMetadata {
  platform: Platform;
  title: string;
  description: string;
  thumbnailUrl: string | undefined;
  textSnippet: string;
  channelOrAuthor: string;
  durationSeconds: number;
}

const FETCH_TIMEOUT = 10_000;

const USER_AGENT =
  'Mozilla/5.0 (compatible; OshiBot/1.0; +https://oshi.app)';

/** Browser-like headers for pages that may block simple User-Agent (e.g. LinkedIn, Facebook). */
const BROWSER_LIKE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const LINKEDIN_FALLBACK_THUMB = 'https://static.licdn.com/sc/h/al2o9zrvru7ynbxj2j6dabs4';
const FACEBOOK_FALLBACK_THUMB = 'https://www.facebook.com/images/fb_icon_325x325.png';

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection — specific platforms checked before generic "web" fallback
// ─────────────────────────────────────────────────────────────────────────────
export function detectPlatform(url: string): Platform {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch') || hostname.includes('fb.me')) return 'facebook';
  if (hostname.includes('spotify.com')) return 'spotify';
  return 'web';
}

// ─────────────────────────────────────────────────────────────────────────────
// Open Graph tag extraction
// ─────────────────────────────────────────────────────────────────────────────
interface OpenGraphData {
  title: string;
  description: string;
  image: string | undefined;
  siteName: string | undefined;
}

async function fetchOpenGraph(
  url: string,
  options?: { browserLikeHeaders?: boolean },
): Promise<{
  og: OpenGraphData;
  html: string;
} | null> {
  try {
    const headers = options?.browserLikeHeaders === true ? BROWSER_LIKE_HEADERS : { 'User-Agent': USER_AGENT };
    const response = await axios.get<string>(url, {
      timeout: FETCH_TIMEOUT,
      headers,
      responseType: 'text',
      maxContentLength: 5_000_000, // 5MB max to prevent OOM on huge pages
    });

    const $ = cheerio.load(response.data);

    const og: OpenGraphData = {
      title:
        $('meta[property="og:title"]').attr('content') ??
        $('title').text().trim() ??
        '',
      description:
        ($('meta[property="og:description"]').attr('content') ??
         $('meta[name="description"]').attr('content') ??
         '').slice(0, 300),
      image:
        $('meta[property="og:image"]').attr('content') ?? undefined,
      siteName:
        $('meta[property="og:site_name"]').attr('content') ?? undefined,
    };

    return { og, html: response.data };
  } catch (err) {
    console.error(
      '[metadata] Failed to fetch Open Graph for',
      url,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cheerio body text extraction
// PRD §3.1.2: extract first 500 words of page text for AI context.
// ─────────────────────────────────────────────────────────────────────────────
function extractBodyText(html: string, maxWords: number = 500): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, noscript, iframe').remove();

  const rawText = $('body').text();
  // Normalise whitespace
  const words = rawText
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);

  return words.slice(0, maxWords).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Spotify Embed API metadata
// PRD §3.1.2: Spotify — Embed API for podcast/episode metadata incl. duration
// ─────────────────────────────────────────────────────────────────────────────
interface SpotifyEmbedResponse {
  title?: string;
  description?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

async function fetchSpotifyEmbed(url: string): Promise<ContentMetadata> {
  const base: ContentMetadata = {
    platform: 'spotify',
    title: '',
    description: '',
    thumbnailUrl: undefined,
    textSnippet: '',
    channelOrAuthor: '',
    durationSeconds: 0,
  };

  try {
    const response = await axios.get<SpotifyEmbedResponse>(
      'https://open.spotify.com/oembed',
      { params: { url }, timeout: FETCH_TIMEOUT },
    );

    const data = response.data;
    base.title = data.title ?? '';
    base.description = data.description ?? '';
    base.thumbnailUrl = data.thumbnail_url;
    base.channelOrAuthor = data.provider_name ?? '';
  } catch {
    // Fall back to Open Graph if Spotify embed fails
    const result = await fetchOpenGraph(url);
    if (result) {
      base.title = result.og.title;
      base.description = result.og.description;
      base.thumbnailUrl = result.og.image;
    }
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube metadata
// PRD §5.7: Full metadata via YouTube Data API v3
// ─────────────────────────────────────────────────────────────────────────────
async function fetchYouTube(url: string): Promise<ContentMetadata> {
  const ytMeta: YouTubeMetadata | null = await fetchYouTubeMetadata(url);

  if (ytMeta) {
    return {
      platform: 'youtube',
      title: ytMeta.title,
      description: ytMeta.description.slice(0, 300),
      thumbnailUrl: ytMeta.thumbnailUrl,
      textSnippet: ytMeta.description.slice(0, 500),
      channelOrAuthor: ytMeta.channelTitle,
      durationSeconds: ytMeta.durationSeconds,
    };
  }

  // API key missing or call failed — fall back to Open Graph + deterministic thumbnail
  const result = await fetchOpenGraph(url);
  const { extractYouTubeId } = await import('./youtubeService');
  const videoId = extractYouTubeId(url);
  const fallbackThumb = videoId
    ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    : undefined;

  return {
    platform: 'youtube',
    title: result?.og.title ?? '',
    description: result?.og.description ?? '',
    thumbnailUrl: result?.og.image ?? fallbackThumb,
    textSnippet: '',
    channelOrAuthor: '',
    durationSeconds: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram — oEmbed first (no auth), then fall back to Open Graph
// Public endpoint returns author_name and title without Facebook app.
// ─────────────────────────────────────────────────────────────────────────────
interface InstagramOEmbedResponse {
  author_name?: string;
  title?: string;
}

async function fetchInstagramOEmbed(url: string): Promise<InstagramOEmbedResponse | null> {
  const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;
  console.log('[metadata] Instagram oEmbed URL:', oembedUrl);

  try {
    const response = await axios.get<InstagramOEmbedResponse>(oembedUrl, {
      timeout: FETCH_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
    });
    const data = response.data ?? null;
    console.log('[metadata] Instagram oEmbed response:', data);
    return data;
  } catch {
    return null;
  }
}

async function fetchInstagram(url: string): Promise<ContentMetadata> {
  const oembed = await fetchInstagramOEmbed(url);
  const hasOembedData =
    oembed && (typeof oembed.author_name === 'string' || typeof oembed.title === 'string');

  if (hasOembedData) {
    const result = await fetchOpenGraph(url);
    return {
      platform: 'instagram',
      title: (oembed!.title ?? result?.og.title ?? '').trim(),
      description: result?.og.description ?? '',
      thumbnailUrl: result?.og.image,
      textSnippet: '',
      channelOrAuthor: (oembed!.author_name ?? '').trim(),
      durationSeconds: 0,
    };
  }

  console.log('[metadata] Instagram oEmbed failed or empty, falling back to Open Graph');
  return fetchRestrictedPlatform(url, 'instagram');
}

// ─────────────────────────────────────────────────────────────────────────────
// Restricted platforms — OG only (never scrape further)
// PRD §3.1.2: TikTok, Twitter — Open Graph tags only.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchRestrictedPlatform(
  url: string,
  platform: Platform,
): Promise<ContentMetadata> {
  const result = await fetchOpenGraph(url);

  return {
    platform,
    title: result?.og.title ?? '',
    description: result?.og.description ?? '',
    thumbnailUrl: result?.og.image,
    textSnippet: '',
    channelOrAuthor: '',
    durationSeconds: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn / Facebook — OG with browser-like headers + platform fallback thumbnail
// ─────────────────────────────────────────────────────────────────────────────
async function fetchLinkedIn(url: string): Promise<ContentMetadata> {
  const result = await fetchOpenGraph(url, { browserLikeHeaders: true });
  const ogImage = result?.og.image?.trim();
  const thumbnailUrl = ogImage || LINKEDIN_FALLBACK_THUMB;
  return {
    platform: 'linkedin',
    title: result?.og.title ?? '',
    description: result?.og.description ?? '',
    thumbnailUrl: thumbnailUrl || undefined,
    textSnippet: result ? extractBodyText(result.html, 500) : '',
    channelOrAuthor: result?.og.siteName ?? '',
    durationSeconds: 0,
  };
}

async function fetchFacebook(url: string): Promise<ContentMetadata> {
  const result = await fetchOpenGraph(url, { browserLikeHeaders: true });
  const ogImage = result?.og.image?.trim();
  const thumbnailUrl = ogImage || FACEBOOK_FALLBACK_THUMB;
  return {
    platform: 'facebook',
    title: result?.og.title ?? '',
    description: result?.og.description ?? '',
    thumbnailUrl: thumbnailUrl || undefined,
    textSnippet: result ? extractBodyText(result.html, 500) : '',
    channelOrAuthor: result?.og.siteName ?? '',
    durationSeconds: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Web / generic URL — full extraction
// PRD §3.1.2: Open Graph + full page text extraction via Cheerio.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWebMetadata(
  url: string,
  platform: Platform,
): Promise<ContentMetadata> {
  const result = await fetchOpenGraph(url);

  return {
    platform,
    title: result?.og.title ?? '',
    description: result?.og.description ?? '',
    thumbnailUrl: result?.og.image,
    textSnippet: result ? extractBodyText(result.html, 500) : '',
    channelOrAuthor: result?.og.siteName ?? '',
    durationSeconds: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch metadata for any URL. Automatically detects the platform and applies
 * the correct extraction strategy per PRD §3.1.2.
 */
export async function fetchContentMetadata(
  url: string,
  platformOverride?: string,
): Promise<ContentMetadata> {
  const platform = (platformOverride as Platform | undefined) ?? detectPlatform(url);

  switch (platform) {
    case 'youtube':
      return fetchYouTube(url);

    case 'instagram':
      return fetchInstagram(url);

    case 'tiktok':
    case 'twitter':
      return fetchRestrictedPlatform(url, platform);

    case 'spotify':
      return fetchSpotifyEmbed(url);

    case 'linkedin':
      return fetchLinkedIn(url);

    case 'facebook':
      return fetchFacebook(url);

    case 'web':
    case 'other':
    default:
      return fetchWebMetadata(url, platform);
  }
}
