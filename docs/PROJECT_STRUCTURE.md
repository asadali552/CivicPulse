# CivicPulse AI Project Structure

This folder is organized for the hackathon MVP:

- `frontend/` - citizen portal, authority dashboard, tracking UI, and contractor screens.
- `frontend/public/assets/` - images, icons, map/media assets, and demo visuals.
- `frontend/src/components/` - reusable UI components.
- `frontend/src/pages/` - application views and routes when the frontend is migrated from the prototype.
- `frontend/src/styles/` - global CSS, theme tokens, and responsive layout styles.
- `frontend/src/lib/` - frontend API clients, mock data, and helpers.
- `backend/` - FastAPI backend skeleton.
- `backend/app/api/routes/` - complaint, dashboard, tracking, contractor, and offer routes.
- `backend/app/core/` - settings, environment config, and app startup logic.
- `backend/app/models/` - database models for complaints, incidents, departments, contractors, offers, and status history.
- `backend/app/schemas/` - request and response validation schemas.
- `backend/app/services/ai/` - Gemini image/text analysis and governance insights.
- `backend/app/services/storage/` - Cloudinary or local upload storage integration.
- `backend/app/services/maps/` - geocoding, location helpers, and future Leaflet/OpenStreetMap support.
- `backend/app/services/contractors/` - contractor matching, trust score, and offer dispatch logic.
- `backend/app/services/analytics/` - dashboard statistics and database aggregation logic.
- `backend/app/db/` - MongoDB connection, seed data, and repository functions.
- `backend/app/utils/` - shared backend utilities.
- `backend/tests/` - API and service tests.
- `data/demo/` - demo complaints, contractors, and seeded dashboard data.
- `data/uploads/` - local development image uploads before Cloudinary integration.
- `docs/` - pitch notes, architecture, API contracts, and demo script.
- `scripts/` - setup, seed, and helper scripts.
- `deploy/` - deployment notes and environment examples.
- `design/` - screenshots, wireframes, and visual references.

The current standalone prototype remains at `index.html` until the frontend is migrated into a framework or split into modular files.
