import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { createStory } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function CreateStoryScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isPartner =
    user?.role === "parceiro" || user?.role === "estabelecimento";
  const hasLinkedPlace = !!(user?.linked_place_id);

  if (!isPartner || !hasLinkedPlace) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={48} color={Colors.textLight} />
        <Text style={styles.noAccessText}>
          Apenas parceiros e estabelecimentos com local vinculado podem publicar stories.
        </Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const pickPhotos = async () => {
    if (photos.length >= 10) {
      Alert.alert("Limite atingido", "Você pode adicionar no máximo 10 fotos.");
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permissão necessária", "Permita o acesso à galeria para selecionar fotos.");
      return;
    }

    const remaining = 10 - photos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled) return;

    const newPhotos = result.assets
      .filter((a) => a.base64)
      .map((a) => {
        const mimeType = a.mimeType ?? "image/jpeg";
        return `data:${mimeType};base64,${a.base64}`;
      });

    setPhotos((prev) => [...prev, ...newPhotos].slice(0, 10));
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (photos.length === 0) {
      Alert.alert("Sem fotos", "Adicione pelo menos uma foto.");
      return;
    }

    setSubmitting(true);
    try {
      await createStory(photos);
      Alert.alert("Sucesso", "Story publicado com sucesso!", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Erro", (err as Error).message ?? "Não foi possível publicar o story.");
    } finally {
      setSubmitting(false);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Novo Story</Text>
        <View style={{ width: 36 }} />
      </View>

      {user?.linked_place_name && (
        <View style={styles.placeInfo}>
          <Ionicons name="location" size={14} color={Colors.primary} />
          <Text style={styles.placeName} numberOfLines={1}>
            {user.linked_place_name}
          </Text>
        </View>
      )}

      <View style={styles.hint}>
        <Text style={styles.hintText}>
          Selecione até {10 - photos.length} foto{10 - photos.length !== 1 ? "s" : ""} da galeria.
          O story ficará disponível por 24 horas.
        </Text>
      </View>

      <FlatList
        data={photos}
        keyExtractor={(_, index) => String(index)}
        numColumns={3}
        contentContainerStyle={styles.grid}
        ListFooterComponent={
          photos.length < 10 ? (
            <Pressable style={styles.addPhotoBtn} onPress={pickPhotos}>
              <Ionicons name="add-circle-outline" size={36} color={Colors.primary} />
              <Text style={styles.addPhotoBtnText}>Adicionar</Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View style={styles.thumbContainer}>
            <Image source={{ uri: item }} style={styles.thumb} contentFit="cover" />
            <Pressable
              style={styles.removeBtn}
              onPress={() => removePhoto(index)}
            >
              <Ionicons name="close-circle" size={22} color="#fff" />
            </Pressable>
            <View style={styles.thumbOrder}>
              <Text style={styles.thumbOrderText}>{index + 1}</Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <Pressable
          style={[
            styles.submitBtn,
            (photos.length === 0 || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={photos.length === 0 || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Publicar Story</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const THUMB_SIZE = "30%";

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
    gap: 16,
    backgroundColor: Colors.background,
  },
  noAccessText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
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
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBack: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  placeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFF5EE",
  },
  placeName: {
    fontSize: 13,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  hint: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hintText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  grid: {
    padding: 8,
    gap: 6,
  },
  thumbContainer: {
    width: THUMB_SIZE,
    aspectRatio: 1,
    margin: "1.5%",
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#f0f0f0",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 11,
  },
  thumbOrder: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOrderText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  addPhotoBtn: {
    width: THUMB_SIZE,
    aspectRatio: 1,
    margin: "1.5%",
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#FFF5EE",
  },
  addPhotoBtnText: {
    fontSize: 12,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  submitBtnDisabled: {
    backgroundColor: "#ccc",
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
