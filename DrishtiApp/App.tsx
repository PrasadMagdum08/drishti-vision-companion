import React, { useEffect, useState, useCallback } from "react";
import { StyleSheet, ActivityIndicator, View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Tts from "react-native-tts";

import { requestDrishtiPermissions } from "./src/core/permissions/PermissionManager";
import HomeScreen from "./src/features/home/HomeScreen";
import CameraStream from "./src/features/vision/CameraStream";
import DebugScreen from "./src/features/debug/DebugScreen";
// NOTE: We will create this in the next step!
import ReaderScreen from "./src/features/reader/ReaderScreen";

import { useVoiceNavigator } from "./src/core/navigation/useVoiceNavigator";
import { useStore } from "./src/core/store/useStore";

type RootStackParamList = {
  Home: undefined;
  Camera: undefined;
  Reader: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppInner = () => {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [currentRoute, setCurrentRoute] = useState("Home");

  const navigate = useCallback(
    (screen: keyof RootStackParamList) => {
      navRef.navigate(screen as any);
    },
    [navRef],
  );

  const { handleNavAudio } = useVoiceNavigator({ currentRoute, navigate });

  // ✅ Expose navigator globally for useStore
  useEffect(() => {
    (globalThis as any).__drishtiNavHandler = handleNavAudio;
  }, [handleNavAudio]);

  return (
    <NavigationContainer
      ref={navRef}
      onStateChange={() => {
        const name = navRef.getCurrentRoute()?.name ?? "Home";
        setCurrentRoute(name);
      }}
    >
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName="Home"
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Camera" component={CameraStream} />
        <Stack.Screen name="Reader" component={ReaderScreen} />
        <Stack.Screen name="Debug" component={DebugScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const App = () => {
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);

  const { connect } = useStore();

  useEffect(() => {
    (async () => {
      try {
        // Renamed to permResult to avoid Hermes 'status' collision
        const permResult = await requestDrishtiPermissions();
        setHasPermissions(permResult);

        // CONNECT TO BACKEND IMMEDIATELY IF PERMISSIONS GRANTED
        if (permResult === true) {
          connect();
        }
      } catch (error) {
        console.error("Permission init error:", error);
      }
    })();
  }, [connect]);

  useEffect(() => {
    Tts.setDefaultLanguage("en-IN");
    Tts.setDefaultRate(0.5);
    Tts.getInitStatus()
      .then(() => {
        console.log("🟢 TTS Engine Ready!");
      })
      .catch(() => {});
  }, []);

  if (hasPermissions === null)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2D5A27" />
      </View>
    );

  if (hasPermissions === false)
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Permissions Denied</Text>
      </View>
    );

  return (
    <SafeAreaView style={styles.container}>
      <AppInner />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F4EF",
  },
  errorText: { color: "#ff4444", fontSize: 20, fontWeight: "bold" },
});

export default App;
