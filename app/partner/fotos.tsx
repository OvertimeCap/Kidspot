import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import {
  fetchPartnerPhotos,
  uploadPartnerPhoto,
  setPartnerPhotoCover,
  setPartnerPhotoKidsArea,
  deletePartnerPhoto,
  resolvePhotoUrl,
  type PlacePhoto,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const MAX_PHOTOS = 8;
const MAX_KIDS_AREA = 2;

export default function PartnerFotosScreen() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const isPartner =
    user?.role === "parceiro" || user?.role === "estabelecimento";
  const placeId = user?.linked_place_id ?? null;

  const { data: photos, isLoading } = useQuery<PlacePhoto[]>({
    queryKey: ["partner-photos", placeId],
    queryFn: () => fetchPartnerPhotos(placeId!),
    enabled: !!placeId && isPartner,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["partner-photos", placeId] });
    qc.invalidateQueries({ queryKey: ["/api/places/photos", placeId] });
  };

  const uploadMutation = useMutation({
    mutationFn: (dataUri: string) => uploadPartnerPhoto(placeId!, dataUri),
    onSuccess: invalidate,
    onError: (err: Error) => Alert.alert("Erro ao enviar", err.message),
  });

  const coverMutation = useMutation({
    mutationFn: (photoId: string) => setPartnerPhotoCover(photoId),
    onSuccess: invalidate,
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const kidsAreaMutation = useMutation({
    mutationFn: ({ photoId, value }: { photoId: string; value: boolean }) =>
      setPartnerPhotoKidsArea(photoId, value),
    onSuccess: invalidate,
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) => deletePartnerPhoto(photoId),
    onSuccess: invalidate,
    onError: (err: Error) => Alert.alert("Erro ao excluir", err.message),
  });

  if (!user || !isPartner || !placeId) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={48} color={Colors.textSecondary} />
        <Text style={styles.lockedText}>
          Esta área é exclusiva para parceiros e estabelecimentos vinculados.
        </Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const photoCount = photos?.length ?? 0;
  const kidsAreaCount = photos?.filter((p) => p.is_kids_area).length ?? 0;

  const pickAndUpload = async () => {
    if (photoCount >= MAX_PHOTOS) {
      Alert.alert("Limite atingido", `Máximo de ${MAX_PHOTOS} fotos por local.`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permissão necessária", "Permita o acesso à galeria para selecionar fotos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets[0]?.base64) return;

    const asset = result.assets[0];
    const UNSUPPORTED = ["image/heic", "image/heif", "image/heics", "image/heifs"];
    const rawMime = (asset.mimeType ?? "image/jpeg").toLowerCase();
    const mimeType = UNSUPPORTED.includes(rawMime) ? "image/jpeg" : rawMime;
    const dataUri = `data:${mimeType};base64,${asset.base64}`;

    uploadMutation.mutate(dataUri);
  };

  const handleDelete = (photoId: string) => {
    Alert.alert("Excluir foto", "Deseja remover esta foto permanentemente?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => deleteMutation.mutate(photoId),
      },
    ]);
  };

  const handleToggleKids = (photo: PlacePhoto) => {
    if (!photo.is_kids_area && kidsAreaCount >= MAX_KIDS_AREA) {
      Alert.alert(
        "Limite atingido",
        `Máximo de ${MAX_KIDS_AREA} fotos de Área Kids por local.`,
      );
      return;
    }
    kidsAreaMutation.mutate({ photoId: photo.id, value: !photo.is_kids_area });
  };

  const renderPhoto = ({ item }: { item: PlacePhoto }) => {
    const isBusy =
      coverMutation.isPending ||
      kidsAreaMutation.isPending ||
      deleteMutation.isPending;

    return (
      <View style={styles.card}>
        <Image
          source={{ uri: resolvePhotoUrl(item, 400) }}
          style={styles.cardImage}
          contentFit="cover"
        />
        <View style={styles.badges}>
          {item.is_cover && (
            <View style={[styles.badge, styles.badgeCover]}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={styles.badgeText}>Capa</Text>
            </View>
          )}
          {item.is_kids_area && (
            <View style={[styles.badge, styles.badgeKids]}>
              <Ionicons name="happy-outline" size={10} color="#fff" />
              <Text style={styles.badgeText}>Kids</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          <Pressable
            style={[styles.actionBtn, item.is_cover && styles.actionBtnActive]}
            onPress={() => !item.is_cover && coverMutation.mutate(item.id)}
            disabled={isBusy || item.is_cover}
          >
            <Ionicons
              name="star-outline"
              size={16}
              color={item.is_cover ? Colors.primary : Colors.textSecondary}
            />
            <Text
              style={[
                styles.actionBtnText,
                item.is_cover && { color: Colors.primary },
              ]}
              numberOfLines={1}
            >
              Capa
            </Text>
          </Pressable>

          <Pressable
            style={[styles.actionBtn, item.is_kids_area && styles.actionBtnKidsActive]}
            onPress={() => handleToggleKids(item)}
            disabled={isBusy}
          >
            <Ionicons
              name={item.is_kids_area ? "happy" : "happy-outline"}
              size={16}
              color={item.is_kids_area ? "#059669" : Colors.textSecondary}
            />
            <Text
              style={[
                styles.actionBtnText,
                item.is_kids_area && { color: "#059669" },
              ]}
              numberOfLines={1}
            >
              Kids
            </Text>
          </Pressable>

          <Pressable
            style={styles.actionBtn}
            onPress={() => handleDelete(item.id)}
            disabled={isBusy}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.error} />
            <Text style={[styles.actionBtnText, { color: Colors.error }]} numberOfLines={1}>
              Excluir
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const placeName = user.linked_place_name ?? "Seu local";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Fotos do Local</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {placeName}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.counter}>
            {photoCount}/{MAX_PHOTOS}
          </Text>
          <Pressable
            style={[
              styles.addBtn,
              (photoCount >= MAX_PHOTOS || uploadMutation.isPending) &&
                styles.addBtnDisabled,
            ]}
            onPress={pickAndUpload}
            disabled={photoCount >= MAX_PHOTOS || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="camera-outline" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Adicionar</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : !photos || photos.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="images-outline" size={56} color={Colors.textSecondary} />
          <Text style={styles.emptyText}>Nenhuma foto ainda.</Text>
          <Text style={styles.emptySubText}>
            Adicione fotos para exibir no perfil do seu local.
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          renderItem={renderPhoto}
          ListFooterComponent={
            <Text style={styles.hint}>
              Marque até {MAX_KIDS_AREA} fotos como Kids — elas aparecem fixadas na tela do local.
            </Text>
          }
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: "#fff",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    maxWidth: 200,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  counter: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  lockedText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  emptySubText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  backBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  list: {
    padding: 12,
    gap: 12,
  },
  row: {
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardImage: {
    width: "100%",
    height: 140,
    backgroundColor: "#f0f0f0",
  },
  badges: {
    position: "absolute",
    top: 8,
    left: 8,
    gap: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeCover: {
    backgroundColor: Colors.primary,
  },
  badgeKids: {
    backgroundColor: "#059669",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  cardActions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  actionBtnActive: {
    backgroundColor: "#FFF8F0",
  },
  actionBtnKidsActive: {
    backgroundColor: "#F0FDF4",
  },
  actionBtnText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
