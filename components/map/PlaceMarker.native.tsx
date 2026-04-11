import React from "react";
import { View, StyleSheet } from "react-native";
import { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { PlaceWithScore } from "@/lib/api";

interface Props {
  place: PlaceWithScore;
  onPress: (place: PlaceWithScore) => void;
}

export default function PlaceMarker({ place, onPress }: Props) {
  return (
    <Marker
      coordinate={{
        latitude: place.location.lat,
        longitude: place.location.lng,
      }}
      // tracksViewChanges={false} é CRÍTICO para performance em Android:
      // sem ele, cada re-render JS força re-render nativo de todos os markers.
      tracksViewChanges={false}
      onPress={() => onPress(place)}
    >
      {/* pointerEvents="none": a View não intercepta cliques — o evento chega ao onPress do Marker.
          Sem isso, no web (React Native Web) o DOM element da View absorve o click antes do Marker. */}
      <View style={styles.container} pointerEvents="none">
        <Ionicons name="location" size={34} color={Colors.primary} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
