import React from "react";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  getFavorites,
  getPlaceDetails,
  toggleFavorite,
  getBestType,
  getPhotoUrl,
  type PlaceDetails,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function FavoriteCard({
  placeId,
  onRemove,
}: {
  placeId: string;
  onRemove: () => void;
}) {
  const { data: place, isLoading } = useQuery<PlaceDetails>({
    queryKey: ["/api/places/details", placeId],
    queryFn: () => getPlaceDetails(placeId),
  });

  if (isLoading) {
    return (
      <View style={styles.cardLoading}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  if (!place) return null;

  const photoUrl =
    place.photos && place.photos.length > 0
      ? getPhotoUrl(place.photos[0].photo_reference, 600)
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
        <Pressable
          style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.7 }]}
          onPress={onRemove}
          hitSlop={8}
        >
          <Ionicons name="heart" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.placeName} numberOfLines={1}>
          {place.name}
        </Text>
        {place.rating != null && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={13} color={Colors.star} />
            <Text style={styles.ratingText}>{place.rating.toFixed(1)}</Text>
          </View>
        )}
        <Text style={styles.address} numberOfLines={1}>
          {place.formatted_address}
        </Text>
      </View>
    </Pressable>
  );
}

export default function FavoritosScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: favorites, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/favorites"],
    queryFn: getFavorites,
    enabled: !!user,
  });

  const removeMutation = useMutation({
    mutationFn: (placeId: string) => toggleFavorite(placeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Meus Favoritos</Text>
          <Ionicons name="heart" size={24} color={Colors.primary} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={64} color={Colors.border} />
          <Text style={styles.emptyTitle}>Login necessário</Text>
          <Text style={styles.emptySubtitle}>
            Faça login para salvar e ver seus{"\n"}lugares favoritos
          </Text>
          <Pressable
            style={({ pressed }) => [styles.goSearchBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/login")}
          >
            <Ionicons name="log-in-outline" size={16} color="#fff" />
            <Text style={styles.goSearchText}>Fazer login</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meus Favoritos</Text>
        <Ionicons name="heart" size={24} color={Colors.primary} />
      </View>

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando favoritos...</Text>
        </View>
      )}

      {!isLoading && error && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>Erro ao carregar favoritos.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            onPress={() => refetch()}
          >
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && (
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.place_id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 100 }]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="heart-outline" size={64} color={Colors.border} />
              <Text style={styles.emptyTitle}>Nenhum favorito ainda</Text>
              <Text style={styles.emptySubtitle}>
                Busque lugares na aba Início e{"\n"}adicione seus favoritos!
              </Text>
              <Pressable
                style={({ pressed }) => [styles.goSearchBtn, pressed && { opacity: 0.8 }]}
                onPress={() => router.push("/")}
              >
                <Ionicons name="search" size={16} color="#fff" />
                <Text style={styles.goSearchText}>Buscar lugares</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <FavoriteCard
              placeId={item.place_id}
              onRemove={() => removeMutation.mutate(item.place_id)}
            />
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
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
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
  },
  errorText: {
    color: Colors.error,
    fontSize: 15,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 4,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  listContent: {
    padding: 16,
    gap: 14,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  goSearchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  goSearchText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  cardLoading: {
    height: 80,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
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
    height: 150,
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
  removeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 14,
    gap: 5,
  },
  placeName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
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
  address: {
    fontSize: 12,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
});
