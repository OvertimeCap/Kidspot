import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Image,
  Linking,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, ROLE_LABELS, ROLE_COLORS } from "@/lib/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface ClaimablePlace {
  place_id: string;
  name: string;
  address: string;
  photo_reference?: string;
}

interface MyClaim {
  id: string;
  place_id: string;
  place_name: string;
  place_address: string;
  contact_phone: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export default function PerfilScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const qc = useQueryClient();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 84 + 24 : insets.bottom + 16;

  const [claimModalVisible, setClaimModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [searchResults, setSearchResults] = useState<ClaimablePlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<ClaimablePlace | null>(null);
  const [contactPhone, setContactPhone] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        refreshUser();
      }
    }, [user, refreshUser]),
  );

  const { data: myClaimsData, refetch: refetchClaims } = useQuery<{ claims: MyClaim[] }>({
    queryKey: ["/api/claims/my"],
    enabled: !!user && user.role === "usuario",
  });

  const myClaims = myClaimsData?.claims ?? [];
  const latestClaim = myClaims[0] ?? null;

  const submitClaimMutation = useMutation({
    mutationFn: async (data: {
      place_id: string;
      place_name: string;
      place_address: string;
      place_photo_reference?: string;
      contact_phone: string;
    }) => {
      const res = await apiRequest("POST", "/api/claims", data);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao enviar solicitação");
      return body;
    },
    onSuccess: async () => {
      setClaimModalVisible(false);
      resetClaimForm();
      await refetchClaims();
      Alert.alert(
        "Solicitação enviada!",
        "Sua solicitação de vínculo foi registrada. Um administrador irá analisar em breve.",
      );
    },
    onError: (err: Error) => {
      Alert.alert("Erro", err.message);
    },
  });

  function resetClaimForm() {
    setSearchQuery("");
    setSearchCity("");
    setSearchResults([]);
    setSelectedPlace(null);
    setContactPhone("");
  }

  function handleSearchChange(text: string) {
    setSearchQuery(text);
    setSelectedPlace(null);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: text.trim() });
        if (searchCity.trim()) params.set("city", searchCity.trim());
        const res = await apiRequest("GET", `/api/places/search-claimable?${params.toString()}`);
        const body = await res.json();
        setSearchResults(body.places ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 600);
  }

  function handleCityChange(text: string) {
    setSearchCity(text);
    setSelectedPlace(null);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (searchQuery.trim().length < 2) return;

    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: searchQuery.trim() });
        if (text.trim()) params.set("city", text.trim());
        const res = await apiRequest("GET", `/api/places/search-claimable?${params.toString()}`);
        const body = await res.json();
        setSearchResults(body.places ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 600);
  }

  function handleSelectPlace(place: ClaimablePlace) {
    setSelectedPlace(place);
    setSearchResults([]);
  }

  function handleSubmitClaim() {
    if (!selectedPlace) {
      Alert.alert("Atenção", "Selecione um local na lista de resultados");
      return;
    }
    if (!contactPhone.trim() || contactPhone.trim().length < 8) {
      Alert.alert("Atenção", "Informe um telefone de contato válido");
      return;
    }

    Alert.alert(
      "Confirmar solicitação",
      `Deseja solicitar vínculo com "${selectedPlace.name}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: () => {
            submitClaimMutation.mutate({
              place_id: selectedPlace.place_id,
              place_name: selectedPlace.name,
              place_address: selectedPlace.address,
              place_photo_reference: selectedPlace.photo_reference,
              contact_phone: contactPhone.trim(),
            });
          },
        },
      ],
    );
  }

  function handleLogout() {
    Alert.alert(
      "Sair da conta",
      "Tem certeza que deseja sair?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sair",
          style: "destructive",
          onPress: async () => {
            await logout();
            qc.clear();
            router.replace("/login");
          },
        },
      ],
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Perfil</Text>
          <Ionicons name="person-circle-outline" size={24} color={Colors.primary} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="person-outline" size={64} color={Colors.border} />
          <Text style={styles.emptyTitle}>Você não está logado</Text>
          <Text style={styles.emptySubtitle}>
            Faça login para acessar seu perfil e favoritos
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/login")}
          >
            <Text style={styles.btnText}>Fazer login</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.btnOutline, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/cadastro")}
          >
            <Text style={styles.btnOutlineText}>Criar conta</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const roleColor = ROLE_COLORS[user.role];
  const roleLabel = ROLE_LABELS[user.role];
  const initials = user.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Perfil</Text>
        <Ionicons name="person-circle-outline" size={24} color={Colors.primary} />
      </View>

      <View style={styles.profileCard}>
        <View style={[styles.avatar, { backgroundColor: roleColor }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + "18" }]}>
            <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
            <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conta</Text>
        <View style={styles.card}>
          <Row icon="mail-outline" label="E-mail" value={user.email} />
          <View style={styles.separator} />
          <Row icon="shield-checkmark-outline" label="Perfil de acesso" value={roleLabel} valueColor={roleColor} />
        </View>
      </View>

      {(user.role === "estabelecimento" || user.role === "parceiro") && user.linked_place_id && (
        <View style={[styles.section, { marginTop: 16 }]}>
          <Text style={styles.sectionTitle}>
            {user.role === "parceiro" ? "Meu Local Parceiro" : "Meu Estabelecimento"}
          </Text>
          <View style={[styles.linkedPlaceCard]}>
            <View style={styles.linkedPlaceHeader}>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <Text style={styles.verifiedText}>Verificado</Text>
              </View>
            </View>
            <Text style={styles.linkedPlaceName}>{user.linked_place_name}</Text>
            <View style={styles.linkedPlaceAddressRow}>
              <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.linkedPlaceAddress} numberOfLines={2}>
                {user.linked_place_address}
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.linkedPlaceAction, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/partner/fotos")}
          >
            <View style={styles.linkedPlaceActionLeft}>
              <Ionicons name="images-outline" size={22} color="#0891B2" />
              <View>
                <Text style={styles.linkedPlaceActionText}>Gerenciar Fotos</Text>
                <Text style={styles.linkedPlaceActionSub}>Adicionar e editar fotos do local</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {user.role === "usuario" && (
        <View style={[styles.section, { marginTop: 16 }]}>
          <Text style={styles.sectionTitle}>Estabelecimento</Text>

          {latestClaim && latestClaim.status === "pending" && (
            <View style={styles.claimStatusCard}>
              <View style={styles.claimStatusHeader}>
                <Ionicons name="time-outline" size={20} color="#D97706" />
                <Text style={[styles.claimStatusLabel, { color: "#D97706" }]}>Solicitação pendente</Text>
              </View>
              <Text style={styles.claimPlaceName}>{latestClaim.place_name}</Text>
              <Text style={styles.claimPlaceAddress} numberOfLines={1}>{latestClaim.place_address}</Text>
              <Text style={styles.claimInfo}>
                Um administrador irá analisar sua solicitação em breve.
              </Text>
            </View>
          )}

          {latestClaim && latestClaim.status === "denied" && (
            <View style={styles.claimStatusCard}>
              <View style={styles.claimStatusHeader}>
                <Ionicons name="close-circle-outline" size={20} color="#DC2626" />
                <Text style={[styles.claimStatusLabel, { color: "#DC2626" }]}>Solicitação negada</Text>
              </View>
              <Text style={styles.claimPlaceName}>{latestClaim.place_name}</Text>
              <Text style={styles.claimInfo}>
                Sua solicitação anterior foi negada. Você pode solicitar vínculo com outro estabelecimento.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.claimBtn, pressed && { opacity: 0.85 }]}
                onPress={() => setClaimModalVisible(true)}
              >
                <Ionicons name="storefront-outline" size={18} color="#fff" />
                <Text style={styles.claimBtnText}>Nova solicitação</Text>
              </Pressable>
            </View>
          )}

          {!latestClaim && (
            <Pressable
              style={({ pressed }) => [styles.claimActionCard, pressed && { opacity: 0.85 }]}
              onPress={() => setClaimModalVisible(true)}
            >
              <View style={styles.claimActionLeft}>
                <Ionicons name="storefront-outline" size={22} color="#0891B2" />
                <View>
                  <Text style={styles.claimActionText}>Solicitar vínculo com estabelecimento</Text>
                  <Text style={styles.claimActionSub}>Gerencie seu negócio no KidSpot</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {(user.role === "admin" || user.role === "colaborador") && (
        <View style={[styles.section, { marginTop: 16 }]}>
          <Text style={styles.sectionTitle}>Administração</Text>
          <Pressable
            style={({ pressed }) => [styles.adminCard, pressed && { opacity: 0.85 }]}
            onPress={() => {
              const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:5000';
              const protocol = domain.includes('localhost') ? 'http' : 'https';
              Linking.openURL(`${protocol}://${domain}/admin`);
            }}
            testID="admin-panel-btn"
          >
            <View style={styles.adminCardLeft}>
              <Ionicons name="desktop-outline" size={22} color="#7C3AED" />
              <View>
                <Text style={styles.adminCardText}>Painel de Administração</Text>
                <Text style={[styles.adminCardText, { fontSize: 11, color: Colors.textSecondary, fontWeight: "400" }]}>
                  Acesse pelo navegador em /admin
                </Text>
              </View>
            </View>
            <Ionicons name="open-outline" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.adminCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/admin-operacao" as any)}
          >
            <View style={styles.adminCardLeft}>
              <Ionicons name="pulse-outline" size={22} color="#DC2626" />
              <Text style={styles.adminCardText}>Operação de IA</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>
      )}

      <View style={styles.logoutSection}>
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.85 }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Sair da conta</Text>
        </Pressable>
      </View>

      <Modal
        visible={claimModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setClaimModalVisible(false); resetClaimForm(); }}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Solicitar vínculo</Text>
            <Pressable
              onPress={() => { setClaimModalVisible(false); resetClaimForm(); }}
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color={Colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalSectionLabel}>Buscar seu negócio</Text>

            <View style={styles.inputRow}>
              <Ionicons name="search-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Nome do estabelecimento"
                placeholderTextColor={Colors.textSecondary}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
                autoFocus
              />
            </View>

            <View style={[styles.inputRow, { marginTop: 8 }]}>
              <Ionicons name="location-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Cidade (opcional)"
                placeholderTextColor={Colors.textSecondary}
                value={searchCity}
                onChangeText={handleCityChange}
                returnKeyType="done"
              />
            </View>

            {isSearching && (
              <View style={styles.searchingRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.searchingText}>Buscando...</Text>
              </View>
            )}

            {!isSearching && searchResults.length > 0 && !selectedPlace && (
              <View style={styles.resultsList}>
                {searchResults.map((place) => (
                  <Pressable
                    key={place.place_id}
                    style={({ pressed }) => [styles.resultItem, pressed && { backgroundColor: Colors.background }]}
                    onPress={() => handleSelectPlace(place)}
                  >
                    {place.photo_reference ? (
                      <Image
                        source={{ uri: `${getApiUrl()}/api/places/photo?reference=${encodeURIComponent(place.photo_reference)}&maxwidth=80` }}
                        style={styles.resultPhoto}
                      />
                    ) : (
                      <View style={[styles.resultPhoto, styles.resultPhotoPlaceholder]}>
                        <Ionicons name="storefront-outline" size={20} color={Colors.border} />
                      </View>
                    )}
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{place.name}</Text>
                      <Text style={styles.resultAddress} numberOfLines={2}>{place.address}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
                  </Pressable>
                ))}
              </View>
            )}

            {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && !selectedPlace && (
              <Text style={styles.noResults}>Nenhum resultado encontrado</Text>
            )}

            {selectedPlace && (
              <View style={styles.selectedPlaceCard}>
                <View style={styles.selectedPlaceHeader}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
                  <Text style={styles.selectedPlaceLabel}>Local selecionado</Text>
                  <Pressable onPress={() => setSelectedPlace(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.selectedPlaceName}>{selectedPlace.name}</Text>
                <Text style={styles.selectedPlaceAddress}>{selectedPlace.address}</Text>
              </View>
            )}

            {selectedPlace && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.modalSectionLabel}>Telefone de contato para verificação</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="call-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="(00) 00000-0000"
                    placeholderTextColor={Colors.textSecondary}
                    value={contactPhone}
                    onChangeText={setContactPhone}
                    keyboardType="phone-pad"
                    returnKeyType="done"
                    maxLength={20}
                  />
                </View>
                <Text style={styles.phoneHint}>
                  Um administrador pode entrar em contato neste número para verificar sua solicitação.
                </Text>
              </View>
            )}

            {selectedPlace && (
              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && { opacity: 0.85 },
                  submitClaimMutation.isPending && { opacity: 0.6 },
                ]}
                onPress={handleSubmitClaim}
                disabled={submitClaimMutation.isPending}
              >
                {submitClaimMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Enviar solicitação</Text>
                )}
              </Pressable>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor, fontFamily: "Inter_600SemiBold" } : {}]}>
        {value}
      </Text>
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
    minHeight: 400,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  btn: {
    backgroundColor: Colors.primary,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  btnOutline: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  btnOutlineText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 20,
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  email: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  roleText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  section: {
    paddingHorizontal: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
  },
  rowValue: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    maxWidth: 160,
    textAlign: "right",
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  linkedPlaceCard: {
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    gap: 6,
  },
  linkedPlaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  verifiedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#059669",
    fontFamily: "Inter_600SemiBold",
  },
  linkedPlaceName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  linkedPlaceAddressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  linkedPlaceAddress: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  linkedPlaceAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  linkedPlaceActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  linkedPlaceActionText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  linkedPlaceActionSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  claimStatusCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  claimStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  claimStatusLabel: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  claimPlaceName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  claimPlaceAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  claimInfo: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginTop: 4,
  },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
  },
  claimBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  claimActionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  claimActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  claimActionText: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  claimActionSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  adminCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  adminCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  adminCardText: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: "Inter_500Medium",
  },
  logoutSection: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.error,
  },
  logoutText: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  inputIcon: {},
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  searchingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  resultsList: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  resultPhoto: {
    width: 44,
    height: 44,
    borderRadius: 8,
    flexShrink: 0,
  },
  resultPhotoPlaceholder: {
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  resultInfo: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  resultAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  noResults: {
    textAlign: "center",
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingVertical: 16,
  },
  selectedPlaceCard: {
    backgroundColor: Colors.primary + "10",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    gap: 4,
    marginTop: 12,
  },
  selectedPlaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  selectedPlaceLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  selectedPlaceName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  selectedPlaceAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  phoneHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
