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
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

type UserRole = "admin" | "colaborador" | "parceiro" | "estabelecimento" | "usuario";

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  colaborador: "Colaborador",
  parceiro: "Parceiro",
  estabelecimento: "Estabelecimento",
  usuario: "Usuário",
};

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  admin: { bg: "#FEE2E2", text: "#DC2626" },
  colaborador: { bg: "#DBEAFE", text: "#2563EB" },
  parceiro: { bg: "#D1FAE5", text: "#059669" },
  estabelecimento: { bg: "#FEF3C7", text: "#D97706" },
  usuario: { bg: "#F3F4F6", text: "#6B7280" },
};

export default function AdminUsuariosScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [roleModal, setRoleModal] = useState<AppUser | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("usuario");

  const { data, isLoading, refetch } = useQuery<{ users: AppUser[] }>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/users");
      return res.json();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error ?? "Erro ao atualizar role");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setRoleModal(null);
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
        throw new Error("Preencha todos os campos");
      }
      const res = await apiRequest("POST", "/api/admin/users", {
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar usuário");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreateModal(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("usuario");
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const users = data?.users ?? [];

  function renderUser({ item }: { item: AppUser }) {
    const roleStyle = ROLE_COLORS[item.role];
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>{item.email}</Text>
          </View>
          <Pressable
            onPress={() => setRoleModal(item)}
            style={[styles.roleBadge, { backgroundColor: roleStyle.bg }]}
          >
            <Text style={[styles.roleText, { color: roleStyle.text }]}>
              {ROLE_LABELS[item.role]}
            </Text>
            <Ionicons name="chevron-down" size={12} color={roleStyle.text} />
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
        <Text style={styles.headerTitle}>Usuários</Text>
        <Pressable onPress={() => setCreateModal(true)} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : users.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhum usuário encontrado</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Role Modal */}
      <Modal
        visible={!!roleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRoleModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Alterar Role</Text>
              <Pressable onPress={() => setRoleModal(null)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>{roleModal?.name}</Text>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
              <Pressable
                key={role}
                onPress={() => roleModal && updateRoleMutation.mutate({ id: roleModal.id, role })}
                style={[styles.roleOption, roleModal?.role === role && styles.roleOptionActive]}
                disabled={updateRoleMutation.isPending}
              >
                <Text style={[styles.roleOptionText, roleModal?.role === role && styles.roleOptionTextActive]}>
                  {ROLE_LABELS[role]}
                </Text>
                {roleModal?.role === role && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* Create Modal */}
      <Modal
        visible={createModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={[styles.modalContent, { marginTop: "auto" }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Criar Usuário</Text>
                <Pressable onPress={() => setCreateModal(false)}>
                  <Ionicons name="close" size={22} color={Colors.text} />
                </Pressable>
              </View>
              <Text style={styles.fieldLabel}>Nome</Text>
              <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Nome completo" placeholderTextColor="#9CA3AF" />
              <Text style={styles.fieldLabel}>E-mail</Text>
              <TextInput style={styles.input} value={newEmail} onChangeText={setNewEmail} placeholder="email@exemplo.com" placeholderTextColor="#9CA3AF" keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.fieldLabel}>Senha</Text>
              <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} placeholder="Mínimo 6 caracteres" placeholderTextColor="#9CA3AF" secureTextEntry />
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                  <Pressable
                    key={role}
                    onPress={() => setNewRole(role)}
                    style={[styles.roleChip, newRole === role && styles.roleChipActive]}
                  >
                    <Text style={[styles.roleChipText, newRole === role && styles.roleChipTextActive]}>
                      {ROLE_LABELS[role]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                style={[styles.saveBtn, createMutation.isPending && styles.saveBtnDisabled]}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Criar</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
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
  addBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardMeta: { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular", marginTop: 2 },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontSize: 15, color: "#6B7280", fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  modalSubtitle: { fontSize: 13, color: "#6B7280", fontFamily: "Inter_400Regular" },
  roleOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#F9FAFB",
  },
  roleOptionActive: { backgroundColor: Colors.primary + "15" },
  roleOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  roleOptionTextActive: { color: Colors.primary, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 13, color: "#374151", fontFamily: "Inter_500Medium", marginBottom: -4 },
  input: {
    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12,
    fontSize: 14, color: Colors.text, fontFamily: "Inter_400Regular", backgroundColor: "#F9FAFB",
  },
  roleChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  roleChipActive: { backgroundColor: Colors.primary + "15", borderColor: Colors.primary },
  roleChipText: { fontSize: 13, color: "#6B7280", fontFamily: "Inter_500Medium" },
  roleChipTextActive: { color: Colors.primary, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    backgroundColor: Colors.primary, padding: 14,
    borderRadius: 10, alignItems: "center", marginTop: 8,
  },
  saveBtnDisabled: { backgroundColor: "#9CA3AF" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
