import { useState, useCallback, useEffect, useRef } from "react";
import * as Location from "expo-location";
import { searchCuratedPlaces, haversineKm, type PlaceWithScore } from "@/lib/api";
import { usePickedLocation } from "@/lib/picked-location-context";

export type UserLocation = { lat: number; lng: number };
export type TypeFilter = "Todos" | "Restaurantes" | "Parques";

export const FOOD_TYPES = new Set([
  "restaurant",
  "cafe",
  "bakery",
  "meal_takeaway",
  "food",
]);
export const PARK_TYPES = new Set([
  "park",
  "playground",
  "amusement_center",
  "amusement_park",
  "zoo",
  "tourist_attraction",
]);

export interface HomeSearchState {
  results: PlaceWithScore[];
  filteredResults: PlaceWithScore[];
  userLocation: UserLocation | null;
  activeLabel: string | null;
  typeFilter: TypeFilter;
  setTypeFilter: (f: TypeFilter) => void;
  loading: boolean;
  error: string | null;
  locationDenied: boolean;
  searched: boolean;
  doSearch: (lat: number, lng: number, label?: string) => Promise<void>;
  handleSearchNearby: () => Promise<void>;
  syncMapResults: (lat: number, lng: number, places: PlaceWithScore[], label?: string) => void;
}

export function useHomeSearch(): HomeSearchState {
  const { pickedLocation } = usePickedLocation();

  const [results, setResults] = useState<PlaceWithScore[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("Todos");

  const didAutoSearch = useRef(false);

  const filteredResults = results.filter((place) => {
    if (typeFilter === "Restaurantes")
      return place.types.some((t) => FOOD_TYPES.has(t));
    if (typeFilter === "Parques")
      return place.types.some((t) => PARK_TYPES.has(t));
    return true;
  });

  const doSearch = useCallback(
    async (lat: number, lng: number, label?: string) => {
      setLoading(true);
      setError(null);
      setTypeFilter("Todos");
      try {
        const { places, city_name } = await searchCuratedPlaces({
          latitude: lat,
          longitude: lng,
        });
        setResults(places);
        setSearched(true);
        setUserLocation({ lat, lng });
        setActiveLabel(label ?? city_name ?? null);
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

  const syncMapResults = useCallback(
    (lat: number, lng: number, places: PlaceWithScore[], label?: string) => {
      setResults(places);
      setUserLocation({ lat, lng });
      setSearched(true);
      if (label !== undefined) {
        setActiveLabel(label);
      }
    },
    [],
  );

  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    handleSearchNearby();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pickedLocation) {
      setActiveLabel(pickedLocation.label);
      doSearch(pickedLocation.lat, pickedLocation.lng, pickedLocation.label);
    }
  }, [pickedLocation, doSearch]);

  return {
    results,
    filteredResults,
    userLocation,
    activeLabel,
    typeFilter,
    setTypeFilter,
    loading,
    error,
    locationDenied,
    searched,
    doSearch,
    handleSearchNearby,
    syncMapResults,
  };
}

// Re-export haversineKm for use in map components without importing api.ts directly
export { haversineKm };
