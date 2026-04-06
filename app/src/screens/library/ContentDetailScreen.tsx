/**
 * ContentDetailScreen — PRD §3.6
 *
 * Displays full metadata for a single saved item:
 *   • Full-width 16:9 thumbnail with platform-colour gradient fallback
 *   • Platform badge + content type label
 *   • Full title, creator name
 *   • AI summary (larger italic)
 *   • Horizontally scrollable tag pills
 *   • Estimated time + relative saved date
 *   • link_status warning banner (unavailable / private)
 *   • 'Open in [Platform]' CTA — does NOT auto-mark done
 *   • Secondary actions: Mark Done, Skip, Change Category, Add Note,
 *     Copy Link, Share, Delete
 *   • Personal note textarea
 *
 * On mount: POST /engagement/signal action='opened'
 * Mark Done: ImpactFeedbackStyle.Heavy + PATCH /saves/:id + engagement signal
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { useThumbnailUri } from '../../utils/thumbnailCache';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp, type ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../../theme/ThemeContext';
import { apiClient } from '../../services/apiClient';
import { useSavesStore } from '../../store/savesStore';
import analytics from '../../services/analytics';
import type { SaveData, Platform_ } from '../../components/OshiCard';
import type { MainStackParamList } from '../../navigation/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / helpers
// ─────────────────────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_HEIGHT = Math.round(SCREEN_WIDTH * (9 / 16));

const PLATFORM_META: Record<Platform_, { label: string; icon: string; gradient: [string, string] }> = {
  instagram: { label: 'Instagram', icon: '📷', gradient: ['#833AB4', '#FD1D1D'] },
  youtube:   { label: 'YouTube',   icon: '▶️',  gradient: ['#FF0000', '#CC0000'] },
  tiktok:    { label: 'TikTok',    icon: '🎵',  gradient: ['#010101', '#69C9D0'] },
  web:       { label: 'Web',       icon: '🌐',  gradient: ['#1A1A2E', '#16213E'] },
  twitter:   { label: 'X',         icon: '𝕏',   gradient: ['#14171A', '#657786'] },
  linkedin:  { label: 'LinkedIn',  icon: '💼',  gradient: ['#0077B5', '#005885'] },
  spotify:   { label: 'Spotify',   icon: '🎧',  gradient: ['#1DB954', '#191414'] },
  other:     { label: 'Link',      icon: '🔗',  gradient: ['#1A1A2E', '#666666'] },
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  short_video: 'Short Video',
  long_video:  'Long Video',
  article:     'Article',
  podcast:     'Podcast',
  post:        'Post',
  product:     'Product',
  image:       'Image',
  other:       'Content',
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Saved today';
  if (days === 1) return 'Saved yesterday';
  if (days < 30) return `Saved ${days} days ago`;
  const months = Math.floor(days / 30);
  return `Saved ${months} month${months === 1 ? '' : 's'} ago`;
}

function formatTime(seconds: number | null, contentType: string | null): string {
  if (!seconds || seconds <= 0) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  const isVideo = contentType === 'short_video' || contentType === 'long_video';
  return `${min} min ${isVideo ? 'watch' : 'read'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category picker sheet
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryPickerProps {
  visible: boolean;
  categories: { id: string; name: string; emoji?: string }[];
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
}

function CategoryPicker({ visible, categories, onSelect, onClose }: CategoryPickerProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: theme.borderRadius.lg, borderTopRightRadius: theme.borderRadius.lg }]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Change Category</Text>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.sheetRow, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm + 4 }]}
              onPress={() => { onSelect(cat.id, cat.name); onClose(); }}
              activeOpacity={0.65}
            >
              <Text style={styles.sheetRowEmoji}>{cat.emoji ?? '📌'}</Text>
              <Text style={[styles.sheetRowText, { color: colors.textPrimary }]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ height: theme.spacing.xl }} />
        </View>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

type RouteProps = RouteProp<MainStackParamList & ParamListBase, 'ContentDetail'>;
type NavProp = NativeStackNavigationProp<MainStackParamList & ParamListBase>;

export default function ContentDetailScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProps>();
  const { saveId } = route.params;

  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;

  const [save, setSave] = useState<SaveData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [note, setNote] = useState('');
  const [noteChanged, setNoteChanged] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string; emoji?: string }[]>([]);
  const [catPickerVisible, setCatPickerVisible] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);

  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSave = useSavesStore((s) => s.updateSave);

  const { uri: thumbnailUri, onLoad: onThumbnailLoad, onError: onThumbnailError } = useThumbnailUri(
    save?.id ?? '',
    save?.thumbnail_url ?? null,
  );

  // ── Fetch save + categories ─────────────────────────────────────────────

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [saveRes, catRes] = await Promise.all([
          apiClient.get<SaveData>(`/saves/${saveId}`),
          apiClient.get<{ categories: { id: string; name: string; emoji?: string }[] }>('/categories'),
        ]);
        setSave(saveRes.data);
        setNote(saveRes.data.user_note ?? '');
        setCategories(catRes.data.categories);
      } catch {
        Alert.alert('Error', 'Could not load save details.');
        navigation.goBack();
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, [saveId, navigation]);

  // ── Engagement signal: opened ───────────────────────────────────────────

  useEffect(() => {
    if (!save) return;
    void apiClient
      .post('/engagement/signal', { save_id: save.id, action: 'opened' })
      .catch(() => {/* non-fatal */});
    analytics.saveOpened({ save_id: save.id, platform: save.platform, content_type: save.content_type ?? undefined });
  }, [save?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save note (debounced 800ms) ────────────────────────────────────

  function handleNoteChange(text: string): void {
    setNote(text);
    setNoteChanged(true);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void saveNote(text), 800);
  }

  async function saveNote(text: string): Promise<void> {
    if (!save) return;
    setIsSavingNote(true);
    try {
      await apiClient.patch(`/saves/${save.id}`, { user_note: text });
      updateSave({ id: save.id, user_note: text });
    } catch {
      // Non-fatal
    } finally {
      setIsSavingNote(false);
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleMarkDone = useCallback(async () => {
    if (!save) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSave((s) => s ? { ...s, status: 'done' } : s);
    try {
      await apiClient.patch(`/saves/${save.id}`, { status: 'done' });
      await apiClient.post('/engagement/signal', { save_id: save.id, action: 'done' });
      updateSave({ id: save.id, status: 'done' });
      analytics.saveMarkedDone({ save_id: save.id, via: 'button' });
    } catch {
      setSave((s) => s ? { ...s, status: 'unread' } : s);
    }
  }, [save, updateSave]);

  const handleSkip = useCallback(async () => {
    if (!save) return;
    setSave((s) => s ? { ...s, status: 'skipped' } : s);
    try {
      await apiClient.patch(`/saves/${save.id}`, { status: 'skipped' });
      await apiClient.post('/engagement/signal', { save_id: save.id, action: 'skipped' });
      updateSave({ id: save.id, status: 'skipped' });
      analytics.saveSkipped({ save_id: save.id, via: 'button' });
      navigation.goBack();
    } catch {
      setSave((s) => s ? { ...s, status: 'unread' } : s);
    }
  }, [save, updateSave, navigation]);

  const handleMarkUnread = useCallback(async () => {
    if (!save) return;
    setSave((s) => (s ? { ...s, status: 'unread' } : s));
    try {
      await apiClient.patch(`/saves/${save.id}`, { status: 'unread' });
      updateSave({ id: save.id, status: 'unread' });
    } catch {
      // if it fails, leave as unread in the local detail view; Home will resync on next fetch
    }
  }, [save, updateSave]);

  const handleDelete = useCallback(() => {
    if (!save) return;
    Alert.alert('Delete save?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/saves/${save.id}`);
            updateSave({ id: save.id, status: 'done' }); // optimistic
            analytics.saveDeleted({ save_id: save.id, via: 'menu' });
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete save.');
          }
        },
      },
    ]);
  }, [save, updateSave, navigation]);

  const handleCopyLink = useCallback(() => {
    if (!save) return;
    void Linking.openURL(save.url);
  }, [save]);

  const handleShare = useCallback(async () => {
    if (!save) return;
    await Share.share({ url: save.url, message: save.title ?? save.url });
    analytics.saveShared(save.id);
  }, [save]);

  const handleOpenInPlatform = useCallback(() => {
    if (!save) return;
    if (save.link_status !== 'active') {
      const plat = PLATFORM_META[save.platform].label;
      Alert.alert(
        save.link_status === 'private'
          ? 'Content is Private'
          : 'Content May Be Unavailable',
        `This content may no longer be available on ${plat}.`,
        [
          { text: 'Open Anyway', onPress: () => { analytics.saveLinkOpened({ save_id: save.id, platform: save.platform }); void Linking.openURL(save.url); } },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      void Linking.openURL(save.url);
    }
  }, [save]);

  const handleChangeCategory = useCallback(async (catId: string, catName: string) => {
    if (!save) return;
    setSave((s) => s ? { ...s, category: { id: catId, name: catName } } : s);
    try {
      await apiClient.patch(`/saves/${save.id}`, { category_id: catId });
      updateSave({ id: save.id, category: { id: catId, name: catName } });
    } catch {
      setSave((s) => s ? { ...s, category: save.category } : s);
    }
  }, [save, updateSave]);

  function showSecondaryActions(): void {
    if (!save) return;
    const isDone = save.status === 'done';
    const isSkipped = save.status === 'skipped';

    const options = [
      isDone ? 'Mark as Unread' : 'Mark as Done',
      isSkipped ? 'Un-skip' : 'Skip',
      'Change Category',
      'Copy Link',
      'Share',
      'Delete',
      'Cancel',
    ];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: 5, cancelButtonIndex: 6 },
        (idx) => {
          if (idx === 0) {
            if (isDone) void handleMarkUnread();
            else void handleMarkDone();
          }
          else if (idx === 1) void handleSkip();
          else if (idx === 2) setCatPickerVisible(true);
          else if (idx === 3) handleCopyLink();
          else if (idx === 4) void handleShare();
          else if (idx === 5) handleDelete();
        },
      );
    } else {
      Alert.alert('Actions', undefined, [
        {
          text: isDone ? 'Mark as Unread' : 'Mark as Done',
          onPress: () => {
            if (isDone) void handleMarkUnread();
            else void handleMarkDone();
          },
        },
        { text: isSkipped ? 'Un-skip' : 'Skip', onPress: () => void handleSkip() },
        { text: 'Change Category', onPress: () => setCatPickerVisible(true) },
        { text: 'Copy Link', onPress: handleCopyLink },
        { text: 'Share', onPress: () => void handleShare() },
        { text: 'Delete', style: 'destructive', onPress: handleDelete },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  if (isLoading || !save) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const platMeta = PLATFORM_META[save.platform];
  const timeStr = formatTime(save.estimated_time_seconds, save.content_type);
  const relDate = formatRelativeTime(save.saved_at);
  const ctaLabel = `Open in ${platMeta.label}`;
  const isDone = save.status === 'done';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Text style={[styles.backIcon, { color: colors.accent }]}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={showSecondaryActions} style={styles.moreBtn} hitSlop={8}>
          <Text style={[styles.moreIcon, { color: colors.textPrimary }]}>⋯</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Thumbnail / 16:9 ─────────────────────────────────────────── */}
        <View style={{ width: SCREEN_WIDTH, height: THUMB_HEIGHT }}>
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={{ width: SCREEN_WIDTH, height: THUMB_HEIGHT }}
              contentFit="cover"
              transition={200}
              onLoad={onThumbnailLoad}
              onError={onThumbnailError}
            />
          ) : (
            <LinearGradient
              colors={platMeta.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: SCREEN_WIDTH, height: THUMB_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={styles.thumbIcon}>{platMeta.icon}</Text>
            </LinearGradient>
          )}
          {/* Platform badge */}
          <View style={[styles.platBadge, { borderRadius: borderRadius.sm }]}>
            <Text style={styles.platBadgeIcon}>{platMeta.icon}</Text>
            <Text style={styles.platBadgeText}>
              {platMeta.label}
              {save.content_type ? ` • ${CONTENT_TYPE_LABELS[save.content_type] ?? ''}` : ''}
            </Text>
          </View>
          {/* Done overlay */}
          {isDone && (
            <View style={styles.doneOverlay}>
              <Text style={styles.doneBadge}>✓ Done</Text>
            </View>
          )}
        </View>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <View style={[styles.body, { padding: spacing.md }]}>

          {/* Title */}
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {save.title ?? save.url}
          </Text>

          {/* Category chip */}
          {save.category?.name && (
            <View
              style={[
                styles.categoryChip,
                { backgroundColor: colors.accent + '18', borderRadius: borderRadius.pill },
              ]}
            >
              <Text style={[styles.categoryChipText, { color: colors.accent }]}>
                📁 {save.category.name}
              </Text>
            </View>
          )}

          {/* Creator */}
          {save.creator_name ? (
            <Text style={[styles.creator, { color: colors.textSecondary }]}>
              {save.creator_name}
            </Text>
          ) : null}

          {/* Meta row: time + date */}
          <View style={styles.metaRow}>
            {timeStr !== '' && (
              <Text style={[styles.metaChip, { color: colors.textMuted }]}>⏱ {timeStr}</Text>
            )}
            <Text style={[styles.metaChip, { color: colors.textMuted }]}>{relDate}</Text>
          </View>

          {/* AI summary */}
          {save.summary ? (
            <Text style={[styles.summary, { color: colors.textSecondary }]}>
              {save.summary}
            </Text>
          ) : null}

          {/* Tags */}
          {save.tags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagRow}>
              {save.tags.map((tag) => (
                <View key={tag} style={[styles.tagPill, { backgroundColor: colors.border, borderRadius: borderRadius.pill }]}>
                  <Text style={[styles.tagText, { color: colors.textSecondary }]}>#{tag}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* link_status warning banner */}
          {save.link_status !== 'active' && (
            <View style={[styles.warningBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning, borderRadius: borderRadius.sm }]}>
              <Text style={styles.warningIcon}>
                {save.link_status === 'private' ? '🔒' : '⚠️'}
              </Text>
              <Text style={[styles.warningText, { color: colors.textPrimary }]}>
                {save.link_status === 'private'
                  ? 'This content is now private or requires login.'
                  : 'This content may no longer be available.'}
              </Text>
            </View>
          )}

          {/* Primary CTA */}
          <TouchableOpacity
            onPress={handleOpenInPlatform}
            style={[styles.ctaBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
            activeOpacity={0.8}
            accessibilityLabel={ctaLabel}
          >
            <Text style={styles.ctaBtnText}>{ctaLabel}</Text>
          </TouchableOpacity>

          {/* Secondary actions row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionRow}>
            {!isDone && (
              <TouchableOpacity
                onPress={() => void handleMarkDone()}
                style={[styles.actionBtn, { backgroundColor: colors.success + '14', borderRadius: borderRadius.sm }]}
              >
                <Text style={styles.actionBtnEmoji}>✓</Text>
                <Text style={[styles.actionBtnLabel, { color: colors.success }]}>Done</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => void handleSkip()}
              style={[styles.actionBtn, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}
            >
              <Text style={styles.actionBtnEmoji}>⏭</Text>
              <Text style={[styles.actionBtnLabel, { color: colors.textSecondary }]}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCatPickerVisible(true)}
              style={[styles.actionBtn, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}
            >
              <Text style={styles.actionBtnEmoji}>📁</Text>
              <Text style={[styles.actionBtnLabel, { color: colors.textSecondary }]}>Category</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleCopyLink}
              style={[styles.actionBtn, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}
            >
              <Text style={styles.actionBtnEmoji}>🔗</Text>
              <Text style={[styles.actionBtnLabel, { color: colors.textSecondary }]}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleShare()}
              style={[styles.actionBtn, { backgroundColor: colors.border, borderRadius: borderRadius.sm }]}
            >
              <Text style={styles.actionBtnEmoji}>↑</Text>
              <Text style={[styles.actionBtnLabel, { color: colors.textSecondary }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDelete}
              style={[styles.actionBtn, { backgroundColor: colors.error + '14', borderRadius: borderRadius.sm }]}
            >
              <Text style={styles.actionBtnEmoji}>🗑</Text>
              <Text style={[styles.actionBtnLabel, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Personal note */}
          <View style={styles.noteSection}>
            <Text style={[styles.noteSectionLabel, { color: colors.textPrimary }]}>
              Personal Note
              {isSavingNote && (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}> · saving…</Text>
              )}
            </Text>
            <TextInput
              value={note}
              onChangeText={handleNoteChange}
              placeholder="Add your thoughts..."
              placeholderTextColor={colors.textMuted}
              style={[
                styles.noteInput,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: borderRadius.sm,
                },
              ]}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Personal note"
            />
          </View>

        </View>
      </ScrollView>

      {/* Category picker */}
      <CategoryPicker
        visible={catPickerVisible}
        categories={categories}
        onSelect={(id, name) => void handleChangeCategory(id, name)}
        onClose={() => setCatPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  backIcon: { fontSize: 28, fontWeight: '400', lineHeight: 32 },
  moreBtn: { padding: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreIcon: { fontSize: 22, fontWeight: '700' },

  // Thumbnail
  thumbIcon: { fontSize: 48 },
  platBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
  },
  platBadgeIcon: { fontSize: 12 },
  platBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  doneOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34,197,94,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBadge: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },

  // Body
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  body: {},
  title: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 6,
  },
  creator: {
    fontSize: 14,
    marginBottom: 8,
  },
  categoryChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  metaChip: { fontSize: 13 },
  summary: {
    fontSize: 10,
    fontStyle: 'italic',
    lineHeight: 15,
    marginBottom: 12,
  },

  // Tags
  tagRow: { marginBottom: 16 },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 8,
  },
  tagText: { fontSize: 13, fontWeight: '500' },

  // Warning banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  warningIcon: { fontSize: 16 },
  warningText: { flex: 1, fontSize: 14, lineHeight: 20 },

  // CTA
  ctaBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginBottom: 12,
  },
  ctaBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  // Secondary actions
  actionRow: { marginBottom: 16 },
  actionBtn: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    gap: 4,
  },
  actionBtnEmoji: { fontSize: 18 },
  actionBtnLabel: { fontSize: 12, fontWeight: '600' },

  // Divider
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },

  // Note
  noteSection: {},
  noteSectionLabel: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  noteInput: {
    minHeight: 100,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    borderWidth: 1,
  },

  // Category picker
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { paddingTop: 8 },
  handleRow: { alignItems: 'center', paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetRowEmoji: { fontSize: 20 },
  sheetRowText: { fontSize: 16, fontWeight: '500' },
});
