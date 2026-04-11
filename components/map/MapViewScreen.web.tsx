/**
 * Stub web para MapViewScreen.
 * react-native-maps usa módulos nativos incompatíveis com React Native Web.
 * Metro carrega este arquivo automaticamente na plataforma web (.web.tsx tem precedência).
 * No Android/iOS o arquivo MapViewScreen.tsx é usado normalmente.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { UserLocation, TypeFilter } from "@/lib/use-home-search";

interface Props {
  userLocation: UserLocation | null;
  typeFilter: TypeFilter;
}

export default function MapViewScreen(_props: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name="map-outline" size={64} color={Colors.primary} />
      <Text style={styles.title}>Mapa disponível no app mobile</Text>
      <Text style={styles.subtitle}>
        Instale o aplicativo KidSpot no seu Android ou iOS para visualizar o mapa interativo.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
    backgroundColor: "#F8FBFF",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text ?? "#1A1A1A",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary ?? "#666",
    textAlign: "center",
    lineHeight: 20,
  },
});
