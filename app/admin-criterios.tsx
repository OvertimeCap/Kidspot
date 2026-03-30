import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Switch,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface CustomCriterion {
  id: string;
  key: string;
  label: string;
  field_type: "boolean" | "number" | "text";
  show_in_filter: boolean;
  is_active: boolean;
  created_at: string;
}

type FieldType = "boolean" | "number" | "text";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  boolean: "Sim/Não",
  number: "Numérico",
  text: "Texto",
};

const FIELD_TYPE_ICONS: Record<FieldType, React.ComponentProps<typeof Ionicons>["name"]> = {
  boolean: "toggle-outline",
  number: "calculator-outline",
  text: "text-outline",
};

export default function AdminCriteriosScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const isAdmin = user?.role === "admin";

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("boolean");
  const [newShowInFilter, setNewShowInFilter] = useState(true);

  const { data, isLoading, isError, refetch } = useQuery<{ criteria: CustomCriterion[] }>({
    queryKey: ["/api/admin/custom-criteria"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      key: string;
      label: string;
      field_type: FieldType;
      show_in_filter: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/admin/custom-criteria", payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao criar critério");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] });
      setShowCreateForm(false);
      setNewKey("");
      setNewLabel("");
      setNewFieldType("boolean");
      setNewShowInFilter(true);
      Alert.alert("Sucesso", "Critério criado com sucesso.");
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/custom-criteria/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao excluir critério");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] });
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; is_active?: boolean; show_in_filter?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/custom-criteria/${id}`, patch);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao atualizar critério");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/custom-criteria"] });
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  function handleCreate() {
    const trimmedKey = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    const trimmedLabel = newLabel.trim();

    if (!trimmedKey || !trimmedLabel) {
      Alert.alert("Atenção", "Preencha o nome técnico e o rótulo do critério.");
      return;
    }

    if (!/^[a-z_]+$/.test(trimmedKey)) {
      Alert.alert("Chave inválida", "A chave deve conter apenas letras minúsculas e underscores (_).");
      return;
    }

    createMutation.mutate({
      key: trimmedKey,
      label: trimmedLabel,
      field_type: newFieldType,
      show_in_filter: newShowInFilter,
    });
  }

  function handleDelete(item: CustomCriterion) {
    Alert.alert(
      "Excluir critério",
      `Excluir "${item.label}"? Esta ação não pode ser desfeita e pode afetar reviews existentes.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => deleteMutation.mutate(item.id),
        },
      ]
    );
  }

  function renderCriterion({ item }: { item: CustomCriterion }) {
    const typeColor: Record<FieldType, string> = {
      boolean: "#059669",
      number: "#2563EB",
      text: "#7C3AED",
    };
    const color = typeColor[item.field_type] ?? Colors.textSecondary;

    return (
      <View style={[styles.criterionCard, !item.is_active && styles.criterionCardInactive]}>
        <View style={styles.criterionTop}>
          <View style={styles.criterionInfo}>
            <View style={[styles.typeChip, { backgroundColor: color + "15" }]}>
              <Ionicons name={FIELD_TYPE_ICONS[item.field_type]} size={12} color={color} />
              <Text style={[styles.typeChipText, { color }]}>
                {FIELD_TYPE_LABELS[item.field_type]}
              </Text>
            </View>
            <Text style={[styles.criterionLabel, !item.is_active && styles.criterionLabelInactive]}>
              {item.label}
            </Text>
            <Text style={styles.criterionKey}>{item.key}</Text>
          </View>

          {isAdmin && (
            <Pressable
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              onPress={() => handleDelete(item)}
              disabled={deleteMutation.isPending}
            >
              <Ionicons name="trash-outline" size={18} color={Colors.error} />
            </Pressable>
          )}
        </View>

        <View style={styles.criterionToggles}>
          <View style={styles.toggleRow}>
            <Ionicons
              name={item.show_in_filter ? "filter" : "filter-outline"}
              size={14}
              color={item.show_in_filter ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.toggleLabel, item.show_in_filter && styles.toggleLabelActive]}>
              Aparece nos filtros do app
            </Text>
            {isAdmin && (
              <Switch
                value={item.show_in_filter}
                onValueChange={(v) => patchMutation.mutate({ id: item.id, show_in_filter: v })}
                trackColor={{ false: "#D1D5DB", true: Colors.primary + "60" }}
                thumbColor={item.show_in_filter ? Colors.primary : "#9CA3AF"}
                style={styles.toggleSwitch}
              />
            )}
          </View>

          <View style={styles.toggleRow}>
            <Ionicons
              name={item.is_active ? "checkmark-circle" : "close-circle-outline"}
              size={14}
              color={item.is_active ? "#059669" : Colors.textSecondary}
            />
            <Text style={[styles.toggleLabel, item.is_active && styles.toggleLabelGreen]}>
              {item.is_active ? "Ativo" : "Inativo"}
            </Text>
            {isAdmin && (
              <Switch
                value={item.is_active}
                onValueChange={(v) => patchMutation.mutate({ id: item.id, is_active: v })}
                trackColor={{ false: "#D1D5DB", true: "#05966960" }}
                thumbColor={item.is_active ? "#059669" : "#9CA3AF"}
                style={styles.toggleSwitch}
              />
            )}
          </View>
        </View>
      </View>
    );
  }

  const criteria = data?.criteria ?? [];

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Critérios Customizados</Text>
        {isAdmin && (
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
            onPress={() => setShowCreateForm((v) => !v)}
          >
            <Ionicons
              name={showCreateForm ? "close" : "add"}
              size={24}
              color={Colors.primary}
            />
          </Pressable>
        )}
        {!isAdmin && <View style={{ width: 40 }} />}
      </View>

      <FlatList
        data={criteria}
        keyExtractor={(c) => c.id}
        renderItem={renderCriterion}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={
          <>
            {showCreateForm && isAdmin && (
              <View style={styles.createForm}>
                <View style={styles.createFormHeader}>
                  <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                  <Text style={styles.createFormTitle}>Novo Critério</Text>
                </View>

                <Text style={styles.fieldLabel}>Chave técnica (ex: aceita_pet)</Text>
                <TextInput
                  style={styles.formInput}
                  value={newKey}
                  onChangeText={(t) => setNewKey(t.toLowerCase().replace(/[^a-z_\s]/g, ""))}
                  placeholder="chave_tecnica"
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.fieldLabel}>Rótulo visível (ex: Aceita Pet)</Text>
                <TextInput
                  style={styles.formInput}
                  value={newLabel}
                  onChangeText={setNewLabel}
                  placeholder="Nome para exibir ao usuário"
                  placeholderTextColor={Colors.textSecondary}
                />

                <Text style={styles.fieldLabel}>Tipo do campo</Text>
                <View style={styles.typeRow}>
                  {(["boolean", "number", "text"] as FieldType[]).map((ft) => {
                    const selected = newFieldType === ft;
                    return (
                      <Pressable
                        key={ft}
                        style={({ pressed }) => [
                          styles.typeOption,
                          selected && styles.typeOptionSelected,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => setNewFieldType(ft)}
                      >
                        <Ionicons
                          name={FIELD_TYPE_ICONS[ft]}
                          size={16}
                          color={selected ? Colors.primary : Colors.textSecondary}
                        />
                        <Text
                          style={[
                            styles.typeOptionText,
                            selected && styles.typeOptionTextSelected,
                          ]}
                        >
                          {FIELD_TYPE_LABELS[ft]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.filterToggleRow}>
                  <View style={styles.filterToggleInfo}>
                    <Ionicons name="filter-outline" size={16} color={Colors.textSecondary} />
                    <Text style={styles.filterToggleLabel}>Aparece nos filtros do app</Text>
                  </View>
                  <Switch
                    value={newShowInFilter}
                    onValueChange={setNewShowInFilter}
                    trackColor={{ false: "#D1D5DB", true: Colors.primary + "60" }}
                    thumbColor={newShowInFilter ? Colors.primary : "#9CA3AF"}
                  />
                </View>

                <View style={styles.createActions}>
                  <Pressable
                    style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => setShowCreateForm(false)}
                  >
                    <Text style={styles.cancelBtnText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.createBtn,
                      pressed && { opacity: 0.75 },
                      createMutation.isPending && { opacity: 0.6 },
                    ]}
                    onPress={handleCreate}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="add" size={16} color="#fff" />
                        <Text style={styles.createBtnText}>Criar Critério</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
              <Text style={styles.infoText}>
                Critérios customizados aparecerão na Fila de Curadoria e nos filtros do app.
                {!isAdmin && " Apenas administradores podem criar ou excluir critérios."}
              </Text>
            </View>

            {isLoading && (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            )}

            {isError && (
              <Pressable onPress={() => refetch()} style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={24} color={Colors.error} />
                <Text style={styles.errorText}>Erro ao carregar critérios. Toque para tentar novamente.</Text>
              </Pressable>
            )}

            {!isLoading && !isError && criteria.length > 0 && (
              <Text style={styles.countLabel}>
                {criteria.length} critério{criteria.length !== 1 ? "s" : ""} cadastrado{criteria.length !== 1 ? "s" : ""}
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          !isLoading && !isError ? (
            <View style={styles.centered}>
              <Ionicons name="options-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>Nenhum critério customizado</Text>
              {isAdmin && (
                <Pressable
                  style={({ pressed }) => [styles.emptyCreateBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => setShowCreateForm(true)}
                >
                  <Ionicons name="add" size={16} color={Colors.primary} />
                  <Text style={styles.emptyCreateBtnText}>Criar primeiro critério</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    flex: 1,
    textAlign: "center",
  },
  addBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  createForm: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    gap: 12,
    marginBottom: 10,
  },
  createFormHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  createFormTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    marginBottom: -4,
  },
  formInput: {
    backgroundColor: "#F8F8F8",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8F8F8",
  },
  typeOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "10",
  },
  typeOptionText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  typeOptionTextSelected: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  filterToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  filterToggleInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterToggleLabel: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  createActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    paddingTop: 4,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  createBtnText: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    marginBottom: 4,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: "#1E40AF",
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
  countLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  criterionCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 12,
  },
  criterionCardInactive: {
    backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB",
  },
  criterionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  criterionInfo: {
    flex: 1,
    gap: 4,
  },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  typeChipText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  criterionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  criterionLabelInactive: {
    color: Colors.textSecondary,
    textDecorationLine: "line-through",
  },
  criterionKey: {
    fontSize: 11,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: Colors.error + "10",
  },
  criterionToggles: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  toggleLabelActive: {
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
  },
  toggleLabelGreen: {
    color: "#059669",
    fontFamily: "Inter_500Medium",
  },
  toggleSwitch: {
    transform: [{ scale: 0.85 }],
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  errorBox: {
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  emptyCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    marginTop: 8,
  },
  emptyCreateBtnText: {
    fontSize: 14,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
  },
});
