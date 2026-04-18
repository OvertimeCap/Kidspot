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

interface KidscoreRule {
  id: string;
  key: string;
  label: string;
  weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function AdminKidscoreScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [editModal, setEditModal] = useState<KidscoreRule | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editActive, setEditActive] = useState(true);

  const { data, isLoading } = useQuery<{ rules: KidscoreRule[] }>({
    queryKey: ["/api/admin/kidscore-rules"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/kidscore-rules");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, weight, is_active }: { id: string; weight: number; is_active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/kidscore-rules/${id}`, { weight, is_active });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar regra");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/kidscore-rules"] });
      setEditModal(null);
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function openEdit(rule: KidscoreRule) {
    setEditModal(rule);
    setEditWeight(String(rule.weight));
    setEditActive(rule.is_active);
  }

  function handleSave() {
    if (!editModal) return;
    const weight = parseInt(editWeight, 10);
    if (isNaN(weight)) {
      Alert.alert("Erro", "Peso deve ser um número inteiro");
      return;
    }
    updateMutation.mutate({ id: editModal.id, weight, is_active: editActive });
  }

  const rules = data?.rules ?? [];

  function renderRule({ item }: { item: KidscoreRule }) {
    return (
      <Pressable onPress={() => openEdit(item)} style={styles.card}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardKey}>{item.key}</Text>
          </View>
          <View style={styles.cardRight}>
            <View style={styles.weightBadge}>
              <Text style={styles.weightText}>{item.weight > 0 ? "+" : ""}{item.weight}</Text>
            </View>
            <View style={[styles.statusBadge, item.is_active ? styles.statusActive : styles.statusInactive]}>
              <Text style={[styles.statusText, item.is_active ? styles.statusActiveText : styles.statusInactiveText]}>
                {item.is_active ? "Ativo" : "Inativo"}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Regras KidScore</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : rules.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="star-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhuma regra cadastrada</Text>
        </View>
      ) : (
        <FlatList
          data={rules}
          keyExtractor={(r) => r.id}
          renderItem={renderRule}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={!!editModal}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Editar Regra</Text>
              <Pressable onPress={() => setEditModal(null)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            {editModal && (
              <>
                <Text style={styles.ruleLabel}>{editModal.label}</Text>
                <Text style={styles.ruleKey}>{editModal.key}</Text>

                <Text style={styles.fieldLabel}>Peso (pontos)</Text>
                <TextInput
                  style={styles.input}
                  value={editWeight}
                  onChangeText={setEditWeight}
                  placeholder="Ex: 10, -5, 0"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />

                <Pressable
                  onPress={() => setEditActive(!editActive)}
                  style={styles.toggleRow}
                >
                  <Text style={styles.toggleLabel}>Regra ativa</Text>
                  <View style={[styles.toggle, editActive && styles.toggleOn]}>
                    <View style={[styles.toggleThumb, editActive && styles.toggleThumbOn]} />
                  </View>
                </Pressable>

                <Pressable
                  onPress={handleSave}
                  disabled={updateMutation.isPending}
                  style={[styles.saveBtn, updateMutation.isPending && styles.saveBtnDisabled]}
                >
                  {updateMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Salvar</Text>
                  )}
                </Pressable>
              </>
            )}
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
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardKey: { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_400Regular", marginTop: 2 },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  weightBadge: {
    backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  weightText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#2563EB" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusActive: { backgroundColor: "#D1FAE5" },
  statusInactive: { backgroundColor: "#F3F4F6" },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statusActiveText: { color: "#059669" },
  statusInactiveText: { color: "#6B7280" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontSize: 15, color: "#6B7280", fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  ruleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  ruleKey: { fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" },
  fieldLabel: { fontSize: 13, color: "#374151", fontFamily: "Inter_500Medium", marginBottom: -4 },
  input: {
    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12,
    fontSize: 14, color: Colors.text, fontFamily: "Inter_400Regular", backgroundColor: "#F9FAFB",
  },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  toggle: {
    width: 44, height: 24, borderRadius: 12, backgroundColor: "#D1D5DB", padding: 2,
  },
  toggleOn: { backgroundColor: Colors.primary },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
  },
  toggleThumbOn: { transform: [{ translateX: 20 }] },
  saveBtn: {
    backgroundColor: Colors.primary, padding: 14,
    borderRadius: 10, alignItems: "center", marginTop: 8,
  },
  saveBtnDisabled: { backgroundColor: "#9CA3AF" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
