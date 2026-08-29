from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import logging
from uuid import uuid4

from app.core.config import settings

try:
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:
    AsyncIOMotorClient = None

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def public_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:10].upper()}"


def clean_mongo_doc(doc: dict | None) -> dict | None:
    if not doc:
        return None
    item = dict(doc)
    item.pop("_id", None)
    return item


class CivicRepository:
    def __init__(self) -> None:
        self.client = None
        self.db = None
        self.use_memory = True
        self.connection_error = None
        self.memory = {
            "complaints": [],
            "contractors": [],
            "offers": [],
            "discussions": [],
            "repair_requests": [],
            "geocoding_cache": [],
            "users": [],
            "sessions": [],
            "audit_events": [],
            "idempotency_keys": [],
            "webhook_events": [],
            "report_owners": [],
            "discussion_votes": [],
        }

    async def connect(self) -> None:
        allow_memory_fallback = settings.allow_memory_fallback and settings.environment != "production"
        if AsyncIOMotorClient is None:
            self.connection_error = "MongoDB driver is unavailable"
            self.use_memory = True
            if not allow_memory_fallback:
                raise RuntimeError(self.connection_error)
            return
        try:
            self.client = AsyncIOMotorClient(
                settings.mongo_uri,
                serverSelectionTimeoutMS=10000,
                tz_aware=True,
            )
            await self.client.admin.command("ping")
            self.db = self.client[settings.mongo_db_name]
            await self.db.users.create_index("email", unique=True)
            await self.db.sessions.create_index("token_hash", unique=True)
            await self.db.sessions.create_index("expires_at", expireAfterSeconds=0)
            await self.db.repair_requests.create_index([("applicant_user_id", 1), ("created_at", -1)])
            await self.db.complaints.create_index("complaint_id", unique=True)
            await self.db.offers.create_index("offer_id", unique=True)
            await self.db.repair_requests.create_index("request_id", unique=True)
            await self.db.audit_events.create_index("event_id", unique=True)
            await self.db.complaints.create_index([("status", 1), ("priority_score", -1), ("created_at", -1)])
            await self.db.complaints.create_index([("category", 1), ("severity", 1), ("created_at", -1)])
            await self.db.complaints.create_index([("location.latitude", 1), ("location.longitude", 1)])
            await self.db.complaints.create_index([("location_geo", "2dsphere")])
            await self.db.audit_events.create_index([("entity_type", 1), ("entity_id", 1), ("created_at", -1)])
            await self.db.idempotency_keys.create_index("key", unique=True)
            await self.db.idempotency_keys.create_index("expires_at", expireAfterSeconds=0)
            await self.db.webhook_events.create_index("provider_event_id", unique=True)
            await self.db.report_owners.create_index("token_hash", unique=True)
            await self.db.report_owners.create_index("expires_at", expireAfterSeconds=0)
            await self.db.discussion_votes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
            self.use_memory = False
            self.connection_error = None
        except Exception as exc:
            self.client = None
            self.db = None
            self.use_memory = True
            self.connection_error = f"{type(exc).__name__}: {exc}"
            if not allow_memory_fallback:
                logger.error("MongoDB unavailable and fallback is disabled: %s", self.connection_error)
                raise RuntimeError(
                    "MongoDB connection failed. Check Atlas network access and DNS resolution, "
                    "or enable ALLOW_MEMORY_FALLBACK for local development."
                ) from exc
            logger.warning(
                "MongoDB is temporarily unavailable; CivicPulse started in non-persistent local mode: %s",
                self.connection_error,
            )

    async def close(self) -> None:
        if self.client:
            self.client.close()

    async def storage_status(self) -> dict:
        if self.use_memory or self.db is None:
            return {"mode": "memory", "used_mb": 0, "threshold_mb": settings.mongo_cleanup_threshold_mb}
        stats = await self.db.command("dbStats", scale=1024 * 1024)
        return {
            "mode": "mongodb",
            "used_mb": round(float(stats.get("dataSize", 0)), 2),
            "storage_mb": round(float(stats.get("storageSize", 0)), 2),
            "threshold_mb": settings.mongo_cleanup_threshold_mb,
        }

    async def enforce_storage_budget(self) -> int:
        """Report storage pressure without silently destroying accountability data."""
        if self.use_memory or self.db is None:
            return 0
        try:
            status = await self.storage_status()
            if status["used_mb"] <= settings.mongo_cleanup_threshold_mb:
                return 0
            logger.error("MongoDB storage budget exceeded (%s MB). Automatic deletion is disabled; archive through a reviewed retention process.", status["used_mb"])
            return 0
        except Exception as exc:
            logger.error("MongoDB retention check failed without blocking the write: %s", exc)
            return 0

    async def ensure_demo_data(self) -> None:
        if await self.count("discussions") == 0:
            await self.insert_many("discussions", [
                {
                    "post_id": "DISC-1001",
                    "author_name": "Ayesha",
                    "area": "Lahore",
                    "topic": "Clean streets",
                    "message": "Civility starts when people stop throwing waste outside shops and homes.",
                    "upvotes": 18,
                    "created_at": now_utc(),
                },
                {
                    "post_id": "DISC-1002",
                    "author_name": "Hassan",
                    "area": "Karachi",
                    "topic": "Report with proof",
                    "message": "Citizens should upload clear photos so departments can act faster.",
                    "upvotes": 11,
                    "created_at": now_utc(),
                },
            ])

        if await self.count("complaints") == 0:
            await self.insert_many("complaints", [
            {
                "complaint_id": "CP-9082", "data_label": "Demo",
                "description": "Large pothole outside Main Market, Block C. Vehicles are swerving around it.",
                "location": {"area": "Main Market, Block C", "latitude": 31.5204, "longitude": 74.3587},
                "image_url": None,
                "category": "Road Infrastructure",
                "severity": "High",
                "confidence": 0.93,
                "summary": "Large pothole affecting vehicle movement near a market corridor.",
                "department": "Roads Department",
                "priority_score": 84,
                "priority_breakdown": {"severity": 38, "citizen_signal": 22, "waiting_time": 10, "location_impact": 14},
                "duplicate_count": 7,
                "status": "Assigned",
                "channel": "Portal",
                "created_at": now_utc(),
                "updated_at": now_utc(),
                "status_history": [
                    {"status": "Submitted", "note": "Citizen report received.", "at": now_utc()},
                    {"status": "AI Analyzed", "note": "Classified as road infrastructure.", "at": now_utc()},
                    {"status": "Assigned", "note": "Routed to Roads Department.", "at": now_utc()},
                ],
            },
            {
                "complaint_id": "CP-7194", "data_label": "Demo",
                "description": "Drainage overflow near school gate. Students cannot cross safely.",
                "location": {"area": "Zone B School Road", "latitude": 31.528, "longitude": 74.344},
                "image_url": None,
                "category": "Drainage / Sewerage",
                "severity": "Critical",
                "confidence": 0.91,
                "summary": "Drainage overflow blocking access near a school.",
                "department": "Drainage Department",
                "priority_score": 94,
                "priority_breakdown": {"severity": 46, "citizen_signal": 20, "waiting_time": 8, "location_impact": 20},
                "duplicate_count": 12,
                "status": "Submitted",
                "channel": "Portal",
                "created_at": now_utc(),
                "updated_at": now_utc(),
                "status_history": [{"status": "Submitted", "note": "Citizen report received.", "at": now_utc()}],
            },
            {
                "complaint_id": "CP-5510", "data_label": "Demo",
                "description": "Waste pile beside residential lane has not been collected.",
                "location": {"area": "Johar Town Phase 2", "latitude": 31.4697, "longitude": 74.2728},
                "image_url": None,
                "category": "Waste Management",
                "severity": "Medium",
                "confidence": 0.88,
                "summary": "Uncollected waste is spreading near homes.",
                "department": "Sanitation Department",
                "priority_score": 67,
                "priority_breakdown": {"severity": 30, "citizen_signal": 12, "waiting_time": 5, "location_impact": 20},
                "duplicate_count": 4,
                "status": "Resolved",
                "resolution_approvals": {"contractor": True, "government": True},
                "fully_verified": True,
                "channel": "Portal",
                "created_at": now_utc(),
                "updated_at": now_utc(),
                "status_history": [{"status": "Resolved", "note": "Demo case resolved.", "at": now_utc()}],
            },
            ])

        if await self.count("contractors") == 0:
            await self.insert_many("contractors", [
            {
                "contractor_id": "CTR-1001",
                "name": "Ahmed Roadworks Team",
                "contact": "+92 300 1111111",
                "service_area": "Main Market, Block C",
                "skills": ["Potholes", "Concrete patch", "Road Infrastructure", "Night crew"],
                "rating": 4.9,
                "completed_jobs": 43,
                "distance_km": 1.8,
                "verified": True,
                "available": True,
                "trust_score": 94,
            },
            {
                "contractor_id": "CTR-1002",
                "name": "Green Lane Services",
                "contact": "+92 300 2222222",
                "service_area": "Johar Town Phase 2",
                "skills": ["Waste Management", "Drain cleaning", "Rapid response"],
                "rating": 4.7,
                "completed_jobs": 31,
                "distance_km": 2.4,
                "verified": True,
                "available": True,
                "trust_score": 88,
            },
            {
                "contractor_id": "CTR-1003",
                "name": "City Light Technicians",
                "contact": "+92 300 3333333",
                "service_area": "Saddar Civic Center",
                "skills": ["Street Lighting", "Inspection", "Electrical repair"],
                "rating": 4.8,
                "completed_jobs": 56,
                "distance_km": 3.1,
                "verified": True,
                "available": True,
                "trust_score": 91,
            },
            ])

    async def count(self, collection: str) -> int:
        if self.use_memory:
            return len(self.memory[collection])
        return await self.db[collection].count_documents({})

    async def complaints_in_bbox(self, west: float, south: float, east: float, north: float, limit: int = 1000) -> list[dict]:
        if self.use_memory:
            matches = []
            for item in self.memory["complaints"]:
                location = item.get("location") or {}
                lat, lon = location.get("latitude"), location.get("longitude")
                if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and south <= lat <= north and west <= lon <= east:
                    matches.append(deepcopy(item))
            return matches[:limit]
        polygon = {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}
        cursor = self.db.complaints.find({"location_geo": {"$geoWithin": {"$geometry": polygon}}}).sort("priority_score", -1).limit(limit)
        return [clean_mongo_doc(item) async for item in cursor]

    async def insert_one(self, collection: str, item: dict) -> dict:
        record = deepcopy(item)
        if self.use_memory:
            self.memory[collection].append(record)
            return record
        await self.db[collection].insert_one(record)
        await self.enforce_storage_budget()
        return clean_mongo_doc(record)

    async def insert_many(self, collection: str, items: list[dict]) -> None:
        if self.use_memory:
            self.memory[collection].extend(deepcopy(items))
            return
        await self.db[collection].insert_many(deepcopy(items))
        await self.enforce_storage_budget()

    async def list_all(self, collection: str) -> list[dict]:
        if self.use_memory:
            return deepcopy(self.memory[collection])
        docs = await self.db[collection].find({}).to_list(length=500)
        return [clean_mongo_doc(doc) for doc in docs]

    async def list_page(self, collection: str, *, skip: int = 0, limit: int = 100, query: dict | None = None, sort=None) -> list[dict]:
        if self.use_memory:
            items = deepcopy(self.memory[collection])
            if query:
                items = [item for item in items if all(item.get(key) == value for key, value in query.items())]
            if sort:
                for key, direction in reversed(sort):
                    items.sort(key=lambda item: item.get(key, 0), reverse=direction < 0)
            return items[skip:skip + limit]
        cursor = self.db[collection].find(query or {})
        if sort:
            cursor = cursor.sort(sort)
        docs = await cursor.skip(skip).limit(limit).to_list(length=limit)
        return [clean_mongo_doc(doc) for doc in docs]

    async def find_one(self, collection: str, key: str, value: str) -> dict | None:
        if self.use_memory:
            for item in self.memory[collection]:
                if item.get(key) == value:
                    return deepcopy(item)
            return None
        return clean_mongo_doc(await self.db[collection].find_one({key: value}))

    async def update_one(self, collection: str, key: str, value: str, changes: dict) -> dict | None:
        changes = deepcopy(changes)
        changes["updated_at"] = now_utc()
        if self.use_memory:
            for index, item in enumerate(self.memory[collection]):
                if item.get(key) == value:
                    item.update(changes)
                    self.memory[collection][index] = item
                    return deepcopy(item)
            return None
        await self.db[collection].update_one({key: value}, {"$set": changes})
        return await self.find_one(collection, key, value)

    async def delete_one(self, collection: str, key: str, value: str) -> bool:
        if self.use_memory:
            before = len(self.memory[collection])
            self.memory[collection] = [item for item in self.memory[collection] if item.get(key) != value]
            return len(self.memory[collection]) < before
        result = await self.db[collection].delete_one({key: value})
        return result.deleted_count == 1


civic_repo = CivicRepository()
