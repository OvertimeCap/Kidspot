import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "@/lib/query-client";
import { usePickedLocation } from "@/lib/picked-location-context";
import Colors from "@/constants/colors";

type Suggestion = { place_id: string; description: string };

async function fetchSuggestions(
  input: string,
  lat?: number,
  lng?: number,
): Promise<Suggestion[]> {
  if (input.trim().length < 2) return [];
  let route = `/api/places/autocomplete?input=${encodeURIComponent(input.trim())}`;
  if (lat != null) route += `&lat=${lat}`;
  if (lng != null) route += `&lng=${lng}`;
  const res = await apiRequest("GET", route);
  const data = await res.json();
  console.log("[autocomplete] response:", JSON.stringify(data));
  return data.suggestions ?? [];
}

async function geocodeSuggestion(
  placeId: string,
): Promise<{ lat: number; lng: number; label: string }> {
  const res = await apiRequest("GET", `/api/places/geocode?place_id=${encodeURIComponent(placeId)}`);
  return res.json();
}

export default function FiltrosSheet() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const originLat = params.lat ? parseFloat(params.lat) : undefined;
  const originLng = params.lng ? parseFloat(params.lng) : undefined;
  const { setPickedLocation } = usePickedLocation();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const results = await fetchSuggestions(text, originLat, originLng);
          setSuggestions(results);
        } catch (err) {
          console.error("[autocomplete] fetch error:", err);
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [originLat, originLng],
  );

  const handleSelect = useCallback(async (suggestion: Suggestion) => {
    setSelecting(true);
    try {
      const geo = await geocodeSuggestion(suggestion.place_id);
      setPickedLocation(geo.lat, geo.lng, geo.label);
      router.back();
    } catch {
    } finally {
      setSelecting(false);
    }
  }, []);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Escolher localização</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.inputRow}>
        <Ionicons name="search" size={18} color={Colors.textLight} style={styles.inputIcon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Digite uma cidade ou bairro..."
          placeholderTextColor={Colors.textLight}
          value={query}
          onChangeText={handleChangeText}
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading && (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.inputSpinner} />
        )}
        {!loading && query.length > 0 && (
          <Pressable onPress={() => { setQuery(""); setSuggestions([]); }} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={Colors.textLight} />
          </Pressable>
        )}
      </View>

      {query.trim().length === 0 && (
        <View style={styles.hint}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.textLight} />
          <Text style={styles.hintText}>
            Digite pelo menos 2 letras para ver sugestões de cidades no Brasil
          </Text>
        </View>
      )}

      {selecting && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.selectingText}>Carregando localização...</Text>
        </View>
      )}

      {!selecting && suggestions.length > 0 && (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.place_id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.suggestionItem, pressed && styles.suggestionPressed]}
              onPress={() => handleSelect(item)}
            >
              <Ionicons name="location-outline" size={18} color={Colors.primary} />
              <Text style={styles.suggestionText} numberOfLines={2}>
                {item.description}
              </Text>
            </Pressable>
          )}
        />
      )}

      {!selecting && query.trim().length >= 2 && !loading && suggestions.length === 0 && (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={32} color={Colors.textLight} />
          <Text style={styles.emptyText}>Nenhuma cidade encontrada</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 12,
  },
  inputIcon: {
    marginRight: 2,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  inputSpinner: {
    marginLeft: 4,
  },
  hint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textLight,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  list: {
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginLeft: 42,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  suggestionPressed: {
    backgroundColor: "#fafafa",
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 32,
  },
  selectingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
});
