import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchStoryPhotos, getStoryPhotoUrl, type StoryPhotoRef } from "@/lib/api";
import { markStorySeen } from "@/components/StoriesRow";
import Colors from "@/constants/colors";

const STORY_DURATION = 4000;

export default function StoryViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<StoryPhotoRef[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const screenWidth = Dimensions.get("window").width;

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev < photos.length - 1) return prev + 1;
      router.back();
      return prev;
    });
  }, [photos.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchStoryPhotos(id)
      .then((p) => {
        setPhotos(p);
        if (id) markStorySeen(id);
      })
      .catch(() => setError("Não foi possível carregar o story."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (photos.length === 0) return;

    progressAnim.setValue(0);

    if (animRef.current) animRef.current.stop();
    if (timerRef.current) clearTimeout(timerRef.current);

    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) goNext();
    });

    return () => {
      if (animRef.current) animRef.current.stop();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentIndex, photos.length]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (loading) {
    return (
      <View style={styles.fullscreen}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error || photos.length === 0) {
    return (
      <View style={styles.fullscreen}>
        <Text style={styles.errorText}>{error ?? "Story sem fotos."}</Text>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    );
  }

  const currentPhoto = photos[currentIndex];
  const photoUrl = getStoryPhotoUrl(currentPhoto.id);

  return (
    <View style={styles.fullscreen}>
      <Image
        source={{ uri: photoUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />

      <View style={[styles.overlay, { paddingTop: topPad }]}>
        <View style={styles.progressRow}>
          {photos.map((_, i) => (
            <View key={i} style={styles.progressSegment}>
              <View style={styles.progressBg} />
              {i < currentIndex ? (
                <View style={[styles.progressFill, { width: "100%" }]} />
              ) : i === currentIndex ? (
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>

        <Pressable
          style={[styles.closeBtn, { top: topPad + 12 }]}
          onPress={() => router.back()}
          testID="story-close-btn"
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.touchRow}>
        <Pressable style={styles.touchLeft} onPress={goPrev} />
        <Pressable style={styles.touchRight} onPress={goNext} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 12,
  },
  progressRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 10,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    position: "relative",
  },
  progressBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  progressFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: "#fff",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  touchRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  touchLeft: {
    flex: 1,
  },
  touchRight: {
    flex: 1,
  },
  errorText: {
    color: "#fff",
    fontSize: 16,
    marginBottom: 20,
    fontFamily: "Inter_400Regular",
  },
});
