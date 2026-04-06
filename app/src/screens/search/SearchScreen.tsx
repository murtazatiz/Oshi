import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// TODO: Implement search screen per PRD §3.3.8
export default function SearchScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Search</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 18 },
});
