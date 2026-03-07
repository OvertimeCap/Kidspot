import React, { useState, useCallback } from "react";
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

type UserLocation = { lat: number; lng: number };
type City = "Franca" | "Ribeirão Preto";
type TypeFilter = "Todos" | "Restaurantes" | "Parques";

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
  const [results, setResults] = useState<PlaceWithScore[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("Todos");

  const filteredResults = results.filter((place) => {
    if (typeFilter === "Restaurantes") return place.types.includes("restaurant");
    if (typeFilter === "Parques")
      return place.types.includes("park") || place.types.includes("amusement_park");
    return true;
  });

  const doSearch = useCallback(
    async (params: Parameters<typeof searchPlaces>[0]) => {
      setLoading(true);
      setError(null);
      setTypeFilter("Todos");
      try {
        const places = await searchPlaces(params);
        setResults(places);
        setSearched(true);
      } catch (e) {
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
      setUserLocation({ lat: latitude, lng: longitude });
      await doSearch({
        latitude,
        longitude,
        radius: 5000,
        establishmentType: "park",
        sortBy: "kidScore",
      });
    } catch {
      setError("Não foi possível obter sua localização.");
      setLoading(false);
    }
  }, [doSearch]);

  const CITY_COORDS: Record<City, { lat: number; lng: number }> = {
    Franca: { lat: -20.5386, lng: -47.4009 },
    "Ribeirão Preto": { lat: -21.1704, lng: -47.8102 },
  };

  const handleCitySearch = useCallback(
    (city: City) => {
      const coords = CITY_COORDS[city];
      doSearch({
        latitude: coords.lat,
        longitude: coords.lng,
        radius: 8000,
        establishmentType: "park",
        sortBy: "kidScore",
      });
    },
    [doSearch],
  );

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

      {!searched && !loading && (
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="search-circle" size={72} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Encontre lugares{"\n"}para sua família</Text>
          <Text style={styles.heroSub}>
            Parques, restaurantes e muito mais{"\n"}em Franca e Ribeirão Preto
          </Text>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
            onPress={handleSearchNearby}
          >
            <Ionicons name="location" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Buscar perto de mim</Text>
          </Pressable>

          {locationDenied && (
            <View style={styles.citySection}>
              <Text style={styles.citySectionLabel}>Escolha uma cidade</Text>
              <View style={styles.cityButtons}>
                <Pressable
                  style={({ pressed }) => [styles.cityBtn, pressed && styles.btnPressed]}
                  onPress={() => handleCitySearch("Franca")}
                >
                  <Text style={styles.cityBtnText}>Franca</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.cityBtn, pressed && styles.btnPressed]}
                  onPress={() => handleCitySearch("Ribeirão Preto")}
                >
                  <Text style={styles.cityBtnText}>Ribeirão Preto</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

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
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
            onPress={handleSearchNearby}
          >
            <Text style={styles.primaryBtnText}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {searched && !loading && !error && (
        <FlatList
          data={filteredResults}
          keyExtractor={(item) => item.place_id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {filteredResults.length > 0
                  ? `${filteredResults.length} lugares encontrados`
                  : "Nenhum lugar encontrado"}
              </Text>

              <View style={styles.typeFilterRow}>
                {(["Todos", "Restaurantes", "Parques"] as TypeFilter[]).map((f) => (
                  <Pressable
                    key={f}
                    style={({ pressed }) => [
                      styles.typeFilterBtn,
                      typeFilter === f && styles.typeFilterBtnActive,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => setTypeFilter(f)}
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
              </View>

              <View style={styles.cityButtons}>
                <Pressable
                  style={({ pressed }) => [styles.filterBtn, pressed && styles.btnPressed]}
                  onPress={() => handleCitySearch("Franca")}
                >
                  <Text style={styles.filterBtnText}>Franca</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.filterBtn, pressed && styles.btnPressed]}
                  onPress={() => handleCitySearch("Ribeirão Preto")}
                >
                  <Text style={styles.filterBtnText}>Ribeirão Preto</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.filterBtn, pressed && styles.btnPressed]}
                  onPress={handleSearchNearby}
                >
                  <Ionicons name="location-outline" size={14} color={Colors.primary} />
                  <Text style={styles.filterBtnText}>Perto de mim</Text>
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="sad-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>
                Nenhum lugar encontrado.{"\n"}Tente outra busca.
              </Text>
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
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  heroIcon: {
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
    lineHeight: 34,
    fontFamily: "Inter_700Bold",
  },
  heroSub: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    marginTop: 4,
  },
  btnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  citySection: {
    marginTop: 20,
    alignItems: "center",
    gap: 10,
  },
  citySectionLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  cityButtons: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  cityBtn: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cityBtnText: {
    color: Colors.primary,
    fontWeight: "600",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
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
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  listContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 100,
  },
  resultsHeader: {
    marginBottom: 8,
    gap: 10,
  },
  resultsCount: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  typeFilterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
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
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterBtnText: {
    color: Colors.primary,
    fontWeight: "600",
    fontSize: 13,
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
