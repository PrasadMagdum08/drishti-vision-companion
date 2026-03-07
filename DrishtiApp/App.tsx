import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Tts from 'react-native-tts';

import { requestDrishtiPermissions } from './src/core/permissions/PermissionManager';
import HomeScreen from './src/features/home/HomeScreen';
import CameraStream from './src/features/vision/CameraStream';
import DebugScreen from './src/features/debug/DebugScreen';

const Stack = createNativeStackNavigator();

const App = () => {
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);

  // 1. Permission Initialization
  useEffect(() => {
    (async () => {
      const status = await requestDrishtiPermissions();
      setHasPermissions(status);
    })();
  }, []);

  // 2. TTS Engine Initialization
  useEffect(() => {
    Tts.setDefaultLanguage('en-IN');
    Tts.setDefaultRate(0.5);

    Tts.getInitStatus()
      .then(() => {
        console.log("🟢 TTS Engine Ready!");
        Tts.speak("Drishti audio system is online.");
      })
      .catch((err) => {
        console.error("🔴 TTS Engine Failed: ", err);
        if (err.code === 'no_engine') {
          Tts.requestInstallEngine();
        }
      });
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (hasPermissions === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFD700" />
        <Text style={styles.text}>Initializing Drishti Sensors...</Text>
      </View>
    );
  }

  // ── Permissions denied ─────────────────────────────────────────────────────
  if (hasPermissions === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Permissions Denied.</Text>
        <Text style={styles.subText}>
          Drishti needs Camera and Microphone to function.
        </Text>
      </View>
    );
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home"   component={HomeScreen} />
          <Stack.Screen name="Camera" component={CameraStream} />
          <Stack.Screen name="Debug"  component={DebugScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  text: {
    color: 'white',
    marginTop: 10,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 40,
  },
});

export default App;