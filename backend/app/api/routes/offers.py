from fastapi import APIRouter, Depends, HTTPException
from app.core.security import require_admin, require_user

from app.db.repository import civic_repo, now_utc, public_id
from app.schemas.offer import OfferCreate, OfferStatusUpdate
from app.services.audit import record_audit_event

router = APIRouter(prefix="/api/offers", tags=["offers"])


@router.get("")
async def list_offers(user: dict = Depends(require_user)):
    offers = await civic_repo.list_all("offers")
    if user.get("role") == "admin":
        return {"offers": offers}
    if user.get("role") == "contractor":
        contractor = next((item for item in await civic_repo.list_all("contractors") if item.get("user_id") == user["user_id"]), None)
        return {"offers": [item for item in offers if contractor and item.get("contractor_id") == contractor.get("contractor_id")], "contractor": contractor}
    raise HTTPException(status_code=403, detail="Contractor or authority access required")


@router.post("")
async def create_offer(payload: OfferCreate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", payload.complaint_id)
    contractor = await civic_repo.find_one("contractors", "contractor_id", payload.contractor_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor not found")
    if not contractor.get("verified") or not contractor.get("available"):
        raise HTTPException(status_code=409, detail="Contractor must be verified and available before dispatch")
    if complaint.get("status") == "Resolved":
        raise HTTPException(status_code=409, detail="Cannot dispatch work for a resolved complaint")
    active_offers = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == payload.complaint_id and item.get("status") in {"Sent", "Accepted", "In Progress", "Proof Submitted"}]
    if active_offers:
        raise HTTPException(status_code=409, detail="This complaint already has an active contractor assignment")
    timestamp = now_utc()
    issue_location = complaint.get("location", {})
    work_location = {
        "area": payload.work_location_area or issue_location.get("area"),
        "latitude": payload.work_latitude if payload.work_latitude is not None else issue_location.get("latitude"),
        "longitude": payload.work_longitude if payload.work_longitude is not None else issue_location.get("longitude"),
    }
    offer = {
        "offer_id": public_id("OFF"),
        "complaint_id": payload.complaint_id,
        "contractor_id": payload.contractor_id,
        "contractor_name": contractor["name"],
        "issue_title": complaint.get("summary") or complaint.get("description"),
        "issue_location": issue_location,
        "work_location": work_location,
        "work_location_area": work_location["area"],
        "work_latitude": work_location["latitude"],
        "work_longitude": work_location["longitude"],
        "issue_priority": complaint.get("priority_score"),
        "issue_severity": complaint.get("severity"),
        "work_type": payload.work_type,
        "budget_cap": payload.budget_cap,
        "sla_hours": payload.sla_hours,
        "proof_required": payload.proof_required,
        "status": "Sent",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    history = complaint.get("status_history", [])
    history.append({
        "status": "Contractor Offer Sent",
        "note": f"Offer sent to {contractor['name']} for {work_location.get('area') or 'reported location'}.",
        "at": timestamp,
    })
    await civic_repo.update_one(
        "complaints",
        "complaint_id",
        payload.complaint_id,
        {"status": "Contractor Offer Sent", "status_history": history},
    )
    created = await civic_repo.insert_one("offers", offer)
    await record_audit_event("offer", created["offer_id"], "created", _admin, after={"complaint_id": payload.complaint_id, "contractor_id": payload.contractor_id, "budget_cap": payload.budget_cap})
    return created


@router.patch("/{offer_id}/status")
async def update_offer_status(offer_id: str, payload: OfferStatusUpdate, user: dict = Depends(require_user)):
    offer = await civic_repo.find_one("offers", "offer_id", offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    if user.get("role") == "contractor":
        contractor = next((item for item in await civic_repo.list_all("contractors") if item.get("user_id") == user["user_id"]), None)
        if not contractor or offer.get("contractor_id") != contractor.get("contractor_id"):
            raise HTTPException(status_code=403, detail="This work order is not assigned to your account")
        if payload.status not in {"Accepted", "Rejected", "In Progress", "Proof Submitted"}:
            raise HTTPException(status_code=403, detail="Authority approval is required")
    elif user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Contractor or authority access required")
    allowed = {
        "Sent": {"Accepted", "Rejected"},
        "Accepted": {"In Progress", "Rejected"},
        "In Progress": {"Proof Submitted"},
        "Proof Submitted": {"Approved", "Rejected"},
    }
    if payload.status != offer.get("status") and payload.status not in allowed.get(offer.get("status"), set()):
        raise HTTPException(status_code=409, detail=f"Cannot move offer from {offer.get('status')} to {payload.status}")
    if payload.status == "Approved":
        complaint = await civic_repo.find_one("complaints", "complaint_id", offer["complaint_id"])
        if not complaint or not complaint.get("resolution_evidence"):
            raise HTTPException(status_code=409, detail="Stored completion evidence is required before approving contractor work")
    updated = await civic_repo.update_one("offers", "offer_id", offer_id, {"status": payload.status, "note": payload.note})
    complaint = await civic_repo.find_one("complaints", "complaint_id", offer["complaint_id"])
    if complaint and payload.status in {"Accepted", "In Progress", "Rejected"}:
        other_active = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == offer["complaint_id"] and item.get("offer_id") != offer_id and item.get("status") in {"Sent", "Accepted", "In Progress", "Proof Submitted"}]
        complaint_status = {"Accepted": "Assigned", "In Progress": "In Progress", "Rejected": complaint.get("status") if other_active else "Submitted"}[payload.status]
        history = complaint.get("status_history", [])
        history.append({"status": f"Contractor {payload.status}", "note": payload.note or f"Offer {offer_id} was {payload.status.lower()}.", "at": now_utc()})
        await civic_repo.update_one("complaints", "complaint_id", offer["complaint_id"], {
            "status": complaint_status,
            "assigned_contractor_id": offer.get("contractor_id") if payload.status != "Rejected" else None,
            "assigned_contractor_name": offer.get("contractor_name") if payload.status != "Rejected" else None,
            "status_history": history,
        })
    await record_audit_event("offer", offer_id, "status_transition", user, {"status": offer.get("status")}, {"status": payload.status}, payload.note)
    return updated
