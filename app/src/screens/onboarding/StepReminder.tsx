import React, { useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';
import { apiClient } from '../../services/apiClient';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Period = 'AM' | 'PM';
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const ALL_DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
];

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function to24h(hour: number, period: Period): number {
  if (period === 'AM') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/** Format minutes as zero-padded string */
function padMin(m: number): string {
  return String(m).padStart(2, '0');
}

/** Build the API TIMETZ string in UTC */
function toApiTime(hour: number, minute: number, period: Period): string {
  const h = to24h(hour, period);
  return `${String(h).padStart(2, '0')}:${padMin(minute)}:00+00`;
}

// ─────────────────────────────────────────────
// Drum-roll picker column
// ─────────────────────────────────────────────
interface DrumColProps<T> {
  items: T[];
  selectedIndex: number;
  onIncrement: () => void;
  onDecrement: () => void;
  format: (v: T) => string;
  accent: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
}

function DrumCol<T>({
  items,
  selectedIndex,
  onIncrement,
  onDecrement,
  format,
  accent,
  textColor,
  mutedColor,
  borderColor,
}: DrumColProps<T>): React.JSX.Element {
  const prev = items[(selectedIndex - 1 + items.length) % items.length];
  const curr = items[selectedIndex];
  const next = items[(selectedIndex + 1) % items.length];

  return (
    <View style={styles.drumCol}>
      {/* Up arrow */}
      <TouchableOpacity
        onPress={onIncrement}
        hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        style={[styles.arrowBtn, { minHeight: 44 }]}
        accessibilityLabel="Increase"
      >
        <Text style={{ color: accent, fontSize: 22 }}>▲</Text>
      </TouchableOpacity>

      {/* Ghost row above */}
      <Text style={[styles.drumGhost, { color: mutedColor }]}>{format(prev)}</Text>

      {/* Selected row */}
      <View style={[styles.drumSelected, { borderTopColor: borderColor, borderBottomColor: borderColor }]}>
        <Text style={[styles.drumValue, { color: textColor }]}>{format(curr)}</Text>
      </View>

      {/* Ghost row below */}
      <Text style={[styles.drumGhost, { color: mutedColor }]}>{format(next)}</Text>

      {/* Down arrow */}
      <TouchableOpacity
        onPress={onDecrement}
        hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
        style={[styles.arrowBtn, { minHeight: 44 }]}
        accessibilityLabel="Decrease"
      >
        <Text style={{ color: accent, fontSize: 22 }}>▼</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────
// Main step
// ─────────────────────────────────────────────
interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export default function StepReminder({ onNext, onSkip }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;

  // Default: 7:00 PM
  const [hourIdx, setHourIdx] = useState(HOURS.indexOf(7));
  const [minIdx, setMinIdx] = useState(0);
  const [period, setPeriod] = useState<Period>('PM');
  const [selectedDays, setSelectedDays] = useState<Set<DayKey>>(
    new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  );
  const [isSaving, setIsSaving] = useState(false);

  function toggleDay(key: DayKey): void {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow removing the last selected day
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      const reminderTime = toApiTime(HOURS[hourIdx]!, MINUTES[minIdx]!, period);
      const reminderDays = ALL_DAYS.filter((d) => selectedDays.has(d.key)).map((d) => d.key);
      await apiClient.patch('/notifications/settings', {
        reminder_time: reminderTime,
        reminder_days: reminderDays,
      });
    } catch {
      // Non-fatal — preferences saved next time
    } finally {
      setIsSaving(false);
      onNext();
    }
  }

  async function handleSkip(): Promise<void> {
    // Store the default (7 PM daily) silently
    try {
      await apiClient.patch('/notifications/settings', {
        reminder_time: '19:00:00+00',
        reminder_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      });
    } catch {
      // Non-fatal
    }
    onSkip();
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={() => void handleSkip()}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel="Skip reminder setup"
          accessibilityRole="button"
        >
          <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>Skip for now</Text>
        </TouchableOpacity>

        <View style={[styles.content, { paddingHorizontal: spacing.xl }]}>
          <Text style={{ fontSize: 52, marginBottom: spacing.sm }}>🔔</Text>
          <Text
            style={[
              {
                color: colors.textPrimary,
                fontFamily: typography.display.fontFamily,
                fontSize: 28,
                lineHeight: 36,
                fontWeight: '700',
                marginBottom: spacing.xs,
              },
            ]}
          >
            Set your daily reminder
          </Text>
          <Text
            style={[{ color: colors.textSecondary, ...typography.body, marginBottom: spacing.xl }]}
          >
            We'll nudge you to check your saved content once a day.
          </Text>

          {/* Time picker */}
          <View style={[styles.pickerRow, { marginBottom: spacing.xl }]}>
            {/* Hours */}
            <DrumCol
              items={HOURS}
              selectedIndex={hourIdx}
              onIncrement={() => setHourIdx((i) => (i - 1 + HOURS.length) % HOURS.length)}
              onDecrement={() => setHourIdx((i) => (i + 1) % HOURS.length)}
              format={(h) => String(h)}
              accent={colors.accent}
              textColor={colors.textPrimary}
              mutedColor={colors.textMuted}
              borderColor={colors.border}
            />

            <Text style={[styles.colon, { color: colors.textPrimary, ...typography.heading1 }]}>:</Text>

            {/* Minutes */}
            <DrumCol
              items={MINUTES}
              selectedIndex={minIdx}
              onIncrement={() => setMinIdx((i) => (i - 1 + MINUTES.length) % MINUTES.length)}
              onDecrement={() => setMinIdx((i) => (i + 1) % MINUTES.length)}
              format={(m) => padMin(m)}
              accent={colors.accent}
              textColor={colors.textPrimary}
              mutedColor={colors.textMuted}
              borderColor={colors.border}
            />

            {/* AM/PM */}
            <View style={[styles.periodCol]}>
              <TouchableOpacity
                onPress={() => setPeriod('AM')}
                style={[
                  styles.periodBtn,
                  {
                    backgroundColor: period === 'AM' ? colors.accent : colors.surface,
                    borderRadius: borderRadius.sm,
                    borderColor: colors.border,
                    minHeight: 44,
                  },
                ]}
                accessibilityLabel="AM"
                accessibilityState={{ selected: period === 'AM' }}
              >
                <Text
                  style={[
                    { ...typography.button, color: period === 'AM' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  AM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPeriod('PM')}
                style={[
                  styles.periodBtn,
                  {
                    backgroundColor: period === 'PM' ? colors.accent : colors.surface,
                    borderRadius: borderRadius.sm,
                    borderColor: colors.border,
                    minHeight: 44,
                    marginTop: 8,
                  },
                ]}
                accessibilityLabel="PM"
                accessibilityState={{ selected: period === 'PM' }}
              >
                <Text
                  style={[
                    { ...typography.button, color: period === 'PM' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  PM
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Day selector */}
          <Text
            style={[{ color: colors.textSecondary, ...typography.bodySmall, marginBottom: spacing.sm }]}
          >
            Remind me on
          </Text>
          <View style={styles.daysRow}>
            {ALL_DAYS.map((d) => {
              const active = selectedDays.has(d.key);
              return (
                <TouchableOpacity
                  key={d.key}
                  onPress={() => toggleDay(d.key)}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: active ? colors.accent : colors.surface,
                      borderColor: active ? colors.accent : colors.border,
                      borderRadius: borderRadius.pill,
                    },
                  ]}
                  accessibilityLabel={d.key}
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      { color: active ? '#FFFFFF' : colors.textSecondary, ...typography.bodySmall },
                    ]}
                  >
                    {d.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* CTA */}
        <View style={[styles.ctaContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
          <TouchableOpacity
            onPress={() => void handleSave()}
            activeOpacity={0.85}
            disabled={isSaving}
            style={[
              styles.ctaBtn,
              { backgroundColor: colors.accent, borderRadius: borderRadius.pill },
            ]}
            accessibilityLabel="Set My Reminder"
            accessibilityRole="button"
          >
            <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Set My Reminder</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  skipBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 12 : 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  content: { flex: 1, justifyContent: 'center' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  drumCol: { alignItems: 'center' },
  arrowBtn: { alignItems: 'center', justifyContent: 'center' },
  drumGhost: { height: 40, lineHeight: 40, fontSize: 22, textAlign: 'center', minWidth: 44 },
  drumSelected: {
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  drumValue: { fontSize: 32, fontWeight: '600', textAlign: 'center' },
  colon: { marginTop: 16, paddingHorizontal: 4 },
  periodCol: { alignItems: 'center', marginTop: 8 },
  periodBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'nowrap', justifyContent: 'space-between' },
  dayChip: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  dayLabel: { fontWeight: '600' },
  ctaContainer: {},
  ctaBtn: { height: 54, alignItems: 'center', justifyContent: 'center' },
});
