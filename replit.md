# KidSpot

## Overview
KidSpot is a mobile application designed to help families discover kid-friendly locations nearby. The project aims to provide a comprehensive platform for finding places like parks, restaurants, and entertainment venues suitable for children, enhancing family outings. It incorporates advanced filtering, a unique "KidScore" ranking system, and community-driven insights to offer personalized recommendations.

The vision for KidSpot includes becoming the go-to resource for parents seeking family-oriented places, fostering a community around shared experiences, and continually enriching its database through user contributions and AI-powered analysis. The project emphasizes user-friendly interfaces, reliable data, and a robust backend to support a growing user base and expand its service offerings.

## User Preferences
I prefer clear, concise explanations and direct answers.
I value an iterative development approach with frequent, small updates.
Please ask for confirmation before implementing major structural changes or adding new external dependencies.
I prefer detailed explanations for complex logic or architectural decisions.
Do not make changes to the `app/backoffice-rbac.tsx` file as it has been removed.
Do not make changes to the `app/admin-*.tsx` files as they have been removed.

## System Architecture
The KidSpot application is built with a mobile-first approach using Expo (React Native) for the frontend and an Express.js server for the backend. Data persistence is handled by PostgreSQL with Drizzle ORM.

### Frontend
The frontend uses Expo Router for navigation and `@tanstack/react-query` for data fetching and state management, leveraging TypeScript for type safety.

### Backend
The Express.js backend, written in TypeScript, serves as the API layer. It orchestrates data retrieval from various sources, applies business logic, and manages user authentication and data storage. Key components include:
-   **Google Places Integration:** Fetches and processes location data.
-   **Foursquare Places Integration:** Enriches place data with additional ratings and popularity metrics.
-   **OpenAI Integration:** Analyzes place reviews to identify family-friendly signals.
-   **KidScore Calculation:** A proprietary algorithm that ranks places based on various kid-friendly criteria (e.g., amenities, safety, user reviews). This involves multiple passes for initial scoring, enrichment, and final score adjustment.
-   **Authentication:** JWT-based authentication system with four user roles: `admin`, `colaborador`, `parceiro`, and `usuario`. Authentication state is managed via AsyncStorage on the client side.
-   **Admin Panel:** A separate web-based admin panel (`/admin`) accessible via Express, offering modules for user management, feedback processing, AI prompt configuration, KidScore rule adjustments, custom criteria definition, app filter management, and city configuration. This panel is a pure HTML/JS single-page application.
-   **Backoffice RBAC System:** A separate, internal role-based access control system (`/api/backoffice/*`) with `super_admin`, `admin`, `curador`, and `analista` roles for managing the platform's operational aspects. This system does not have a direct mobile UI but handles backend administrative tasks.

### Database
PostgreSQL is used as the primary database, accessed via Drizzle ORM. The schema includes tables for users, places, reviews, favorites, and an enrichment cache.

### Core Features
-   **Place Search:** Users can search for places based on location, radius, establishment type, open status, and keywords.
-   **Kid-Friendly Filtering:** An advanced multi-layer filtering system identifies and prioritizes places suitable for children, including blocklists for unsuitable locations and auto-pass types.
-   **Dynamic KidScore:** Places are assigned a KidScore based on type, community flags (e.g., `espaco_kids`, `trocador`), ratings, proximity, and AI-analyzed review sentiment, as well as Foursquare data.
-   **Review System:** Users can submit reviews, contributing to the community-sourced `kid_flags`.
-   **Favorites:** Users can save their favorite places.
-   **Enrichment Cache:** Foursquare and OpenAI results are cached for 7 days to optimize performance and reduce API calls.

## External Dependencies
-   **Google Places API:** Used for fetching nearby places, place details, and photos.
-   **Foursquare Places API:** Utilized for enriching place data with additional ratings and popularity information.
-   **OpenAI API:** Integrated for advanced natural language processing to analyze review text and identify family-relevant signals.
-   **PostgreSQL:** The relational database used for all application data storage.
-   **Nodemailer (SMTP):** (Optional) For sending email invitations in the backoffice system.