import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Data API v3 Integration — PRD §5.7
//
// Fields requested:
//   snippet.title, snippet.description, snippet.thumbnails.maxres,
//   snippet.channelTitle, contentDetails.duration, statistics.viewCount
//
// Duration is returned as ISO 8601 (e.g. "PT14M22S") and converted to seconds.
// ─────────────────────────────────────────────────────────────────────────────

const YOUTUBE_API_KEY = process.env.YOUTUBE_DATA_API_KEY;
const YT_API_URL = 'https://www.googleapis.com/youtube/v3/videos';

export interface YouTubeMetadata {
  title: string;
  description: string;
  thumbnailUrl: string | undefined;
  channelTitle: string;
  durationSeconds: number;
  viewCount: number;
}

/**
 * Extract the YouTube video ID from a URL.
 * Supports: youtube.com/watch, youtu.be, youtube.com/shorts, youtube.com/embed
 * PRD §5.7 — exact regex patterns from the PRD.
 */
export function extractYouTubeId(url: string): string | null {
  const patterns: RegExp[] = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Parse an ISO 8601 duration string to seconds.
 * PRD §5.7 — exact implementation from the PRD.
 * e.g. "PT1H14M22S" → 4462
 */
export function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    parseInt(match[1] ?? '0', 10) * 3600 +
    parseInt(match[2] ?? '0', 10) * 60 +
    parseInt(match[3] ?? '0', 10)
  );
}

/**
 * Fetch video metadata from the YouTube Data API v3.
 * Returns null if the video ID cannot be extracted or the API call fails.
 *
 * PRD §5.7 — exact fields and API URL from the PRD.
 */
export async function fetchYouTubeMetadata(
  url: string,
): Promise<YouTubeMetadata | null> {
  if (!YOUTUBE_API_KEY) {
    console.warn('[youtube] YOUTUBE_DATA_API_KEY not set — skipping YouTube API call.');
    return null;
  }

  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  try {
    const response = await axios.get<YouTubeApiResponse>(YT_API_URL, {
      params: {
        id: videoId,
        key: YOUTUBE_API_KEY,
        part: 'snippet,contentDetails,statistics',
        fields:
          'items(snippet(title,description,thumbnails(medium,high,maxres),channelTitle),' +
          'contentDetails/duration,statistics/viewCount)',
      },
      timeout: 10_000,
    });

    const item = response.data.items?.[0];
    if (!item) return null;

    const thumbs = item.snippet.thumbnails;
    // Prefer maxres → high → medium → deterministic fallback URL
    const thumbnailUrl =
      thumbs?.maxres?.url ??
      thumbs?.high?.url ??
      thumbs?.medium?.url ??
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    return {
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl,
      channelTitle: item.snippet.channelTitle,
      durationSeconds: parseDuration(item.contentDetails.duration),
      viewCount: parseInt(String(item.statistics.viewCount ?? '0'), 10),
    };
  } catch (err) {
    console.error('[youtube] API call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube API response types (subset matching our requested fields)
// ─────────────────────────────────────────────────────────────────────────────
interface YouTubeApiResponse {
  items?: Array<{
    snippet: {
      title: string;
      description: string;
      thumbnails?: {
        medium?: { url: string; width: number; height: number };
        high?: { url: string; width: number; height: number };
        maxres?: { url: string; width: number; height: number };
      };
      channelTitle: string;
    };
    contentDetails: {
      duration: string; // ISO 8601 — e.g. "PT14M22S"
    };
    statistics: {
      viewCount: string;
    };
  }>;
}
