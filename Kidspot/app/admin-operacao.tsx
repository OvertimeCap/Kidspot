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
  ScrollView,
  Modal,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

const BACKOFFICE_TOKEN_KEY = "backoffice_token";

interface City {
  id: string;
  name: string;
  state: string;
  lat: string;
  lng: string;
  status: "ativa" | "inativa";
  created_at: string;
}

interface PipelineRun {
  id: string;
  city_id: string | null;
  city_name: string;
  status: string;
  places_found: number;
  new_pending: number;
  failures: number;
  estimated_cost_usd: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

interface RunsResponse {
  runs: PipelineRun[];
  total: number;
}

interface CitiesResponse {
  cities: City[];
}

async function backofficeRequest(method: string, path: string, body?: unknown) {
  const token = await AsyncStorage.getItem(BACKOFFICE_TOKEN_KEY);
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl).toString();
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

type TabKey = "execucoes" | "cidades";

export default function AdminOperacaoScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [activeTab, setActiveTab] = useState<TabKey>("execucoes");
  const [selectedCityId, setSelectedCityId] = useState<string | "todas">("todas");
  const [isRunning, setIsRunning] = useState(false);
  const [addCityModal, setAddCityModal] = useState(false);
  const [newCityName, setNewCityName] = useState("");
  const [newCityState, setNewCityState] = useState("SP");
  const [newCityLat, setNewCityLat] = useState("");
  const [newCityLng, setNewCityLng] = useState("");

  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<RunsResponse>({
    queryKey: ["/api/admin/pipeline/runs"],
    queryFn: async () => {
      const res = await backofficeRequest("GET", "/api/admin/pipeline/runs?limit=50");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error ?? "Erro ao carregar execuções");
      }
      return res.json();
    },
    refetchInterval: isRunning ? 3000 : false,
  });

  const { data: citiesData, isLoading: citiesLoading, refetch: refetchCities } = useQuery<CitiesResponse>({
    queryKey: ["/api/admin/cities"],
    queryFn: async () => {
      const res = await backofficeRequest("GET", "/api/admin/cities");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error ?? "Erro ao carregar cidades");
      }
      return res.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async (cityId: string | "todas") => {
      setIsRunning(true);
      const body = cityId === "todas" ? {} : { city_id: cityId };
      const res = await backofficeRequest("POST", "/api/admin/pipeline/run", body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao iniciar varredura");
      return data;
    },
    onSuccess: (data) => {
      setIsRunning(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/pipeline/runs"] });
      const results: PipelineRun[] = data.results ?? [];
      const total_new = results.reduce((s: number, r: PipelineRun) => s + r.new_pending, 0);
      const total_found = results.reduce((s: number, r: PipelineRun) => s + r.places_found, 0);
      const failed = results.filter((r: PipelineRun) => r.status === "failed").length;
      Alert.alert(
        "Varredura concluída",
        `${results.length} cidade(s) processada(s)\n${total_found} locais encontrados\n${total_new} novos pendentes${failed > 0 ? `\n${failed} falha(s)` : ""}`,
      );
    },
    onError: (err: Error) => {
      setIsRunning(false);
      Alert.alert("Erro", err.message);
    },
  });

  const toggleCityMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ativa" | "inativa" }) => {
      const res = await backofficeRequest("PATCH", `/api/admin/cities/${id}/status`, { status });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar cidade");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const addCityMutation = useMutation({
    mutationFn: async () => {
      const lat = parseFloat(newCityLat);
      const lng = parseFloat(newCityLng);
      if (!newCityName.trim()) throw new Error("Informe o nome da cidade");
      if (isNaN(lat) || isNaN(lng)) throw new Error("Coordenadas inválidas");

      const res = await backofficeRequest("POST", "/api/admin/cities", {
        name: newCityName.trim(),
        state: newCityState.trim().toUpperCase() || "SP",
        lat,
        lng,
        status: "ativa",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao adicionar cidade");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/cities"] });
      setAddCityModal(false);
      setNewCityName("");
      setNewCityState("SP");
      setNewCityLat("");
      setNewCityLng("");
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const cities = citiesData?.cities ?? [];
  const activeCities = cities.filter((c) => c.status === "ativa");
  const runs = runsData?.runs ?? [];

  function confirmRun() {
    const cityLabel = selectedCityId === "todas"
      ? `todas as ${activeCities.length} cidade(s) ativa(s)`
      : cities.find((c) => c.id === selectedCityId)?.name ?? selectedCityId;

    Alert.alert(
      "Iniciar Varredura",
      `Deseja iniciar a varredura de IA para ${cityLabel}?\n\nEssa operação pode demorar alguns minutos e gera custo de API.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => runMutation.mutate(selectedCityId) },
      ],
    );
  }

  function renderStatusBadge(status: string) {
    const config: Record<string, { color: string; bg: string; label: string }> = {
      completed: { color: "#059669", bg: "#D1FAE5", label: "Concluído" },
      running: { color: "#2563EB", bg: "#DBEAFE", label: "Executando" },
      failed: { color: "#DC2626", bg: "#FEE2E2", label: "Falhou" },
    };
    const c = config[status] ?? { color: "#6B7280", bg: "#F3F4F6", label: status };
    return (
      <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
        <Text style={{ fontSize: 11, color: c.color, fontFamily: "Inter_600SemiBold" }}>{c.label}</Text>
      </View>
    );
  }

  function renderRunItem({ item }: { item: PipelineRun }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.city_name}</Text>
          {renderStatusBadge(item.status)}
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardMeta}>{formatDate(item.started_at)}</Text>
          <Text style={styles.cardMeta}>Duração: {formatDuration(item.started_at, item.finished_at)}</Text>
        </View>
        <View style={styles.metricsRow}>
          <MetricChip icon="search" value={item.places_found} label="Encontrados" color="#2563EB" />
          <MetricChip icon="time" value={item.new_pending} label="Novos Pend." color="#D97706" />
          <MetricChip icon="warning" value={item.failures} label="Falhas" color="#DC2626" />
          <MetricChip icon="cash" value={`$${Number(item.estimated_cost_usd).toFixed(4)}`} label="Custo" color="#6B7280" />
        </View>
        {item.error_message && (
          <Text style={styles.errorText} numberOfLines={2}>{item.error_message}</Text>
        )}
      </View>
    );
  }

  function renderCityItem({ item }: { item: City }) {
    const isActive = item.status === "ativa";
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.name} - {item.state}</Text>
            <Text style={styles.cardMeta}>
              {Number(item.lat).toFixed(4)}, {Number(item.lng).toFixed(4)}
            </Text>
          </View>
          <Pressable
            onPress={() => toggleCityMutation.mutate({ id: item.id, status: isActive ? "inativa" : "ativa" })}
            style={[styles.toggleBtn, isActive ? styles.toggleBtnActive : styles.toggleBtnInactive]}
          >
            <Text style={[styles.toggleBtnText, isActive ? styles.toggleBtnActiveText : styles.toggleBtnInactiveText]}>
              {isActive ? "Ativa" : "Inativa"}
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
        <Text style={styles.headerTitle}>Operação de IA</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.tabBar}>
        {(["execucoes", "cidades"] as TabKey[]).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "execucoes" ? "Execuções" : "Cidades"}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "execucoes" && (
        <View style={{ flex: 1 }}>
          <View style={styles.controlBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                <Pressable
                  onPress={() => setSelectedCityId("todas")}
                  style={[styles.cityChip, selectedCityId === "todas" && styles.cityChipActive]}
                >
                  <Text style={[styles.cityChipText, selectedCityId === "todas" && styles.cityChipTextActive]}>
                    Todas
                  </Text>
                </Pressable>
                {activeCities.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setSelectedCityId(c.id)}
                    style={[styles.cityChip, selectedCityId === c.id && styles.cityChipActive]}
                  >
                    <Text style={[styles.cityChipText, selectedCityId === c.id && styles.cityChipTextActive]}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Pressable
              onPress={confirmRun}
              disabled={isRunning || runMutation.isPending}
              style={[styles.runBtn, (isRunning || runMutation.isPending) && styles.runBtnDisabled]}
            >
              {(isRunning || runMutation.isPending) ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="play" size={14} color="#fff" />
                  <Text style={styles.runBtnText}>Iniciar</Text>
                </>
              )}
            </Pressable>
          </View>

          {runsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : runs.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="pulse-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>Nenhuma execução registrada</Text>
              <Text style={styles.emptySubtext}>Inicie uma varredura para ver o histórico</Text>
            </View>
          ) : (
            <FlatList
              data={runs}
              keyExtractor={(r) => r.id}
              renderItem={renderRunItem}
              contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      {activeTab === "cidades" && (
        <View style={{ flex: 1 }}>
          <View style={styles.citiesHeader}>
            <Text style={styles.citiesCount}>
              {activeCities.length}/{cities.length} ativas
            </Text>
            <Pressable
              onPress={() => setAddCityModal(true)}
              style={styles.addCityBtn}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addCityBtnText}>Adicionar</Text>
            </Pressable>
          </View>

          {citiesLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : cities.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="location-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>Nenhuma cidade cadastrada</Text>
            </View>
          ) : (
            <FlatList
              data={cities}
              keyExtractor={(c) => c.id}
              renderItem={renderCityItem}
              contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      <Modal
        visible={addCityModal}
        transparent
        animationType="slide"
        onRequestClose={() => setAddCityModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adicionar Cidade</Text>
              <Pressable onPress={() => setAddCityModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Nome da Cidade</Text>
            <TextInput
              style={styles.input}
              value={newCityName}
              onChangeText={setNewCityName}
              placeholder="Ex: São Paulo"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Estado (UF)</Text>
            <TextInput
              style={styles.input}
              value={newCityState}
              onChangeText={setNewCityState}
              placeholder="SP"
              placeholderTextColor="#9CA3AF"
              maxLength={2}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={newCityLat}
              onChangeText={setNewCityLat}
              placeholder="Ex: -23.5505"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={newCityLng}
              onChangeText={setNewCityLng}
              placeholder="Ex: -46.6333"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
            />

            <Pressable
              onPress={() => addCityMutation.mutate()}
              disabled={addCityMutation.isPending}
              style={[styles.saveBtn, addCityMutation.isPending && styles.saveBtnDisabled]}
            >
              {addCityMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Salvar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MetricChip({ icon, value, label, color }: { icon: string; value: number | string; label: string; color: string }) {
  return (
    <View style={styles.metricChip}>
      <Ionicons name={icon as never} size={12} color={color} />
      <Text style={[styles.metricValue, { color }]}>{String(value)}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Inter_500Medium",
  },
  tabTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  controlBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    gap: 8,
  },
  cityChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cityChipActive: {
    backgroundColor: Colors.primary + "15",
    borderColor: Colors.primary,
  },
  cityChipText: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Inter_500Medium",
  },
  cityChipTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  runBtnDisabled: {
    backgroundColor: "#9CA3AF",
  },
  runBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    gap: 8,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 6,
  },
  metricChip: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    paddingVertical: 6,
  },
  metricValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  metricLabel: {
    fontSize: 9,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  errorText: {
    fontSize: 12,
    color: "#DC2626",
    fontFamily: "Inter_400Regular",
    backgroundColor: "#FEF2F2",
    borderRadius: 6,
    padding: 8,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#6B7280",
    fontFamily: "Inter_600SemiBold",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  citiesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  citiesCount: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  addCityBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addCityBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleBtnActive: {
    backgroundColor: "#D1FAE5",
    borderColor: "#059669",
  },
  toggleBtnInactive: {
    backgroundColor: "#F3F4F6",
    borderColor: "#D1D5DB",
  },
  toggleBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  toggleBtnActiveText: {
    color: "#059669",
  },
  toggleBtnInactiveText: {
    color: "#6B7280",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 10,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    color: "#374151",
    fontFamily: "Inter_500Medium",
    marginBottom: -4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    backgroundColor: "#F9FAFB",
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnDisabled: {
    backgroundColor: "#9CA3AF",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
