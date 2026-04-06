/**
 * Local thumbnail cache using expo-file-system.
 * Thumbnails are stored under cacheDirectory/thumbnails/{saveId}.jpg
 * and can be used when offline or when the remote URL fails.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useState } from 'react';

const THUMBNAILS_DIR = 'thumbnails';
const EXT = '.jpg';

function thumbnailPath(saveId: string): string {
  const dir = `${FileSystem.cacheDirectory}${THUMBNAILS_DIR}`;
  return `${dir}/${saveId}${EXT}`;
}

/**
 * Returns the local file URI for a cached thumbnail if it exists, otherwise null.
 */
export async function getCachedThumbnailPath(saveId: string): Promise<string | null> {
  const path = thumbnailPath(saveId);
  try {
    const info = await FileSystem.getInfoAsync(path, { size: false });
    return info.exists ? path : null;
  } catch {
    return null;
  }
}

/**
 * Downloads the image from url and saves it to the thumbnail cache for saveId.
 * Ensures the thumbnails directory exists. Resolves when done; rejects on failure.
 */
export async function cacheThumbnail(saveId: string, url: string): Promise<void> {
  const dir = `${FileSystem.cacheDirectory}${THUMBNAILS_DIR}`;
  const path = thumbnailPath(saveId);
  try {
    const dirInfo = await FileSystem.getInfoAsync(dir, { size: false });
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    await FileSystem.downloadAsync(url, path);
  } catch {
    // Silently fail — cache is best-effort
  }
}

/**
 * Deletes the cached thumbnail file for saveId if it exists.
 * Safe to call when the file does not exist (idempotent).
 */
export async function deleteCachedThumbnail(saveId: string): Promise<void> {
  const path = thumbnailPath(saveId);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React hook for thumbnail URI with cache-first and fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves thumbnail URI: checks cache first, then uses remote URL.
 * Returns { uri, onLoad, onError } for use with Image:
 * - uri: local path if cached, else remote URL (or null)
 * - onLoad: call when remote image loads — caches it
 * - onError: call when remote fails — tries cache and updates uri
 */
export function useThumbnailUri(
  saveId: string,
  remoteUrl: string | null,
): { uri: string | null; onLoad: () => void; onError: () => void } {
  const [uri, setUri] = useState<string | null>(remoteUrl ?? null);

  useEffect(() => {
    if (!saveId) {
      setUri(remoteUrl ?? null);
      return;
    }
    if (!remoteUrl) {
      setUri(null);
      return;
    }
    let cancelled = false;
    getCachedThumbnailPath(saveId).then((cached) => {
      if (cancelled) return;
      setUri(cached ?? remoteUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [saveId, remoteUrl]);

  const onLoad = useCallback(() => {
    if (remoteUrl && uri === remoteUrl) {
      void cacheThumbnail(saveId, remoteUrl);
    }
  }, [saveId, remoteUrl, uri]);

  const onError = useCallback(() => {
    if (!remoteUrl) return;
    getCachedThumbnailPath(saveId).then((cached) => {
      if (cached) setUri(cached);
    });
  }, [saveId, remoteUrl]);

  return { uri, onLoad, onError };
}
