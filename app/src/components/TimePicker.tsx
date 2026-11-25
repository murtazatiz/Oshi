/**
 * TimePicker — hour/minute/AM-PM stepper (no native picker dependency).
 * Shared by the daily reminder editor and the per-category reminder override.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/** Minimal time picker: scrolling HH / MM / AM-PM wheels on iOS-like experience
 *  using simple -/+ buttons (no native picker dependency). */
export function TimePicker({
  hour,
  minute,
  onChangeHour,
  onChangeMinute,
}: {
  hour: number;
  minute: number;
  onChangeHour: (h: number) => void;
  onChangeMinute: (m: number) => void;
}): React.JSX.Element {
  const { colors, theme } = useTheme();
  const isAM = hour < 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  function toggleMeridiem(): void {
    onChangeHour(isAM ? hour + 12 : hour - 12);
  }

  return (
    <View style={timStyles.row}>
      {/* Hour */}
      <View style={timStyles.spinnerCol}>
        <TouchableOpacity onPress={() => onChangeHour((hour + 1) % 24)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▲</Text>
        </TouchableOpacity>
        <Text style={[timStyles.digit, { color: colors.textPrimary }]}>
          {String(h12).padStart(2, '0')}
        </Text>
        <TouchableOpacity onPress={() => onChangeHour((hour - 1 + 24) % 24)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▼</Text>
        </TouchableOpacity>
      </View>
      <Text style={[timStyles.colon, { color: colors.textPrimary }]}>:</Text>
      {/* Minute */}
      <View style={timStyles.spinnerCol}>
        <TouchableOpacity onPress={() => onChangeMinute((minute + 1) % 60)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▲</Text>
        </TouchableOpacity>
        <Text style={[timStyles.digit, { color: colors.textPrimary }]}>
          {String(minute).padStart(2, '0')}
        </Text>
        <TouchableOpacity onPress={() => onChangeMinute((minute - 1 + 60) % 60)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▼</Text>
        </TouchableOpacity>
      </View>
      {/* AM/PM toggle */}
      <TouchableOpacity
        onPress={toggleMeridiem}
        style={[timStyles.meridiem, { backgroundColor: colors.border, borderRadius: theme.borderRadius.sm }]}
      >
        <Text style={[timStyles.meridiemText, { color: colors.textPrimary }]}>
          {isAM ? 'AM' : 'PM'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const timStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  spinnerCol: { alignItems: 'center', gap: 4 },
  arrow: { padding: 4 },
  arrowText: { fontSize: 14 },
  digit: { fontSize: 32, fontWeight: '700', minWidth: 48, textAlign: 'center' },
  colon: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  meridiem: { paddingHorizontal: 12, paddingVertical: 8, marginLeft: 8 },
  meridiemText: { fontSize: 16, fontWeight: '700' },
});
