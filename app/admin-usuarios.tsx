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

interface ClaimItem {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  place_id: string;
  place_name: string;
  place_address: string;
  contact_phone: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
  reviewed_at?: string | null;
}

const ALL_ROLES: UserRole[] = ["admin", "colaborador", "parceiro", "estabelecimento", "usuario"];
const COLABORADOR_ROLES: UserRole[] = ["usuario", "estabelecimento", "parceiro"];
const FILTER_ROLES: Array<UserRole | "todos"> = ["todos", "admin", "colaborador", "parceiro", "estabelecimento", "usuario"];

type TabKey = "usuarios" | "reivindicacoes";

export default function AdminUsuariosScreen() {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [activeTab, setActiveTab] = useState<TabKey>("usuarios");

  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [filterRole, setFilterRole] = useState<UserRole | "todos">("todos");

  const [claimFilter, setClaimFilter] = useState<"all" | "pending" | "approved" | "denied">("pending");

  const { data, isLoading, isError } = useQuery<{ users: ManagedUser[] }>({
    queryKey: ["/api/admin/users"],
  });

  const { data: claimsData, isLoading: claimsLoading, isError: claimsError } = useQuery<{ claims: ClaimItem[] }>({
    queryKey: ["/api/admin/claims", claimFilter],
    queryFn: async () => {
      const params = claimFilter !== "all" ? `?status=${claimFilter}` : "";
      const res = await apiRequest("GET", `/api/admin/claims${params}`);
      return res.json();
    },
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

  const reviewClaimMutation = useMutation({
    mutationFn: async ({ claimId, action }: { claimId: string; action: "approve" | "deny" }) => {
      const res = await apiRequest("PATCH", `/api/admin/claims/${claimId}`, { action });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao processar reivindicação");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/claims"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
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

  function handleApproveClaim(claim: ClaimItem) {
    Alert.alert(
      "Aprovar reivindicação",
      `Aprovar vínculo de "${claim.user_name}" com "${claim.place_name}"?\n\nO usuário será promovido para Estabelecimento e outros pedidos pendentes para este local serão negados automaticamente.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Aprovar",
          onPress: () => reviewClaimMutation.mutate({ claimId: claim.id, action: "approve" }),
        },
      ],
    );
  }

  function handleDenyClaim(claim: ClaimItem) {
    Alert.alert(
      "Negar reivindicação",
      `Negar solicitação de "${claim.user_name}" para "${claim.place_name}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Negar",
          style: "destructive",
          onPress: () => reviewClaimMutation.mutate({ claimId: claim.id, action: "deny" }),
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

  function renderClaim({ item }: { item: ClaimItem }) {
    const statusColors: Record<string, string> = {
      pending: "#D97706",
      approved: "#059669",
      denied: "#DC2626",
    };
    const statusLabels: Record<string, string> = {
      pending: "Pendente",
      approved: "Aprovado",
      denied: "Negado",
    };
    const statusIcons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
      pending: "time-outline",
      approved: "checkmark-circle-outline",
      denied: "close-circle-outline",
    };

    const color = statusColors[item.status] ?? "#6B7280";
    const isPending = item.status === "pending";
    const createdDate = new Date(item.created_at).toLocaleDateString("pt-BR");

    return (
      <View style={styles.claimCard}>
        <View style={styles.claimTopRow}>
          <View style={styles.claimUserInfo}>
            <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.claimUserName} numberOfLines={1}>{item.user_name}</Text>
          </View>
          <View style={[styles.claimStatusBadge, { backgroundColor: color + "18" }]}>
            <Ionicons name={statusIcons[item.status]} size={12} color={color} />
            <Text style={[styles.claimStatusText, { color }]}>{statusLabels[item.status]}</Text>
          </View>
        </View>

        <Text style={styles.claimUserEmail} numberOfLines={1}>{item.user_email}</Text>

        <View style={styles.claimPlaceRow}>
          <Ionicons name="storefront-outline" size={14} color={Colors.primary} />
          <Text style={styles.claimPlaceName} numberOfLines={1}>{item.place_name}</Text>
        </View>
        <View style={styles.claimAddressRow}>
          <Ionicons name="location-outline" size={12} color={Colors.textSecondary} />
          <Text style={styles.claimAddress} numberOfLines={2}>{item.place_address}</Text>
        </View>

        <View style={styles.claimPhoneRow}>
          <Ionicons name="call-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.claimPhone}>{item.contact_phone}</Text>
          <Text style={styles.claimDate}>{createdDate}</Text>
        </View>

        {isPending && (
          <View style={styles.claimActions}>
            <Pressable
              style={({ pressed }) => [
                styles.claimActionBtn,
                styles.claimDenyBtn,
                pressed && { opacity: 0.75 },
                reviewClaimMutation.isPending && { opacity: 0.5 },
              ]}
              onPress={() => handleDenyClaim(item)}
              disabled={reviewClaimMutation.isPending}
            >
              <Ionicons name="close" size={16} color="#DC2626" />
              <Text style={styles.claimDenyText}>Negar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.claimActionBtn,
                styles.claimApproveBtn,
                pressed && { opacity: 0.75 },
                reviewClaimMutation.isPending && { opacity: 0.5 },
              ]}
              onPress={() => handleApproveClaim(item)}
              disabled={reviewClaimMutation.isPending}
            >
              {reviewClaimMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={styles.claimApproveText}>Aprovar</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const totalCount = data?.users?.length ?? 0;
  const filteredCount = filteredUsers.length;
  const isFiltering = filterRole !== "todos" || searchEmail.trim() !== "";
  const claims = claimsData?.claims ?? [];

  const { data: pendingClaimsData } = useQuery<{ claims: ClaimItem[] }>({
    queryKey: ["/api/admin/claims", "pending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/claims?status=pending");
      return res.json();
    },
  });
  const pendingCount = pendingClaimsData?.claims?.length ?? 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Administração</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            activeTab === "usuarios" && styles.tabActive,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setActiveTab("usuarios")}
        >
          <Text style={[styles.tabText, activeTab === "usuarios" && styles.tabTextActive]}>
            Usuários
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            activeTab === "reivindicacoes" && styles.tabActive,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setActiveTab("reivindicacoes")}
        >
          <Text style={[styles.tabText, activeTab === "reivindicacoes" && styles.tabTextActive]}>
            Reivindicações
            {pendingCount > 0 && (
              <Text style={styles.tabBadge}> {pendingCount}</Text>
            )}
          </Text>
        </Pressable>
      </View>

      {activeTab === "usuarios" && (
        <>
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
        </>
      )}

      {activeTab === "reivindicacoes" && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {(["pending", "approved", "denied", "all"] as const).map((f) => {
              const labels = { pending: "Pendentes", approved: "Aprovadas", denied: "Negadas", all: "Todas" };
              const colors = { pending: "#D97706", approved: "#059669", denied: "#DC2626", all: Colors.primary };
              const isActive = claimFilter === f;
              const color = colors[f];
              return (
                <Pressable
                  key={f}
                  style={({ pressed }) => [
                    styles.filterChip,
                    isActive && { backgroundColor: color, borderColor: color },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => setClaimFilter(f)}
                >
                  <Text style={[
                    styles.filterChipText,
                    isActive && { color: "#fff" },
                    !isActive && { color },
                  ]}>
                    {labels[f]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {claimsLoading && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}

          {claimsError && (
            <View style={styles.centered}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
              <Text style={styles.errorText}>Não foi possível carregar as reivindicações</Text>
            </View>
          )}

          {!claimsLoading && !claimsError && (
            <FlatList
              data={claims}
              keyExtractor={(c) => c.id}
              renderItem={renderClaim}
              contentContainerStyle={[styles.list, { gap: 12 }]}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Ionicons name="document-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>
                    {claimFilter === "pending"
                      ? "Nenhuma reivindicação pendente"
                      : "Nenhuma reivindicação encontrada"}
                  </Text>
                </View>
              }
            />
          )}
        </>
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
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: "#fff",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  tabTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  tabBadge: {
    color: "#DC2626",
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
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
    minHeight: 200,
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
  claimCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
    gap: 4,
  },
  claimTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  claimUserInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  claimUserName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  claimStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  claimStatusText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  claimUserEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginBottom: 6,
  },
  claimPlaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  claimPlaceName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  claimAddressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  claimAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 16,
  },
  claimPhoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  claimPhone: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  claimDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  claimActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  claimActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
  },
  claimDenyBtn: {
    borderWidth: 1.5,
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
  },
  claimDenyText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#DC2626",
    fontFamily: "Inter_600SemiBold",
  },
  claimApproveBtn: {
    backgroundColor: "#059669",
  },
  claimApproveText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
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
