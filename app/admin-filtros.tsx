import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface AppFilter {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  seasonal: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export default function AdminFiltrosScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("filter");

  const { data, isLoading } = useQuery<{ filters: AppFilter[] }>({
    queryKey: ["/api/admin/filters"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/filters");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/filters/${id}/toggle`, { active });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar filtro");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/filters"] }),
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Informe o nome do filtro");
      const res = await apiRequest("POST", "/api/admin/filters", {
        name: newName.trim(),
        icon: newIcon.trim() || "filter",
        active: true,
        seasonal: false,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar filtro");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/filters"] });
      setCreateModal(false);
      setNewName(""); setNewIcon("filter");
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const filters = data?.filters ?? [];

  function renderFilter({ item }: { item: AppFilter }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.iconCircle}>
            <Ionicons name={item.icon as never} size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            {item.seasonal && (
              <Text style={styles.seasonalBadge}>Sazonal</Text>
            )}
          </View>
          <Pressable
            onPress={() => toggleMutation.mutate({ id: item.id, active: !item.active })}
            style={[styles.toggleBtn, item.active ? styles.toggleBtnActive : styles.toggleBtnInactive]}
            disabled={toggleMutation.isPending}
          >
            <Text style={[styles.toggleBtnText, item.active ? styles.toggleBtnActiveText : styles.toggleBtnInactiveText]}>
              {item.active ? "Ativo" : "Inativo"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Filtros do App</Text>
        <Pressable onPress={() => setCreateModal(true)} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : filters.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="funnel-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhum filtro cadastrado</Text>
        </View>
      ) : (
        <FlatList
          data={filters}
          keyExtractor={(f) => f.id}
          renderItem={renderFilter}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={createModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Novo Filtro</Text>
              <Pressable onPress={() => setCreateModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>Nome</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Ex: Parques aquáticos"
              placeholderTextColor="#9CA3AF"
            />
            <Text style={styles.fieldLabel}>Ícone (Ionicons)</Text>
            <TextInput
              style={styles.input}
              value={newIcon}
              onChangeText={setNewIcon}
              placeholder="Ex: water, leaf, bicycle"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />
            <Pressable
              onPress={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              style={[styles.saveBtn, createMutation.isPending && styles.saveBtnDisabled]}
            >
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Criar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  addBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary + "15",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  seasonalBadge: { fontSize: 11, color: "#D97706", fontFamily: "Inter_500Medium", marginTop: 2 },
  toggleBtn: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, borderWidth: 1,
  },
  toggleBtnActive: { backgroundColor: "#D1FAE5", borderColor: "#059669" },
  toggleBtnInactive: { backgroundColor: "#F3F4F6", borderColor: "#D1D5DB" },
  toggleBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  toggleBtnActiveText: { color: "#059669" },
  toggleBtnInactiveText: { color: "#6B7280" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontSize: 15, color: "#6B7280", fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  fieldLabel: { fontSize: 13, color: "#374151", fontFamily: "Inter_500Medium", marginBottom: -4 },
  input: {
    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12,
    fontSize: 14, color: Colors.text, fontFamily: "Inter_400Regular", backgroundColor: "#F9FAFB",
  },
  saveBtn: {
    backgroundColor: Colors.primary, padding: 14,
    borderRadius: 10, alignItems: "center", marginTop: 8,
  },
  saveBtnDisabled: { backgroundColor: "#9CA3AF" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
