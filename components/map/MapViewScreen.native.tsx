import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Pressable,
} from "react-native";
import MapView, { PROVIDER_GOOGLE, type Region } from "react-native-maps";
import useSupercluster from "use-supercluster";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { searchCuratedPlaces, haversineKm, type PlaceWithScore } from "@/lib/api";
import { zoomFromRegion, boundsFromRegion, boundsObjectFromRegion } from "@/lib/map-utils";
import { FOOD_TYPES, PARK_TYPES, type UserLocation, type TypeFilter } from "@/lib/use-home-search";
import PlaceMarker from "./PlaceMarker";
import MarkerCluster from "./MarkerCluster";
import MiniCard from "./MiniCard";

const MAP_STYLE = [
  { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.text", stylers: [{ visibility: "off" }] },
  { featureType: "poi.attraction", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.government", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.medical", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.place_of_worship", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.school", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.sports_complex", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.line", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.airport", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.bus", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.rail", elementType: "all", stylers: [{ visibility: "off" }] },
];

interface Props {
  userLocation: UserLocation | null;
  typeFilter: TypeFilter;
  places: PlaceWithScore[];
  onResultsChange?: (lat: number, lng: number, places: PlaceWithScore[], label?: string) => void;
}

const DEFAULT_LAT = -23.5505;
const DEFAULT_LNG = -46.6333;
const GOOGLE_MAP_ID = process.env.EXPO_PUBLIC_GOOGLE_MAP_ID?.trim() || undefined;

function isFiniteRegion(region: Region): boolean {
  return (
    Number.isFinite(region.latitude) &&
    Number.isFinite(region.longitude) &&
    Number.isFinite(region.latitudeDelta) &&
    Number.isFinite(region.longitudeDelta) &&
    region.latitudeDelta > 0 &&
    region.longitudeDelta > 0
  );
}

function sanitizePlaces(places: PlaceWithScore[]): PlaceWithScore[] {
  return places.filter((place) =>
    Number.isFinite(place.location.lat) && Number.isFinite(place.location.lng),
  );
}

function getRegionForPlaces(places: PlaceWithScore[]): Region | null {
  const coordinates = sanitizePlaces(places).map((place) => ({
    latitude: place.location.lat,
    longitude: place.location.lng,
  }));

  if (coordinates.length === 0) return null;

  if (coordinates.length === 1) {
    return {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
      latitudeDelta: 0.03,
      longitudeDelta: 0.03,
    };
  }

  const latitudes = coordinates.map((coord) => coord.latitude);
  const longitudes = coordinates.map((coord) => coord.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.03),
    longitudeDelta: Math.max((maxLng - minLng) * 1.35, 0.03),
  };
}

function focusMapOnPlaces(
  mapRef: React.RefObject<MapView | null>,
  places: PlaceWithScore[],
): Region | null {
  const region = getRegionForPlaces(places);
  if (!region || !mapRef.current) return region;
  mapRef.current.animateToRegion(region, 350);
  return region;
}

export default function MapViewScreen({
  userLocation,
  typeFilter,
  places,
  onResultsChange,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchCenter = useRef<{ lat: number; lng: number } | null>(null);
  const suppressNextPlacesFit = useRef(false);

  const sanitizedIncomingPlaces = useMemo(() => sanitizePlaces(places), [places]);
  const initialRegion: Region = useMemo(
    () =>
      getRegionForPlaces(sanitizedIncomingPlaces) ?? {
        latitude: userLocation?.lat ?? DEFAULT_LAT,
        longitude: userLocation?.lng ?? DEFAULT_LNG,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      },
    [sanitizedIncomingPlaces, userLocation],
  );

  const [mapResults, setMapResults] = useState<PlaceWithScore[]>(sanitizedIncomingPlaces);
  const [selectedPlace, setSelectedPlace] = useState<PlaceWithScore | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<Region>(initialRegion);
  const [pendingSearch, setPendingSearch] = useState(false);

  const fetchForRegion = useCallback(async (region: Region) => {
    if (!isFiniteRegion(region)) return null;

    setMapLoading(true);
    try {
      const { places: nextPlaces } = await searchCuratedPlaces({
        latitude: region.latitude,
        longitude: region.longitude,
        bounds: boundsObjectFromRegion(region),
      });
      const sanitizedPlaces = sanitizePlaces(nextPlaces);
      setMapResults(sanitizedPlaces);
      return sanitizedPlaces;
    } catch {
      return null;
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    setMapResults(sanitizedIncomingPlaces);
    setSelectedPlace((currentSelectedPlace) =>
      currentSelectedPlace &&
      sanitizedIncomingPlaces.some((place) => place.place_id === currentSelectedPlace.place_id)
        ? currentSelectedPlace
        : null,
    );

    const targetRegion = getRegionForPlaces(sanitizedIncomingPlaces);
    if (targetRegion) {
      setCurrentRegion(targetRegion);
    }

    if (!mapReady || suppressNextPlacesFit.current || sanitizedIncomingPlaces.length === 0) {
      suppressNextPlacesFit.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const fittedRegion = focusMapOnPlaces(mapRef, sanitizedIncomingPlaces);
      if (fittedRegion) {
        setCurrentRegion(fittedRegion);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [mapReady, sanitizedIncomingPlaces]);

  useEffect(() => {
    if (userLocation) {
      lastSearchCenter.current = userLocation;
    }
  }, [userLocation]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const visiblePlaces = useMemo(() => {
    if (typeFilter === "Restaurantes") {
      return mapResults.filter((place) =>
        place.types.some((type) => FOOD_TYPES.has(type)),
      );
    }
    if (typeFilter === "Parques") {
      return mapResults.filter((place) =>
        place.types.some((type) => PARK_TYPES.has(type)),
      );
    }
    return mapResults;
  }, [mapResults, typeFilter]);

  const points = useMemo(
    () =>
      visiblePlaces.map((place) => ({
        type: "Feature" as const,
        properties: { cluster: false as const, place },
        geometry: {
          type: "Point" as const,
          coordinates: [place.location.lng, place.location.lat] as [number, number],
        },
      })),
    [visiblePlaces],
  );

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: boundsFromRegion(currentRegion),
    zoom: zoomFromRegion(currentRegion),
    options: { radius: 60, maxZoom: 17 },
  });

  function handleRegionChange(region: Region, details?: { isGesture?: boolean }) {
    if (!isFiniteRegion(region)) return;

    setCurrentRegion(region);

    if (details && !details.isGesture) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      if (lastSearchCenter.current) {
        const drift = haversineKm(
          lastSearchCenter.current.lat,
          lastSearchCenter.current.lng,
          region.latitude,
          region.longitude,
        );
        if (drift < 0.2) return;
      }
      setPendingSearch(true);
    }, 600);
  }

  async function handleSearchHere() {
    if (!isFiniteRegion(currentRegion)) return;

    lastSearchCenter.current = {
      lat: currentRegion.latitude,
      lng: currentRegion.longitude,
    };
    setPendingSearch(false);
    setSelectedPlace(null);

    const nextPlaces = await fetchForRegion(currentRegion);
    if (nextPlaces) {
      suppressNextPlacesFit.current = true;
      onResultsChange?.(
        currentRegion.latitude,
        currentRegion.longitude,
        nextPlaces,
        "Area do mapa",
      );
    }
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={false}
        moveOnMarkerPress={false}
        poiClickEnabled={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsIndoors={false}
        toolbarEnabled={false}
        googleRenderer="LATEST"
        googleMapId={GOOGLE_MAP_ID}
        customMapStyle={GOOGLE_MAP_ID ? undefined : MAP_STYLE}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChange}
        onPress={() => setSelectedPlace(null)}
      >
        {clusters.map((cluster) => {
          if (cluster.properties.cluster) {
            if (!supercluster) return null;
            return (
              <MarkerCluster
                key={`cluster-${cluster.id ?? cluster.properties.cluster_id}`}
                cluster={cluster as Parameters<typeof MarkerCluster>[0]["cluster"]}
                supercluster={supercluster}
                mapRef={mapRef}
              />
            );
          }

          const place = (cluster.properties as { place: PlaceWithScore }).place;
          return (
            <PlaceMarker
              key={place.place_id}
              place={place}
              onPress={setSelectedPlace}
            />
          );
        })}
      </MapView>

      {pendingSearch && !mapLoading && (
        <Pressable
          style={({ pressed }) => [
            styles.searchHereBtn,
            pressed && styles.searchHereBtnPressed,
          ]}
          onPress={handleSearchHere}
        >
          <Ionicons name="search" size={15} color="#fff" />
          <Text style={styles.searchHereBtnText}>Buscar nesta area</Text>
        </Pressable>
      )}

      {mapLoading && (
        <ActivityIndicator
          style={styles.loadingOverlay}
          size="small"
          color={Colors.primary}
        />
      )}

      <MiniCard
        place={selectedPlace}
        onDismiss={() => setSelectedPlace(null)}
        onNavigate={() => {
          if (selectedPlace) {
            router.push(`/place/${selectedPlace.place_id}`);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  searchHereBtn: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  searchHereBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  searchHereBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  loadingOverlay: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    backgroundColor: "#ffffffcc",
    borderRadius: 20,
    padding: 6,
  },
});
