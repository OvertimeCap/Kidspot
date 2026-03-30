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
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKOFFICE_TOKEN_KEY = "backoffice_token";
const BACKOFFICE_USER_KEY = "backoffice_user";

type BackofficeRole = "super_admin" | "admin" | "curador" | "analista";
type BackofficeStatus = "ativo" | "pendente" | "inativo";

const ROLE_LABELS: Record<BackofficeRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  curador: "Curador",
  analista: "Analista",
};

const ROLE_COLORS: Record<BackofficeRole, string> = {
  super_admin: "#7C3AED",
  admin: "#2563EB",
  curador: "#D97706",
  analista: "#059669",
};

const STATUS_LABELS: Record<BackofficeStatus, string> = {
  ativo: "Ativo",
  pendente: "Pendente",
  inativo: "Inativo",
};

const STATUS_COLORS: Record<BackofficeStatus, string> = {
  ativo: "#059669",
  pendente: "#D97706",
  inativo: "#6B7280",
};

interface BackofficeUser {
  id: string;
  name: string;
  email: string;
  role: BackofficeRole;
  status: BackofficeStatus;
  created_at: string;
  last_active_at?: string | null;
}

interface AuditEntry {
  id: string;
  user_id: string;
  user_email: string;
  user_role: string;
  action: string;
  module: string;
  target_id?: string | null;
  payload_before?: Record<string, unknown> | null;
  payload_after?: Record<string, unknown> | null;
  ip?: string | null;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

type TabKey = "usuarios" | "audit" | "login";

const BACKOFFICE_MODULES_PT: Record<string, string> = {
  auth: "Autenticação",
  gestao_prompts: "Gestão de Prompts",
  filtros_app: "Filtros do App",
  kidscore: "KidScore",
  criterios_customizados: "Critérios Customizados",
  fila_curadoria: "Fila de Curadoria",
  galeria: "Galeria",
  operacao_ia: "Operação de IA",
  comunidade: "Comunidade",
  gestao_cidades: "Gestão de Cidades",
  provedores_ia: "Provedores de IA",
  gestao_usuarios: "Gestão de Usuários",
  parcerias: "Parcerias",
};

type PermissionLevel = "full" | "read" | "none" | "partial";

const PERMISSION_MATRIX: Record<string, Record<BackofficeRole, PermissionLevel>> = {
  gestao_prompts: { super_admin: "full", admin: "full", curador: "none", analista: "read" },
  filtros_app: { super_admin: "full", admin: "full", curador: "none", analista: "read" },
  kidscore: { super_admin: "full", admin: "full", curador: "none", analista: "read" },
  criterios_customizados: { super_admin: "full", admin: "full", curador: "none", analista: "none" },
  fila_curadoria: { super_admin: "full", admin: "full", curador: "full", analista: "read" },
  galeria: { super_admin: "full", admin: "full", curador: "full", analista: "none" },
  operacao_ia: { super_admin: "full", admin: "full", curador: "partial", analista: "read" },
  comunidade: { super_admin: "full", admin: "full", curador: "full", analista: "read" },
  gestao_cidades: { super_admin: "full", admin: "full", curador: "none", analista: "read" },
  provedores_ia: { super_admin: "full", admin: "none", curador: "none", analista: "none" },
  gestao_usuarios: { super_admin: "full", admin: "none", curador: "none", analista: "none" },
  parcerias: { super_admin: "full", admin: "full", curador: "read", analista: "read" },
};

function PermissionsMatrix({ role }: { role: BackofficeRole }) {
  const getPermIcon = (level: PermissionLevel) => {
    switch (level) {
      case "full": return { name: "checkmark-circle" as const, color: "#059669" };
      case "read": return { name: "eye" as const, color: "#2563EB" };
      case "partial": return { name: "ellipsis-horizontal-circle" as const, color: "#D97706" };
      case "none": return { name: "close-circle" as const, color: "#D1D5DB" };
    }
  };
  const getPermLabel = (level: PermissionLevel) => {
    switch (level) {
      case "full": return "Acesso total";
      case "read": return "Somente leitura";
      case "partial": return "Parcial";
      case "none": return "Sem acesso";
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.text, fontFamily: "Inter_600SemiBold", marginBottom: 4 }}>
        Suas permissões de acesso
      </Text>
      {Object.entries(PERMISSION_MATRIX).map(([mod, perms]) => {
        const level = perms[role];
        const icon = getPermIcon(level);
        return (
          <View key={mod} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 10, padding: 12 }}>
            <Ionicons name={icon.name} size={18} color={icon.color} />
            <Text style={{ flex: 1, fontSize: 13, color: Colors.text, fontFamily: "Inter_400Regular" }}>
              {BACKOFFICE_MODULES_PT[mod]}
            </Text>
            <Text style={{ fontSize: 11, color: icon.color, fontFamily: "Inter_600SemiBold" }}>
              {getPermLabel(level)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
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

export default function BackofficeRBACScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [activeTab, setActiveTab] = useState<TabKey>("login");
  const [backofficeToken, setBackofficeToken] = useState<string | null>(null);
  const [backofficeUser, setBackofficeUser] = useState<{ id: string; name: string; email: string; role: BackofficeRole; status: BackofficeStatus } | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<BackofficeRole>("analista");

  const [selectedUser, setSelectedUser] = useState<BackofficeUser | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);

  const [auditPage, setAuditPage] = useState(0);
  const [auditModuleFilter, setAuditModuleFilter] = useState<string>("all");
  const [auditUserFilter, setAuditUserFilter] = useState<string>("");
  const [auditDateFrom, setAuditDateFrom] = useState<string>("");
  const [auditDateTo, setAuditDateTo] = useState<string>("");

  React.useEffect(() => {
    (async () => {
      const savedToken = await AsyncStorage.getItem(BACKOFFICE_TOKEN_KEY);
      const savedUser = await AsyncStorage.getItem(BACKOFFICE_USER_KEY);
      if (savedToken && savedUser) {
        setBackofficeToken(savedToken);
        setBackofficeUser(JSON.parse(savedUser));
        setActiveTab("usuarios");
      }
    })();
  }, []);

  const isSuperAdmin = backofficeUser?.role === "super_admin";

  async function handleLogout() {
    await AsyncStorage.removeItem(BACKOFFICE_TOKEN_KEY);
    await AsyncStorage.removeItem(BACKOFFICE_USER_KEY);
    setBackofficeToken(null);
    setBackofficeUser(null);
    setActiveTab("login");
  }

  React.useEffect(() => {
    if (!backofficeToken) return;
    const REFRESH_INTERVAL_MS = 45 * 60 * 1000;
    const id = setInterval(async () => {
      try {
        const res = await backofficeRequest("POST", "/api/backoffice/auth/refresh");
        if (res.status === 401) {
          clearInterval(id);
          handleLogout();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          await AsyncStorage.setItem(BACKOFFICE_TOKEN_KEY, data.token);
          setBackofficeToken(data.token);
        }
      } catch {
        // network error — keep session, will retry next interval
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [backofficeToken]);

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: BackofficeUser[] }>({
    queryKey: ["/api/backoffice/users", backofficeToken],
    queryFn: async () => {
      const res = await backofficeRequest("GET", "/api/backoffice/users");
      if (res.status === 401) { handleLogout(); throw new Error("Sessão expirada"); }
      if (!res.ok) throw new Error("Erro ao carregar usuários");
      return res.json();
    },
    enabled: !!backofficeToken && isSuperAdmin && activeTab === "usuarios",
  });

  const { data: auditData, isLoading: auditLoading } = useQuery<AuditResponse>({
    queryKey: ["/api/backoffice/audit-log", backofficeToken, auditPage, auditModuleFilter, auditUserFilter, auditDateFrom, auditDateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(auditPage * 50),
        ...(auditModuleFilter !== "all" ? { module: auditModuleFilter } : {}),
        ...(auditUserFilter.trim() ? { user_email: auditUserFilter.trim() } : {}),
        ...(auditDateFrom ? { date_from: auditDateFrom } : {}),
        ...(auditDateTo ? { date_to: auditDateTo } : {}),
      });
      const res = await backofficeRequest("GET", `/api/backoffice/audit-log?${params}`);
      if (res.status === 401) { handleLogout(); throw new Error("Sessão expirada"); }
      if (!res.ok) throw new Error("Erro ao carregar log de auditoria");
      return res.json();
    },
    enabled: !!backofficeToken && isSuperAdmin && activeTab === "audit",
  });

  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError("Preencha e-mail e senha");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await backofficeRequest("POST", "/api/backoffice/auth/login", {
        email: loginEmail.trim(),
        password: loginPassword,
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error ?? "Erro ao fazer login");
        return;
      }
      await AsyncStorage.setItem(BACKOFFICE_TOKEN_KEY, data.token);
      await AsyncStorage.setItem(BACKOFFICE_USER_KEY, JSON.stringify(data.user));
      setBackofficeToken(data.token);
      setBackofficeUser(data.user);
      setLoginPassword("");
      setActiveTab("usuarios");
    } catch {
      setLoginError("Erro de conexão. Tente novamente.");
    } finally {
      setLoginLoading(false);
    }
  }

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await backofficeRequest("POST", "/api/backoffice/users/invite", {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao convidar usuário");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/backoffice/users"] });
      setInviteModalVisible(false);
      setInviteName("");
      setInviteEmail("");
      setInviteRole("analista");
      Alert.alert(
        "Convite enviado",
        `Usuário convidado com sucesso!\n\nLink de ativação:\n${data.activationLink}`,
      );
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: BackofficeRole }) => {
      const res = await backofficeRequest("PATCH", `/api/backoffice/users/${userId}/role`, { role });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao alterar perfil");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/backoffice/users"] });
      setEditModalVisible(false);
      setSelectedUser(null);
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "ativo" | "inativo" }) => {
      const res = await backofficeRequest("PATCH", `/api/backoffice/users/${userId}/status`, { status });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao alterar status");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/backoffice/users"] });
      setEditModalVisible(false);
      setSelectedUser(null);
    },
    onError: (err: Error) => Alert.alert("Erro", err.message),
  });

  function handleToggleStatus(user: BackofficeUser) {
    const newStatus = user.status === "ativo" ? "inativo" : "ativo";
    const action = newStatus === "ativo" ? "ativar" : "desativar";
    Alert.alert(
      `${newStatus === "ativo" ? "Ativar" : "Desativar"} usuário`,
      `Deseja ${action} o acesso de "${user.name}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: newStatus === "ativo" ? "Ativar" : "Desativar",
          style: newStatus === "inativo" ? "destructive" : "default",
          onPress: () => updateStatusMutation.mutate({ userId: user.id, status: newStatus }),
        },
      ],
    );
  }

  function renderBackofficeUser({ item }: { item: BackofficeUser }) {
    const roleColor = ROLE_COLORS[item.role] ?? "#6B7280";
    const statusColor = STATUS_COLORS[item.status] ?? "#6B7280";
    const initials = item.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    const isSelf = item.id === backofficeUser?.id;

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
          <View style={styles.badgesRow}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + "18" }]}>
              <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
              <Text style={[styles.roleText, { color: roleColor }]}>{ROLE_LABELS[item.role]}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[item.status]}</Text>
            </View>
          </View>
        </View>
        {!isSelf && (
          <Pressable
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              setSelectedUser(item);
              setEditModalVisible(true);
            }}
            testID={`edit-bo-user-${item.id}`}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#6B7280" />
          </Pressable>
        )}
      </View>
    );
  }

  function renderAuditEntry({ item }: { item: AuditEntry }) {
    const moduleLabel = BACKOFFICE_MODULES_PT[item.module] ?? item.module;
    const date = new Date(item.created_at);
    const dateStr = `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const roleColor = ROLE_COLORS[item.user_role as BackofficeRole] ?? "#6B7280";
    const hasDiff = item.payload_before || item.payload_after;

    return (
      <View style={styles.auditCard}>
        <View style={styles.auditTopRow}>
          <Text style={styles.auditAction}>{item.action}</Text>
          <Text style={styles.auditDate}>{dateStr}</Text>
        </View>
        <View style={styles.auditMetaRow}>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + "18" }]}>
            <Text style={[styles.roleText, { color: roleColor }]}>{ROLE_LABELS[item.user_role as BackofficeRole] ?? item.user_role}</Text>
          </View>
          <Text style={styles.auditUser} numberOfLines={1}>{item.user_email}</Text>
        </View>
        <View style={styles.auditModuleRow}>
          <Ionicons name="cube-outline" size={12} color={Colors.textSecondary} />
          <Text style={styles.auditModule}>{moduleLabel}</Text>
          {item.target_id && (
            <Text style={styles.auditTarget} numberOfLines={1}>· {item.target_id}</Text>
          )}
        </View>
        {hasDiff && (
          <View style={styles.auditDiff}>
            {item.payload_before && (
              <View style={styles.auditDiffBefore}>
                <Text style={styles.auditDiffLabel}>Antes:</Text>
                <Text style={styles.auditDiffValue}>{JSON.stringify(item.payload_before)}</Text>
              </View>
            )}
            {item.payload_after && (
              <View style={styles.auditDiffAfter}>
                <Text style={styles.auditDiffLabel}>Depois:</Text>
                <Text style={styles.auditDiffValue}>{JSON.stringify(item.payload_after)}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  if (!backofficeToken || activeTab === "login") {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Backoffice</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.loginCard}>
            <View style={styles.loginIcon}>
              <Ionicons name="shield-checkmark" size={40} color={Colors.primary} />
            </View>
            <Text style={styles.loginTitle}>Acesso ao Backoffice</Text>
            <Text style={styles.loginSubtitle}>
              Esta área é restrita a colaboradores autorizados do backoffice.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>E-mail</Text>
              <TextInput
                style={styles.input}
                value={loginEmail}
                onChangeText={setLoginEmail}
                placeholder="seu@email.com"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="bo-login-email"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Senha</Text>
              <TextInput
                style={styles.input}
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry
                testID="bo-login-password"
              />
            </View>

            {loginError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
                <Text style={styles.errorBoxText}>{loginError}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.85 }, loginLoading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loginLoading}
              testID="bo-login-btn"
            >
              {loginLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.loginBtnText}>Entrar</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Backoffice RBAC</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {backofficeUser?.name} · {ROLE_LABELS[backofficeUser!.role]}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
          testID="bo-logout-btn"
        >
          <Ionicons name="log-out-outline" size={22} color="#DC2626" />
        </Pressable>
      </View>

      {isSuperAdmin && (
        <View style={styles.tabs}>
          <Pressable
            style={({ pressed }) => [styles.tab, activeTab === "usuarios" && styles.tabActive, pressed && { opacity: 0.8 }]}
            onPress={() => setActiveTab("usuarios")}
          >
            <Text style={[styles.tabText, activeTab === "usuarios" && styles.tabTextActive]}>Colaboradores</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tab, activeTab === "audit" && styles.tabActive, pressed && { opacity: 0.8 }]}
            onPress={() => setActiveTab("audit")}
          >
            <Text style={[styles.tabText, activeTab === "audit" && styles.tabTextActive]}>Auditoria</Text>
          </Pressable>
        </View>
      )}

      {!isSuperAdmin && (
        <>
          <View style={styles.permissionsCard}>
            <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
            <Text style={styles.permissionsText}>
              Seu perfil é <Text style={{ fontFamily: "Inter_600SemiBold" }}>{ROLE_LABELS[backofficeUser!.role]}</Text>.
              Gestão de usuários e auditoria são exclusivas para Super Admins.
            </Text>
          </View>
          <PermissionsMatrix role={backofficeUser!.role} />
        </>
      )}

      {isSuperAdmin && activeTab === "usuarios" && (
        <>
          <Pressable
            style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.85 }]}
            onPress={() => setInviteModalVisible(true)}
            testID="bo-invite-btn"
          >
            <Ionicons name="person-add-outline" size={18} color="#fff" />
            <Text style={styles.inviteBtnText}>Convidar Colaborador</Text>
          </Pressable>

          {usersLoading && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}

          {!usersLoading && (
            <FlatList
              data={usersData?.users ?? []}
              keyExtractor={(u) => u.id}
              renderItem={renderBackofficeUser}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Ionicons name="people-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>Nenhum colaborador cadastrado</Text>
                </View>
              }
            />
          )}
        </>
      )}

      {isSuperAdmin && activeTab === "audit" && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {["all", ...Object.keys(BACKOFFICE_MODULES_PT)].map((mod) => {
              const isActive = auditModuleFilter === mod;
              return (
                <Pressable
                  key={mod}
                  style={({ pressed }) => [
                    styles.filterChip,
                    isActive && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => { setAuditModuleFilter(mod); setAuditPage(0); }}
                >
                  <Text style={[styles.filterChipText, isActive && { color: "#fff" }]}>
                    {mod === "all" ? "Todos" : BACKOFFICE_MODULES_PT[mod]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.auditFiltersRow}>
            <TextInput
              style={[styles.input, styles.auditFilterInput]}
              placeholder="Filtrar por e-mail do usuário"
              placeholderTextColor={Colors.textSecondary}
              value={auditUserFilter}
              onChangeText={(v) => { setAuditUserFilter(v); setAuditPage(0); }}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <View style={styles.auditDateRow}>
              <TextInput
                style={[styles.input, styles.auditDateInput]}
                placeholder="De (AAAA-MM-DD)"
                placeholderTextColor={Colors.textSecondary}
                value={auditDateFrom}
                onChangeText={(v) => { setAuditDateFrom(v); setAuditPage(0); }}
              />
              <TextInput
                style={[styles.input, styles.auditDateInput]}
                placeholder="Até (AAAA-MM-DD)"
                placeholderTextColor={Colors.textSecondary}
                value={auditDateTo}
                onChangeText={(v) => { setAuditDateTo(v); setAuditPage(0); }}
              />
            </View>
          </View>

          {auditData && (
            <Text style={styles.auditCount}>
              {auditData.total} registro{auditData.total !== 1 ? "s" : ""} · Página {auditPage + 1}
            </Text>
          )}

          {auditLoading && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}

          {!auditLoading && (
            <FlatList
              data={auditData?.entries ?? []}
              keyExtractor={(e) => e.id}
              renderItem={renderAuditEntry}
              contentContainerStyle={[styles.list, { gap: 8, paddingBottom: insets.bottom + 16 }]}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Ionicons name="document-text-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>Nenhum registro encontrado</Text>
                </View>
              }
              ListFooterComponent={
                auditData && auditData.total > (auditPage + 1) * 50 ? (
                  <Pressable
                    style={({ pressed }) => [styles.paginationBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => setAuditPage((p) => p + 1)}
                  >
                    <Text style={styles.paginationBtnText}>Carregar mais</Text>
                  </Pressable>
                ) : null
              }
            />
          )}
        </>
      )}

      <Modal visible={inviteModalVisible} transparent animationType="slide" onRequestClose={() => setInviteModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setInviteModalVisible(false)}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Convidar Colaborador</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Nome</Text>
              <TextInput
                style={styles.input}
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="Nome completo"
                placeholderTextColor={Colors.textSecondary}
                testID="invite-name"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>E-mail</Text>
              <TextInput
                style={styles.input}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="email@exemplo.com"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="invite-email"
              />
            </View>

            <Text style={[styles.inputLabel, { marginBottom: 8 }]}>Perfil de acesso</Text>
            <View style={styles.rolePickerRow}>
              {(["super_admin", "admin", "curador", "analista"] as BackofficeRole[]).map((role) => {
                const isSelected = inviteRole === role;
                const color = ROLE_COLORS[role];
                return (
                  <Pressable
                    key={role}
                    style={[styles.rolePicker, isSelected && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setInviteRole(role)}
                  >
                    <Text style={[styles.rolePickerText, isSelected && { color: "#fff" }]}>{ROLE_LABELS[role]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.85 }, inviteMutation.isPending && { opacity: 0.7 }]}
              onPress={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
              testID="invite-submit"
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.loginBtnText}>Enviar Convite</Text>
              )}
            </Pressable>
            <Pressable style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.75 }]} onPress={() => setInviteModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEditModalVisible(false)}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              Gerenciar{"\n"}
              <Text style={styles.modalUserName}>{selectedUser?.name}</Text>
            </Text>

            <Text style={[styles.inputLabel, { marginBottom: 8 }]}>Alterar perfil</Text>
            {(["super_admin", "admin", "curador", "analista"] as BackofficeRole[]).map((role) => {
              const isCurrent = selectedUser?.role === role;
              const color = ROLE_COLORS[role];
              return (
                <Pressable
                  key={role}
                  style={({ pressed }) => [styles.roleOption, isCurrent && styles.roleOptionActive, pressed && { opacity: 0.75 }]}
                  onPress={() => {
                    if (!selectedUser || isCurrent) return;
                    Alert.alert(
                      "Confirmar",
                      `Alterar perfil de "${selectedUser.name}" para ${ROLE_LABELS[role]}?`,
                      [
                        { text: "Cancelar", style: "cancel" },
                        { text: "Confirmar", onPress: () => updateRoleMutation.mutate({ userId: selectedUser.id, role }) },
                      ],
                    );
                  }}
                  disabled={isCurrent || updateRoleMutation.isPending}
                >
                  <View style={[styles.roleOptionDot, { backgroundColor: color }]} />
                  <Text style={[styles.roleOptionLabel, isCurrent && { color }]}>{ROLE_LABELS[role]}</Text>
                  {isCurrent && <Ionicons name="checkmark" size={18} color={color} style={{ marginLeft: "auto" }} />}
                </Pressable>
              );
            })}

            <View style={styles.divider} />

            {selectedUser && (
              <Pressable
                style={({ pressed }) => [
                  styles.statusToggleBtn,
                  selectedUser.status === "ativo" ? styles.deactivateBtn : styles.activateBtn,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleToggleStatus(selectedUser)}
                testID="toggle-status-btn"
              >
                <Ionicons
                  name={selectedUser.status === "ativo" ? "ban-outline" : "checkmark-circle-outline"}
                  size={18}
                  color={selectedUser.status === "ativo" ? "#DC2626" : "#059669"}
                />
                <Text style={[styles.statusToggleBtnText, { color: selectedUser.status === "ativo" ? "#DC2626" : "#059669" }]}>
                  {selectedUser.status === "ativo" ? "Desativar acesso" : "Reativar acesso"}
                </Text>
              </Pressable>
            )}

            <Pressable style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.75 }]} onPress={() => setEditModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Fechar</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
    gap: 8,
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
  },
  headerSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  logoutBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
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
  loginContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
  },
  loginCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  loginIcon: {
    alignItems: "center",
    marginBottom: 4,
  },
  loginTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  loginSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    backgroundColor: Colors.background,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
  },
  errorBoxText: {
    fontSize: 13,
    color: "#DC2626",
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  loginBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  loginBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  permissionsCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    margin: 16,
    backgroundColor: Colors.primary + "10",
    borderRadius: 14,
    padding: 14,
  },
  permissionsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginVertical: 12,
    justifyContent: "center",
  },
  inviteBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  list: {
    paddingVertical: 4,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 4,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    minHeight: 200,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
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
  badgesRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    flexWrap: "wrap",
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
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
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
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
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  auditCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  auditFiltersRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  auditFilterInput: {
    marginBottom: 0,
  },
  auditDateRow: {
    flexDirection: "row",
    gap: 8,
  },
  auditDateInput: {
    flex: 1,
    marginBottom: 0,
  },
  auditCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  auditTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  auditAction: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  auditDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  auditMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  auditUser: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  auditModuleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  auditModule: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  auditTarget: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  auditDiff: {
    gap: 4,
    marginTop: 4,
  },
  auditDiffBefore: {
    backgroundColor: "#FEF2F2",
    borderRadius: 6,
    padding: 6,
    gap: 2,
  },
  auditDiffAfter: {
    backgroundColor: "#F0FDF4",
    borderRadius: 6,
    padding: 6,
    gap: 2,
  },
  auditDiffLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
  },
  auditDiffValue: {
    fontSize: 11,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  paginationBtn: {
    alignItems: "center",
    padding: 16,
  },
  paginationBtnText: {
    fontSize: 14,
    color: Colors.primary,
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
    gap: 8,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
    lineHeight: 22,
  },
  modalUserName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  rolePickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  rolePicker: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: "#fff",
  },
  rolePickerText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  roleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
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
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  statusToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
  },
  deactivateBtn: {
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
  },
  activateBtn: {
    borderColor: "#059669",
    backgroundColor: "#F0FDF4",
  },
  statusToggleBtnText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  cancelBtn: {
    marginTop: 4,
    alignItems: "center",
    paddingVertical: 13,
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
