import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  searchPlaces,
  getBestType,
  haversineKm,
  formatDistance,
  getPhotoUrl,
  type PlaceWithScore,
} from "@/lib/api";
import { usePickedLocation } from "@/lib/picked-location-context";
import StoriesRow, { type PlacePhotoMap } from "@/components/StoriesRow";

type UserLocation = { lat: number; lng: number };
type TypeFilter = "Todos" | "Restaurantes" | "Parques";

const FOOD_TYPES = new Set(["restaurant", "cafe", "bakery", "meal_takeaway", "food"]);
const PARK_TYPES = new Set([
  "park", "playground", "amusement_center", "amusement_park", "zoo", "tourist_attraction",
]);

function PlaceCard({
  place,
  userLocation,
}: {
  place: PlaceWithScore;
  userLocation: UserLocation | null;
}) {
  const photoUrl =
    place.photos && place.photos.length > 0
      ? getPhotoUrl(place.photos[0].photo_reference, 600)
      : null;

  const distanceText =
    userLocation
      ? formatDistance(
          haversineKm(
            userLocation.lat,
            userLocation.lng,
            place.location.lat,
            place.location.lng,
          ),
        )
      : null;

  const category = getBestType(place.types);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/place/${place.place_id}`)}
    >
      <View style={styles.cardPhoto}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            contentFit="cover"
          />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="image-outline" size={36} color="#ccc" />
          </View>
        )}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{category}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.placeName} numberOfLines={1}>
          {place.name}
        </Text>

        {place.family_highlight && (
          <View style={styles.highlightRow}>
            <Ionicons name="happy-outline" size={13} color={Colors.primary} />
            <Text style={styles.highlightText}>{place.family_highlight} mencionado em avaliações</Text>
          </View>
        )}

        <View style={styles.metaRow}>
          {place.rating != null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color={Colors.star} />
              <Text style={styles.ratingText}>
                {place.rating.toFixed(1)}
                {place.user_ratings_total
                  ? `  (${place.user_ratings_total})`
                  : ""}
              </Text>
            </View>
          )}
          {distanceText && (
            <View style={styles.ratingRow}>
              <Ionicons name="location-outline" size={13} color={Colors.textLight} />
              <Text style={styles.distanceText}>{distanceText}</Text>
            </View>
          )}
        </View>

        <Text style={styles.address} numberOfLines={1}>
          {place.address}
        </Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { pickedLocation } = usePickedLocation();

  const [results, setResults] = useState<PlaceWithScore[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("Todos");
  const [storyPlaceIds, setStoryPlaceIds] = useState<string[]>([]);
  const [placePhotoRefs, setPlacePhotoRefs] = useState<PlacePhotoMap>({});

  const didAutoSearch = useRef(false);

  const filteredResults = results.filter((place) => {
    if (typeFilter === "Restaurantes")
      return place.types.some((t) => FOOD_TYPES.has(t));
    if (typeFilter === "Parques")
      return place.types.some((t) => PARK_TYPES.has(t));
    return true;
  });

  useEffect(() => {
    setStoryPlaceIds(filteredResults.map((p) => p.place_id));
  }, [filteredResults.map((p) => p.place_id).join(",")]);

  const doSearch = useCallback(
    async (lat: number, lng: number, label?: string) => {
      setLoading(true);
      setError(null);
      setTypeFilter("Todos");
      try {
        const places = await searchPlaces({
          latitude: lat,
          longitude: lng,
          radius: 8000,
          establishmentTypes: [
            "park",
            "playground",
            "amusement_center",
            "zoo",
            "tourist_attraction",
            "restaurant",
            "cafe",
          ],
          sortBy: "kidScore",
        });
        setResults(places);
        const photoMap: PlacePhotoMap = {};
        for (const p of places) {
          if (p.photos && p.photos.length > 0) {
            photoMap[p.place_id] = p.photos[0].photo_reference;
          }
        }
        setPlacePhotoRefs(photoMap);
        setSearched(true);
        setUserLocation({ lat, lng });
        if (label) setActiveLabel(label);
      } catch {
        setError("Não foi possível buscar lugares. Tente novamente.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleSearchNearby = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationDenied(true);
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      await doSearch(latitude, longitude, "Localização atual");
    } catch {
      setError("Não foi possível obter sua localização.");
      setLoading(false);
    }
  }, [doSearch]);

  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    handleSearchNearby();
  }, []);

  useEffect(() => {
    if (pickedLocation) {
      setActiveLabel(pickedLocation.label);
      doSearch(pickedLocation.lat, pickedLocation.lng, pickedLocation.label);
    }
  }, [pickedLocation]);

  const openFiltros = useCallback(() => {
    router.push({
      pathname: "/filtros",
      params: {
        lat: userLocation ? String(userLocation.lat) : undefined,
        lng: userLocation ? String(userLocation.lng) : undefined,
      },
    });
  }, [userLocation]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>KidSpot</Text>
          <Text style={styles.tagline}>Lugares para a família</Text>
        </View>
        <View style={styles.logoCircle}>
          <Ionicons name="happy" size={28} color="#fff" />
        </View>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Buscando lugares...</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={handleSearchNearby}
            >
              <Ionicons name="location" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Perto de mim</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
              onPress={openFiltros}
            >
              <Ionicons name="options-outline" size={16} color={Colors.primary} />
              <Text style={styles.secondaryBtnText}>Filtros</Text>
            </Pressable>
          </View>
        </View>
      )}

      {locationDenied && !searched && !loading && (
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={48} color={Colors.textLight} />
          <Text style={styles.emptyText}>
            Permissão de localização negada.{"\n"}Escolha uma cidade nos filtros.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
            onPress={openFiltros}
          >
            <Ionicons name="options-outline" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Filtros</Text>
          </Pressable>
        </View>
      )}

      {searched && !loading && !error && (
        <FlatList
          data={filteredResults}
          keyExtractor={(item) => item.place_id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 + 16 : insets.bottom + 16 },
          ]}
          ListHeaderComponent={(
            <View>
              <StoriesRow placeIds={storyPlaceIds} placePhotoRefs={placePhotoRefs} />
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsCount}>
                  {filteredResults.length > 0
                    ? `${filteredResults.length} lugares encontrados`
                    : "Nenhum lugar encontrado"}
                </Text>

                {activeLabel && (
                  <View style={styles.locationRow}>
                    <Ionicons name="location" size={13} color={Colors.primary} />
                    <Text style={styles.locationLabel} numberOfLines={1}>
                      {activeLabel}
                    </Text>
                  </View>
                )}

                <View style={styles.filterRow}>
                  {(["Restaurantes", "Parques"] as TypeFilter[]).map((f) => (
                    <Pressable
                      key={f}
                      style={({ pressed }) => [
                        styles.typeFilterBtn,
                        typeFilter === f && styles.typeFilterBtnActive,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => setTypeFilter(typeFilter === f ? "Todos" : f)}
                    >
                      <Text
                        style={[
                          styles.typeFilterBtnText,
                          typeFilter === f && styles.typeFilterBtnTextActive,
                        ]}
                      >
                        {f}
                      </Text>
                    </Pressable>
                  ))}

                  <Pressable
                    style={({ pressed }) => [styles.filtrosBtn, pressed && styles.btnPressed]}
                    onPress={openFiltros}
                  >
                    <Ionicons name="options-outline" size={15} color={Colors.primary} />
                    <Text style={styles.filtrosBtnText}>Filtros</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="sad-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>
                Nenhum lugar encontrado.{"\n"}Tente outra localização nos filtros.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={openFiltros}
              >
                <Ionicons name="options-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Filtros</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <PlaceCard place={item} userLocation={userLocation} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  appName: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.primary,
    fontFamily: "Inter_700Bold",
  },
  tagline: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  logoCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 14,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
  errorText: {
    color: Colors.error,
    fontSize: 15,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  errorActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  btnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  listContent: {
    padding: 16,
    gap: 14,
  },
  resultsHeader: {
    marginBottom: 8,
    gap: 8,
  },
  resultsCount: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  locationLabel: {
    fontSize: 13,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  typeFilterBtn: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  typeFilterBtnActive: {
    backgroundColor: Colors.primary,
  },
  typeFilterBtnText: {
    color: Colors.primary,
    fontWeight: "600",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  typeFilterBtnTextActive: {
    color: "#fff",
  },
  filtrosBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  filtrosBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  cardPhoto: {
    height: 160,
    width: "100%",
    position: "relative",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  cardBody: {
    padding: 14,
    gap: 6,
  },
  placeName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  highlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  highlightText: {
    fontSize: 11,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
  },
  metaRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 13,
    color: Colors.text,
    fontFamily: "Inter_500Medium",
  },
  distanceText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  address: {
    fontSize: 12,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
});
