import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { PlaceWithScore } from "@/lib/api";

interface Props {
  place: PlaceWithScore;
  onPress: (place: PlaceWithScore) => void;
}

export default function PlaceMarker({ place, onPress }: Props) {
  const coordinate = {
    latitude: place.location.lat,
    longitude: place.location.lng,
  };

  return (
    <Marker
      coordinate={coordinate}
      pinColor={Platform.OS === "android" ? Colors.primary : undefined}
      tracksViewChanges={false}
      onPress={() => onPress(place)}
    >
      {Platform.OS !== "android" && (
        <View style={styles.container} pointerEvents="none">
          <Ionicons name="location" size={34} color={Colors.primary} />
        </View>
      )}
    </Marker>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
