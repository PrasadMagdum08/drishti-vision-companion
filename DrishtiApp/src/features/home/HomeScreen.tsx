import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { DrishtiColors } from '../../core/theme/colors';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

const HomeScreen = () => {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* 🌿 Branding Header */}
        <View style={styles.header}>
          <Text style={styles.logoText}>DRISHTI</Text>
          <Text style={styles.tagline}>Vision Beyond Sight</Text>
          <View style={styles.leafDecorator} />
        </View>

        {/* 📸 Main Actions */}
        <View style={styles.content}>

          {/* Primary — Open Vision */}
          <Pressable
            style={({ pressed }) => [
              styles.cameraButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => navigation.navigate('Camera')}
          >
            <View style={styles.iconCircle}>
              <Text style={{ fontSize: 40 }}>👁️</Text>
            </View>
            <Text style={styles.buttonText}>Open Vision</Text>
            <Text style={styles.buttonSubtext}>Guardian • Voice • Navigation</Text>
          </Pressable>

          {/* Secondary — Debug Vision */}
          <Pressable
            style={({ pressed }) => [
              styles.debugButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => navigation.navigate('Debug')}
          >
            <Text style={styles.debugIcon}>🔍</Text>
            <View style={styles.debugTextGroup}>
              <Text style={styles.debugButtonText}>Debug Vision</Text>
              <Text style={styles.debugButtonSubtext}>
                Bounding boxes • Tracking • Stats
              </Text>
            </View>
          </Pressable>

        </View>

        {/* 📊 Status Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Guardian v2 Active  •  RTX 4050 Linked</Text>
        </View>

      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DrishtiColors.background,
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginTop: 60,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '900',
    color: DrishtiColors.primary,
    letterSpacing: 4,
  },
  tagline: {
    fontSize: 14,
    color: DrishtiColors.secondary,
    fontWeight: '600',
    marginTop: -5,
  },
  leafDecorator: {
    width: 40,
    height: 4,
    backgroundColor: DrishtiColors.secondary,
    marginTop: 15,
    borderRadius: 2,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
  },

  // Primary button — Open Vision
  cameraButton: {
    backgroundColor: DrishtiColors.primary,
    width: '100%',
    padding: 28,
    borderRadius: 25,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 80,
    height: 80,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  buttonSubtext: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },

  // Secondary button — Debug Vision
  debugButton: {
    backgroundColor: '#1C1C1E',
    width: '100%',
    padding: 18,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  debugIcon: {
    fontSize: 28,
  },
  debugTextGroup: {
    flex: 1,
  },
  debugButtonText: {
    color: 'white', 
    fontSize: 17,
    fontWeight: '700',
  },
  debugButtonSubtext: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  footerText: {
    color: DrishtiColors.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
});

export default HomeScreen;