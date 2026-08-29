from collections import Counter
from datetime import datetime, timezone
from statistics import median


def _dt(value):
    if not value:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _hours(start, end):
    start, end = _dt(start), _dt(end)
    return round((end - start).total_seconds() / 3600, 2) if start and end and end >= start else None


def build_dashboard_stats(complaints: list[dict], offers: list[dict]) -> dict:
    active = [item for item in complaints if item.get("status") != "Resolved"]
    critical = [item for item in complaints if item.get("severity") == "Critical"]
    needs_review = [item for item in complaints if item.get("needs_review")]
    overdue = [item for item in complaints if item.get("sla_status", "").startswith("Overdue")]
    hotspots = [item for item in complaints if item.get("hotspot_warning")]
    whatsapp = [item for item in complaints if item.get("channel") == "WhatsApp"]
    category_counts = Counter(item.get("category", "Other") for item in complaints)
    severity_counts = Counter(item.get("severity", "Medium") for item in complaints)
    top_category = category_counts.most_common(1)[0][0] if category_counts else "None"
    now = datetime.now(timezone.utc)
    response_hours = [value for item in complaints if (value := _hours(item.get("created_at"), item.get("assigned_at"))) is not None]
    resolution_hours = [value for item in complaints if (value := _hours(item.get("created_at"), item.get("resolved_at"))) is not None]
    backlog_age_hours = [value for item in active if (value := _hours(item.get("created_at"), now)) is not None]
    resolved = [item for item in complaints if item.get("status") == "Resolved"]
    sla_measured = [item for item in complaints if item.get("resolved_at") and item.get("sla_due_at")]
    sla_met = sum(1 for item in sla_measured if _dt(item["resolved_at"]) <= _dt(item["sla_due_at"]))
    severity_weight = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    resolved_weight = sum(severity_weight.get(item.get("severity"), 2) for item in resolved)
    total_weight = sum(severity_weight.get(item.get("severity"), 2) for item in complaints)
    department_workload = Counter(item.get("department", "Unassigned") for item in active)

    return {
        "active_issues": len(active),
        "critical_queue": len(critical),
        "offers_sent": len(offers),
        "resolution_rate": round((len(complaints) - len(active)) / max(len(complaints), 1) * 100),
        "needs_review": len(needs_review),
        "overdue_cases": len(overdue),
        "hotspot_warnings": len(hotspots),
        "category_counts": dict(category_counts),
        "severity_counts": dict(severity_counts),
        "top_category": top_category,
        "critical_count": len(critical),
        "whatsapp_intakes": len(whatsapp),
        "whatsapp_open": sum(1 for item in whatsapp if item.get("status") != "Resolved"),
        "accountability": {
            "median_response_hours": round(median(response_hours), 2) if response_hours else None,
            "median_resolution_hours": round(median(resolution_hours), 2) if resolution_hours else None,
            "sla_compliance_percent": round(sla_met / len(sla_measured) * 100, 1) if sla_measured else None,
            "verified_resolution_rate_percent": round(sum(1 for item in resolved if item.get("fully_verified")) / max(len(resolved), 1) * 100, 1),
            "reopened_issue_rate_percent": round(sum(1 for item in complaints if item.get("reopened_at")) / max(len(complaints), 1) * 100, 1),
            "outstanding_backlog": len(active),
            "median_backlog_age_hours": round(median(backlog_age_hours), 2) if backlog_age_hours else None,
            "severity_adjusted_resolution_percent": round(resolved_weight / max(total_weight, 1) * 100, 1),
            "department_workload": dict(department_workload),
            "citizen_confirmation_rate_percent": round(sum(1 for item in resolved if item.get("citizen_verification", {}).get("fixed")) / max(len(resolved), 1) * 100, 1),
        },
        "methodology": "Medians reduce outlier distortion. SLA compliance uses only cases with due and resolution timestamps. Severity-adjusted performance weights Critical=4, High=3, Medium=2, Low=1. Rates are not rankings and should be interpreted with workload and backlog.",
    }
