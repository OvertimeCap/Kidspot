# KidSpot

## Overview
KidSpot is a full-stack mobile application (Expo/React Native + Express/PostgreSQL) designed to help families discover kid-friendly locations nearby. The project aims to provide a comprehensive platform for finding places like parks, restaurants, and entertainment venues suitable for children, incorporating advanced filtering, a unique "KidScore" ranking system, and AI-powered insights.

The vision for KidSpot includes becoming the go-to resource for parents seeking family-oriented places, fostering a community around shared experiences, and continually enriching its database through user contributions and an automated AI pipeline for discovering and validating new locations.

## User Preferences
I prefer clear, concise explanations and direct answers.
I value an iterative development approach with frequent, small updates.
Please ask for confirmation before implementing major structural changes or adding new external dependencies.
I prefer detailed explanations for complex logic or architectural decisions.

## System Architecture
The KidSpot application is built with a mobile-first approach using Expo (React Native) for the frontend and an Express.js server for the backend. Data persistence is handled by PostgreSQL with Drizzle ORM.

### Frontend
The frontend uses Expo (React Native) with Expo Router for navigation and `@tanstack/react-query` for data fetching and state management, leveraging TypeScript for type safety. Authentication state is managed via a global `AuthProvider` using JWT and `AsyncStorage`.

### Backend
The Express.js backend, written in TypeScript, serves as the API layer. It orchestrates data retrieval, applies business logic, and manages user authentication and data storage. Key components include:
- **Google Places Integration:** Fetches and processes location data.
- **Foursquare Places Integration:** Enriches place data with additional ratings and popularity metrics.
- **AI Provider Hub:** Multi-provider AI integration supporting OpenAI, Anthropic/Claude, Perplexity, and Google Gemini. API keys are stored AES-256-GCM encrypted. Dynamic pipeline routing lets admins configure which provider/model to use per pipeline stage, with automatic fallback chains. Managed via the backoffice admin panel.
- **OpenAI Integration:** Analyzes place reviews to identify family-friendly signals (now routed dynamically via the AI Provider Hub).
- **KidScore Calculation:** A proprietary algorithm that ranks places based on various kid-friendly criteria (e.g., amenities, safety, user reviews).
- **AI Pipeline:** An automated ingestion module (`server/pipeline.ts`) that scans Google Places for kid-friendly locations for specific cities, inserts them as `pendente`, and logs execution metrics to the `pipeline_runs` table.
- **Authentication:** JWT-based system with roles: `admin`, `colaborador`, `parceiro`, and `usuario`.
- **Backoffice RBAC System:** A robust internal role-based access control system (`backoffice_users` table) with roles: `super_admin`, `admin`, `curador`, and `analista`.
- **Admin Mobile Screens:** The app includes dedicated administrative screens (`admin-operacao.tsx`, etc.) for managing:
    - Users and RBAC
    - App Filters and Categories
    - AI Prompts and KidScore Rules
    - Community Feedback and Criteria
    - AI Operations (City management and Pipeline execution)
- **Admin Panel:** A separate web-based admin panel (`/admin`) accessible via Express, offering modules for user management, feedback processing, AI prompt configuration, KidScore rule adjustments, custom criteria definition, app filter management, and city configuration. This panel is a pure HTML/JS single-page application.

### Database
PostgreSQL hosted on **Neon** (external) is the primary database, accessed via Drizzle ORM. The connection is configured via the `NEON_DATABASE_URL` environment variable (falls back to `DATABASE_URL` if not set). The schema includes:
- **Users & Auth:** `users`, `backoffice_users`, and sessions.
- **Places & Cities:** `places_kidspot` (with `status` and `ciudad_id`), and `cities` (storing `nome`, `estado`, `latitude`, `longitude`, `raio_km`, `frequencia`, `ativa`, etc.).
- **Operations:** `pipeline_runs` for tracking AI ingestion tasks.
- **Content:** `reviews`, `favorites`, `enrichment_cache`, and `kid_flags`.

### Core Features
- **Place Search:** Search by location, radius, type, and kid-friendly filters.
- **Place Status Management:** Places go through a workflow (`pendente` -> `aprovado`/`rejeitado`) before appearing in mobile search results.
- **Dynamic KidScore:** Multi-layer scoring based on type, community flags (e.g., `espaco_kids`, `trocador`), ratings, and AI-analyzed sentiment.
- **Enrichment Cache:** Foursquare and OpenAI results are cached for 7 days to optimize performance.

## External Dependencies
- **Google Places API:** Fetching nearby places, details, and photos.
- **Foursquare Places API:** Enriching data with ratings and popularity.
- **OpenAI API:** NLP analysis of reviews for family-relevant signals.
- **Neon PostgreSQL:** Primary relational database (external, hosted on Neon).
- **Nodemailer (SMTP):** (Optional) For sending email invitations.
