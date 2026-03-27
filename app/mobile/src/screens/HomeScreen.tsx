// src/screens/HomeScreen.tsx
// Class list + quick-mark entry point.
// Teacher sees all their classes. Tapping a class goes to MarkingScreen with that class pre-selected.

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { listClasses } from '../services/api';
import { Class } from '../types';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: implement data loading
    loadClasses();
  }, []);

  const loadClasses = async () => {
    // TODO: implement — call listClasses(), handle errors, set loading state
    try {
      const data = await listClasses();
      setClasses(data);
    } catch (e) {
      setError('Failed to load classes. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleClassPress = (cls: Class) => {
    // TODO: navigate to MarkingScreen with class_id
    navigation.navigate('Mark', { class_id: cls.id });
  };

  const handleAddClass = () => {
    // TODO: navigate to ClassSetupScreen
    navigation.navigate('ClassSetup' as never);
  };

  if (loading) return <ActivityIndicator style={styles.centre} />;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Classes</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={classes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.classCard} onPress={() => handleClassPress(item)}>
            <Text style={styles.className}>{item.name}</Text>
            <Text style={styles.classDetail}>{item.education_level.replace('_', ' ').toUpperCase()}</Text>
            {/* TODO: show student count and last marked date */}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No classes yet. Tap + to create one.</Text>
        }
      />
      <TouchableOpacity style={styles.fab} onPress={handleAddClass}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  error: { color: 'red', marginBottom: 8 },
  classCard: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 8 },
  className: { fontSize: 18, fontWeight: '600' },
  classDetail: { fontSize: 13, color: '#666', marginTop: 2 },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 40 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center' },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 32 },
});
