/**
 * OshiSkeletonCard — shimmer placeholder card shown while content loads.
 *
 * PRD §3.3.1 requirements:
 *   • Matches OshiCard exact dimensions in grid and list view.
 *   • Shimmer sweeps left-to-right, translateX −screenWidth → +screenWidth, 1.2 s loop.
 *   • Uses theme.colors.skeletonBase / skeletonHighlight.
 *   • Grid mode: 6 cards. List mode: 4 cards.
 *   • 300 ms delay before showing — if data resolves faster, skeletons never appear.
 *
 * Note: PRD specifies Reanimated 2 but that library is incompatible with Expo Go.
 * Identical visual behaviour is achieved with React Native's built-in Animated API.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants — must stay in sync with OshiCard dimensions
// ─────────────────────────────────────────────────────────────────────────────
const SCREEN_WIDTH = Dimensions.get('window').width;
const H_PADDING = 16;
const CARD_GAP = 12;

/** Width of a single grid card — identical to OshiCard grid mode */
const GRID_CARD_WIDTH = (SCREEN_WIDTH - H_PADDING * 2 - CARD_GAP) / 2;
/** Thumbnail height in grid mode (4:3 ratio) */
const GRID_THUMB_HEIGHT = Math.round(GRID_CARD_WIDTH * 0.75);

/** Thumbnail width in list mode */
const LIST_THUMB_W = 96;
/** Full list card height */
const LIST_CARD_H = 96;

// ─────────────────────────────────────────────────────────────────────────────
// Shimmer — shared across all skeleton cards rendered at the same time.
// A module-level Animated.Value ensures every visible card sweeps in lockstep.
// ─────────────────────────────────────────────────────────────────────────────
let shimmerAnimation: Animated.CompositeAnimation | null = null;
let activeCardCount = 0;
const shimmerValue = new Animated.Value(0);

function startGlobalShimmer(): void {
  if (activeCardCount === 0) {
    shimmerAnimation = Animated.loop(
      Animated.timing(shimmerValue, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );
    shimmerAnimation.start();
  }
  activeCardCount += 1;
}

function stopGlobalShimmer(): void {
  activeCardCount = Math.max(0, activeCardCount - 1);
  if (activeCardCount === 0) {
    shimmerAnimation?.stop();
    shimmerValue.setValue(0);
  }
}

/** translateX range: −screenWidth → +screenWidth per PRD §3.3.1 */
const shimmerTranslateX = shimmerValue.interpolate({
  inputRange: [0, 1],
  outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
});

// ─────────────────────────────────────────────────────────────────────────────
// Shimmer overlay — reusable over any skeleton block
// ─────────────────────────────────────────────────────────────────────────────
function ShimmerOverlay({ highlight }: { highlight: string }): React.JSX.Element {
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        { transform: [{ translateX: shimmerTranslateX }] },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={['transparent', highlight, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton block — a single grey rounded rectangle with shimmer
// ─────────────────────────────────────────────────────────────────────────────
interface BlockProps {
  base: string;
  highlight: string;
  style?: ViewStyle;
}

function SkeletonBlock({ base, highlight, style }: BlockProps): React.JSX.Element {
  return (
    <View
      style={[styles.skeletonBlock, { backgroundColor: base, overflow: 'hidden' }, style]}
    >
      <ShimmerOverlay highlight={highlight} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid skeleton card
// ─────────────────────────────────────────────────────────────────────────────
interface CardProps {
  base: string;
  highlight: string;
  surface: string;
  borderRadius: number;
}

function GridSkeletonCard({ base, highlight, surface, borderRadius }: CardProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.gridCard,
        {
          width: GRID_CARD_WIDTH,
          backgroundColor: surface,
          borderRadius,
          overflow: 'hidden',
        },
      ]}
    >
      {/* Thumbnail */}
      <SkeletonBlock
        base={base}
        highlight={highlight}
        style={{ width: GRID_CARD_WIDTH, height: GRID_THUMB_HEIGHT, borderRadius: 0 }}
      />
      {/* Text rows */}
      <View style={styles.gridCardBody}>
        <SkeletonBlock base={base} highlight={highlight} style={styles.titleRow1} />
        <SkeletonBlock base={base} highlight={highlight} style={styles.titleRow2} />
        <SkeletonBlock base={base} highlight={highlight} style={styles.metaRow} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List skeleton card
// ─────────────────────────────────────────────────────────────────────────────
function ListSkeletonCard({ base, highlight, surface, borderRadius }: CardProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.listCard,
        {
          height: LIST_CARD_H,
          backgroundColor: surface,
          borderRadius,
          overflow: 'hidden',
        },
      ]}
    >
      {/* Left thumbnail */}
      <SkeletonBlock
        base={base}
        highlight={highlight}
        style={{ width: LIST_THUMB_W, height: LIST_CARD_H, borderRadius: 0 }}
      />
      {/* Right text area */}
      <View style={styles.listCardBody}>
        <SkeletonBlock base={base} highlight={highlight} style={styles.listTitle1} />
        <SkeletonBlock base={base} highlight={highlight} style={styles.listTitle2} />
        <SkeletonBlock base={base} highlight={highlight} style={styles.listMeta} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OshiSkeletonCard — single card (public component)
// ─────────────────────────────────────────────────────────────────────────────
export interface OshiSkeletonCardProps {
  viewMode: 'grid' | 'list';
}

export function OshiSkeletonCard({ viewMode }: OshiSkeletonCardProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { borderRadius } = theme;

  useEffect(() => {
    startGlobalShimmer();
    return () => stopGlobalShimmer();
  }, []);

  const cardProps: CardProps = {
    base: colors.skeletonBase,
    highlight: colors.skeletonHighlight,
    surface: colors.surface,
    borderRadius: borderRadius.md,
  };

  if (viewMode === 'grid') {
    return <GridSkeletonCard {...cardProps} />;
  }
  return <ListSkeletonCard {...cardProps} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// useSkeletonDelay — hook that enforces the 300 ms "skip if fast" rule.
//
// Usage:
//   const showSkeleton = useSkeletonDelay(isLoading);
//   if (showSkeleton) return <OshiSkeletonList viewMode={viewMode} />;
// ─────────────────────────────────────────────────────────────────────────────
export function useSkeletonDelay(isLoading: boolean, delayMs = 300): boolean {
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }

    // Only show skeleton if loading takes longer than delayMs
    const timer = setTimeout(() => setShowSkeleton(true), delayMs);
    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  return showSkeleton;
}

// ─────────────────────────────────────────────────────────────────────────────
// OshiSkeletonList — convenience wrapper: renders the right count per view mode
// and handles the 300 ms delay internally.
//
// Props:
//   isLoading    — pass your loading boolean directly
//   viewMode     — 'grid' | 'list'
//   containerStyle — optional style for the outer container
// ─────────────────────────────────────────────────────────────────────────────
export interface OshiSkeletonListProps {
  isLoading: boolean;
  viewMode: 'grid' | 'list';
  containerStyle?: ViewStyle;
}

export function OshiSkeletonList({
  isLoading,
  viewMode,
  containerStyle,
}: OshiSkeletonListProps): React.JSX.Element | null {
  const showSkeleton = useSkeletonDelay(isLoading);

  if (!showSkeleton) return null;

  const count = viewMode === 'grid' ? 6 : 4;

  return (
    <View
      style={[
        viewMode === 'grid' ? styles.gridContainer : styles.listContainer,
        containerStyle,
      ]}
    >
      {Array.from({ length: count }, (_, i) => (
        <OshiSkeletonCard key={i} viewMode={viewMode} />
      ))}
    </View>
  );
}

export default OshiSkeletonCard;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  skeletonBlock: {
    borderRadius: 6,
  },

  // Grid card
  gridCard: {
    marginBottom: CARD_GAP,
  },
  gridCardBody: {
    padding: 10,
    gap: 8,
  },
  titleRow1: { height: 14, width: '90%' },
  titleRow2: { height: 14, width: '65%' },
  metaRow: { height: 10, width: '40%' },

  // List card
  listCard: {
    flexDirection: 'row',
    marginBottom: CARD_GAP,
  },
  listCardBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    gap: 8,
  },
  listTitle1: { height: 14, width: '85%' },
  listTitle2: { height: 14, width: '60%' },
  listMeta: { height: 10, width: '35%' },

  // Containers
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
    paddingHorizontal: H_PADDING,
  },
  listContainer: {
    paddingHorizontal: H_PADDING,
  },
});
