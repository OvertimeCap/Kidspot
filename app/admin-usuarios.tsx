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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/auth-context";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

const ALL_ROLES: UserRole[] = ["admin", "colaborador", "parceiro", "estabelecimento", "usuario"];
const COLABORADOR_ROLES: UserRole[] = ["usuario", "estabelecimento", "parceiro"];

export default function AdminUsuariosScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [roleModalVisible, setRoleModalVisible] = useState(false);

  const { data, isLoading, isError } = useQuery<{ users: ManagedUser[] }>({
    queryKey: ["/api/admin/users"],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setRoleModalVisible(false);
      setSelectedUser(null);
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const availableRoles = me?.role === "admin" ? ALL_ROLES : COLABORADOR_ROLES;

  function openRoleModal(u: ManagedUser) {
    setSelectedUser(u);
    setRoleModalVisible(true);
  }

  function confirmRoleChange(role: UserRole) {
    if (!selectedUser) return;
    if (selectedUser.id === me?.id) {
      Alert.alert("Atenção", "Você não pode alterar seu próprio perfil.");
      return;
    }
    Alert.alert(
      "Confirmar alteração",
      `Alterar perfil de "${selectedUser.name}" para ${ROLE_LABELS[role]}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: () => updateRoleMutation.mutate({ userId: selectedUser.id, role }),
        },
      ],
    );
  }

  function renderUser({ item }: { item: ManagedUser }) {
    const roleColor = ROLE_COLORS[item.role] ?? "#6B7280";
    const roleLabel = ROLE_LABELS[item.role] ?? item.role;
    const initials = item.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    const isSelf = item.id === me?.id;
    const canEdit =
      !isSelf &&
      (me?.role === "admin" ||
        (me?.role === "colaborador" && COLABORADOR_ROLES.includes(item.role)));

    return (
      <View style={styles.userCard}>
        <View style={[styles.userAvatar, { backgroundColor: roleColor }]}>
          <Text style={styles.userAvatarText}>{initials}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.name}
            {isSelf && <Text style={styles.selfTag}> (você)</Text>}
          </Text>
          <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + "18" }]}>
            <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
            <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
        </View>
        {canEdit && (
          <Pressable
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
            onPress={() => openRoleModal(item)}
            testID={`edit-role-${item.id}`}
          >
            <Ionicons name="create-outline" size={20} color="#2563EB" />
          </Pressable>
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
        <Text style={styles.headerTitle}>Gerenciar usuários</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {isError && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>Não foi possível carregar os usuários</Text>
        </View>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={data?.users ?? []}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>Nenhum usuário encontrado</Text>
            </View>
          }
        />
      )}

      <Modal
        visible={roleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRoleModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setRoleModalVisible(false)}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              Alterar perfil de{"\n"}
              <Text style={styles.modalUserName}>{selectedUser?.name}</Text>
            </Text>
            {availableRoles.map((role) => {
              const color = ROLE_COLORS[role];
              const isCurrent = selectedUser?.role === role;
              return (
                <Pressable
                  key={role}
                  style={({ pressed }) => [
                    styles.roleOption,
                    isCurrent && styles.roleOptionActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => confirmRoleChange(role)}
                  disabled={isCurrent || updateRoleMutation.isPending}
                >
                  <View style={[styles.roleOptionDot, { backgroundColor: color }]} />
                  <Text style={[styles.roleOptionLabel, isCurrent && { color }]}>
                    {ROLE_LABELS[role]}
                  </Text>
                  {isCurrent && (
                    <Ionicons name="checkmark" size={18} color={color} style={{ marginLeft: "auto" }} />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.75 }]}
              onPress={() => setRoleModalVisible(false)}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
          </View>
        </Pressable>
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
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  errorText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  list: {
    padding: 16,
    gap: 0,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 4,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 0,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  userAvatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  userInfo: {
    flex: 1,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  selfTag: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
  },
  userEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  roleDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  roleText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  editBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 4,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
    lineHeight: 22,
  },
  modalUserName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  roleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  roleOptionActive: {
    backgroundColor: Colors.background,
  },
  roleOptionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  roleOptionLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.text,
    fontFamily: "Inter_500Medium",
  },
  cancelBtn: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
  },
});
