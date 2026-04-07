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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

type FeedbackType = "sugestao" | "denuncia" | "fechado";
type FeedbackStatus = "pendente" | "resolvido" | "rejeitado";

interface FeedbackItem {
  id: string;
  type: FeedbackType;
  content: string;
  place_id: string | null;
  place_name: string | null;
  user_id: string | null;
  status: FeedbackStatus;
  created_at: string;
  resolved_at: string | null;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  sugestao: "Sugestão",
  denuncia: "Denúncia",
  fechado: "Fechado",
};

const TYPE_COLORS: Record<FeedbackType, { bg: string; text: string }> = {
  sugestao: { bg: "#DBEAFE", text: "#2563EB" },
  denuncia: { bg: "#FEE2E2", text: "#DC2626" },
  fechado: { bg: "#F3F4F6", text: "#6B7280" },
};

const STATUS_COLORS: Record<FeedbackStatus, { bg: string; text: string }> = {
  pendente: { bg: "#FEF3C7", text: "#D97706" },
  resolvido: { bg: "#D1FAE5", text: "#059669" },
  rejeitado: { bg: "#F3F4F6", text: "#6B7280" },
};

function formatDate(d: string) {
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminFeedbackScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [filterStatus, setFilterStatus] = useState<FeedbackStatus | "">("");
  const [filterType, setFilterType] = useState<FeedbackType | "">("");

  const queryParams = new URLSearchParams();
  if (filterStatus) queryParams.set("status", filterStatus);
  if (filterType) queryParams.set("type", filterType);
  const queryString = queryParams.toString();

  const { data, isLoading } = useQuery<{ feedback: FeedbackItem[]; unreadCount: number }>({
    queryKey: ["/api/admin/feedback", filterStatus, filterType],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/feedback${queryString ? "?" + queryString : ""}`);
      return res.json();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "resolver" | "rejeitar" }) => {
      const res = await apiRequest("PATCH", `/api/admin/feedback/${id}`, { action });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao processar feedback");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/feedback"] }),
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function confirmAction(item: FeedbackItem, action: "resolver" | "rejeitar") {
    const label = action === "resolver" ? "Resolver" : "Rejeitar";
    Alert.alert(label, `Deseja ${label.toLowerCase()} este feedback?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", onPress: () => actionMutation.mutate({ id: item.id, action }) },
    ]);
  }

  const items = data?.feedback ?? [];

  function renderItem({ item }: { item: FeedbackItem }) {
    const typeStyle = TYPE_COLORS[item.type];
    const statusStyle = STATUS_COLORS[item.status];
    const isPending = item.status === "pendente";

    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={[styles.badge, { backgroundColor: typeStyle.bg }]}>
            <Text style={[styles.badgeText, { color: typeStyle.text }]}>{TYPE_LABELS[item.type]}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.badgeText, { color: statusStyle.text }]}>{item.status}</Text>
          </View>
          <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
        </View>
        {item.place_name && (
          <Text style={styles.placeName} numberOfLines={1}>📍 {item.place_name}</Text>
        )}
        <Text style={styles.content} numberOfLines={3}>{item.content}</Text>
        {isPending && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => confirmAction(item, "resolver")}
              style={[styles.actionBtn, styles.actionBtnSuccess]}
              disabled={actionMutation.isPending}
            >
              <Ionicons name="checkmark" size={14} color="#059669" />
              <Text style={[styles.actionBtnText, { color: "#059669" }]}>Resolver</Text>
            </Pressable>
            <Pressable
              onPress={() => confirmAction(item, "rejeitar")}
              style={[styles.actionBtn, styles.actionBtnDanger]}
              disabled={actionMutation.isPending}
            >
              <Ionicons name="close" size={14} color="#DC2626" />
              <Text style={[styles.actionBtnText, { color: "#DC2626" }]}>Rejeitar</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>
          Feedback{data?.unreadCount ? ` (${data.unreadCount} novo${data.unreadCount > 1 ? "s" : ""})` : ""}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Filters */}
      <View style={styles.filtersRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
            {(["", "pendente", "resolvido", "rejeitado"] as const).map((s) => (
              <Pressable
                key={s || "all"}
                onPress={() => setFilterStatus(s as FeedbackStatus | "")}
                style={[styles.chip, filterStatus === s && styles.chipActive]}
              >
                <Text style={[styles.chipText, filterStatus === s && styles.chipTextActive]}>
                  {s === "" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)}
                </Text>
              </Pressable>
            ))}
            <View style={styles.divider} />
            {(["", "sugestao", "denuncia"] as const).map((t) => (
              <Pressable
                key={t || "all-type"}
                onPress={() => setFilterType(t as FeedbackType | "")}
                style={[styles.chip, filterType === t && styles.chipActive]}
              >
                <Text style={[styles.chipText, filterType === t && styles.chipTextActive]}>
                  {t === "" ? "Tipo: Todos" : TYPE_LABELS[t as FeedbackType]}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="chatbubble-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhum feedback encontrado</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  filtersRow: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  chipActive: { backgroundColor: Colors.primary + "15", borderColor: Colors.primary },
  chipText: { fontSize: 12, color: "#6B7280", fontFamily: "Inter_500Medium" },
  chipTextActive: { color: Colors.primary, fontFamily: "Inter_600SemiBold" },
  divider: { width: 1, backgroundColor: "#E5E7EB", marginHorizontal: 4 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, gap: 8,
  },
  cardRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dateText: { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_400Regular", marginLeft: "auto" },
  placeName: { fontSize: 12, color: "#6B7280", fontFamily: "Inter_500Medium" },
  content: { fontSize: 13, color: Colors.text, fontFamily: "Inter_400Regular", lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },
  actionBtnSuccess: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  actionBtnDanger: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontSize: 15, color: "#6B7280", fontFamily: "Inter_600SemiBold" },
});
