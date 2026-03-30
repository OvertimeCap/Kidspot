import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  TextInput,
  ScrollView,
  Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

type ScanFrequency = "diaria" | "semanal" | "quinzenal" | "mensal";

interface City {
  id: string;
  nome: string;
  estado: string;
  latitude: string;
  longitude: string;
  raio_km: number;
  frequencia: ScanFrequency;
  parametros_prompt: Record<string, unknown> | null;
  ativa: boolean;
  ultima_varredura: string | null;
  criado_em: string;
}

const FREQ_LABELS: Record<ScanFrequency, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};

const FREQ_OPTIONS: ScanFrequency[] = ["diaria", "semanal", "quinzenal", "mensal"];

const emptyForm = {
  nome: "",
  estado: "",
  latitude: "",
  longitude: "",
  raio_km: "10",
  frequencia: "semanal" as ScanFrequency,
  parametros_prompt: "",
  ativa: true,
};

export default function AdminCidadesScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [search, setSearch] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery<{ cities: City[] }>({
    queryKey: ["/api/admin/cities"],
  });

  const filteredCities = useMemo(() => {
    const all = data?.cities ?? [];
    if (!search.trim()) return all;
    const lower = search.trim().toLowerCase();
    return all.filter(
      (c) =>
        c.nome.toLowerCase().includes(lower) ||
        c.estado.toLowerCase().includes(lower),
    );
  }, [data?.cities, search]);

  const createMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await apiRequest("POST", "/api/admin/cities", payload);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? "Erro ao criar cidade");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
      closeModal();
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: object }) => {
      const res = await apiRequest("PATCH", `/api/admin/cities/${id}`, payload);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? "Erro ao atualizar cidade");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
      closeModal();
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/admin/cities/${id}/toggle`, {});
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? "Erro ao alternar cidade");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/cities/${id}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? "Erro ao excluir cidade");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function openCreateModal() {
    setEditingCity(null);
    setForm({ ...emptyForm });
    setFormErrors({});
    setModalVisible(true);
  }

  function openEditModal(city: City) {
    setEditingCity(city);
    setForm({
      nome: city.nome,
      estado: city.estado,
      latitude: city.latitude,
      longitude: city.longitude,
      raio_km: String(city.raio_km),
      frequencia: city.frequencia,
      parametros_prompt: city.parametros_prompt
        ? JSON.stringify(city.parametros_prompt, null, 2)
        : "",
      ativa: city.ativa,
    });
    setFormErrors({});
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingCity(null);
    setForm({ ...emptyForm });
    setFormErrors({});
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!form.nome.trim()) errors.nome = "Nome é obrigatório";
    if (!form.estado.trim()) errors.estado = "Estado é obrigatório";
    const lat = parseFloat(form.latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) errors.latitude = "Latitude inválida (−90 a 90)";
    const lng = parseFloat(form.longitude);
    if (isNaN(lng) || lng < -180 || lng > 180)
      errors.longitude = "Longitude inválida (−180 a 180)";
    const raio = parseInt(form.raio_km, 10);
    if (isNaN(raio) || raio < 1 || raio > 500) errors.raio_km = "Raio entre 1 e 500 km";
    if (form.parametros_prompt.trim()) {
      try {
        JSON.parse(form.parametros_prompt);
      } catch {
        errors.parametros_prompt = "JSON inválido";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit() {
    if (!validateForm()) return;
    let parametros: Record<string, unknown> | null = null;
    if (form.parametros_prompt.trim()) {
      try {
        parametros = JSON.parse(form.parametros_prompt);
      } catch {}
    }
    const payload = {
      nome: form.nome.trim(),
      estado: form.estado.trim(),
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      raio_km: parseInt(form.raio_km, 10),
      frequencia: form.frequencia,
      parametros_prompt: parametros,
      ativa: form.ativa,
    };
    if (editingCity) {
      updateMutation.mutate({ id: editingCity.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleDelete(city: City) {
    Alert.alert(
      "Excluir cidade",
      `Tem certeza que deseja excluir "${city.nome}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => deleteMutation.mutate(city.id),
        },
      ],
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  function renderItem({ item }: { item: City }) {
    const isToggling = toggleMutation.isPending;
    const lastScan = item.ultima_varredura
      ? new Date(item.ultima_varredura).toLocaleDateString("pt-BR")
      : "Nunca";

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardName}>{item.nome}</Text>
            <Text style={styles.cardState}>{item.estado}</Text>
          </View>
          <Switch
            value={item.ativa}
            onValueChange={() => { if (!isToggling) toggleMutation.mutate(item.id); }}
            trackColor={{ false: Colors.border, true: Colors.primary + "88" }}
            thumbColor={item.ativa ? Colors.primary : "#ccc"}
          />
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="locate-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.metaText}>
              {parseFloat(item.latitude).toFixed(4)}, {parseFloat(item.longitude).toFixed(4)}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="radio-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{item.raio_km} km</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{FREQ_LABELS[item.frequencia]}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.metaItem}>
            <Ionicons name="scan-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.metaText}>Última varredura: {lastScan}</Text>
          </View>
          <View style={styles.cardActions}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => openEditModal(item)}
              testID={`edit-city-${item.id}`}
            >
              <Ionicons name="pencil-outline" size={16} color={Colors.primary} />
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => handleDelete(item)}
              testID={`delete-city-${item.id}`}
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            </Pressable>
          </View>
        </View>

        {item.ativa ? (
          <View style={[styles.statusBadge, styles.statusActive]}>
            <Text style={[styles.statusText, styles.statusActiveText]}>Ativa</Text>
          </View>
        ) : (
          <View style={[styles.statusBadge, styles.statusInactive]}>
            <Text style={[styles.statusText, styles.statusInactiveText]}>Inativa</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Gestão de Cidades</Text>
        <Pressable onPress={openCreateModal} style={styles.addBtn} testID="add-city-btn">
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nome ou estado..."
          placeholderTextColor={Colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          testID="city-search-input"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Erro ao carregar cidades</Text>
        </View>
      ) : filteredCities.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="map-outline" size={40} color={Colors.border} />
          <Text style={styles.emptyText}>
            {search ? "Nenhuma cidade encontrada" : "Nenhuma cidade cadastrada"}
          </Text>
          {!search && (
            <Pressable style={styles.emptyAddBtn} onPress={openCreateModal}>
              <Text style={styles.emptyAddBtnText}>Adicionar primeira cidade</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredCities}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={[styles.modalContainer, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={closeModal} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={22} color={Colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>
              {editingCity ? "Editar Cidade" : "Nova Cidade"}
            </Text>
            <Pressable
              onPress={handleSubmit}
              style={[styles.modalSaveBtn, isSaving && styles.modalSaveBtnDisabled]}
              disabled={isSaving}
              testID="save-city-btn"
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSaveBtnText}>Salvar</Text>
              )}
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Informações básicas</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Nome da cidade *</Text>
                <TextInput
                  style={[styles.fieldInput, formErrors.nome ? styles.fieldInputError : null]}
                  placeholder="Ex: São Paulo"
                  placeholderTextColor={Colors.textSecondary}
                  value={form.nome}
                  onChangeText={(v) => setForm((f) => ({ ...f, nome: v }))}
                  testID="field-nome"
                />
                {formErrors.nome ? (
                  <Text style={styles.fieldError}>{formErrors.nome}</Text>
                ) : null}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Estado *</Text>
                <TextInput
                  style={[styles.fieldInput, formErrors.estado ? styles.fieldInputError : null]}
                  placeholder="Ex: SP"
                  placeholderTextColor={Colors.textSecondary}
                  value={form.estado}
                  onChangeText={(v) => setForm((f) => ({ ...f, estado: v }))}
                  testID="field-estado"
                />
                {formErrors.estado ? (
                  <Text style={styles.fieldError}>{formErrors.estado}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Coordenadas</Text>

              <View style={styles.row}>
                <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.fieldLabel}>Latitude *</Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      formErrors.latitude ? styles.fieldInputError : null,
                    ]}
                    placeholder="-23.5505"
                    placeholderTextColor={Colors.textSecondary}
                    value={form.latitude}
                    onChangeText={(v) => setForm((f) => ({ ...f, latitude: v }))}
                    keyboardType="decimal-pad"
                    testID="field-latitude"
                  />
                  {formErrors.latitude ? (
                    <Text style={styles.fieldError}>{formErrors.latitude}</Text>
                  ) : null}
                </View>

                <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.fieldLabel}>Longitude *</Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      formErrors.longitude ? styles.fieldInputError : null,
                    ]}
                    placeholder="-46.6333"
                    placeholderTextColor={Colors.textSecondary}
                    value={form.longitude}
                    onChangeText={(v) => setForm((f) => ({ ...f, longitude: v }))}
                    keyboardType="decimal-pad"
                    testID="field-longitude"
                  />
                  {formErrors.longitude ? (
                    <Text style={styles.fieldError}>{formErrors.longitude}</Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Raio de busca (km) *</Text>
                <TextInput
                  style={[styles.fieldInput, formErrors.raio_km ? styles.fieldInputError : null]}
                  placeholder="10"
                  placeholderTextColor={Colors.textSecondary}
                  value={form.raio_km}
                  onChangeText={(v) => setForm((f) => ({ ...f, raio_km: v }))}
                  keyboardType="number-pad"
                  testID="field-raio"
                />
                {formErrors.raio_km ? (
                  <Text style={styles.fieldError}>{formErrors.raio_km}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Configuração de varredura</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Frequência de busca</Text>
                <View style={styles.freqOptions}>
                  {FREQ_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt}
                      style={[
                        styles.freqOption,
                        form.frequencia === opt && styles.freqOptionActive,
                      ]}
                      onPress={() => setForm((f) => ({ ...f, frequencia: opt }))}
                      testID={`freq-${opt}`}
                    >
                      <Text
                        style={[
                          styles.freqOptionText,
                          form.frequencia === opt && styles.freqOptionTextActive,
                        ]}
                      >
                        {FREQ_LABELS[opt]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={[styles.fieldGroup, styles.toggleRow]}>
                <View>
                  <Text style={styles.fieldLabel}>Varredura ativa</Text>
                  <Text style={styles.fieldHint}>
                    Desative para pausar esta cidade no pipeline
                  </Text>
                </View>
                <Switch
                  value={form.ativa}
                  onValueChange={(v) => setForm((f) => ({ ...f, ativa: v }))}
                  trackColor={{ false: Colors.border, true: Colors.primary + "88" }}
                  thumbColor={form.ativa ? Colors.primary : "#ccc"}
                />
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Parâmetros regionais (JSON)</Text>
              <Text style={styles.fieldHint}>
                Dados adicionais passados ao prompt da IA para este território. Deixe vazio para usar o padrão global.
              </Text>
              <TextInput
                style={[
                  styles.fieldInput,
                  styles.textArea,
                  formErrors.parametros_prompt ? styles.fieldInputError : null,
                ]}
                placeholder={'{\n  "foco": "parques e restaurantes família",\n  "idioma": "pt-BR"\n}'}
                placeholderTextColor={Colors.textSecondary}
                value={form.parametros_prompt}
                onChangeText={(v) => setForm((f) => ({ ...f, parametros_prompt: v }))}
                multiline
                numberOfLines={5}
                autoCorrect={false}
                autoCapitalize="none"
                testID="field-params"
              />
              {formErrors.parametros_prompt ? (
                <Text style={styles.fieldError}>{formErrors.parametros_prompt}</Text>
              ) : null}
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardTitleRow: {
    flex: 1,
    marginRight: 8,
  },
  cardName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  cardState: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnDanger: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  statusBadge: {
    position: "absolute",
    top: 10,
    right: 60,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusActive: {
    backgroundColor: "#dcfce7",
  },
  statusInactive: {
    backgroundColor: "#f1f5f9",
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  statusActiveText: {
    color: "#16a34a",
  },
  statusInactiveText: {
    color: Colors.textSecondary,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: "#ef4444",
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  emptyAddBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    marginTop: 4,
  },
  emptyAddBtnText: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "Inter_500Medium",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 72,
    alignItems: "center",
  },
  modalSaveBtnDisabled: {
    opacity: 0.6,
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  modalScroll: {
    flex: 1,
  },
  formSection: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 18,
  },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  fieldInputError: {
    borderColor: "#ef4444",
  },
  fieldError: {
    fontSize: 12,
    color: "#ef4444",
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  freqOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  freqOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  freqOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  freqOptionText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  freqOptionTextActive: {
    color: "#fff",
    fontFamily: "Inter_500Medium",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 0,
  },
});
