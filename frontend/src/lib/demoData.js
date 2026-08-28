export const demoComplaints = [
  {
    complaint_id: "CP-9082",
    description: "Large pothole outside Main Market, Block C. Vehicles are swerving around it.",
    location: { area: "Main Market, Block C", latitude: 31.5204, longitude: 74.3587 },
    category: "Road Infrastructure",
    severity: "High",
    department: "Roads Department",
    priority_score: 84,
    duplicate_count: 7,
    status: "Assigned"
  },
  {
    complaint_id: "CP-7194",
    description: "Drainage overflow near school gate. Students cannot cross safely.",
    location: { area: "Zone B School Road", latitude: 31.528, longitude: 74.344 },
    category: "Drainage / Sewerage",
    severity: "Critical",
    department: "Drainage Department",
    priority_score: 94,
    duplicate_count: 12,
    status: "Submitted"
  }
];

export const demoContractors = [
  {
    contractor_id: "CTR-1001",
    name: "Ahmed Roadworks Team",
    skills: ["Potholes", "Concrete patch", "Road Infrastructure", "Night crew"],
    rating: 4.9,
    completed_jobs: 43,
    trust_score: 94
  },
  {
    contractor_id: "CTR-1002",
    name: "Green Lane Services",
    skills: ["Waste Management", "Drain cleaning", "Rapid response"],
    rating: 4.7,
    completed_jobs: 31,
    trust_score: 88
  }
];
