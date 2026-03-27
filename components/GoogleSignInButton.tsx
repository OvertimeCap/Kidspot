import React, { useEffect, useState } from "react";
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import Colors from "@/constants/colors";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

export default function GoogleSignInButton({
  onError,
}: {
  onError?: (msg: string) => void;
}) {
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);

  const redirectUri = makeRedirectUri({
    scheme: "myapp",
  });

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_CLIENT_ID,
    iosClientId: GOOGLE_CLIENT_ID,
    androidClientId: GOOGLE_CLIENT_ID,
    redirectUri,
  });

  useEffect(() => {
    if (response?.type !== "success") return;
    const accessToken = response.authentication?.accessToken;
    if (!accessToken) {
      onError?.("Não foi possível obter o token do Google.");
      return;
    }
    setLoading(true);
    loginWithGoogle(accessToken)
      .then(() => router.replace("/(tabs)"))
      .catch(() => onError?.("Erro ao autenticar com Google. Tente novamente."))
      .finally(() => setLoading(false));
  }, [response]);

  const configured = !!GOOGLE_CLIENT_ID;

  function handlePress() {
    if (!configured) {
      onError?.(
        "Login com Google não configurado. Verifique EXPO_PUBLIC_GOOGLE_CLIENT_ID.",
      );
      return;
    }
    promptAsync();
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        pressed && styles.btnPressed,
        !configured && styles.btnDisabled,
        loading && styles.btnDisabled,
      ]}
      onPress={handlePress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.textSecondary} />
      ) : (
        <>
          <GoogleLogo />
          <Text style={styles.text}>Continuar com Google</Text>
        </>
      )}
    </Pressable>
  );
}

function GoogleLogo() {
  return (
    <View style={styles.logo}>
      <Text style={styles.logoG}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: "#fff",
    gap: 10,
    paddingHorizontal: 16,
  },
  btnPressed: {
    backgroundColor: "#F8FAFC",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  logo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  logoG: {
    fontSize: 17,
    fontWeight: "700",
    color: "#4285F4",
    fontFamily: "Inter_700Bold",
  },
  text: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
});
