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
  checkCity,
  getCuratedPlaces,
  requestCityActivation,
  haversineKm,
  formatDistance,
  type CuratedPlace,
  type CityCheckResult,
} from "@/lib/api";
import { usePickedLocation } from "@/lib/picked-location-context";
import StoriesRow, { type PlacePhotoMap } from "@/components/StoriesRow";

type UserLocation = { lat: number; lng: number };

function PlaceCard({
  place,
  userLocation,
}: {
  place: CuratedPlace;
  userLocation: UserLocation | null;
}) {
  const distanceText =
    userLocation && place.lat && place.lng
      ? formatDistance(
          haversineKm(
            userLocation.lat,
            userLocation.lng,
            parseFloat(place.lat),
            parseFloat(place.lng),
          ),
        )
      : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/place/${place.place_id}`)}
    >
      <View style={styles.cardPhoto}>
        {place.cover_photo_url ? (
          <Image
            source={{ uri: place.cover_photo_url }}
            style={styles.photo}
            contentFit="cover"
          />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="image-outline" size={36} color="#ccc" />
          </View>
        )}
        {place.category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{place.category}</Text>
          </View>
        )}
        {place.is_sponsored && (
          <View style={styles.sponsoredBadge}>
            <Ionicons name="star" size={10} color="#FF6B35" />
            <Text style={styles.sponsoredText}>Parceiro</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.placeName} numberOfLines={1}>
          {place.name ?? "Local"}
        </Text>

        {place.family_highlight && (
          <View style={styles.highlightRow}>
            <Ionicons name="happy-outline" size={13} color={Colors.primary} />
            <Text style={styles.highlightText}>{place.family_highlight} mencionado em avaliações</Text>
          </View>
        )}

        <View style={styles.metaRow}>
          {place.kid_score != null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color={Colors.star} />
              <Text style={styles.ratingText}>KidScore {place.kid_score}</Text>
            </View>
          )}
          {distanceText && (
            <View style={styles.ratingRow}>
              <Ionicons name="location-outline" size={13} color={Colors.textLight} />
              <Text style={styles.distanceText}>{distanceText}</Text>
            </View>
          )}
        </View>

        {place.address && (
          <Text style={styles.address} numberOfLines={1}>
            {place.address}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function CityUnavailableScreen({
  cityName,
  onRequest,
  requesting,
  requested,
}: {
  cityName: string | null;
  onRequest: () => void;
  requesting: boolean;
  requested: boolean;
}) {
  return (
    <View style={styles.centered}>
      <Ionicons name="location-outline" size={52} color={Colors.textLight} />
      <Text style={styles.cityUnavailableTitle}>Cidade indisponível</Text>
      <Text style={styles.cityUnavailableText}>
        {cityName ? `${cityName} ainda` : "Esta cidade ainda"} não está disponível no KidSpot.{"\n"}Em breve por aqui!
      </Text>
      {requested ? (
        <View style={styles.requestedBadge}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
          <Text style={styles.requestedText}>Solicitação enviada!</Text>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, requesting && styles.btnDisabled]}
          onPress={onRequest}
          disabled={requesting}
        >
          {requesting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="send-outline" size={16} color="#fff" />
          }
          <Text style={styles.primaryBtnText}>Solicitar habilitação</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { pickedLocation } = usePickedLocation();

  const [results, setResults] = useState<CuratedPlace[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [searched, setSearched] = useState(false);
  const [cityCheck, setCityCheck] = useState<CityCheckResult | null>(null);
  const [placePhotoRefs] = useState<PlacePhotoMap>({});
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  const didAutoSearch = useRef(false);

  const doSearch = useCallback(
    async (lat: number, lng: number, label?: string) => {
      setLoading(true);
      setError(null);
      setCityCheck(null);
      setRequested(false);
      try {
        const check = await checkCity(lat, lng);
        setCityCheck(check);
        setUserLocation({ lat, lng });
        if (label) setActiveLabel(label);

        if (!check.enabled || !check.city_id) {
          setResults([]);
          setSearched(true);
          return;
        }

        const places = await getCuratedPlaces(check.city_id);
        setResults(places);
        setSearched(true);
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
      setUserLocation({ lat: latitude, lng: longitude });
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

  const handleRequestActivation = useCallback(async () => {
    if (!userLocation) return;
    setRequesting(true);
    try {
      await requestCityActivation(userLocation.lat, userLocation.lng, cityCheck?.city_name ?? null);
      setRequested(true);
    } catch {
      // fail silently — the button stays enabled for retry
    } finally {
      setRequesting(false);
    }
  }, [userLocation, cityCheck]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const cityUnavailable = searched && !loading && !error && cityCheck && !cityCheck.enabled;

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

      <StoriesRow
        userLat={userLocation?.lat}
        userLng={userLocation?.lng}
        placePhotoRefs={placePhotoRefs}
      />

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

      {cityUnavailable && (
        <CityUnavailableScreen
          cityName={cityCheck?.city_name ?? null}
          onRequest={handleRequestActivation}
          requesting={requesting}
          requested={requested}
        />
      )}

      {searched && !loading && !error && !cityUnavailable && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place_id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 + 16 : insets.bottom + 16 },
          ]}
          ListHeaderComponent={(
            <View>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsCount}>
                  {results.length > 0
                    ? `${results.length} lugares encontrados`
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
  cityUnavailableTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  cityUnavailableText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  requestedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  requestedText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
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
  btnDisabled: {
    opacity: 0.6,
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
  sponsoredBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  sponsoredText: {
    color: "#FF6B35",
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
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
