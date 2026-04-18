import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  ActivityIndicator,
  TextInput,
  Linking,
  Platform,
  Alert,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  getPlaceDetails,
  getReviews,
  createReview,
  getFavorites,
  toggleFavorite,
  getBestType,
  getPhotoUrl,
  fetchPlacePhotos,
  resolvePhotoUrl,
  type PlaceDetails,
  type PlacePhoto,
  type Review,
  type KidFlags,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const KID_FLAG_LABELS: Record<keyof KidFlags, string> = {
  trocador: "Trocador de fraldas",
  cadeirao: "Cadeirão para bebê",
  banheiro_familia: "Banheiro família",
  espaco_kids: "Espaço kids",
  seguro: "Ambiente seguro",
};

const DEFAULT_FLAGS: KidFlags = {
  trocador: false,
  cadeirao: false,
  banheiro_familia: false,
  espaco_kids: false,
  seguro: false,
};

function StarSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
          <Ionicons
            name={n <= value ? "star" : "star-outline"}
            size={32}
            color={n <= value ? Colors.star : "#ccc"}
          />
        </Pressable>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 },
});

function ReviewCard({ review }: { review: Review }) {
  const flags = review.kid_flags as KidFlags;
  const activeFlags = (Object.keys(flags) as Array<keyof KidFlags>).filter(
    (k) => flags[k],
  );

  return (
    <View style={reviewStyles.card}>
      <View style={reviewStyles.header}>
        <View style={reviewStyles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Ionicons
              key={n}
              name={n <= review.rating ? "star" : "star-outline"}
              size={14}
              color={n <= review.rating ? Colors.star : "#ddd"}
            />
          ))}
        </View>
        <Text style={reviewStyles.date}>
          {new Date(review.created_at).toLocaleDateString("pt-BR")}
        </Text>
      </View>
      {activeFlags.length > 0 && (
        <View style={reviewStyles.flags}>
          {activeFlags.map((k) => (
            <View key={k} style={reviewStyles.flag}>
              <Ionicons name="checkmark-circle" size={12} color={Colors.secondary} />
              <Text style={reviewStyles.flagText}>{KID_FLAG_LABELS[k]}</Text>
            </View>
          ))}
        </View>
      )}
      {review.note ? (
        <Text style={reviewStyles.note}>{review.note}</Text>
      ) : null}
    </View>
  );
}

const reviewStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stars: { flexDirection: "row", gap: 2 },
  date: { fontSize: 12, color: Colors.textLight, fontFamily: "Inter_400Regular" },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  flag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E8F5E9",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flagText: { fontSize: 11, color: Colors.secondary, fontFamily: "Inter_500Medium" },
  note: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
});

export default function PlaceDetailsScreen() {
  const { place_id } = useLocalSearchParams<{ place_id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [reviewRating, setReviewRating] = useState(0);
  const [kidFlags, setKidFlags] = useState<KidFlags>({ ...DEFAULT_FLAGS });
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: place, isLoading: placeLoading } = useQuery<PlaceDetails>({
    queryKey: ["/api/places/details", place_id],
    queryFn: () => getPlaceDetails(place_id!),
    enabled: !!place_id,
  });

  const { data: reviews, isLoading: reviewsLoading } = useQuery<Review[]>({
    queryKey: ["/api/reviews", place_id],
    queryFn: () => getReviews(place_id!),
    enabled: !!place_id,
  });

  const { data: dbPhotos } = useQuery<PlacePhoto[]>({
    queryKey: ["/api/places/photos", place_id],
    queryFn: () => fetchPlacePhotos(place_id!),
    enabled: !!place_id,
  });

  const { data: favorites } = useQuery({
    queryKey: ["/api/favorites"],
    queryFn: getFavorites,
    enabled: !!user,
  });

  const isFavorited = favorites?.some((f) => f.place_id === place_id) ?? false;

  const favMutation = useMutation({
    mutationFn: () => toggleFavorite(place_id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const handleFavPress = () => {
    if (!user) {
      Alert.alert(
        "Login necessário",
        "Faça login para salvar favoritos.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Fazer login", onPress: () => router.push("/login") },
        ],
      );
      return;
    }
    favMutation.mutate();
  };

  const handleDirections = () => {
    if (!place) return;
    const { lat, lng } = place.location;
    const label = encodeURIComponent(place.name);
    const url = Platform.select({
      ios: `maps:?q=${label}&ll=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    Linking.openURL(url!).catch(() =>
      Alert.alert("Erro", "Não foi possível abrir o mapa."),
    );
  };

  const handleSubmitReview = async () => {
    if (!user) {
      Alert.alert(
        "Login necessário",
        "Faça login para enviar uma avaliação.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Fazer login", onPress: () => router.push("/login") },
        ],
      );
      return;
    }
    if (reviewRating === 0) {
      Alert.alert("Avaliação", "Selecione uma nota de 1 a 5 estrelas.");
      return;
    }
    setSubmitting(true);
    try {
      await createReview({
        place_id: place_id!,
        rating: reviewRating,
        kid_flags: kidFlags,
        note: reviewNote.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ["/api/reviews", place_id] });
      setReviewRating(0);
      setKidFlags({ ...DEFAULT_FLAGS });
      setReviewNote("");
    } catch {
      Alert.alert("Erro", "Não foi possível enviar a avaliação. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFlag = (key: keyof KidFlags) => {
    setKidFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  if (placeLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando detalhes...</Text>
      </View>
    );
  }

  if (!place) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text style={styles.errorText}>Lugar não encontrado.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const category = getBestType(place.types);

  const screenWidth = Dimensions.get("window").width;

  const sortedDbPhotos = dbPhotos
    ? [...dbPhotos].sort((a, b) => (b.is_cover ? 1 : 0) - (a.is_cover ? 1 : 0) || a.order - b.order)
    : [];

  const googlePhotos = (place.photos ?? [])
    .filter((p) => !!p.photo_reference)
    .slice(0, Math.max(0, 8 - sortedDbPhotos.length));

  const galleryPhotos: string[] = [
    ...sortedDbPhotos.map((p) => resolvePhotoUrl(p, 800)),
    ...googlePhotos.map((p) => getPhotoUrl(p.photo_reference!, 800)),
  ];

  const kidsAreaPhotos = sortedDbPhotos.filter((p) => p.is_kids_area).slice(0, 2);

  const avgRating =
    reviews && reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroContainer}>
        {galleryPhotos.length > 0 ? (
          <FlatList
            data={galleryPhotos}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <Image
                source={{ uri: item }}
                style={[styles.heroPhoto, { width: screenWidth }]}
                contentFit="cover"
              />
            )}
          />
        ) : (
          <View style={[styles.heroPhoto, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={64} color="#ccc" />
          </View>
        )}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{category}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.favBtn, pressed && { opacity: 0.7 }]}
          onPress={handleFavPress}
          disabled={favMutation.isPending}
        >
          <Ionicons
            name={isFavorited ? "heart" : "heart-outline"}
            size={24}
            color={isFavorited ? Colors.primary : "#555"}
          />
        </Pressable>
      </View>

      <View style={styles.content}>
        {place.is_sponsored && (
          <View style={styles.sponsoredBadge}>
            <Ionicons name="star" size={12} color="#FF6B35" />
            <Text style={styles.sponsoredText}>Parceiro KidSpot</Text>
          </View>
        )}
        <Text style={styles.placeName}>{place.name}</Text>

        <View style={styles.metaRow}>
          {place.rating != null && (
            <View style={styles.pill}>
              <Ionicons name="star" size={14} color={Colors.star} />
              <Text style={styles.pillText}>
                {place.rating.toFixed(1)}
                {place.user_ratings_total
                  ? `  (${place.user_ratings_total})`
                  : ""}
              </Text>
            </View>
          )}
          {place.opening_hours?.open_now != null && (
            <View
              style={[
                styles.pill,
                {
                  backgroundColor: place.opening_hours.open_now
                    ? "#E8F5E9"
                    : "#FFEBEE",
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={14}
                color={
                  place.opening_hours.open_now ? Colors.secondary : Colors.error
                }
              />
              <Text
                style={[
                  styles.pillText,
                  {
                    color: place.opening_hours.open_now
                      ? Colors.secondary
                      : Colors.error,
                  },
                ]}
              >
                {place.opening_hours.open_now ? "Aberto agora" : "Fechado"}
              </Text>
            </View>
          )}
        </View>

        {place.family_summary ? (
          <View style={summaryStyles.card}>
            <Text style={summaryStyles.title}>Por que é indicado para famílias</Text>
            <Text style={summaryStyles.body}>{place.family_summary}</Text>
          </View>
        ) : null}

        {kidsAreaPhotos.length > 0 && (
          <View style={styles.kidsAreaSection}>
            <View style={styles.kidsAreaHeader}>
              <Ionicons name="happy-outline" size={16} color="#059669" />
              <Text style={styles.kidsAreaTitle}>Área Kids</Text>
            </View>
            <View style={styles.kidsAreaRow}>
              {kidsAreaPhotos.map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: resolvePhotoUrl(p, 600) }}
                  style={styles.kidsAreaPhoto}
                  contentFit="cover"
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color={Colors.textSecondary} />
          <Text style={styles.infoText}>{place.formatted_address}</Text>
        </View>

        {place.formatted_phone_number && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.7 }]}
            onPress={() =>
              Linking.openURL(`tel:${place.formatted_phone_number}`)
            }
          >
            <Ionicons name="call-outline" size={16} color={Colors.textSecondary} />
            <Text style={[styles.infoText, styles.link]}>
              {place.formatted_phone_number}
            </Text>
          </Pressable>
        )}

        {place.website && (
          <Pressable
            style={({ pressed }) => [styles.infoRow, pressed && { opacity: 0.7 }]}
            onPress={() => Linking.openURL(place.website!)}
          >
            <Ionicons name="globe-outline" size={16} color={Colors.textSecondary} />
            <Text style={[styles.infoText, styles.link]} numberOfLines={1}>
              {place.website}
            </Text>
          </Pressable>
        )}

        {place.opening_hours?.weekday_text &&
          place.opening_hours.weekday_text.length > 0 && (
            <View style={styles.hoursBlock}>
              <Text style={styles.sectionLabel}>Horários</Text>
              {place.opening_hours.weekday_text.map((line, i) => (
                <Text key={i} style={styles.hoursLine}>
                  {line}
                </Text>
              ))}
            </View>
          )}

        <Pressable
          style={({ pressed }) => [
            styles.directionsBtn,
            pressed && { opacity: 0.85 },
          ]}
          onPress={handleDirections}
        >
          <Ionicons name="navigate" size={18} color="#fff" />
          <Text style={styles.directionsBtnText}>Como chegar</Text>
        </Pressable>

        <View style={styles.divider} />

        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>Avaliações KidSpot</Text>
            {avgRating != null && (
              <View style={styles.avgRating}>
                <Ionicons name="star" size={16} color={Colors.star} />
                <Text style={styles.avgRatingText}>{avgRating.toFixed(1)}</Text>
                <Text style={styles.avgRatingCount}>
                  ({reviews!.length})
                </Text>
              </View>
            )}
          </View>

          <View style={styles.reviewForm}>
            <Text style={styles.formLabel}>Deixe sua avaliação</Text>

            <StarSelector value={reviewRating} onChange={setReviewRating} />

            <Text style={styles.formSubLabel}>Recursos para crianças</Text>
            {(Object.keys(KID_FLAG_LABELS) as Array<keyof KidFlags>).map((key) => (
              <Pressable
                key={key}
                style={({ pressed }) => [
                  styles.flagRow,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => toggleFlag(key)}
              >
                <Ionicons
                  name={kidFlags[key] ? "checkbox" : "square-outline"}
                  size={22}
                  color={kidFlags[key] ? Colors.secondary : "#ccc"}
                />
                <Text style={styles.flagLabel}>{KID_FLAG_LABELS[key]}</Text>
              </Pressable>
            ))}

            <TextInput
              style={styles.noteInput}
              placeholder="Comentário opcional..."
              placeholderTextColor={Colors.textLight}
              value={reviewNote}
              onChangeText={setReviewNote}
              multiline
              maxLength={300}
            />

            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                (submitting || reviewRating === 0) && styles.submitBtnDisabled,
                pressed && { opacity: 0.85 },
              ]}
              onPress={handleSubmitReview}
              disabled={submitting || reviewRating === 0}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Enviar avaliação</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.reviewList}>
            {reviewsLoading && (
              <ActivityIndicator size="small" color={Colors.primary} />
            )}
            {!reviewsLoading && reviews && reviews.length === 0 && (
              <Text style={styles.noReviews}>
                Nenhuma avaliação ainda. Seja o primeiro!
              </Text>
            )}
            {reviews?.map((r) => <ReviewCard key={r.id} review={r} />)}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const summaryStyles = StyleSheet.create({
  card: {
    backgroundColor: "#E8F5E9",
    borderLeftWidth: 3,
    borderLeftColor: "#059669",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  title: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#059669",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#1a3c2e",
    lineHeight: 21,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
  backBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  backBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  heroContainer: {
    position: "relative",
    height: 260,
  },
  heroPhoto: {
    width: "100%",
    height: "100%",
  },
  heroPlaceholder: {
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryBadge: {
    position: "absolute",
    bottom: 14,
    left: 16,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  categoryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  favBtn: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    padding: 20,
    gap: 12,
  },
  sponsoredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFF3EF",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  sponsoredText: {
    color: "#FF6B35",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  placeName: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    lineHeight: 30,
    fontFamily: "Inter_700Bold",
  },
  metaRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.text,
    fontFamily: "Inter_500Medium",
  },
  kidsAreaSection: {
    gap: 8,
  },
  kidsAreaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kidsAreaTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#059669",
    fontFamily: "Inter_600SemiBold",
  },
  kidsAreaRow: {
    flexDirection: "row",
    gap: 8,
  },
  kidsAreaPhoto: {
    flex: 1,
    height: 120,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  link: {
    color: Colors.primary,
    textDecorationLine: "underline",
  },
  hoursBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 4,
    fontFamily: "Inter_600SemiBold",
  },
  hoursLine: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  directionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.secondary,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  directionsBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  reviewsSection: {
    gap: 16,
  },
  reviewsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  avgRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  avgRatingText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  avgRatingCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  reviewForm: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  formLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  formSubLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  flagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  flagLabel: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  noteInput: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    minHeight: 70,
    textAlignVertical: "top",
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  reviewList: {
    gap: 10,
  },
  noReviews: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    paddingVertical: 8,
  },
});
