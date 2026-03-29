import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  fetchStories,
  fetchStoriesNearby,
  getPhotoUrl,
  type StoryItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const SEEN_STORIES_KEY = "kidspot_seen_stories";

async function getSeenStories(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_STORIES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function markStorySeen(storyId: string): Promise<void> {
  try {
    const seen = await getSeenStories();
    seen.add(storyId);
    await AsyncStorage.setItem(SEEN_STORIES_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    // ignore
  }
}

interface StoryCircleProps {
  story: StoryItem;
  seen: boolean;
  photoRef: string | null;
  onPress: () => void;
}

function StoryCircle({ story, seen, photoRef, onPress }: StoryCircleProps) {
  const photoUrl = photoRef ? getPhotoUrl(photoRef, 200) : null;

  const ringColor = seen
    ? "#CCCCCC"
    : story.user_role === "parceiro"
    ? "#7C3AED"
    : Colors.secondary;

  return (
    <Pressable style={styles.storyItem} onPress={onPress}>
      <View style={[styles.ring, { borderColor: ringColor }]}>
        <View style={styles.circleInner}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.circleImage} contentFit="cover" />
          ) : (
            <View style={styles.circlePlaceholder}>
              <Ionicons name="location-outline" size={22} color="#ccc" />
            </View>
          )}
        </View>
      </View>
      <Text style={styles.storyName} numberOfLines={1}>
        {story.place_name}
      </Text>
    </Pressable>
  );
}

export interface PlacePhotoMap {
  [placeId: string]: string;
}

interface StoriesRowProps {
  userLat?: number;
  userLng?: number;
  placeIds?: string[];
  placePhotoRefs?: PlacePhotoMap;
}

export default function StoriesRow({
  userLat,
  userLng,
  placeIds = [],
  placePhotoRefs = {},
}: StoriesRowProps) {
  const { user } = useAuth();
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const isPartner =
    user?.role === "parceiro" || user?.role === "estabelecimento";
  const hasLinkedPlace = !!(user?.linked_place_id);

  const locationKey = userLat != null && userLng != null
    ? `${userLat.toFixed(4)},${userLng.toFixed(4)}`
    : null;
  const placeIdsKey = placeIds.join(",");

  useEffect(() => {
    const hasLocation = userLat != null && userLng != null;

    if (!hasLocation && placeIds.length === 0) {
      setStories([]);
      return;
    }

    setLoading(true);
    const storiesPromise = hasLocation
      ? fetchStoriesNearby(userLat!, userLng!)
      : fetchStories(placeIds);

    Promise.all([storiesPromise, getSeenStories()])
      .then(([fetchedStories, seen]) => {
        setStories(fetchedStories);
        setSeenIds(seen);
      })
      .catch(() => {
        setStories([]);
      })
      .finally(() => setLoading(false));
  }, [locationKey, placeIdsKey]);

  const showAddButton = isPartner && hasLinkedPlace;

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  if (!showAddButton && stories.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {showAddButton && (
          <Pressable
            style={styles.storyItem}
            onPress={() => router.push("/story/criar")}
          >
            <View style={[styles.ring, { borderColor: Colors.primary }]}>
              <View style={[styles.circleInner, styles.addCircle]}>
                <Ionicons name="add" size={28} color={Colors.primary} />
              </View>
            </View>
            <Text style={styles.storyName} numberOfLines={1}>
              Publicar
            </Text>
          </Pressable>
        )}
        {stories.map((story) => (
          <StoryCircle
            key={story.id}
            story={story}
            seen={seenIds.has(story.id)}
            photoRef={placePhotoRefs[story.place_id] ?? null}
            onPress={() => {
              setSeenIds((prev) => new Set([...prev, story.id]));
              router.push(`/story/${story.id}`);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const CIRCLE_SIZE = 64;

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
  },
  loadingRow: {
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  storyItem: {
    alignItems: "center",
    width: CIRCLE_SIZE + 8,
  },
  ring: {
    width: CIRCLE_SIZE + 4,
    height: CIRCLE_SIZE + 4,
    borderRadius: (CIRCLE_SIZE + 4) / 2,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleInner: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: "hidden",
    backgroundColor: "#f0f0f0",
  },
  circleImage: {
    width: "100%",
    height: "100%",
  },
  circlePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  addCircle: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF5EE",
  },
  storyName: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: "center",
    fontFamily: "Inter_500Medium",
    width: CIRCLE_SIZE + 8,
  },
});
