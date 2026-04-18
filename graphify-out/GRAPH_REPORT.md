# Graph Report - d:/Novo Kidspot/Kidspot  (2026-04-12)

## Corpus Check
- 77 files · ~60,036 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 585 nodes · 864 edges · 40 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `API Functions Library` - 25 edges
2. `Root Layout (App Entry)` - 18 edges
3. `API Request / Query Client Helper` - 17 edges
4. `Colors Constants` - 17 edges
5. `Routes Registrar (routes.ts)` - 17 edges
6. `Auth Context Provider` - 16 edges
7. `fetchWithTimeout()` - 11 edges
8. `Backoffice Auth Router` - 9 edges
9. `Curation Router` - 9 edges
10. `Storage Module` - 8 edges

## Surprising Connections (you probably didn't know these)
- `KidSpot API Reference` --references--> `Reviews Router`  [INFERRED]
  docs/API.md → server/routes/reviews.ts
- `KidFlags Type (frontend)` --semantically_similar_to--> `KidFlags Type (trocador/cadeirao/banheiro_familia/espaco_kids/seguro)`  [INFERRED] [semantically similar]
  lib/api.ts → shared/schema.ts
- `Reviews API Concept (kid_flags rationale)` --conceptually_related_to--> `KidFlags Type (trocador/cadeirao/banheiro_familia/espaco_kids/seguro)`  [INFERRED]
  docs/API.md → shared/schema.ts
- `UserRole Type (frontend)` --semantically_similar_to--> `userRoleEnum (admin/colaborador/parceiro/estabelecimento/usuario)`  [INFERRED] [semantically similar]
  lib/auth-context.tsx → shared/schema.ts
- `MiniCard Component` --calls--> `API Functions Library`  [EXTRACTED]
  components/map/MiniCard.tsx → lib/api.ts

## Hyperedges (group relationships)
- **Admin Mobile Panel Screens** — admin_criterios, admin_feedback, admin_filtros, admin_kidscore, admin_operacao, admin_prompts, admin_usuarios [INFERRED 0.90]
- **Authentication Flow Screens** — login, cadastro, lib_auth_context [INFERRED 0.95]
- **Main Tab Navigation Screens** — home_index, favoritos, perfil, tabs_layout [EXTRACTED 1.00]
- **Partner Content Management Screens** — partner_fotos, story_criar, partner_layout [INFERRED 0.85]
- **Place Discovery and Detail Flow** — home_index, filtros, place_detail, favoritos, lib_use_home_search, lib_picked_location_context [INFERRED 0.85]
- **Root Provider Context Chain** — root_layout, lib_auth_context, lib_picked_location_context, lib_query_client, components_error_boundary [EXTRACTED 1.00]
- **Map Component System (native + web platform split)** — mapviewscreen_native, mapviewscreen_web, markercluster_native, markercluster_web, placemarker_native, placemarker_web, minicard_component [INFERRED 0.90]
- **AI Enrichment Chain** — server_aireviewanalysis, server_aicrypto, server_foursquare, concept_aiprovider_hub, concept_enrichment_cache [INFERRED 0.85]
- **Full KidScore Search Pipeline** — server_googleplaces, server_kidscore, server_foursquare, server_aireviewanalysis, server_storage [EXTRACTED 1.00]
- **Dual Auth System (Mobile + Backoffice)** — server_auth, server_routes, server_index, shared_schema [INFERRED 0.85]
- **4-Layer Kid Filter Pipeline** — kidscore_filterByBlocklist, kidscore_filterByAllowedTypes, kidscore_filterByKidEvidence, kidscore_filterByQuality [EXTRACTED 1.00]
- **KidScore Scoring Breakdown Components** — kidscore_calculateKidScore, kidscore_analyseReviews, kidscore_calculateReviewBonus, kidscore_haversineMeters [EXTRACTED 0.95]
- **3-Step Pipeline Workflow** — pipeline_aiSearchForCity, pipeline_applyCriteriaToPlaces, pipeline_runPipelineForCity [INFERRED 0.85]
- **Backoffice Auth & Audit Chain** — routes_backoffice_auth, storage_createAuditLog, auth_signBackofficeToken, helpers_trackBackofficeActivity [EXTRACTED 0.90]
- **Route Registration Hub** — routes_ts, routes_health, routes_auth, routes_backoffice_auth, routes_places, routes_pipeline, routes_curation, routes_cities, routes_feedback, routes_partner [EXTRACTED 1.00]
- **Admin Middleware Stack** — auth_requireAuth, auth_requireBackofficeAuth, auth_requireRole, helpers_requireAdminOrCollaborator, helpers_requirePartnerWithPlace, helpers_trackBackofficeActivity [INFERRED 0.85]
- **Review Submission Flow (Frontendâ†’APIâ†’DB)** — lib_api, reviews_router, schema_reviews_table, schema_insert_review_schema, schema_kid_flags_type [INFERRED 0.90]
- **Auth Session Management (JWT + AsyncStorage + SessionTimeout)** — lib_auth_context, lib_query_client, concept_jwt_async_storage, concept_session_timeout, lib_query_client_set_auth_token [EXTRACTED 0.95]
- **Partner Story Creation Flow** — stories_router, schema_partner_stories_table, schema_story_photos_table, concept_place_link_requirement, concept_image_base64_storage [EXTRACTED 0.95]
- **Home Search Pipeline (Locationâ†’APIâ†’Results)** — lib_use_home_search, lib_picked_location_context, lib_api, lib_query_client_api_request [EXTRACTED 0.90]
- **Sponsorship Management (Plans + Contracts + Performance)** — sponsorship_router, schema_sponsorship_plans_table, schema_sponsorship_contracts_table, concept_sponsorship, schema_insert_sponsorship_plan_schema, schema_insert_sponsorship_contract_schema [EXTRACTED 0.95]
- **Map Region Utilities (radius/zoom/bounds)** — lib_map_utils, lib_map_utils_radius_from_region, lib_map_utils_zoom_from_region, lib_map_utils_bounds_from_region [EXTRACTED 1.00]
- **Core Database Tables** — schema_users_table, schema_places_table, schema_reviews_table, schema_favorites_table, schema_cities_table, schema_pipeline_runs_table, schema_place_kidspot_meta_table [EXTRACTED 1.00]

## Communities

### Community 0 - "Storage Layer (DB Operations)"
Cohesion: 0.02
Nodes (14): checkCityByCoords(), extractEstado(), findOrCreateGoogleUser(), findUserByEmail(), getActiveSponsoredPlaceIds(), getCityById(), getPublishedPlacesByCity(), getPublishedPlacesByCityAdmin() (+6 more)

### Community 1 - "Admin Backoffice UI"
Cohesion: 0.04
Nodes (48): API getActiveCities, API /api/admin/ai-prompts, API /api/admin/cities, API /api/admin/custom-criteria, API /api/admin/feedback, API /api/admin/filters, API /api/admin/kidscore-rules, API /api/admin/pipeline (+40 more)

### Community 2 - "AI Review & Auth Middleware"
Cohesion: 0.05
Nodes (60): AI Crypto Module, AI Review Analysis Module, requireAuth Middleware, requireBackofficeAuth Middleware, requireRole Middleware, signBackofficeToken Function, signToken Function, Place Status Workflow (pendente->aprovado/rejeitado) (+52 more)

### Community 3 - "REST API Routes"
Cohesion: 0.04
Nodes (7): getPhotoUrl(), resolvePhotoUrl(), Map Utilities (lib), MiniCard Component, getSeenStories(), load(), markStorySeen()

### Community 4 - "Auth & AI Providers"
Cohesion: 0.09
Nodes (13): getJwtSecret(), optionalAuth(), requireAdmin(), requireAuth(), requireBackofficeAuth(), signBackofficeToken(), signToken(), verifyBackofficeToken() (+5 more)

### Community 5 - "Docs & Business Concepts"
Cohesion: 0.07
Nodes (34): Base64 Image Storage for Story Photos, Partner Story (24h ephemeral content), linked_place_id Requirement for Story Publishing, Sponsorship System (Plans + Contracts), KidSpot API Reference, Favorites API Concept, Places Search API Concept, Reviews API Concept (kid_flags rationale) (+26 more)

### Community 6 - "Platform Config & Index"
Cohesion: 0.08
Nodes (6): Platform Stub Pattern (native/web), runMigrations(), seedConfigDefaults(), configureExpoAndLanding(), getAppName(), useHomeSearch Hook (lib)

### Community 7 - "Error Boundary (React)"
Cohesion: 0.13
Nodes (10): ErrorBoundary, apiRequest(), getApiUrl(), getExpoDevHostname(), isLikelyLanHost(), isLocalNetworkHost(), isLoopback(), normalizeUrlCandidate() (+2 more)

### Community 8 - "AI Crypto (Key Encryption)"
Cohesion: 0.16
Nodes (15): decryptApiKey(), encryptApiKey(), getDerivedKey(), analyzeReviewsWithAI(), callAnthropic(), callGoogle(), callOpenAI(), callPerplexity() (+7 more)

### Community 9 - "Google Places Integration"
Cohesion: 0.19
Nodes (14): autocompleteEstablishments(), autocompletePlaces(), deduplicateAndSort(), fetchGooglePlaces(), fetchWithTimeout(), geocodeCityPlace(), geocodePlace(), getPlaceDetails() (+6 more)

### Community 10 - "AI Provider Hub & KidScore Pipeline"
Cohesion: 0.17
Nodes (18): AI Provider Hub (Multi-provider), Enrichment Cache (7-day TTL), KidScore Enrichment Pipeline, GoogleSignInButton Component, Auth Context (lib), AI Crypto Module, AI Review Analysis Module, Auth Middleware Module (+10 more)

### Community 11 - "KidScore Calculation Engine"
Cohesion: 0.23
Nodes (12): analyseReviews(), applyKidFilters(), calculateKidScore(), calculateReviewBonus(), containsAny(), extractFamilyHighlight(), filterByAllowedTypes(), filterByBlocklist() (+4 more)

### Community 12 - "Foursquare Integration"
Cohesion: 0.31
Nodes (8): fetchAndCacheFoursquare(), fetchWithTimeout(), getCachedEnrichment(), matchFoursquarePlace(), nameSimilarity(), normalise(), searchFoursquareNearby(), setCachedEnrichment()

### Community 13 - "KidScore Algorithm"
Cohesion: 0.22
Nodes (9): KidScore Algorithm (multi-layer scoring), TIER1_KEYWORDS Constant, TIER2_KEYWORDS Constant, analyseReviews Function, calculateKidScore Function, calculateReviewBonus Function, haversineMeters Function, KidScore Module (+1 more)

### Community 14 - "Kid Filter Pipeline"
Cohesion: 0.22
Nodes (9): Kid Filter Pipeline (4-layer), ALLOWED_TYPES Constant, BLOCK_KEYWORDS Constant, KID_KEYWORDS Constant, applyKidFilters Function, filterByAllowedTypes Function, filterByBlocklist Function, filterByKidEvidence Function (+1 more)

### Community 15 - "Map Utilities"
Cohesion: 0.4
Nodes (5): Haversine Distance Calculation, Map Utility Functions, boundsFromRegion Function, radiusFromRegion Function, zoomFromRegion Function

### Community 16 - "Firebase Storage"
Cohesion: 0.83
Nodes (3): deletePartnerPhotoFromStorage(), getFirebaseBucket(), uploadPartnerPhoto()

### Community 17 - "Native Intent Redirect"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Not Found Screen"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "KeyboardAware Scroll Compat"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Error Fallback Components"
Cohesion: 1.0
Nodes (2): ErrorBoundary Component, ErrorFallback Component

### Community 21 - "Backoffice Schema (Users)"
Cohesion: 1.0
Nodes (2): backofficeRoleEnum (super_admin/admin/curador/analista), backoffice_users Table

### Community 22 - "Place Workflow & Status"
Cohesion: 1.0
Nodes (2): Place Approval Workflow (pendenteâ†’aprovado/rejeitado), placeStatusEnum (pendente/aprovado/rejeitado)

### Community 23 - "ScrollView Component"
Cohesion: 1.0
Nodes (1): KeyboardAwareScrollViewCompat Component

### Community 24 - "Email Server"
Cohesion: 1.0
Nodes (1): Email Module

### Community 25 - "Firebase Server"
Cohesion: 1.0
Nodes (1): Firebase Storage Module

### Community 26 - "KidScore Sort Results"
Cohesion: 1.0
Nodes (1): sortResults Function

### Community 27 - "KidScore Filter Open Now"
Cohesion: 1.0
Nodes (1): filterOpenNow Function

### Community 28 - "Storage Upsert Place"
Cohesion: 1.0
Nodes (1): upsertPlace Function

### Community 29 - "Storage Create User"
Cohesion: 1.0
Nodes (1): createUser Function

### Community 30 - "Auth Module"
Cohesion: 1.0
Nodes (1): Auth Module

### Community 31 - "Audit Helpers"
Cohesion: 1.0
Nodes (1): withAudit Middleware Factory

### Community 32 - "Enrichment Cache Schema"
Cohesion: 1.0
Nodes (1): enrichment_cache Table

### Community 33 - "App Filters Schema"
Cohesion: 1.0
Nodes (1): app_filters Table

### Community 34 - "KidScore Rules Schema"
Cohesion: 1.0
Nodes (1): kidscore_rules Table

### Community 35 - "Custom Criteria Schema"
Cohesion: 1.0
Nodes (1): custom_criteria Table

### Community 36 - "City Demand Schema"
Cohesion: 1.0
Nodes (1): city_demand Table

### Community 37 - "Audit Log Schema"
Cohesion: 1.0
Nodes (1): audit_log Table

### Community 38 - "AI Providers Schema"
Cohesion: 1.0
Nodes (1): ai_providers Table

### Community 39 - "Pipeline Routing Schema"
Cohesion: 1.0
Nodes (1): pipeline_routing Table

## Ambiguous Edges - Review These
- `StoriesRow Component` → `Routes Module`  [AMBIGUOUS]
  components/StoriesRow.tsx · relation: conceptually_related_to

## Knowledge Gaps
- **103 isolated node(s):** `Tabs Navigation Layout`, `Partner Section Layout`, `ErrorBoundary Component`, `MapViewScreen Component`, `API /api/admin/custom-criteria` (+98 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Native Intent Redirect`** (2 nodes): `+native-intent.tsx`, `redirectSystemPath()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Not Found Screen`** (2 nodes): `+not-found.tsx`, `NotFoundScreen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `KeyboardAware Scroll Compat`** (2 nodes): `KeyboardAwareScrollViewCompat.tsx`, `KeyboardAwareScrollViewCompat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Error Fallback Components`** (2 nodes): `ErrorBoundary Component`, `ErrorFallback Component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Backoffice Schema (Users)`** (2 nodes): `backofficeRoleEnum (super_admin/admin/curador/analista)`, `backoffice_users Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Place Workflow & Status`** (2 nodes): `Place Approval Workflow (pendenteâ†’aprovado/rejeitado)`, `placeStatusEnum (pendente/aprovado/rejeitado)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ScrollView Component`** (1 nodes): `KeyboardAwareScrollViewCompat Component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Email Server`** (1 nodes): `Email Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Firebase Server`** (1 nodes): `Firebase Storage Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `KidScore Sort Results`** (1 nodes): `sortResults Function`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `KidScore Filter Open Now`** (1 nodes): `filterOpenNow Function`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Storage Upsert Place`** (1 nodes): `upsertPlace Function`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Storage Create User`** (1 nodes): `createUser Function`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Auth Module`** (1 nodes): `Auth Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audit Helpers`** (1 nodes): `withAudit Middleware Factory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Enrichment Cache Schema`** (1 nodes): `enrichment_cache Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Filters Schema`** (1 nodes): `app_filters Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `KidScore Rules Schema`** (1 nodes): `kidscore_rules Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Custom Criteria Schema`** (1 nodes): `custom_criteria Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `City Demand Schema`** (1 nodes): `city_demand Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audit Log Schema`** (1 nodes): `audit_log Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `AI Providers Schema`** (1 nodes): `ai_providers Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pipeline Routing Schema`** (1 nodes): `pipeline_routing Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `StoriesRow Component` and `Routes Module`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `API Functions Library` connect `Admin Backoffice UI` to `AI Provider Hub & KidScore Pipeline`, `REST API Routes`, `Docs & Business Concepts`, `Map Utilities`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `Auth Context Provider` connect `Admin Backoffice UI` to `Docs & Business Concepts`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `UserRole Type (frontend)` connect `Docs & Business Concepts` to `Admin Backoffice UI`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **What connects `Tabs Navigation Layout`, `Partner Section Layout`, `ErrorBoundary Component` to the rest of the system?**
  _103 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Storage Layer (DB Operations)` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Admin Backoffice UI` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._