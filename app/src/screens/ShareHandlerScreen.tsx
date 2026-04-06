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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { useShareIntentContext } from 'expo-share-intent';

import { useTheme } from '../theme/ThemeContext';
import { apiClient } from '../services/apiClient';
import { enqueue } from '../services/offlineQueue';
import { useSavesStore } from '../store/savesStore';
import type { SaveData } from '../components/OshiCard';

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────

function detectSourceApp(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('spotify.com')) return 'spotify';
  return 'web';
}

function platformLabel(source: string): string {
  const labels: Record<string, string> = {
    instagram: 'Instagram',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    twitter: 'X (Twitter)',
    linkedin: 'LinkedIn',
    spotify: 'Spotify',
    web: 'Web',
  };
  return labels[source] ?? 'Link';
}

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
// Category picker
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryItem {
  id: string;
  name: string;
  emoji: string;
}

interface CategoryPickerProps {
  visible: boolean;
  categories: CategoryItem[];
  onSelect: (cat: CategoryItem) => void;
  onClose: () => void;
}

function CategoryPicker({ visible, categories, onSelect, onClose }: CategoryPickerProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { borderRadius, spacing } = theme;

  const renderItem = useCallback(
    ({ item }: { item: CategoryItem }) => (
      <TouchableOpacity
        style={[styles.catRow, { paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.md }]}
        onPress={() => onSelect(item)}
        activeOpacity={0.65}
      >
        <Text style={styles.catEmoji}>{item.emoji}</Text>
        <Text style={[styles.catName, { color: colors.textPrimary }]}>{item.name}</Text>
      </TouchableOpacity>
    ),
    [onSelect, colors.textPrimary, spacing],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: borderRadius.lg,
              borderTopRightRadius: borderRadius.lg,
            },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Change Category</Text>
          <FlatList
            data={categories}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 350 }}
          />
          <View style={{ height: spacing.xl }} />
        </View>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareHandlerScreen
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'loading' | 'saved' | 'queued' | 'error';

export default function ShareHandlerScreen(): React.JSX.Element | null {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { colors, theme } = useTheme();
  const { borderRadius, spacing, shadows } = theme;

  const [status, setStatus] = useState<Status>('loading');
  const [categoryName, setCategoryName] = useState('Other');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
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

  // ── Fetch categories ──────────────────────────────────────────────────

  useEffect(() => {
    if (!resolvedUrl) return;
    async function load(): Promise<void> {
      try {
        const res = await apiClient.get<{
          categories: Array<{ id: string; name: string; emoji?: string }>;
        }>('/categories');
        setCategories(
          res.data.categories.map((c) => ({
            id: c.id,
            name: c.name,
            emoji: c.emoji ?? '📌',
          })),
        );
      } catch {
        // Categories unavailable — picker will be empty
      }
    }
    void load();
  }, [resolvedUrl]);

  // ── Save the URL ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!resolvedUrl || hasSavedRef.current) return;
    hasSavedRef.current = true;

    const sourceApp = detectSourceApp(resolvedUrl);

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
      } catch {
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

  async function handleCategoryChange(cat: CategoryItem): Promise<void> {
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

  const sourceApp = detectSourceApp(resolvedUrl);
  const label = platformLabel(sourceApp);
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
          {status !== 'loading' && (
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
      <CategoryPicker
        visible={pickerVisible}
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

  // Category picker
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 8,
  },
  handleRow: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  catEmoji: {
    fontSize: 20,
  },
  catName: {
    fontSize: 16,
    fontWeight: '500',
  },
});
