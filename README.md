# CivicPulse AI

AI-powered smart civic governance and decision-support platform for hackathon demo.

## MVP Demo Flow

1. Citizen reports a civic problem from the portal with photo, description, and location.
2. Backend stores the complaint and runs AI analysis.
3. AI returns category, severity, department, confidence, and summary.
4. Priority engine calculates a transparent score.
5. Authority dashboard shows map markers, queue, analytics, and governance insight.
6. Admin can send a controlled small repair offer to verified local contractors.
7. Citizen tracks progress using a public complaint ID.
8. A registered community account can propose explicitly eligible low-risk micro-maintenance; the proposal remains linked to that account across logout/login.
9. Admin records a demo budget reservation, the community worker uploads an after-repair photo, and admin verifies proof before recording payment approval.

The community workflow is restricted to explicitly recognized, low-risk cleanup and beautification tasks. Budget and payment states are demonstrations unless a real payment provider is integrated.

## Accountability and Safety

- Every citizen report remains a distinct source record and can link to a shared incident cluster.
- Reporters who provide private contact details receive a time-limited verification token; administrators cannot impersonate reporter approval.
- Public accountability receipts expose AI recommendations, priority methodology, SLA state, evidence hashes, approvals, and a tamper-evident audit chain without exposing reporter identity.
- Uploads are decoded, pixel-limited, orientation-normalized, metadata-stripped, and safely re-encoded.
- Public text is screened for common phone, email, and national-identifier patterns; public coordinates are reduced in precision.
- Production startup rejects default administrator credentials, weak reporter-token secrets, and memory fallback.

## Current State

- `index.html` is a polished UI served by FastAPI at `/` and can also run standalone.
- `backend/` contains a FastAPI API with MongoDB-ready repository and in-memory fallback.
- Contractor matching, offer dispatch, proof workflow, dashboard analytics, and tracking APIs are scaffolded.
- Public problems remain visible on the civic map, while community proposals, contact details, and funding actions are private to the owner and administrator.
- Authentication uses HttpOnly sessions, CSRF tokens, salted PBKDF2 password hashes, login throttling, and role-based API authorization.

## Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

The development administrator is `admin` / `admin`. Set strong `ADMIN_USERNAME` and `ADMIN_PASSWORD` values in `.env` before any public deployment.

Health check:

```bash
curl http://localhost:8000/api/health
```

The backend uses MongoDB if `MONGO_URI` works. If MongoDB is unavailable, it automatically falls back to seeded in-memory demo data so the demo can still run.

For local development, `ALLOW_MEMORY_FALLBACK=true` prevents a temporary Atlas or DNS outage from stopping the server. Data created in fallback mode is not persistent. Production keeps fallback disabled and should configure the deployment IP in MongoDB Atlas Network Access.

## Frontend

Run the full application:

```bash
./scripts/run_backend.sh
```

Then open `http://127.0.0.1:8000/`. The frontend automatically uses the same-origin `/api` URL when deployed.

## Tests

```bash
cd backend
./.venv/bin/pytest -q
```

## Deploy

### Vercel (frontend and backend together)

Import the repository into Vercel with the repository root as the project root. Do not select `backend/` as the Root Directory. Vercel uses the root `index.py` entry point, serves the frontend at `/`, and serves FastAPI at `/api` on the same domain.

Bundled frontend assets live under `public/assets/`, which Vercel serves through its CDN. Complaint and repair evidence is uploaded to Cloudinary in production; files under local `data/uploads/` are intentionally ignored and are not deployed.

Add these Production environment variables in **Project Settings → Environment Variables**:

```text
ENVIRONMENT=production
ALLOW_MEMORY_FALLBACK=false
SEED_DEMO_DATA=false
MONGO_URI=<MongoDB Atlas connection string>
MONGO_DB_NAME=civicpulse
ADMIN_USERNAME=<secure administrator name>
ADMIN_PASSWORD=<at least 12 characters>
REPORTER_TOKEN_SECRET=<random value with at least 32 characters>
CLOUDINARY_CLOUD_NAME=<Cloudinary cloud name>
CLOUDINARY_API_KEY=<Cloudinary API key>
CLOUDINARY_API_SECRET=<Cloudinary API secret>
MAX_UPLOAD_MB=4
GEMINI_API_KEY=<optional Gemini API key>
GEMINI_MODEL=gemini-3.5-flash-lite
```

After deploying, set `PUBLIC_BASE_URL` to the production URL, such as `https://civicpulse.example.com`, and redeploy. The frontend uses same-origin `/api`, so a separate API URL or CORS configuration is not required.

Production uploads are Cloudinary-only because Vercel Functions do not provide persistent local storage. The application refuses unsafe production settings during startup instead of silently losing data.

Cloudinary's combined `CLOUDINARY_URL=cloudinary://...` environment variable can be used instead of the three separate `CLOUDINARY_*` credential variables. Never configure both forms with different accounts.

Verify the deployment:

```bash
curl https://your-domain.vercel.app/api/health
```

The repository also retains `Dockerfile` and `render.yaml` for container-based deployment on Render.
