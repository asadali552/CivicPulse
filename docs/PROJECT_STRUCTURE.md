# UrbanFix AI Project Structure

This folder is organized for the hackathon MVP:

- `index.html` - frontend document structure and external dependencies.
- `public/assets/css/` - application styles.
- `public/assets/js/` - React application code, Tailwind configuration, and service-worker registration.
- `public/assets/` - CDN-served images, icons, manifest, and service worker.
- `backend/` - FastAPI backend.
- `backend/app/api/routes/` - complaint, dashboard, tracking, contractor, and offer routes.
- `backend/app/core/` - settings, environment config, and app startup logic.
- `backend/app/models/` - database models for complaints, incidents, departments, contractors, offers, and status history.
- `backend/app/schemas/` - request and response validation schemas.
- `backend/app/services/ai/` - Gemini image/text analysis and governance insights.
- `backend/app/services/storage/` - Cloudinary or local upload storage integration.
- `backend/app/services/contractors/` - contractor matching, trust score, and offer dispatch logic.
- `backend/app/services/analytics/` - dashboard statistics and database aggregation logic.
- `backend/app/db/` - MongoDB connection, seed data, and repository functions.
- `backend/tests/` - API and service tests.
- `data/demo/` - demo complaints, contractors, and seeded dashboard data.
- `data/uploads/` - local development image uploads before Cloudinary integration.
- `docs/` - pitch notes, architecture, API contracts, and demo script.
- `scripts/` - setup, seed, and helper scripts.
- `deploy/` - deployment notes and environment examples.

The frontend remains build-free for the hackathon demo. FastAPI serves `index.html`; Vercel serves `public/assets/` through its CDN, while FastAPI mounts the same directory for local development.
