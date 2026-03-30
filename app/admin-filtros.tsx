import React, { useState } from "react";
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

interface AppFilter {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  seasonal: boolean;
  starts_at: string | null;
  ends_at: string | null;
  criteria: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const ICON_OPTIONS = [
  "filter", "sunny", "snow", "leaf", "gift", "star", "heart",
  "home", "cafe", "restaurant", "walk", "bicycle", "boat",
  "happy", "balloon", "football", "basketball", "musical-notes",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function FilterCard({
  filter,
  onToggle,
  onEdit,
}: {
  filter: AppFilter;
  onToggle: (id: string) => void;
  onEdit: (filter: AppFilter) => void;
}) {
  const isExpired = filter.seasonal && filter.ends_at && new Date(filter.ends_at) < new Date();

  return (
    <View style={[styles.card, !filter.active && styles.cardInactive]}>
      <View style={styles.cardLeft}>
        <View style={[styles.iconCircle, !filter.active && styles.iconCircleInactive]}>
          <Ionicons
            name={(filter.icon || "filter") as keyof typeof Ionicons.glyphMap}
            size={22}
            color={filter.active ? Colors.primary : Colors.textLight}
          />
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.filterName, !filter.active && styles.filterNameInactive]}>
            {filter.name}
          </Text>
          <View style={styles.tagRow}>
            {filter.seasonal && (
              <View style={[styles.tag, styles.tagSeasonal]}>
                <Text style={styles.tagText}>Sazonal</Text>
              </View>
            )}
            {isExpired && (
              <View style={[styles.tag, styles.tagExpired]}>
                <Text style={styles.tagText}>Expirado</Text>
              </View>
            )}
            {filter.seasonal && filter.starts_at && (
              <Text style={styles.dateText}>
                {formatDate(filter.starts_at)} – {formatDate(filter.ends_at)}
              </Text>
            )}
          </View>
        </View>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
          onPress={() => onEdit(filter)}
        >
          <Ionicons name="pencil-outline" size={18} color={Colors.primary} />
        </Pressable>
        <Switch
          value={filter.active}
          onValueChange={() => onToggle(filter.id)}
          trackColor={{ false: Colors.border, true: Colors.primary + "88" }}
          thumbColor={filter.active ? Colors.primary : Colors.textLight}
        />
      </View>
    </View>
  );
}

interface FilterFormData {
  name: string;
  icon: string;
  active: boolean;
  seasonal: boolean;
  starts_at: string;
  ends_at: string;
}

function FilterFormModal({
  visible,
  onClose,
  onSave,
  initial,
  saving,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: FilterFormData) => void;
  initial?: AppFilter | null;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "filter");
  const [active, setActive] = useState(initial?.active ?? true);
  const [seasonal, setSeasonal] = useState(initial?.seasonal ?? false);
  const [startsAt, setStartsAt] = useState(
    initial?.starts_at ? initial.starts_at.slice(0, 10) : "",
  );
  const [endsAt, setEndsAt] = useState(
    initial?.ends_at ? initial.ends_at.slice(0, 10) : "",
  );

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setIcon(initial?.icon ?? "filter");
      setActive(initial?.active ?? true);
      setSeasonal(initial?.seasonal ?? false);
      setStartsAt(initial?.starts_at ? initial.starts_at.slice(0, 10) : "");
      setEndsAt(initial?.ends_at ? initial.ends_at.slice(0, 10) : "");
    }
  }, [visible, initial]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("Erro", "Nome é obrigatório");
      return;
    }
    onSave({
      name: name.trim(),
      icon,
      active,
      seasonal,
      starts_at: seasonal && startsAt ? `${startsAt}T00:00:00.000Z` : "",
      ends_at: seasonal && endsAt ? `${endsAt}T23:59:59.000Z` : "",
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalCloseBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.modalTitle}>{initial ? "Editar Filtro" : "Novo Filtro"}</Text>
          <Pressable onPress={handleSave} style={[styles.saveBtn, saving && styles.saveBtnDisabled]} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Salvar</Text>
            )}
          </Pressable>
        </View>
        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nome *</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="Ex: Especial Férias"
            placeholderTextColor={Colors.textLight}
          />

          <Text style={styles.fieldLabel}>Ícone</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconRow}>
            {ICON_OPTIONS.map((ic) => (
              <Pressable
                key={ic}
                style={[styles.iconOption, icon === ic && styles.iconOptionSelected]}
                onPress={() => setIcon(ic)}
              >
                <Ionicons
                  name={ic as keyof typeof Ionicons.glyphMap}
                  size={24}
                  color={icon === ic ? Colors.primary : Colors.textLight}
                />
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Ativo</Text>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ false: Colors.border, true: Colors.primary + "88" }}
              thumbColor={active ? Colors.primary : Colors.textLight}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Sazonal (com data de expiração)</Text>
            <Switch
              value={seasonal}
              onValueChange={setSeasonal}
              trackColor={{ false: Colors.border, true: Colors.primary + "88" }}
              thumbColor={seasonal ? Colors.primary : Colors.textLight}
            />
          </View>

          {seasonal && (
            <>
              <Text style={styles.fieldLabel}>Data de início (AAAA-MM-DD)</Text>
              <TextInput
                style={styles.textInput}
                value={startsAt}
                onChangeText={setStartsAt}
                placeholder="2026-07-01"
                placeholderTextColor={Colors.textLight}
                keyboardType="numeric"
              />
              <Text style={styles.fieldLabel}>Data de fim (AAAA-MM-DD)</Text>
              <TextInput
                style={styles.textInput}
                value={endsAt}
                onChangeText={setEndsAt}
                placeholder="2026-08-31"
                placeholderTextColor={Colors.textLight}
                keyboardType="numeric"
              />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function AdminFiltrosScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingFilter, setEditingFilter] = useState<AppFilter | null>(null);

  const { data, isLoading, isError } = useQuery<{ filters: AppFilter[] }>({
    queryKey: ["/api/admin/filters"],
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/admin/filters/${id}/toggle`, {}).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/filters"] }),
    onError: (err) => Alert.alert("Erro", (err as Error).message),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { id?: string; data: FilterFormData }) => {
      const body = {
        name: payload.data.name,
        icon: payload.data.icon,
        active: payload.data.active,
        seasonal: payload.data.seasonal,
        starts_at: payload.data.starts_at || null,
        ends_at: payload.data.ends_at || null,
      };
      if (payload.id) {
        return apiRequest("PATCH", `/api/admin/filters/${payload.id}`, body).then((r) => r.json());
      }
      return apiRequest("POST", "/api/admin/filters", body).then((r) => r.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/filters"] });
      setModalVisible(false);
      setEditingFilter(null);
    },
    onError: (err) => Alert.alert("Erro", (err as Error).message),
  });

  const handleEdit = (filter: AppFilter) => {
    setEditingFilter(filter);
    setModalVisible(true);
  };

  const handleNewFilter = () => {
    setEditingFilter(null);
    setModalVisible(true);
  };

  const handleSave = (formData: FilterFormData) => {
    saveMutation.mutate({ id: editingFilter?.id, data: formData });
  };

  if (!me || (me.role !== "admin" && me.role !== "colaborador")) {
    return (
      <View style={[styles.centered, { paddingTop: topPad }]}>
        <Ionicons name="lock-closed-outline" size={48} color={Colors.textLight} />
        <Text style={styles.emptyText}>Acesso restrito a administradores</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Controle de Filtros</Text>
        <Pressable style={styles.addBtn} onPress={handleNewFilter}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {isError && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>Erro ao carregar filtros</Text>
        </View>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={data?.filters ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 + 16 : insets.bottom + 16 },
          ]}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="options-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>Nenhum filtro cadastrado</Text>
              <Pressable style={styles.primaryBtn} onPress={handleNewFilter}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Criar Filtro</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <FilterCard
              filter={item}
              onToggle={(id) => toggleMutation.mutate(id)}
              onEdit={handleEdit}
            />
          )}
        />
      )}

      <FilterFormModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditingFilter(null);
        }}
        onSave={handleSave}
        initial={editingFilter}
        saving={saveMutation.isPending}
      />
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
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  addBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 6,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardInactive: {
    opacity: 0.65,
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleInactive: {
    backgroundColor: Colors.border,
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  filterName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  filterNameInactive: {
    color: Colors.textLight,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagSeasonal: {
    backgroundColor: Colors.primary + "22",
  },
  tagExpired: {
    backgroundColor: Colors.error + "22",
  },
  tagText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
  },
  dateText: {
    fontSize: 11,
    color: Colors.textLight,
    fontFamily: "Inter_400Regular",
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  editBtn: {
    padding: 6,
  },
  btnPressed: {
    opacity: 0.7,
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
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  modalBody: {
    flex: 1,
    padding: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
    marginTop: 16,
  },
  textInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    backgroundColor: "#fafafa",
  },
  iconRow: {
    flexDirection: "row",
  },
  iconOption: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  iconOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "12",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
});
