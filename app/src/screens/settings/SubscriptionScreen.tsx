import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// TODO: Implement paywall / subscription screen per PRD §8
export default function SubscriptionScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Subscription</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 18 },
});
