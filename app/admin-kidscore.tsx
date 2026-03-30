import React, { useState, useEffect } from "react";
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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface KidscoreRule {
  id: string;
  key: string;
  label: string;
  weight: number;
  is_active: boolean;
  updated_at: string;
}

interface LocalRule extends KidscoreRule {
  weight_text: string;
  dirty: boolean;
}

export default function AdminKidscoreScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const isAdmin = user?.role === "admin";

  const [localRules, setLocalRules] = useState<LocalRule[]>([]);
  const [hasDirty, setHasDirty] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ rules: KidscoreRule[] }>({
    queryKey: ["/api/admin/kidscore-rules"],
  });

  useEffect(() => {
    if (data?.rules) {
      setLocalRules(
        data.rules.map((r) => ({
          ...r,
          weight_text: String(r.weight),
          dirty: false,
        }))
      );
      setHasDirty(false);
    }
  }, [data?.rules]);

  const saveMutation = useMutation({
    mutationFn: async (rules: Array<{ id: string; weight: number; is_active: boolean }>) => {
      const res = await apiRequest("PUT", "/api/admin/kidscore-rules", { rules });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao salvar regras");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/kidscore-rules"] });
      setHasDirty(false);
      Alert.alert("Sucesso", "Regras de ranqueamento atualizadas com sucesso.");
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  function updateWeight(id: string, text: string) {
    setLocalRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, weight_text: text, dirty: true } : r
      )
    );
    setHasDirty(true);
  }

  function updateActive(id: string, value: boolean) {
    setLocalRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, is_active: value, dirty: true } : r
      )
    );
    setHasDirty(true);
  }

  function handleSave() {
    const invalid = localRules.find(
      (r) => r.dirty && (isNaN(parseInt(r.weight_text, 10)) || parseInt(r.weight_text, 10) < 0)
    );
    if (invalid) {
      Alert.alert("Peso inválido", `O peso de "${invalid.label}" deve ser um número inteiro ≥ 0.`);
      return;
    }

    const dirtyRules = localRules
      .filter((r) => r.dirty)
      .map((r) => ({
        id: r.id,
        weight: parseInt(r.weight_text, 10),
        is_active: r.is_active,
      }));

    if (dirtyRules.length === 0) return;

    Alert.alert(
      "Salvar alterações",
      `Salvar ${dirtyRules.length} alteração${dirtyRules.length > 1 ? "s" : ""} no motor de ranqueamento?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Salvar", onPress: () => saveMutation.mutate(dirtyRules) },
      ]
    );
  }

  function handleDiscard() {
    if (data?.rules) {
      setLocalRules(
        data.rules.map((r) => ({
          ...r,
          weight_text: String(r.weight),
          dirty: false,
        }))
      );
      setHasDirty(false);
    }
  }

  function renderRule({ item }: { item: LocalRule }) {
    return (
      <View style={[styles.ruleCard, item.dirty && styles.ruleCardDirty]}>
        <View style={styles.ruleTop}>
          <View style={styles.ruleLabelContainer}>
            {item.dirty && (
              <View style={styles.dirtyDot} />
            )}
            <Text style={[styles.ruleLabel, !item.is_active && styles.ruleLabelInactive]}>
              {item.label}
            </Text>
          </View>
          {isAdmin && (
            <Switch
              value={item.is_active}
              onValueChange={(v) => updateActive(item.id, v)}
              trackColor={{ false: "#D1D5DB", true: Colors.primary + "60" }}
              thumbColor={item.is_active ? Colors.primary : "#9CA3AF"}
            />
          )}
        </View>

        <View style={styles.ruleBottom}>
          <Text style={styles.ruleKeyText}>{item.key}</Text>
          <View style={styles.weightRow}>
            <Text style={styles.weightLabel}>Peso:</Text>
            {isAdmin ? (
              <TextInput
                style={[styles.weightInput, !item.is_active && styles.weightInputInactive]}
                value={item.weight_text}
                onChangeText={(text) => updateWeight(item.id, text)}
                keyboardType="numeric"
                selectTextOnFocus
                editable={item.is_active}
                maxLength={4}
              />
            ) : (
              <Text style={[styles.weightValue, !item.is_active && styles.ruleLabelInactive]}>
                {item.weight}
              </Text>
            )}
            <Text style={[styles.weightUnit, !item.is_active && styles.ruleLabelInactive]}>
              pts
            </Text>
          </View>
        </View>

        {!item.is_active && (
          <View style={styles.inactiveBadge}>
            <Text style={styles.inactiveBadgeText}>Inativo — não contribui para o score</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Motor de Ranqueamento</Text>
        <View style={{ width: 40 }} />
      </View>

      {hasDirty && isAdmin && (
        <View style={styles.dirtyBar}>
          <Ionicons name="pencil-outline" size={14} color="#D97706" />
          <Text style={styles.dirtyBarText}>Alterações não salvas</Text>
          <Pressable style={styles.discardBtn} onPress={handleDiscard}>
            <Text style={styles.discardBtnText}>Descartar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.saveBarBtn, pressed && { opacity: 0.75 }]}
            onPress={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBarBtnText}>Salvar</Text>
            )}
          </Pressable>
        </View>
      )}

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
        <Text style={styles.infoText}>
          Os pesos determinam quantos pontos cada critério contribui para o KidScore. Critérios inativos não são computados.
          {!isAdmin && " Apenas administradores podem editar."}
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
          <Text style={styles.errorText}>Erro ao carregar regras. Toque para tentar novamente.</Text>
        </Pressable>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={localRules}
          keyExtractor={(r) => r.id}
          renderItem={renderRule}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="list-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>Nenhuma regra cadastrada</Text>
            </View>
          }
        />
      )}
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
  dirtyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFFBEB",
    borderBottomWidth: 1,
    borderBottomColor: "#FDE68A",
  },
  dirtyBarText: {
    flex: 1,
    fontSize: 13,
    color: "#D97706",
    fontFamily: "Inter_500Medium",
  },
  discardBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D97706",
  },
  discardBtnText: {
    fontSize: 13,
    color: "#D97706",
    fontFamily: "Inter_500Medium",
  },
  saveBarBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.primary,
    minWidth: 60,
    alignItems: "center",
  },
  saveBarBtnText: {
    fontSize: 13,
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    margin: 12,
    padding: 12,
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: "#1E40AF",
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
  list: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  ruleCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  ruleCardDirty: {
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDE7",
  },
  ruleTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  ruleLabelContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dirtyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#D97706",
  },
  ruleLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  ruleLabelInactive: {
    color: Colors.textSecondary,
    textDecorationLine: "line-through",
  },
  ruleBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  ruleKeyText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  weightLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  weightInput: {
    width: 60,
    height: 34,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    backgroundColor: "#F8F8F8",
  },
  weightInputInactive: {
    color: Colors.textSecondary,
    backgroundColor: "#F0F0F0",
  },
  weightValue: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    minWidth: 40,
    textAlign: "center",
  },
  weightUnit: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  inactiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#F3F4F6",
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  inactiveBadgeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  centered: {
    flex: 1,
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
});
