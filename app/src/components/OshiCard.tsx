/**
 * OshiCard — the primary content card component.
 *
 * PRD §3.3.3 defines 7 card states; PRD §3.6 defines card elements.
 * Supports both grid (2-column) and list layout modes via `viewMode` prop.
 *
 * Dimensions are shared with OshiSkeletonCard — keep them in sync.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Animated,
  Clipboard,
  Dimensions,
  Image,
  Modal,
  Pressable,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  type ImageStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import type { ColorTokens } from '../theme';
import { useThumbnailUri } from '../utils/thumbnailCache';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Platform_ =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'web'
  | 'twitter'
  | 'linkedin'
  | 'spotify'
  | 'other';

export type ContentType =
  | 'short_video'
  | 'long_video'
  | 'article'
  | 'podcast'
  | 'post'
  | 'product'
  | 'image'
  | 'other';

export type SaveStatus = 'unread' | 'done' | 'skipped';
export type ProcessingStatus = 'pending' | 'processing' | 'complete' | 'failed';
export type LinkStatus = 'active' | 'unavailable' | 'private';

export interface SaveData {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  thumbnail_url: string | null;
  platform: Platform_;
  content_type: ContentType | null;
  category: { id: string; name: string };
  tags: string[];
  creator_name: string | null;
  estimated_time_seconds: number | null;
  processing_status: ProcessingStatus;
  status: SaveStatus;
  link_status: LinkStatus;
  saved_at: string;
  ai_confidence_score: number | null;
  user_note: string | null;
}

export interface OshiCardProps {
  save: SaveData;
  viewMode: 'grid' | 'list';
  /** Fires when the user taps the card body (navigate to detail) */
  onPress?: (save: SaveData) => void;
  /** Fires when the user taps the done ✓ button */
  onMarkDone?: (save: SaveData) => void;
  /** Fires when retry is tapped on a failed card */
  onRetry?: (save: SaveData) => void;
  /** Fires when a menu action is chosen */
  onMenuAction?: (save: SaveData, action: MenuAction) => void;
  /** Multi-select mode */
  isSelected?: boolean;
  isMultiSelectActive?: boolean;
  onToggleSelect?: (save: SaveData) => void;
}

export type MenuAction =
  | 'edit_category'
  | 'skip'
  | 'unskip'
  | 'mark_unread'
  | 'add_note'
  | 'copy_link'
  | 'share'
  | 'delete';

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants — shared with OshiSkeletonCard
// ─────────────────────────────────────────────────────────────────────────────
const SCREEN_WIDTH = Dimensions.get('window').width;
const H_PADDING = 16;
const CARD_GAP = 12;

export const GRID_CARD_WIDTH = (SCREEN_WIDTH - H_PADDING * 2 - CARD_GAP) / 2;
const GRID_THUMB_HEIGHT = Math.round(GRID_CARD_WIDTH * (9 / 16));

const LIST_THUMB_W = 96;
const LIST_CARD_H = 96;

// ─────────────────────────────────────────────────────────────────────────────
// Platform metadata
// ─────────────────────────────────────────────────────────────────────────────
interface PlatformInfo {
  label: string;
  icon: string;
  gradientColors: [string, string];
}

const PLATFORM_META: Record<Platform_, PlatformInfo> = {
  instagram: { label: 'Instagram', icon: '📷', gradientColors: ['#833AB4', '#FD1D1D'] },
  youtube:   { label: 'YouTube',   icon: '▶️',  gradientColors: ['#FF0000', '#CC0000'] },
  tiktok:    { label: 'TikTok',    icon: '🎵', gradientColors: ['#010101', '#69C9D0'] },
  web:       { label: 'Web',       icon: '🌐', gradientColors: ['#1A1A2E', '#16213E'] },
  twitter:   { label: 'X',         icon: '𝕏',  gradientColors: ['#14171A', '#657786'] },
  linkedin:  { label: 'LinkedIn',  icon: '💼', gradientColors: ['#0077B5', '#005885'] },
  spotify:   { label: 'Spotify',   icon: '🎧', gradientColors: ['#1DB954', '#191414'] },
  other:     { label: 'Link',      icon: '🔗', gradientColors: ['#1A1A2E', '#666666'] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatEstimatedTime(seconds: number | null, contentType: ContentType | null): string {
  if (seconds == null || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  const verb = isVideoType(contentType) ? 'watch' : 'read';
  return `${minutes} min ${verb}`;
}

function isVideoType(ct: ContentType | null): boolean {
  return ct === 'short_video' || ct === 'long_video';
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getCardState(save: SaveData): 'unread' | 'done' | 'skipped' | 'processing' | 'failed' | 'unavailable' | 'private' {
  if (save.processing_status === 'pending' || save.processing_status === 'processing') return 'processing';
  if (save.processing_status === 'failed') return 'failed';
  if (save.link_status === 'unavailable') return 'unavailable';
  if (save.link_status === 'private') return 'private';
  return save.status;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Platform icon badge overlaid on the thumbnail (bottom-left) */
function PlatformBadge({ platform, borderRadius }: { platform: Platform_; borderRadius: number }): React.JSX.Element {
  const info = PLATFORM_META[platform];
  return (
    <View style={[styles.platformBadge, { borderRadius }]}>
      <Text style={styles.platformBadgeIcon}>{info.icon}</Text>
      <Text style={styles.platformBadgeLabel}>{info.label}</Text>
    </View>
  );
}

/** Category chip shown below the title */
function OshiCategoryChip({
  name,
  colors,
  borderRadius,
}: {
  name: string;
  colors: ColorTokens;
  borderRadius: number;
}): React.JSX.Element {
  return (
    <View style={[styles.categoryChip, { backgroundColor: colors.accent + '18', borderRadius }]}>
      <Text style={[styles.categoryChipText, { color: colors.accent }]}>{name}</Text>
    </View>
  );
}

/** Processing title with pulse animation */
function PulsingTitle({ platform, colors }: { platform: Platform_; colors: ColorTokens }): React.JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.Text
      style={[styles.processingTitle, { color: colors.textMuted, opacity }]}
      numberOfLines={1}
    >
      Processing…
    </Animated.Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OshiCard — main component
// ─────────────────────────────────────────────────────────────────────────────

export function OshiCard({
  save,
  viewMode,
  onPress,
  onMarkDone,
  onRetry,
  onMenuAction,
  isSelected,
  isMultiSelectActive,
  onToggleSelect,
}: OshiCardProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius, shadows } = theme;

  const cardState = getCardState(save);
  const platformInfo = PLATFORM_META[save.platform];
  const isGrid = viewMode === 'grid';
  const [menuVisible, setMenuVisible] = useState(false);

  // ── Card-level state-driven overrides ─────────────────────────────────────

  const cardBackground: string =
    cardState === 'done' ? '#F0FDF4' : colors.surface;

  const titleColor: string =
    cardState === 'unavailable' || cardState === 'private'
      ? colors.textMuted
      : colors.textPrimary;

  const thumbnailOpacity: number =
    cardState === 'done' ? 0.5 : cardState === 'skipped' ? 0.3 : 1;

  const { uri: thumbnailUri, onLoad: onThumbnailLoad, onError: onThumbnailError } = useThumbnailUri(
    save.id,
    save.thumbnail_url,
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handlePress(): void {
    if (isMultiSelectActive && onToggleSelect) {
      onToggleSelect(save);
      return;
    }
    if (cardState === 'failed' && onRetry) {
      onRetry(save);
      return;
    }
    onPress?.(save);
  }

  function handleDone(): void {
    onMarkDone?.(save);
  }

  function handleMenu(): void {
    const isSkipped = save.status === 'skipped';
    const isDone = save.status === 'done';
    const options = [
      'Edit Category',
      isSkipped ? 'Un-skip' : 'Skip',
      isDone ? 'Mark as Unread' : null,
      'Add Note',
      'Copy Link',
      'Share',
      'Delete',
      'Cancel',
    ].filter((label): label is string => label !== null);
    const actions: (MenuAction | 'cancel')[] = [
      'edit_category',
      isSkipped ? 'unskip' : 'skip',
      ...(isDone ? (['mark_unread'] as const) : []),
      'add_note',
      'copy_link',
      'share',
      'delete',
      'cancel' as const,
    ];
    const destructiveIdx = options.indexOf('Delete');
    const cancelIdx = options.length - 1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: destructiveIdx, cancelButtonIndex: cancelIdx },
        (idx) => {
          const action = actions[idx];
          if (action && action !== 'cancel') onMenuAction?.(save, action);
        },
      );
    } else {
      // Android: open custom bottom-sheet modal; actual list is rendered below.
      setMenuVisible(true);
    }
  }

  // ── Thumbnail ─────────────────────────────────────────────────────────────

  function renderThumbnail(): React.JSX.Element {
    const thumbStyle: ViewStyle = isGrid
      ? { width: GRID_CARD_WIDTH, height: GRID_THUMB_HEIGHT }
      : { width: LIST_THUMB_W, height: LIST_CARD_H };

    const imageStyle: ImageStyle = {
      width: thumbStyle.width as number,
      height: thumbStyle.height as number,
      opacity: thumbnailOpacity,
    };

    const showGradient =
      !thumbnailUri || cardState === 'processing';

    const handleOpenExternal = (): void => {
      try {
        void Linking.openURL(save.url);
      } catch {
        // ignore
      }
    };

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handleOpenExternal}
        accessibilityRole="button"
        accessibilityLabel="Open link"
      >
        <View style={[styles.thumbContainer, thumbStyle]}>
          {showGradient ? (
            <LinearGradient
              colors={platformInfo.gradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { opacity: thumbnailOpacity }]}
            />
          ) : (
            <Image
              source={{ uri: thumbnailUri! }}
              style={imageStyle as ImageStyle}
              resizeMode="cover"
              onLoad={onThumbnailLoad}
              onError={onThumbnailError}
            />
          )}

          {/* Done overlay — 50% green tint */}
          {cardState === 'done' && (
            <View style={styles.doneOverlay} />
          )}

          {/* Platform badge — bottom left */}
          <View style={styles.platformBadgePosition}>
            <PlatformBadge platform={save.platform} borderRadius={borderRadius.sm} />
          </View>

          {/* State badges — top right */}
          {cardState === 'done' && (
            <View style={[styles.stateBadge, styles.stateBadgeTR, { backgroundColor: colors.success, borderRadius: borderRadius.sm }]}>
              <Text style={styles.stateBadgeText}>✓</Text>
            </View>
          )}
          {cardState === 'skipped' && (
            <View style={[styles.stateBadge, styles.stateBadgeTR, { backgroundColor: colors.textMuted, borderRadius: borderRadius.sm }]}>
              <Text style={styles.stateBadgeText}>⏭</Text>
            </View>
          )}
          {cardState === 'failed' && (
            <View style={[styles.stateBadge, styles.stateBadgeCenter, { backgroundColor: colors.warning, borderRadius: borderRadius.pill }]}>
              <Text style={styles.stateBadgeTextLg}>⚠️</Text>
            </View>
          )}
          {cardState === 'unavailable' && (
            <View style={[styles.stateBadge, styles.stateBadgeTR, { backgroundColor: colors.warning, borderRadius: borderRadius.sm }]}>
              <Text style={styles.stateBadgeText}>⚠️</Text>
            </View>
          )}
          {cardState === 'private' && (
            <View style={[styles.stateBadge, styles.stateBadgeTR, { backgroundColor: colors.textMuted, borderRadius: borderRadius.sm }]}>
              <Text style={styles.stateBadgeText}>🔒</Text>
            </View>
          )}

          {/* Multi-select checkbox — top left */}
          {isMultiSelectActive && (
            <View style={[styles.selectCircle, styles.selectCirclePosition, { borderColor: colors.surface }]}>
              {isSelected && (
                <View style={[styles.selectCircleFill, { backgroundColor: colors.accent }]}>
                  <Text style={styles.selectCheckmark}>✓</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // ── Card body text ────────────────────────────────────────────────────────

  function renderTitle(): React.JSX.Element | null {
    if (cardState === 'processing') {
      return <PulsingTitle platform={save.platform} colors={colors} />;
    }
    if (cardState === 'failed') {
      return (
        <Text style={[styles.failedTitle, { color: colors.warning, ...typography.bodySmall }]} numberOfLines={isGrid ? 2 : 2}>
          {platformInfo.label} content — tap to retry
        </Text>
      );
    }
    if (!save.title) return null;
    return (
      <Text
        style={[isGrid ? styles.gridTitle : styles.listTitle, { color: titleColor, ...typography.heading2 }]}
        numberOfLines={2}
      >
        {save.title}
      </Text>
    );
  }

  function renderSummary(): React.JSX.Element | null {
    if (cardState === 'processing' || cardState === 'failed') return null;
    if (cardState === 'private') {
      return (
        <Text style={[styles.summaryText, { color: colors.textMuted, ...typography.bodySmall }]} numberOfLines={isGrid ? 1 : 2}>
          This content is now private or requires login.
        </Text>
      );
    }
    if (!save.summary) return null;
    return (
      <Text
        style={[styles.summaryText, { color: colors.textSecondary, ...typography.bodySmall }]}
        numberOfLines={isGrid ? 1 : 2}
      >
        {save.summary}
      </Text>
    );
  }

  function renderMeta(): React.JSX.Element {
    const timeStr = formatEstimatedTime(save.estimated_time_seconds, save.content_type);
    const relativeTime = formatRelativeTime(save.saved_at);

    return (
      <View style={styles.metaRow}>
        {timeStr !== '' && (
          <Text style={[styles.metaText, { color: colors.textMuted, ...typography.caption }]}>
            ⏱ {timeStr}
          </Text>
        )}
        <Text style={[styles.metaText, { color: colors.textMuted, ...typography.caption }]}>
          {relativeTime}
        </Text>
      </View>
    );
  }

  // ── GRID layout ───────────────────────────────────────────────────────────

  if (isGrid) {
    return (
      <>
        <View
          style={[
            styles.gridCard,
            {
              width: GRID_CARD_WIDTH,
              backgroundColor: cardBackground,
              borderRadius: borderRadius.md,
              borderColor: isSelected ? colors.accent : 'transparent',
              borderWidth: isSelected ? 2 : 0,
              ...shadows.card,
            },
          ]}
        >
          {/* Thumbnail — opens external URL */}
          {renderThumbnail()}

          {/* Body — opens detail view */}
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={save.title ?? 'Content card'}
          >
            <View style={[styles.gridBody, { padding: spacing.sm }]}>
              {renderTitle()}
              {renderSummary()}

              {/* Category chip */}
              {cardState !== 'processing' && (
                <OshiCategoryChip
                  name={save.category.name}
                  colors={colors}
                  borderRadius={borderRadius.pill}
                />
              )}

              {renderMeta()}

              {/* Action row: done + overflow */}
              {cardState !== 'processing' && cardState !== 'failed' && (
                <View style={styles.gridActionRow}>
                  {save.status !== 'done' && (
                    <TouchableOpacity
                      onPress={handleDone}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={[styles.doneBtn, { backgroundColor: colors.success + '18', borderRadius: borderRadius.pill }]}
                      accessibilityLabel="Mark as done"
                    >
                      <Text style={[styles.doneBtnText, { color: colors.success }]}>✓</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleMenu}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[styles.menuBtn, { minHeight: 44, minWidth: 44 }]}
                    accessibilityLabel="More actions"
                  >
                    <Text style={[styles.menuDots, { color: colors.textMuted }]}>⋯</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {Platform.OS === 'android' && (
          <Modal
            transparent
            animationType="slide"
            visible={menuVisible}
            onRequestClose={() => setMenuVisible(false)}
          >
            <Pressable
              style={styles.menuOverlay}
              onPress={() => setMenuVisible(false)}
            >
              <View
                style={[
                  styles.menuSheet,
                  {
                    backgroundColor: colors.surface,
                    borderTopLeftRadius: borderRadius.lg,
                    borderTopRightRadius: borderRadius.lg,
                  },
                ]}
              >
                {['Edit Category', save.status === 'skipped' ? 'Un-skip' : 'Skip', 'Add Note', 'Copy Link', 'Share', 'Delete'].map(
                  (label, index) => (
                    <TouchableOpacity
                      key={label}
                      style={styles.menuRow}
                      activeOpacity={0.7}
                      onPress={() => {
                        const map: (MenuAction | 'cancel')[] = [
                          'edit_category',
                          save.status === 'skipped' ? 'unskip' : 'skip',
                          'add_note',
                          'copy_link',
                          'share',
                          'delete',
                          'cancel',
                        ];
                        const action = map[index];
                        setMenuVisible(false);
                        if (action && action !== 'cancel') {
                          onMenuAction?.(save, action);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.menuRowText,
                          label === 'Delete' ? { color: '#EF4444' } : { color: colors.textPrimary },
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}

                <TouchableOpacity
                  style={[styles.menuRow, styles.menuCancelRow]}
                  activeOpacity={0.7}
                  onPress={() => setMenuVisible(false)}
                >
                  <Text style={[styles.menuRowText, { fontWeight: '700', color: colors.textPrimary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>
        )}
      </>
    );
  }

  // ── LIST layout ───────────────────────────────────────────────────────────

  return (
    <>
      <View
        style={[
          styles.listCard,
          {
            backgroundColor: cardBackground,
            borderRadius: borderRadius.md,
            borderColor: isSelected ? colors.accent : 'transparent',
            borderWidth: isSelected ? 2 : 0,
            ...shadows.card,
          },
        ]}
      >
        {/* Thumbnail — left, opens external URL */}
        {renderThumbnail()}

        {/* Body — right, opens detail */}
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={save.title ?? 'Content card'}
          style={[styles.listBody, { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }]}
        >
          {renderTitle()}
          {renderSummary()}

          <View style={styles.listBottomRow}>
            {/* Category + meta */}
            <View style={styles.listInfoRow}>
              {cardState !== 'processing' && (
                <OshiCategoryChip
                  name={save.category.name}
                  colors={colors}
                  borderRadius={borderRadius.pill}
                />
              )}
              {save.estimated_time_seconds != null && save.estimated_time_seconds > 0 && (
                <Text style={[{ color: colors.textMuted, ...typography.caption }]}>
                  ⏱ {formatEstimatedTime(save.estimated_time_seconds, save.content_type)}
                </Text>
              )}
            </View>

            {/* Actions */}
            {cardState !== 'processing' && cardState !== 'failed' && (
              <View style={styles.listActionRow}>
                {save.status !== 'done' && (
                  <TouchableOpacity
                    onPress={handleDone}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[styles.doneBtn, { backgroundColor: colors.success + '18', borderRadius: borderRadius.pill }]}
                    accessibilityLabel="Mark as done"
                  >
                    <Text style={[styles.doneBtnText, { color: colors.success }]}>✓</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={handleMenu}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.menuBtn, { minHeight: 44, minWidth: 36 }]}
                  accessibilityLabel="More actions"
                >
                  <Text style={[styles.menuDots, { color: colors.textMuted }]}>⋮</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'android' && (
        <Modal
          transparent
          animationType="slide"
          visible={menuVisible}
          onRequestClose={() => setMenuVisible(false)}
        >
          <Pressable
            style={styles.menuOverlay}
            onPress={() => setMenuVisible(false)}
          >
            <View
              style={[
                styles.menuSheet,
                {
                  backgroundColor: colors.surface,
                  borderTopLeftRadius: borderRadius.lg,
                  borderTopRightRadius: borderRadius.lg,
                },
              ]}
            >
              {['Edit Category', save.status === 'skipped' ? 'Un-skip' : 'Skip', 'Add Note', 'Copy Link', 'Share', 'Delete'].map(
                (label, index) => (
                  <TouchableOpacity
                    key={label}
                    style={styles.menuRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      const map: (MenuAction | 'cancel')[] = [
                        'edit_category',
                        save.status === 'skipped' ? 'unskip' : 'skip',
                        'add_note',
                        'copy_link',
                        'share',
                        'delete',
                        'cancel',
                      ];
                      const action = map[index];
                      setMenuVisible(false);
                      if (action && action !== 'cancel') {
                        onMenuAction?.(save, action);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.menuRowText,
                        label === 'Delete' ? { color: '#EF4444' } : { color: colors.textPrimary },
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ),
              )}

              <TouchableOpacity
                style={[styles.menuRow, styles.menuCancelRow]}
                activeOpacity={0.7}
                onPress={() => setMenuVisible(false)}
              >
                <Text style={[styles.menuRowText, { fontWeight: '700', color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

export default OshiCard;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Thumbnail ─────────────────────────────────────────────────────────────
  thumbContainer: {
    overflow: 'hidden',
    position: 'relative',
  },
  doneOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34,197,94,0.18)',
  },

  // Platform badge — bottom left of thumbnail
  platformBadgePosition: {
    position: 'absolute',
    bottom: 6,
    left: 6,
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  platformBadgeIcon: { fontSize: 10 },
  platformBadgeLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },

  // State badges — top right of thumbnail
  stateBadge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 4,
  },
  stateBadgeTR: {
    top: 6,
    right: 6,
  },
  stateBadgeCenter: {
    top: '50%',
    left: '50%',
    marginTop: -18,
    marginLeft: -18,
    width: 36,
    height: 36,
  },
  stateBadgeText: { fontSize: 12, color: '#FFFFFF' },
  stateBadgeTextLg: { fontSize: 20 },

  // Multi-select checkbox
  selectCirclePosition: { top: 6, left: 6 },
  selectCircle: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleFill: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCheckmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  // ── Processing ────────────────────────────────────────────────────────────
  processingTitle: {
    fontStyle: 'italic',
    fontSize: 14,
  },
  failedTitle: {},

  // ── Grid card ─────────────────────────────────────────────────────────────
  gridCard: {
    overflow: 'hidden',
    marginBottom: CARD_GAP,
  },
  gridBody: {
    gap: 4,
  },
  gridTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  gridActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },

  // ── List card ─────────────────────────────────────────────────────────────
  listCard: {
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: CARD_GAP,
    minHeight: LIST_CARD_H,
  },
  listBody: {
    flex: 1,
    justifyContent: 'space-between',
  },
  listTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  listBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  listInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  listActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  // ── Shared text ───────────────────────────────────────────────────────────
  summaryText: {
    marginTop: 2,
  },

  // ── Category chip ─────────────────────────────────────────────────────────
  categoryChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Meta row ──────────────────────────────────────────────────────────────
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  metaText: {},

  // ── Action buttons ────────────────────────────────────────────────────────
  doneBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  menuBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuDots: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  // Android menu bottom sheet
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  menuRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  menuRowText: {
    fontSize: 16,
  },
  menuCancelRow: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
});
