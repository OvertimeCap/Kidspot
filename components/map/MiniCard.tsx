import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { getBestType, resolvePlaceImageUrl, type PlaceWithScore } from "@/lib/api";

interface Props {
  place: PlaceWithScore | null;
  onDismiss: () => void;
  onNavigate: () => void;
}

export default function MiniCard({ place, onDismiss, onNavigate }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(180)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: place ? 0 : 180,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  }, [place, slideAnim]);

  const photoUrl =
    place?.photos && place.photos.length > 0
      ? resolvePlaceImageUrl(place.photos[0], 200)
      : null;

  const category = place ? place.category_label ?? getBestType(place.types) : "";

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingBottom: insets.bottom + 12 },
        { transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents={place ? "box-none" : "none"}
    >
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onNavigate}
      >
        <View style={styles.photoContainer}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              contentFit="cover"
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="image-outline" size={28} color="#ccc" />
            </View>
          )}
        </View>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {place?.name ?? ""}
          </Text>

          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{category}</Text>
          </View>

          <View style={styles.ratingRow}>
            {place?.rating != null && (
              <>
                <Ionicons name="star" size={13} color={Colors.star ?? "#FFC107"} />
                <Text style={styles.rating}>{place.rating.toFixed(1)}</Text>
              </>
            )}
            <Text style={styles.kidScore}>
              KidScore {place?.kid_score ?? "-"}
            </Text>
          </View>
        </View>

        <Ionicons
          name="chevron-forward"
          size={20}
          color={Colors.textLight ?? "#999"}
          style={styles.chevron}
        />
      </Pressable>

      <Pressable style={styles.closeBtn} onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close-circle" size={22} color={Colors.textLight ?? "#999"} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardPressed: {
    opacity: 0.8,
  },
  photoContainer: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#f0f0f0",
    flexShrink: 0,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary + "20",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rating: {
    fontSize: 13,
    color: "#1A1A1A",
    fontWeight: "600",
  },
  kidScore: {
    fontSize: 12,
    color: "#666",
    marginLeft: 4,
  },
  chevron: {
    flexShrink: 0,
  },
  closeBtn: {
    position: "absolute",
    top: 8,
    right: 12,
  },
});
