import asyncio
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.db.repository import CivicRepository
from app.services.drive_verification import normalize_drive_url, verification_url
from app.services.payments import release_contractor_payment


def test_drive_links_are_allowlisted_and_canonical_download_is_used():
    link = "https://drive.google.com/file/d/abc_DEF-123/view?usp=sharing"
    assert normalize_drive_url(link) == link
    assert verification_url(link) == "https://drive.google.com/uc?export=download&id=abc_DEF-123"
    with pytest.raises(HTTPException) as rejected:
        normalize_drive_url("https://drive.google.com.attacker.example/file/d/abc/view")
    assert rejected.value.status_code == 422


def test_memory_transaction_rolls_back_all_collections():
    repo = CivicRepository()
    repo.use_memory = True
    async def execute():
        async with repo.transaction() as session:
            await repo.insert_one("complaints", {"complaint_id": "CP-ROLLBACK"}, session=session)
            await repo.insert_one("audit_events", {"event_id": "AUD-ROLLBACK"}, session=session)
            raise RuntimeError("fail after partial write")
    with pytest.raises(RuntimeError):
        asyncio.run(execute())
    assert repo.memory["complaints"] == []
    assert repo.memory["audit_events"] == []


def test_demo_payment_is_explicit_and_idempotency_ready(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "payment_provider", "demo")
    receipt = asyncio.run(release_contractor_payment(
        {"offer_id": "OFF-1", "complaint_id": "CP-1", "budget_cap": 1250},
        {"payout_account_id": None},
    ))
    assert receipt.provider == "demo"
    assert receipt.reference == "demo-OFF-1"
    assert receipt.amount == 1250


def test_cluster_results_are_bounded_and_preserve_single_marker_identity():
    repo = CivicRepository()
    repo.use_memory = True
    repo.memory["complaints"] = [
        {"complaint_id": "CP-1", "location": {"latitude": 31.5, "longitude": 74.3}, "priority_score": 80, "severity": "Critical"},
        {"complaint_id": "CP-2", "location": {"latitude": 31.5001, "longitude": 74.3001}, "priority_score": 60, "severity": "Medium"},
        {"complaint_id": "OUTSIDE", "location": {"latitude": 40, "longitude": 70}, "priority_score": 10, "severity": "Low"},
    ]
    clusters = asyncio.run(repo.complaint_clusters(74, 31, 75, 32, 10))
    assert sum(row["count"] for row in clusters) == 2
    assert max(row["critical_count"] for row in clusters) == 1
