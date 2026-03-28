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
const FILTER_ROLES: Array<UserRole | "todos"> = ["todos", "admin", "colaborador", "parceiro", "estabelecimento", "usuario"];

export default function AdminUsuariosScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [filterRole, setFilterRole] = useState<UserRole | "todos">("todos");

  const { data, isLoading, isError } = useQuery<{ users: ManagedUser[] }>({
    queryKey: ["/api/admin/users"],
  });

  const filteredUsers = useMemo(() => {
    const all = data?.users ?? [];
    return all.filter((u) => {
      const matchesRole = filterRole === "todos" || u.role === filterRole;
      const matchesEmail = searchEmail.trim() === "" ||
        u.email.toLowerCase().includes(searchEmail.trim().toLowerCase());
      return matchesRole && matchesEmail;
    });
  }, [data?.users, filterRole, searchEmail]);

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

  const totalCount = data?.users?.length ?? 0;
  const filteredCount = filteredUsers.length;
  const isFiltering = filterRole !== "todos" || searchEmail.trim() !== "";

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

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por e-mail..."
          placeholderTextColor={Colors.textSecondary}
          value={searchEmail}
          onChangeText={setSearchEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchEmail.length > 0 && Platform.OS !== "ios" && (
          <Pressable onPress={() => setSearchEmail("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersRow}
      >
        {FILTER_ROLES.map((role) => {
          const isActive = filterRole === role;
          const color = role === "todos" ? Colors.primary : ROLE_COLORS[role as UserRole];
          return (
            <Pressable
              key={role}
              style={({ pressed }) => [
                styles.filterChip,
                isActive && { backgroundColor: color, borderColor: color },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => setFilterRole(role)}
            >
              {role !== "todos" && (
                <View style={[
                  styles.filterChipDot,
                  { backgroundColor: isActive ? "#fff" : color },
                ]} />
              )}
              <Text style={[
                styles.filterChipText,
                isActive && { color: "#fff" },
                !isActive && role !== "todos" && { color },
              ]}>
                {role === "todos" ? "Todos" : ROLE_LABELS[role as UserRole]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!isLoading && !isError && (
        <View style={styles.countRow}>
          <Text style={styles.countText}>
            {isFiltering
              ? `${filteredCount} de ${totalCount} usuário${totalCount !== 1 ? "s" : ""}`
              : `${totalCount} usuário${totalCount !== 1 ? "s" : ""}`}
          </Text>
          {isFiltering && (
            <Pressable onPress={() => { setFilterRole("todos"); setSearchEmail(""); }}>
              <Text style={styles.clearFilters}>Limpar filtros</Text>
            </Pressable>
          )}
        </View>
      )}

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
          data={filteredUsers}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="search-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>
                {isFiltering
                  ? "Nenhum usuário encontrado\ncom esses filtros"
                  : "Nenhum usuário encontrado"}
              </Text>
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  filtersRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: "#fff",
  },
  filterChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  countText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  clearFilters: {
    fontSize: 12,
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
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
    lineHeight: 22,
  },
  list: {
    paddingVertical: 4,
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
