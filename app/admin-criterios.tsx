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

type FieldType = "boolean" | "number" | "text";

interface CustomCriterion {
  id: string;
  key: string;
  label: string;
  field_type: FieldType;
  show_in_filter: boolean;
  is_active: boolean;
  created_at: string;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  boolean: "Booleano",
  number: "Número",
  text: "Texto",
};

export default function AdminCriteriosScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [createModal, setCreateModal] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("boolean");
  const [newShowFilter, setNewShowFilter] = useState(true);

  const { data, isLoading } = useQuery<{ criteria: CustomCriterion[] }>({
    queryKey: ["/api/admin/custom-criteria"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/custom-criteria");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/custom-criteria/${id}`, { is_active });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar critério");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] }),
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/custom-criteria/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao excluir critério");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] }),
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newKey.trim() || !newLabel.trim()) throw new Error("Preencha todos os campos");
      const res = await apiRequest("POST", "/api/admin/custom-criteria", {
        key: newKey.trim().toLowerCase().replace(/\s+/g, "_"),
        label: newLabel.trim(),
        field_type: newType,
        show_in_filter: newShowFilter,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar critério");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] });
      setCreateModal(false);
      setNewKey(""); setNewLabel(""); setNewType("boolean"); setNewShowFilter(true);
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function confirmDelete(item: CustomCriterion) {
    Alert.alert(
      "Excluir Critério",
      `Deseja excluir "${item.label}"? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir", style: "destructive", onPress: () => deleteMutation.mutate(item.id) },
      ],
    );
  }

  const criteria = data?.criteria ?? [];

  function renderItem({ item }: { item: CustomCriterion }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardKey}>{item.key}</Text>
          </View>
          <View style={styles.badges}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{FIELD_TYPE_LABELS[item.field_type as FieldType]}</Text>
            </View>
            {item.show_in_filter && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterText}>Filtro</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => toggleMutation.mutate({ id: item.id, is_active: !item.is_active })}
            style={[styles.toggleBtn, item.is_active ? styles.toggleBtnActive : styles.toggleBtnInactive]}
            disabled={toggleMutation.isPending}
          >
            <Text style={[styles.toggleBtnText, item.is_active ? styles.toggleBtnActiveText : styles.toggleBtnInactiveText]}>
              {item.is_active ? "Ativo" : "Inativo"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => confirmDelete(item)}
            style={styles.deleteBtn}
            disabled={deleteMutation.isPending}
          >
            <Ionicons name="trash-outline" size={16} color="#DC2626" />
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
        <Text style={styles.headerTitle}>Critérios Personalizados</Text>
        <Pressable onPress={() => setCreateModal(true)} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : criteria.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="options-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhum critério cadastrado</Text>
        </View>
      ) : (
        <FlatList
          data={criteria}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
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
              <Text style={styles.modalTitle}>Novo Critério</Text>
              <Pressable onPress={() => setCreateModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Chave (snake_case)</Text>
            <TextInput
              style={styles.input}
              value={newKey}
              onChangeText={setNewKey}
              placeholder="Ex: area_criancas"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Rótulo (exibição)</Text>
            <TextInput
              style={styles.input}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Ex: Área para crianças"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Tipo de Campo</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["boolean", "number", "text"] as FieldType[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setNewType(t)}
                  style={[styles.typeChip, newType === t && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, newType === t && styles.typeChipTextActive]}>
                    {FIELD_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => setNewShowFilter(!newShowFilter)}
              style={styles.toggleRow}
            >
              <Text style={styles.toggleLabel}>Mostrar no filtro do app</Text>
              <View style={[styles.toggle, newShowFilter && styles.toggleOn]}>
                <View style={[styles.toggleThumb, newShowFilter && styles.toggleThumbOn]} />
              </View>
            </Pressable>

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
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, gap: 10,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardKey: { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 2 },
  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
  typeBadge: { backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  typeText: { fontSize: 11, color: "#2563EB", fontFamily: "Inter_600SemiBold" },
  filterBadge: { backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  filterText: { fontSize: 11, color: "#D97706", fontFamily: "Inter_600SemiBold" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center",
  },
  toggleBtnActive: { backgroundColor: "#D1FAE5", borderColor: "#059669" },
  toggleBtnInactive: { backgroundColor: "#F3F4F6", borderColor: "#D1D5DB" },
  toggleBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  toggleBtnActiveText: { color: "#059669" },
  toggleBtnInactiveText: { color: "#6B7280" },
  deleteBtn: {
    width: 36, height: 36, alignItems: "center", justifyContent: "center",
    backgroundColor: "#FEF2F2", borderRadius: 8,
  },
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
  typeChip: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  typeChipActive: { backgroundColor: Colors.primary + "15", borderColor: Colors.primary },
  typeChipText: { fontSize: 13, color: "#6B7280", fontFamily: "Inter_500Medium" },
  typeChipTextActive: { color: Colors.primary, fontFamily: "Inter_600SemiBold" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: "#D1D5DB", padding: 2 },
  toggleOn: { backgroundColor: Colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleThumbOn: { transform: [{ translateX: 20 }] },
  saveBtn: {
    backgroundColor: Colors.primary, padding: 14,
    borderRadius: 10, alignItems: "center", marginTop: 8,
  },
  saveBtnDisabled: { backgroundColor: "#9CA3AF" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
