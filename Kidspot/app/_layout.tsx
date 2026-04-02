import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { PickedLocationProvider } from "@/lib/picked-location-context";
import { AuthProvider } from "@/lib/auth-context";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Voltar" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="place/[place_id]"
        options={{
          title: "Detalhes",
          headerTintColor: Colors.primary,
          headerBackTitle: "Voltar",
        }}
      />
      <Stack.Screen
        name="filtros"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [0.6],
          sheetGrabberVisible: true,
          headerShown: false,
          contentStyle: { backgroundColor: "#fff" },
        }}
      />
      <Stack.Screen
        name="login"
        options={{
          headerShown: false,
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="cadastro"
        options={{
          headerShown: false,
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="story/[id]"
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
        }}
      />
      <Stack.Screen
        name="story/criar"
        options={{
          headerShown: false,
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="admin-filtros"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="admin-feedback"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="admin-usuarios"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="admin-prompts"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="admin-kidscore"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="admin-criterios"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="admin-operacao"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <PickedLocationProvider>
                <RootLayoutNav />
              </PickedLocationProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
