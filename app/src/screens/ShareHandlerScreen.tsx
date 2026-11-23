/**
 * ShareHandlerScreen — handles incoming share intents on both platforms.
 *
 * PRD §3.1.4:
 *   - Receives a URL from ACTION_SEND (Android) or Share Extension (iOS)
 *   - Shows a confirmation card UI
 *   - Calls POST /saves to save the URL
 *   - Queues offline if no network
 *   - User taps Done → screen closes and returns to the originating app
 *
 * Uses expo-share-intent's useShareIntentContext() to read the shared content
 * and resetShareIntent() to clear it after processing.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { useShareIntentContext } from 'expo-share-intent';

import { useTheme } from '../theme/ThemeContext';
import { apiClient, isLimitError } from '../services/apiClient';
import { enqueue } from '../services/offlineQueue';
import { useSavesStore } from '../store/savesStore';
import type { SaveData } from '../components/OshiCard';
import { detectPlatformFromUrl, getPlatformMeta } from '../constants/platforms';
import { CategoryPickerSheet, type CategoryOption } from '../components/CategoryPickerSheet';

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────

// Platform detection + labels come from constants/platforms (shared with
// OshiCard and ContentDetailScreen; previously a third diverged copy here
// that was missing facebook).

function platformLimitedNote(source: string): string | null {
  if (source === 'instagram') return 'Instagram preview may be limited';
  if (source === 'tiktok') return 'TikTok preview may be limited';
  return null;
}

/** Extract the first http(s) URL from arbitrary shared text. */
function extractUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareHandlerScreen
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'loading' | 'saved' | 'queued' | 'limit' | 'error';

export default function ShareHandlerScreen(): React.JSX.Element | null {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { colors, theme } = useTheme();
  const { borderRadius, spacing, shadows } = theme;

  const [status, setStatus] = useState<Status>('loading');
  const [categoryName, setCategoryName] = useState('Other');
  const [savedId, setSavedId] = useState<string | null>(null);
  // Shared with the Library via savesStore — no per-screen copy to go stale
  const categories = useSavesStore((s) => s.categories);
  const fetchCategories = useSavesStore((s) => s.fetchCategories);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedRef = useRef(false);
  const addSaveToTop = useSavesStore((s) => s.addSaveToTop);

  // ── Resolve the URL from the share intent ──────────────────────────────

  useEffect(() => {
    if (!hasShareIntent) {
      hasSavedRef.current = false;
      setResolvedUrl(null);
      setStatus('loading');
      return;
    }
    // webUrl is set for explicit URL shares, text may contain a URL inline
    const raw = shareIntent.webUrl ?? shareIntent.text ?? '';
    const url = extractUrl(raw);
    if (url) {
      setResolvedUrl(url);
    } else {
      setResolvedUrl(null);
    }
  }, [hasShareIntent, shareIntent]);

  // ── Fade in when we have a URL ─────────────────────────────────────────

  useEffect(() => {
    if (!resolvedUrl) return;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [resolvedUrl, fadeAnim]);

  // ── Categories for the picker ─────────────────────────────────────────
  // A share can cold-start the app before the Library has loaded categories

  useEffect(() => {
    if (resolvedUrl && categories.length === 0) void fetchCategories();
  }, [resolvedUrl, categories.length, fetchCategories]);

  // ── Save the URL ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!resolvedUrl || hasSavedRef.current) return;
    hasSavedRef.current = true;

    const sourceApp = detectPlatformFromUrl(resolvedUrl);

    async function save(): Promise<void> {
      const netState = await NetInfo.fetch();
      const isConnected = netState.isConnected ?? false;

      if (!isConnected) {
        await enqueue(resolvedUrl!, sourceApp);
        setStatus('queued');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleAutoDismiss();
        return;
      }

      try {
        const res = await apiClient.post<SaveData>('/saves', {
          url: resolvedUrl,
          source_app: sourceApp,
        });

        setSavedId(res.data.id);
        if (res.data.category) {
          setCategoryName(res.data.category.name);
        }
        // Insert the new save so the Library immediately shows a processing card.
        addSaveToTop(res.data);
        setStatus('saved');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleAutoDismiss();
      } catch (err) {
        if (isLimitError(err)) {
          // Not a connectivity problem — queueing would retry a save the
          // server will keep refusing. The apiClient interceptor has opened
          // the paywall beneath this overlay; auto-dismiss reveals it.
          setStatus('limit');
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          scheduleAutoDismiss();
          return;
        }
        await enqueue(resolvedUrl!, sourceApp);
        setStatus('queued');
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleAutoDismiss();
      }
    }

    void save();

    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUrl]);

  function scheduleAutoDismiss(): void {
    autoDismissTimer.current = setTimeout(() => {
      handleDismiss();
    }, 3_000);
  }

  function handleDismiss(): void {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      resetShareIntent();
    });
  }

  // ── Category change ───────────────────────────────────────────────────

  async function handleCategoryChange(cat: CategoryOption): Promise<void> {
    setPickerVisible(false);
    setCategoryName(cat.name);
    if (!savedId) return;
    try {
      await apiClient.patch(`/saves/${savedId}`, { category_id: cat.id });
    } catch {
      // Non-fatal
    }
  }

  // ── Don't render when there's no share intent or no URL ───────────────

  if (!hasShareIntent || !resolvedUrl) return null;

  const sourceApp = detectPlatformFromUrl(resolvedUrl);
  const label = getPlatformMeta(sourceApp).label;
  const limitedNote = platformLimitedNote(sourceApp);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderRadius: borderRadius.lg,
            ...shadows.card,
          },
        ]}
      >
        {/* Thumbnail placeholder */}
        <View
          style={[
            styles.thumbnail,
            { backgroundColor: colors.skeletonBase, borderTopLeftRadius: borderRadius.lg, borderTopRightRadius: borderRadius.lg },
          ]}
        >
          <Text style={styles.platformIcon}>
            {sourceApp === 'youtube' ? '▶️' : sourceApp === 'instagram' ? '📷' : '🔗'}
          </Text>
        </View>

        <View style={[styles.body, { padding: spacing.md }]}>
          {/* Title / URL */}
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
            {resolvedUrl}
          </Text>

          {/* Platform label */}
          <Text style={[styles.platform, { color: colors.textMuted }]}>{label}</Text>

          {/* Limited preview note */}
          {limitedNote && (
            <Text style={[styles.limitedNote, { color: colors.warning }]}>{limitedNote}</Text>
          )}

          {/* Category badge — tappable */}
          {(status === 'saved' || status === 'queued') && (
            <TouchableOpacity
              onPress={() => {
                if (categories.length > 0) setPickerVisible(true);
              }}
              style={[
                styles.categoryBadge,
                {
                  backgroundColor: colors.accent + '18',
                  borderRadius: borderRadius.pill,
                },
              ]}
              activeOpacity={0.7}
              accessibilityLabel={`Category: ${categoryName}. Tap to change.`}
            >
              <Text style={[styles.categoryText, { color: colors.accent }]}>
                📌 {categoryName}
              </Text>
            </TouchableOpacity>
          )}

          {/* Status */}
          <View style={styles.statusRow}>
            {status === 'loading' && (
              <>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.statusText, { color: colors.textMuted }]}>Saving…</Text>
              </>
            )}
            {status === 'saved' && (
              <Text style={[styles.statusText, { color: colors.success }]}>Saved to Oshi ✓</Text>
            )}
            {status === 'queued' && (
              <Text style={[styles.statusText, { color: colors.textMuted }]}>
                Queued — will save when back online
              </Text>
            )}
            {status === 'limit' && (
              <Text style={[styles.statusText, { color: colors.warning }]}>
                Monthly save limit reached — upgrade to keep saving
              </Text>
            )}
            {status === 'error' && (
              <Text style={[styles.statusText, { color: colors.error }]}>Failed to save</Text>
            )}
          </View>

          {/* Done button */}
          <TouchableOpacity
            onPress={handleDismiss}
            style={[
              styles.doneBtn,
              { backgroundColor: colors.accent, borderRadius: borderRadius.sm },
            ]}
            activeOpacity={0.7}
            accessibilityLabel="Done"
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Category picker */}
      <CategoryPickerSheet
        visible={pickerVisible}
        title="Change Category"
        categories={categories}
        onSelect={(cat) => void handleCategoryChange(cat)}
        onClose={() => setPickerVisible(false)}
      />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  card: {
    width: '90%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  thumbnail: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformIcon: {
    fontSize: 32,
  },
  body: {},
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  platform: {
    fontSize: 13,
    marginBottom: 4,
  },
  limitedNote: {
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    minHeight: 24,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  doneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

});
