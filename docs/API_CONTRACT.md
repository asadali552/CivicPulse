# API Contract

Base URL: `http://localhost:8000/api`

## Health

- `GET /health`

## Complaints

- `GET /complaints`
- `GET /complaints/{complaint_id}`
- `POST /complaints`
- `POST /complaints/analyze` (multipart AI preview; optionally stores evidence)
- `POST /complaints/with-image`
- `PATCH /complaints/{complaint_id}/status`
- `POST /complaints/{complaint_id}/resolution-approval`

Resolution map state is derived from `resolution_approvals.contractor`, `resolution_approvals.reporter`, and `resolution_approvals.government`. All three approvals plus evidence produce a fully verified resolution.

MongoDB retention is checked after inserts. Above `MONGO_CLEANUP_THRESHOLD_MB` (default 450 MB), the oldest resolved complaint bundles are removed first until the database reaches `MONGO_CLEANUP_TARGET_MB` (default 425 MB).

## Dashboard

- `GET /dashboard`

## Contractors

- `GET /contractors`
- `POST /contractors`
- `GET /contractors/match/{complaint_id}`

## Offers

- `GET /offers`
- `POST /offers`
- `PATCH /offers/{offer_id}/status`

## Tracking

- `GET /track/{complaint_id}`

Tracking responses include both a compact summary and the complete complaint record under `complaint` for the citizen timeline and evidence UI.

## Community Repair Funding

- `GET /repair-requests`
- `POST /repair-requests`
- `PATCH /repair-requests/{request_id}/decision`
- `POST /repair-requests/{request_id}/proof`
- `POST /repair-requests/{request_id}/release-funds`

Approved budgets use an explicitly labeled demonstration reservation state. The system does not claim real escrow or money movement. Payment approval cannot be recorded until completion proof has been submitted for authority verification, and complaint closure still requires reporter confirmation.

## Authority Operations

- `GET /operations/incidents/{complaint_id}` — complaint evidence, citizen input, AI assessment, risk flags, recommendation, contractor matches, work orders, and related funding requests.
- `GET /geo/reverse?latitude=...&longitude=...` — cached OpenStreetMap reverse geocoding for user-triggered GPS capture.
