// src/screens/SettingsScreen.tsx
// Teacher profile, subscription status, answer key management, and logout.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();

  const handleLogout = async () => {
    // TODO: clear JWT from AsyncStorage, redirect to login screen
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('neriah_jwt');
          // TODO: navigate to auth/login screen
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      {/* TODO: show teacher name and phone number from stored profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {/* TODO: implement */}
        <Text style={styles.placeholder}>Teacher profile — TODO</Text>
      </View>

      {/* TODO: show subscription status and payment info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subscription</Text>
        {/* TODO: implement — show trial/active/expired, link to EcoCash payment */}
        <Text style={styles.placeholder}>Subscription management — TODO (EcoCash integration out of MVP scope)</Text>
      </View>

      {/* TODO: link to answer key management screen */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Answer Keys</Text>
        <Text style={styles.placeholder}>Manage answer keys — TODO</Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 },
  placeholder: { color: '#aaa', fontSize: 14 },
  logoutButton: { marginTop: 'auto', padding: 16, borderRadius: 8, backgroundColor: '#fee2e2', alignItems: 'center' },
  logoutText: { color: '#dc2626', fontWeight: '600', fontSize: 16 },
});
