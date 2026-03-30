import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
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
  user_name: string | null;
  user_email: string | null;
  status: FeedbackStatus;
  created_at: string;
  resolved_at: string | null;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  sugestao: "Sugestão",
  denuncia: "Denúncia",
  fechado: "Fechado",
};

const TYPE_ICONS: Record<FeedbackType, string> = {
  sugestao: "add-circle-outline",
  denuncia: "warning-outline",
  fechado: "close-circle-outline",
};

const TYPE_COLORS: Record<FeedbackType, string> = {
  sugestao: "#3b82f6",
  denuncia: "#ef4444",
  fechado: "#f59e0b",
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  pendente: "Pendente",
  resolvido: "Resolvido",
  rejeitado: "Rejeitado",
};

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  pendente: "#f59e0b",
  resolvido: "#22c55e",
  rejeitado: "#9ca3af",
};

type TabKey = "sugestao" | "denuncia" | "fechado" | "todos";

const TABS: { key: TabKey; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "sugestao", label: "Sugestões" },
  { key: "denuncia", label: "Denúncias" },
  { key: "fechado", label: "Fechados" },
];

function FeedbackCard({
  item,
  onAction,
  actionLoading: loadingId,
}: {
  item: FeedbackItem;
  onAction: (id: string, action: "resolver" | "rejeitar" | "adicionar_fila") => void;
  actionLoading: string | null;
}) {
  const isLoading = loadingId === item.id;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, { backgroundColor: TYPE_COLORS[item.type] + "20" }]}>
          <Ionicons
            name={TYPE_ICONS[item.type] as keyof typeof Ionicons.glyphMap}
            size={14}
            color={TYPE_COLORS[item.type]}
          />
          <Text style={[styles.typeBadgeText, { color: TYPE_COLORS[item.type] }]}>
            {TYPE_LABELS[item.type]}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + "20" }]}>
          <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <Text style={styles.content}>{item.content}</Text>

      {item.place_name && (
        <View style={styles.placeRow}>
          <Ionicons name="location-outline" size={13} color={Colors.textLight} />
          <Text style={styles.placeText} numberOfLines={1}>{item.place_name}</Text>
        </View>
      )}

      <View style={styles.metaRow}>
        {item.user_name && (
          <View style={styles.metaItem}>
            <Ionicons name="person-outline" size={12} color={Colors.textLight} />
            <Text style={styles.metaText}>{item.user_name}</Text>
          </View>
        )}
        <Text style={styles.dateText}>
          {new Date(item.created_at).toLocaleDateString("pt-BR")}
        </Text>
      </View>

      {item.status === "pendente" && (
        <View style={styles.actionsRow}>
          {item.type === "sugestao" && (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnQueue, pressed && styles.btnPressed]}
              onPress={() => onAction(item.id, "adicionar_fila")}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Adicionar à fila</Text>
                </>
              )}
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnResolve, pressed && styles.btnPressed]}
            onPress={() => onAction(item.id, "resolver")}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={14} color="#fff" />
                <Text style={styles.actionBtnText}>Resolvido</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnReject, pressed && styles.btnPressed]}
            onPress={() => onAction(item.id, "rejeitar")}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="close-circle" size={14} color="#fff" />
                <Text style={styles.actionBtnText}>Rejeitar</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function AdminFeedbackScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [activeTab, setActiveTab] = useState<TabKey>("todos");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const typeParam = activeTab !== "todos" ? activeTab : undefined;

  const { data, isLoading, isError } = useQuery<{ feedback: FeedbackItem[]; unreadCount: number }>({
    queryKey: ["/api/admin/feedback", activeTab],
    queryFn: async () => {
      const params = typeParam ? `?type=${typeParam}` : "";
      const res = await apiRequest("GET", `/api/admin/feedback${params}`);
      return res.json();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/feedback/${id}`, { action });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/feedback"] });
      setActionLoadingId(null);
    },
    onError: (err) => {
      setActionLoadingId(null);
      Alert.alert("Erro", (err as Error).message);
    },
  });

  const handleAction = (id: string, action: "resolver" | "rejeitar" | "adicionar_fila") => {
    const labels: Record<string, string> = {
      resolver: "Marcar como resolvido?",
      rejeitar: "Rejeitar este feedback?",
      adicionar_fila: "Adicionar lugar à fila de curadoria?",
    };
    Alert.alert("Confirmar", labels[action], [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Confirmar",
        onPress: () => {
          setActionLoadingId(id);
          actionMutation.mutate({ id, action });
        },
      },
    ]);
  };

  if (!me || (me.role !== "admin" && me.role !== "colaborador")) {
    return (
      <View style={[styles.centered, { paddingTop: topPad }]}>
        <Ionicons name="lock-closed-outline" size={48} color={Colors.textLight} />
        <Text style={styles.emptyText}>Acesso restrito a administradores</Text>
      </View>
    );
  }

  const feedbackList = data?.feedback ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Caixa de Entrada</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : String(unreadCount)}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {isError && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>Erro ao carregar feedbacks</Text>
        </View>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={feedbackList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 + 16 : insets.bottom + 16 },
          ]}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="chatbox-ellipses-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>Nenhum feedback encontrado</Text>
            </View>
          }
          renderItem={({ item }) => (
            <FeedbackCard
              item={item}
              onAction={handleAction}
              actionLoading={actionLoadingId}
            />
          )}
        />
      )}
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  badge: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  tabsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: "#fff",
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
    fontSize: 13,
    color: Colors.textLight,
    fontFamily: "Inter_500Medium",
  },
  tabTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  placeText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
  dateText: {
    fontSize: 12,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 4,
    flexWrap: "wrap",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionBtnQueue: {
    backgroundColor: Colors.primary,
  },
  actionBtnResolve: {
    backgroundColor: "#22c55e",
  },
  actionBtnReject: {
    backgroundColor: "#9ca3af",
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  btnPressed: {
    opacity: 0.75,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 14,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: Colors.error,
    fontSize: 15,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
});
