const API_BASE = window.CIVICPULSE_API_BASE || "/api";

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

export function createComplaint(payload) {
  return apiFetch("/complaints", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listComplaints() {
  return apiFetch("/complaints");
}

export function analyzeEvidence(formData) {
  return fetch(`${API_BASE}/complaints/analyze`, { method: "POST", body: formData }).then(async response => {
    if (!response.ok) throw new Error((await response.json()).detail || "Analysis failed");
    return response.json();
  });
}

export function getDashboard() {
  return apiFetch("/dashboard");
}

export function getTracking(complaintId) {
  return apiFetch(`/track/${complaintId}`);
}

export function createOffer(payload) {
  return apiFetch("/offers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
