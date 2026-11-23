/**
 * RemindersScreen — PRD §3.7.2. Deep-link target for oshi://settings/reminders.
 * The editor itself is components/ReminderSettings, shared with SettingsScreen.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '../../theme/ThemeContext';
import { ReminderSettings } from '../../components/ReminderSettings';

export default function RemindersScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { colors, theme } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: theme.spacing.md }]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.side}
        >
          <Text style={[styles.backText, { color: colors.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Daily Reminder</Text>
        <View style={styles.side} />
      </View>
      <ScrollView>
        <ReminderSettings />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 17, fontWeight: '500' },
  title: { fontSize: 17, fontWeight: '600' },
});
