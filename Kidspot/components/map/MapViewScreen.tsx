import React, { useRef, useState, useCallback } from "react";
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
import { searchPlaces, haversineKm, type PlaceWithScore } from "@/lib/api";
import { radiusFromRegion, zoomFromRegion, boundsFromRegion } from "@/lib/map-utils";
import { FOOD_TYPES, PARK_TYPES, type UserLocation, type TypeFilter } from "@/lib/use-home-search";
import PlaceMarker from "./PlaceMarker";
import MarkerCluster from "./MarkerCluster";
import MiniCard from "./MiniCard";

/**
 * Estilo do Google Maps que oculta TODOS os POIs nativos.
 *
 * Por que regras explícitas por subtipo?
 * No Styled Maps, regras mais específicas do Google (poi.government, poi.medical,
 * poi.place_of_worship…) têm precedência sobre a regra genérica "poi" quando
 * elementType não é declarado.  Declarar `elementType: "all"` em cada subtipo
 * garante que ícone + label + geometria de marcador sejam escondidos,
 * independente de qual regra o Google considere mais específica.
 *
 * O que fica visível: ruas, bairros, água, fronteiras administrativas.
 * O que some: todas lojas, governo, saúde, culto, escola, esporte,
 *             parques (somente label/ícone — geometria verde permanece),
 *             transit (ônibus, metrô, trem, aeroporto).
 */
const MAP_STYLE = [
  // ── Regra de cobertura máxima (poi + elementType all) ────────────────────
  { featureType: "poi",                  elementType: "all",    stylers: [{ visibility: "off" }] },
  // ── Subtipos explícitos (sobrepõem qualquer default do Google) ───────────
  { featureType: "poi.attraction",       elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "poi.business",         elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "poi.government",       elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "poi.medical",          elementType: "all",    stylers: [{ visibility: "off" }] },
  // poi.park: oculta label/ícone mas mantém geometria verde (referência geográfica útil)
  { featureType: "poi.park",             elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.place_of_worship", elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "poi.school",           elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "poi.sports_complex",   elementType: "all",    stylers: [{ visibility: "off" }] },
  // ── Transit (metrô, ônibus, trem, aeroporto) ─────────────────────────────
  { featureType: "transit",              elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "transit.line",         elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "transit.station",      elementType: "all",    stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.airport", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.bus",     elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.rail",    elementType: "all", stylers: [{ visibility: "off" }] },
];

interface Props {
  userLocation: UserLocation | null;
  typeFilter: TypeFilter;
}

const DEFAULT_LAT = -23.5505; // São Paulo (fallback)
const DEFAULT_LNG = -46.6333;

export default function MapViewScreen({ userLocation, typeFilter }: Props) {
  const mapRef = useRef<MapView>(null);

  const initialRegion: Region = {
    latitude: userLocation?.lat ?? DEFAULT_LAT,
    longitude: userLocation?.lng ?? DEFAULT_LNG,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  const [mapResults, setMapResults] = useState<PlaceWithScore[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceWithScore | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<Region>(initialRegion);
  // Controla visibilidade do botão "Buscar nesta área"
  const [pendingSearch, setPendingSearch] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchCenter = useRef<{ lat: number; lng: number } | null>(null);

  // Busca locais usando o mesmo pipeline KidScore que a lista
  const fetchForRegion = useCallback(async (region: Region) => {
    setMapLoading(true);
    try {
      const places = await searchPlaces({
        latitude: region.latitude,
        longitude: region.longitude,
        radius: radiusFromRegion(region),
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
      setMapResults(places);
    } catch {
      // Falha silenciosa no mapa — o usuário pode tentar novamente
    } finally {
      setMapLoading(false);
    }
  }, []);

  // Busca inicial ao montar o componente
  React.useEffect(() => {
    fetchForRegion(initialRegion);
    if (userLocation) {
      lastSearchCenter.current = userLocation;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao mover o mapa: não busca automaticamente.
  // Exibe o botão "Buscar nesta área" quando a deriva for ≥ 200m.
  function handleRegionChange(region: Region) {
    setCurrentRegion(region);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      // Guard: ignora micro-variações de animação (< 200m)
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

  // Chamado pelo botão "Buscar nesta área"
  function handleSearchHere() {
    lastSearchCenter.current = {
      lat: currentRegion.latitude,
      lng: currentRegion.longitude,
    };
    setPendingSearch(false);
    setSelectedPlace(null);
    fetchForRegion(currentRegion);
  }

  // Filtragem client-side dos resultados pelo filtro de tipo ativo
  const visiblePlaces = mapResults.filter((p) => {
    if (typeFilter === "Restaurantes") return p.types.some((t) => FOOD_TYPES.has(t));
    if (typeFilter === "Parques") return p.types.some((t) => PARK_TYPES.has(t));
    return true;
  });

  // Pontos GeoJSON para use-supercluster
  const points = visiblePlaces.map((p) => ({
    type: "Feature" as const,
    properties: { cluster: false as const, place: p },
    geometry: {
      type: "Point" as const,
      // GeoJSON: [longitude, latitude] — ordem invertida em relação ao React Native Maps
      coordinates: [p.location.lng, p.location.lat] as [number, number],
    },
  }));

  const { clusters, supercluster } = useSupercluster({
    points,
    // ATENÇÃO: bounds espera [westLng, southLat, eastLng, northLat]
    bounds: boundsFromRegion(currentRegion),
    zoom: zoomFromRegion(currentRegion),
    options: { radius: 60, maxZoom: 17 },
  });

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        // PROVIDER_GOOGLE usa Google Maps no Android.
        // No iOS Expo Go não suporta PROVIDER_GOOGLE → usa Apple Maps como fallback.
        // Em development build no iOS, PROVIDER_GOOGLE funciona normalmente.
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}        // Blue Dot nativo
        showsMyLocationButton={false}   // botão padrão suprimido
        // CRÍTICO: "LEGACY" é obrigatório para customMapStyle funcionar.
        // O renderer "LATEST" (padrão em react-native-maps 1.14+) usa o Google Maps
        // SDK 18.0+ que descontinuou setMapStyle() / MapStyleOptions.
        // Com LATEST, customMapStyle é silenciosamente ignorado e POIs aparecem.
        // Com LEGACY, setMapStyle() funciona e o JSON de estilo é aplicado.
        googleRenderer="LEGACY"
        // Aplica em Android (PROVIDER_GOOGLE) e iOS dev build.
        // Apple Maps (iOS Expo Go) ignora silenciosamente — sem erro.
        customMapStyle={MAP_STYLE}
        onRegionChangeComplete={handleRegionChange}
        onPress={() => setSelectedPlace(null)}
      >
        {clusters.map((cluster) => {
          if (cluster.properties.cluster) {
            if (!supercluster) return null;
            return (
              <MarkerCluster
                key={`cluster-${cluster.id}`}
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

      {/* Botão "Buscar nesta área" — aparece após pan/zoom ≥ 200m */}
      {pendingSearch && !mapLoading && (
        <Pressable
          style={({ pressed }) => [
            styles.searchHereBtn,
            pressed && styles.searchHereBtnPressed,
          ]}
          onPress={handleSearchHere}
        >
          <Ionicons name="search" size={15} color="#fff" />
          <Text style={styles.searchHereBtnText}>Buscar nesta área</Text>
        </Pressable>
      )}

      {/* Indicador de loading ao re-buscar */}
      {mapLoading && (
        <ActivityIndicator
          style={styles.loadingOverlay}
          size="small"
          color={Colors.primary}
        />
      )}

      {/* Mini-card deslizante — sempre montado, animado internamente */}
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
