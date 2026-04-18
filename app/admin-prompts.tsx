import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface AiPrompt {
  id: string;
  name: string;
  prompt: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function AdminPromptsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const { data, isLoading } = useQuery<{ prompt: AiPrompt | null }>({
    queryKey: ["/api/admin/ai-prompts/active"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/ai-prompts/active");
      return res.json();
    },
  });

  useEffect(() => {
    if (data?.prompt) setDraft(data.prompt.prompt);
  }, [data?.prompt]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (draft.trim().length < 10) throw new Error("Prompt muito curto (mínimo 10 caracteres)");
      const res = await apiRequest("PUT", "/api/admin/ai-prompts/active", { prompt: draft.trim() });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Erro ao salvar prompt");
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-prompts/active"] });
      setEditing(false);
      Alert.alert("Salvo", "Prompt atualizado com sucesso.");
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function handleEdit() {
    setEditing(true);
  }

  function handleCancel() {
    setDraft(data?.prompt?.prompt ?? "");
    setEditing(false);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Prompt de IA</Text>
          {!editing ? (
            <Pressable onPress={handleEdit} style={styles.editBtn}>
              <Ionicons name="pencil" size={18} color={Colors.primary} />
            </Pressable>
          ) : (
            <View style={{ width: 38 }} />
          )}
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 80 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {data?.prompt && (
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  Atualizado: {new Date(data.prompt.updated_at).toLocaleString("pt-BR", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </Text>
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Ativo</Text>
                </View>
              </View>
            )}

            {!data?.prompt && !editing && (
              <View style={styles.emptyCard}>
                <Ionicons name="document-text-outline" size={40} color="#D1D5DB" />
                <Text style={styles.emptyText}>Nenhum prompt configurado</Text>
                <Pressable onPress={handleEdit} style={styles.createBtn}>
                  <Text style={styles.createBtnText}>Criar Prompt</Text>
                </Pressable>
              </View>
            )}

            {editing ? (
              <View style={styles.editorCard}>
                <Text style={styles.editorLabel}>Editar Prompt</Text>
                <TextInput
                  style={styles.textArea}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  placeholder="Instruções para a IA analisar avaliações de locais..."
                  placeholderTextColor="#9CA3AF"
                  textAlignVertical="top"
                />
                <Text style={styles.charCount}>{draft.length} caracteres</Text>
                <View style={styles.editorActions}>
                  <Pressable onPress={handleCancel} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    style={[styles.saveBtn, saveMutation.isPending && styles.saveBtnDisabled]}
                  >
                    {saveMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>Salvar</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : data?.prompt ? (
              <View style={styles.promptCard}>
                <Text style={styles.promptText}>{data.prompt.prompt}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
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
  editBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  metaText: { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular" },
  activeBadge: { backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  activeBadgeText: { fontSize: 11, color: "#059669", fontFamily: "Inter_600SemiBold" },
  promptCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  promptText: { fontSize: 13, color: Colors.text, fontFamily: "Inter_400Regular", lineHeight: 20 },
  editorCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, gap: 10,
  },
  editorLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  textArea: {
    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
    padding: 12, minHeight: 200, fontSize: 13,
    color: Colors.text, fontFamily: "Inter_400Regular",
    backgroundColor: "#F9FAFB", lineHeight: 20,
  },
  charCount: { fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular", textAlign: "right" },
  editorActions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1, padding: 12, borderRadius: 10, alignItems: "center",
    borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff",
  },
  cancelBtnText: { fontSize: 14, color: Colors.text, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    flex: 2, backgroundColor: Colors.primary, padding: 12,
    borderRadius: 10, alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: "#9CA3AF" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 32,
    alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  emptyText: { fontSize: 15, color: "#6B7280", fontFamily: "Inter_600SemiBold" },
  createBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, marginTop: 4,
  },
  createBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
