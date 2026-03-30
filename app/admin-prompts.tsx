import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
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

interface TestResult {
  family_score: number;
  highlights: string[];
  confidence: "high" | "medium" | "low";
}

export default function AdminPromptsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const [testPlaceName, setTestPlaceName] = useState("Restaurante Família Feliz");
  const [testReviews, setTestReviews] = useState(
    "Ótimo lugar, tem brinquedoteca e cardápio infantil. As crianças adoraram!\nTem fraldário limpo e cadeirão para bebês. Excelente atendimento para famílias."
  );
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ prompt: AiPrompt | null }>({
    queryKey: ["/api/admin/ai-prompts/active"],
  });

  const activePrompt = data?.prompt;
  const currentText = editedPrompt ?? activePrompt?.prompt ?? "";
  const isDirty = editedPrompt !== null && editedPrompt !== activePrompt?.prompt;

  const saveMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("PUT", "/api/admin/ai-prompts/active", { prompt });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao salvar prompt");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-prompts/active"] });
      setEditedPrompt(null);
      Alert.alert("Sucesso", "Prompt salvo com sucesso. A IA usará este prompt na próxima execução.");
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  function handleSave() {
    if (!isDirty || !editedPrompt) return;
    Alert.alert(
      "Salvar prompt",
      "Tem certeza? Este prompt será usado pela IA em todas as análises futuras.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Salvar", onPress: () => saveMutation.mutate(editedPrompt) },
      ]
    );
  }

  function handleDiscard() {
    setEditedPrompt(null);
  }

  async function handleTest() {
    const reviews = testReviews
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (!testPlaceName.trim() || reviews.length === 0) {
      Alert.alert("Atenção", "Preencha o nome do local e pelo menos uma review para testar.");
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await apiRequest("POST", "/api/admin/ai-prompts/test", {
        prompt: currentText,
        placeName: testPlaceName.trim(),
        reviews,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao testar prompt");
      setTestResult(body.result);
    } catch (err) {
      Alert.alert("Erro", (err as Error).message);
    } finally {
      setIsTesting(false);
    }
  }

  const isAdmin = user?.role === "admin";
  const confidenceColor = { high: "#059669", medium: "#D97706", low: "#DC2626" };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Gestão de Prompts IA</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="sparkles-outline" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>System Prompt Atual</Text>
            </View>
            <Text style={styles.sectionDesc}>
              Este prompt define como a IA analisa reviews de estabelecimentos para famílias com crianças.
              {!isAdmin && " Apenas administradores podem editar."}
            </Text>

            {isLoading && (
              <View style={styles.centered}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            )}

            {isError && (
              <Pressable onPress={() => refetch()} style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={20} color={Colors.error} />
                <Text style={styles.errorText}>Erro ao carregar prompt. Toque para tentar novamente.</Text>
              </Pressable>
            )}

            {!isLoading && !isError && (
              <>
                <TextInput
                  style={[styles.promptEditor, !isAdmin && styles.promptEditorReadOnly]}
                  value={currentText}
                  onChangeText={isAdmin ? setEditedPrompt : undefined}
                  multiline
                  editable={isAdmin}
                  placeholder="Prompt do sistema..."
                  placeholderTextColor={Colors.textSecondary}
                  textAlignVertical="top"
                  scrollEnabled={false}
                />

                {isDirty && (
                  <View style={styles.dirtyBanner}>
                    <Ionicons name="pencil-outline" size={14} color="#D97706" />
                    <Text style={styles.dirtyText}>Alterações não salvas</Text>
                  </View>
                )}

                {isAdmin && (
                  <View style={styles.actionRow}>
                    {isDirty && (
                      <Pressable
                        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
                        onPress={handleDiscard}
                      >
                        <Ionicons name="close" size={16} color={Colors.textSecondary} />
                        <Text style={styles.secondaryBtnText}>Descartar</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={({ pressed }) => [
                        styles.saveBtn,
                        !isDirty && styles.saveBtnDisabled,
                        pressed && { opacity: 0.75 },
                        saveMutation.isPending && { opacity: 0.6 },
                      ]}
                      onPress={handleSave}
                      disabled={!isDirty || saveMutation.isPending}
                    >
                      {saveMutation.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="save-outline" size={16} color="#fff" />
                          <Text style={styles.saveBtnText}>Salvar Prompt</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flask-outline" size={20} color="#7C3AED" />
              <Text style={styles.sectionTitle}>Teste em Tempo Real</Text>
            </View>
            <Text style={styles.sectionDesc}>
              Teste o prompt atual (ou o que você está editando) com dados de exemplo antes de salvar.
            </Text>

            <Text style={styles.fieldLabel}>Nome do estabelecimento</Text>
            <TextInput
              style={styles.testInput}
              value={testPlaceName}
              onChangeText={setTestPlaceName}
              placeholder="Ex: Restaurante Família Feliz"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={styles.fieldLabel}>Reviews (uma por linha, máx. 5)</Text>
            <TextInput
              style={[styles.testInput, styles.testInputMulti]}
              value={testReviews}
              onChangeText={setTestReviews}
              multiline
              placeholder={"Review 1\nReview 2\n..."}
              placeholderTextColor={Colors.textSecondary}
              textAlignVertical="top"
              scrollEnabled={false}
            />

            <Pressable
              style={({ pressed }) => [
                styles.testBtn,
                pressed && { opacity: 0.75 },
                isTesting && { opacity: 0.6 },
              ]}
              onPress={handleTest}
              disabled={isTesting}
            >
              {isTesting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="play-outline" size={16} color="#fff" />
                  <Text style={styles.testBtnText}>Executar Teste</Text>
                </>
              )}
            </Pressable>

            {testResult && (
              <View style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#059669" />
                  <Text style={styles.resultTitle}>Resultado da IA</Text>
                </View>

                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Score familiar:</Text>
                  <View style={styles.scoreBar}>
                    <View
                      style={[
                        styles.scoreBarFill,
                        { width: `${testResult.family_score}%` as any },
                      ]}
                    />
                  </View>
                  <Text style={styles.scoreValue}>{testResult.family_score}/100</Text>
                </View>

                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Confiança:</Text>
                  <View
                    style={[
                      styles.confidenceBadge,
                      { backgroundColor: confidenceColor[testResult.confidence] + "20" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.confidenceText,
                        { color: confidenceColor[testResult.confidence] },
                      ]}
                    >
                      {testResult.confidence === "high"
                        ? "Alta"
                        : testResult.confidence === "medium"
                        ? "Média"
                        : "Baixa"}
                    </Text>
                  </View>
                </View>

                {testResult.highlights.length > 0 && (
                  <View style={styles.highlightsSection}>
                    <Text style={styles.resultLabel}>Destaques:</Text>
                    {testResult.highlights.map((h, i) => (
                      <View key={i} style={styles.highlightChip}>
                        <Ionicons name="star-outline" size={12} color={Colors.primary} />
                        <Text style={styles.highlightText}>{h}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {testResult.highlights.length === 0 && (
                  <Text style={styles.noHighlightsText}>
                    Nenhum destaque familiar detectado nas reviews.
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={{ height: insets.bottom + 32 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  sectionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  centered: {
    alignItems: "center",
    paddingVertical: 24,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    fontFamily: "Inter_400Regular",
  },
  promptEditor: {
    backgroundColor: "#F8F8F8",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    minHeight: 260,
  },
  promptEditorReadOnly: {
    backgroundColor: "#F4F4F4",
    color: Colors.textSecondary,
  },
  dirtyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    backgroundColor: "#FFFBEB",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  dirtyText: {
    fontSize: 12,
    color: "#D97706",
    fontFamily: "Inter_500Medium",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryBtnText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.border,
  },
  saveBtnText: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    marginBottom: -4,
  },
  testInput: {
    backgroundColor: "#F8F8F8",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  testInputMulti: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  testBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#7C3AED",
  },
  testBtnText: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },
  resultCard: {
    backgroundColor: "#F0FDF4",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    padding: 14,
    gap: 10,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#065F46",
    fontFamily: "Inter_700Bold",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    minWidth: 90,
  },
  scoreBar: {
    flex: 1,
    height: 8,
    backgroundColor: "#E5E7EB",
    borderRadius: 4,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: "100%",
    backgroundColor: "#059669",
    borderRadius: 4,
  },
  scoreValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#059669",
    fontFamily: "Inter_700Bold",
    minWidth: 50,
    textAlign: "right",
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  highlightsSection: {
    gap: 6,
  },
  highlightChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: Colors.primary + "15",
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  highlightText: {
    fontSize: 13,
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
  },
  noHighlightsText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },
});
