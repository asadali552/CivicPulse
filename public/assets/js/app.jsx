    const { useState, useEffect, useRef } = React;
    const API_BASE = window.CIVICPULSE_API_BASE || '/api';

    async function api(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'same-origin',
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(!['GET','HEAD','OPTIONS'].includes(method) && window.CIVICPULSE_CSRF ? {'X-CSRF-Token': window.CIVICPULSE_CSRF} : {})
        }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(body.detail)
          ? body.detail.map(item => item.msg || item.message || String(item)).join(' · ')
          : body.detail;
        const error = new Error(detail || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return body;
    }

    const absoluteMediaUrl = (url) => {
      if (!url || url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) return url;
      return `${window.location.origin}${url}`;
    };

    const DEMO_IMAGE_BY_CATEGORY = {
      'Road Infrastructure': 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
      'Drainage / Sewerage': 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800',
      'Waste Management': 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&q=80&w=800',
    };

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);

    const normalizeReport = (item) => ({
      ...item,
      id: item.complaint_id || item.id,
      title: item.summary || item.title || item.description,
      location: typeof item.location === 'string' ? item.location : item.location?.area || 'Location pending',
      coordinates: item.coordinates || { lat: item.location?.latitude, lng: item.location?.longitude },
      confidence: typeof item.confidence === 'number'
        ? `${item.needs_review ? 'Needs Human Review' : 'AI Confidence'} (${Math.round(item.confidence * 100)}%)`
        : item.confidence,
      duplicates: item.duplicate_count ?? item.duplicates ?? 0,
      beforeImage: absoluteMediaUrl(
        item.image_url
        || item.beforeImage
        || (item.data_label === 'Demo' ? DEMO_IMAGE_BY_CATEGORY[item.category] : null)
      ),
      afterImage: absoluteMediaUrl(item.resolution_evidence?.after_image_url || item.afterImage),
      timeline: (item.status_history || item.timeline || []).map(entry => ({
        step: entry.status || entry.step,
        time: entry.at ? new Date(entry.at).toLocaleString() : entry.time,
        note: entry.note,
        done: entry.done !== false,
      })),
    });

    const markerState = (report) => {
      const approvals = report.resolution_approvals || {};
      const approvalCount = ['contractor', 'reporter', 'government'].filter(key => approvals[key]).length;
      if (approvalCount === 3 || report.fully_verified) return { color: '#22c55e', label: 'Fully verified resolution' };
      if (approvalCount > 0) return { color: '#38bdf8', label: `${approvalCount}/3 resolution approvals` };
      if (report.severity === 'Critical' || report.severity === 'High') return { color: '#ef4444', label: `${report.severity} unresolved problem` };
      return { color: '#eab308', label: `${report.severity || 'Moderate'} unresolved problem` };
    };

    function AuthorityMap({ reports, onSelect }) {
      const mapNode = useRef(null);
      const mapInstance = useRef(null);
      useEffect(() => {
        if (!window.L || !mapNode.current) return;
        if (mapInstance.current) mapInstance.current.remove();
        const locatedReports = reports.filter(r => Number.isFinite(r.coordinates?.lat) && Number.isFinite(r.coordinates?.lng));
        const groups = new Map();
        locatedReports.forEach(report => {
          const key = report.incident_id || report.id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(report);
        });
        const located = [...groups.values()].map(group => ({...group[0], incidentReportCount: group.length}));
        const center = located.length ? [located[0].coordinates.lat, located[0].coordinates.lng] : [30.1575, 71.5249];
        const map = window.L.map(mapNode.current).setView(center, 12);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        located.forEach(report => {
          const state = markerState(report);
          const color = state.color;
          window.L.circleMarker([report.coordinates.lat, report.coordinates.lng], {
            radius: (report.severity === 'Critical' ? 10 : 7) + Math.min((report.incidentReportCount || 1) - 1, 5), color, fillColor: color, fillOpacity: .8, weight: 2
          }).addTo(map).bindPopup(`<strong>${escapeHtml(report.incident_id || report.id)}</strong><br>${escapeHtml(report.category)}<br>${escapeHtml(report.location)}<br>${escapeHtml(report.status)}<br><small>${escapeHtml(state.label)}</small>${report.incidentReportCount > 1 ? `<br><small>${report.incidentReportCount} citizen reports linked to this incident</small>` : ''}${report.community_repair_interest_count ? `<br><small>${Number(report.community_repair_interest_count) || 0} community proposal(s) received</small>` : ''}`).on('click', () => onSelect(report));
        });
        if (located.length > 1) map.fitBounds(located.map(r => [r.coordinates.lat, r.coordinates.lng]), { padding: [30, 30] });
        mapInstance.current = map;
        return () => { map.remove(); mapInstance.current = null; };
      }, [reports]);
      return <div ref={mapNode} className="h-[440px] w-full rounded-xl overflow-hidden bg-slate-950" />;
    }

    function LocationPicker({ latitude, longitude, onPick }) {
      const mapNode = useRef(null);
      const onPickRef = useRef(onPick);
      useEffect(() => { onPickRef.current = onPick; }, [onPick]);
      useEffect(() => {
        if (!window.L || !mapNode.current) return;
        const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
        const center = hasLocation ? [latitude, longitude] : [30.1575, 71.5249];
        const map = window.L.map(mapNode.current).setView(center, hasLocation ? 17 : 11);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        const marker = window.L.marker(center, { draggable: true }).addTo(map);
        const select = ({ lat, lng }) => {
          marker.setLatLng([lat, lng]);
          onPickRef.current(lat, lng);
        };
        map.on('click', event => select(event.latlng));
        marker.on('dragend', () => select(marker.getLatLng()));
        setTimeout(() => map.invalidateSize(), 0);
        return () => map.remove();
      }, []);
      return <div ref={mapNode} className="h-72 w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800" aria-label="Choose report location on map" />;
    }

    // --- ICON HELPER COMPONENT FOR LUCIDE CDN ---
    const Icon = ({ name, className = "w-5 h-5", ...props }) => {
      const iconRef = useRef(null);
      useEffect(() => {
        if (window.lucide?.icons && iconRef.current) {
          const key = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
          const definition = window.lucide.icons[key];
          if (definition && window.lucide.createElement) {
            const svg = window.lucide.createElement(definition);
            svg.setAttribute('class', className);
            iconRef.current.replaceChildren(svg);
          }
        }
      }, [name, className]);
      return <span ref={iconRef} className={`inline-flex ${className}`} aria-hidden="true" {...props}></span>;
    };

    // --- MOCK DATABASE ---
    const INITIAL_REPORTS = [
      {
        id: 'CP-88412',
        category: 'Let AI decide',
        title: 'Severe Asphalt Pothole near School Gate',
        location: 'Bosan Road, Sector 3, Multan',
        coordinates: { lat: 30.258, lng: 71.514 },
        severity: 'Critical',
        status: 'In Progress',
        department: 'Dept. of Public Works',
        reportedAt: '2026-08-20T09:12:00Z',
        confidence: 'High Confidence (98.4%)',
        duplicates: 4,
        beforeImage: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
        afterImage: null,
        description: 'Deep pothole across the left lane creating severe traffic bottlenecks during morning school hours.',
        timeline: [
          { step: 'Reported', time: '09:12 AM', done: true },
          { step: 'AI Assessed', time: '09:13 AM', done: true },
          { step: 'Assigned', time: '09:30 AM', done: true },
          { step: 'In Progress', time: '10:15 AM', done: true },
          { step: 'Resolved', time: 'Pending Evidence', done: false }
        ]
      },
      {
        id: 'CP-88390',
        category: 'Waste Management',
        title: 'Overflowing Municipal Garbage Bin',
        location: 'Main Commercial Market, Block B',
        coordinates: { lat: 30.262, lng: 71.520 },
        severity: 'High',
        status: 'Resolved',
        department: 'Sanitation Authority',
        reportedAt: '2026-08-19T14:20:00Z',
        confidence: 'High Confidence (96.1%)',
        duplicates: 1,
        beforeImage: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800',
        afterImage: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&q=80&w=800',
        description: 'Commercial waste spill overflowing onto pedestrian walkway.',
        timeline: [
          { step: 'Reported', time: '02:20 PM', done: true },
          { step: 'AI Assessed', time: '02:21 PM', done: true },
          { step: 'Assigned', time: '02:45 PM', done: true },
          { step: 'In Progress', time: '03:10 PM', done: true },
          { step: 'Resolved', time: '05:00 PM', done: true }
        ]
      },
      {
        id: 'CP-88210',
        category: 'Water & Sewage',
        title: 'Main Pipeline Overflow & Standing Water',
        location: 'Gulgasht Colony, Street 14',
        coordinates: { lat: 30.250, lng: 71.508 },
        severity: 'Critical',
        status: 'Pending',
        department: 'Water Supply & Sewerage Board',
        reportedAt: '2026-08-20T11:45:00Z',
        confidence: 'Needs Human Review',
        duplicates: 0,
        beforeImage: 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&q=80&w=800',
        afterImage: null,
        description: 'Water leaking continuously from underground main valve.',
        timeline: [
          { step: 'Reported', time: '11:45 AM', done: true },
          { step: 'AI Assessed', time: '11:46 AM', done: true },
          { step: 'Assigned', time: 'Pending', done: false },
          { step: 'In Progress', time: 'Pending', done: false },
          { step: 'Resolved', time: 'Pending', done: false }
        ]
      }
    ];

    function AuthCard({ title, subtitle, mode, setMode, form, setForm, submit, busy, error, allowRegister = true }) {
      const [showPassword, setShowPassword] = useState(false);
      const registering = allowRegister && mode === 'register';
      const emailValid = !allowRegister || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
      const passwordValid = form.password.length >= (registering ? 8 : 1);
      const passwordsMatch = !registering || form.password === form.confirmPassword;
      const canSubmit = !busy && emailValid && passwordValid && (!registering || (form.name.trim().length >= 2 && passwordsMatch));
      return <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div><h2 className="text-xl font-bold text-white">{title}</h2><p className="text-xs text-slate-400 mt-1">{subtitle}</p></div>
        {allowRegister && <div className="grid grid-cols-2 bg-slate-950 border border-slate-800 rounded-lg p-1"><button onClick={()=>setMode('login')} className={`py-2 rounded text-xs ${mode==='login'?'bg-sky-500 text-slate-950':'text-slate-400'}`}>Login</button><button onClick={()=>setMode('register')} className={`py-2 rounded text-xs ${mode==='register'?'bg-sky-500 text-slate-950':'text-slate-400'}`}>Register</button></div>}
        {allowRegister && mode==='register' && <><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" autoComplete="name" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"/><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone (optional)" autoComplete="tel" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"/></>}
        <input type={allowRegister?'email':'text'} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder={allowRegister ? 'Email address' : 'Admin username'} autoComplete="username" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"/>
        <div className="relative"><input type={showPassword?'text':'password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Password" autoComplete={mode==='register'?'new-password':'current-password'} onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 pr-16 text-sm text-white"/><button type="button" onClick={()=>setShowPassword(value=>!value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{showPassword?'Hide':'Show'}</button></div>
        {registering && <><input type={showPassword?'text':'password'} value={form.confirmPassword} onChange={e=>setForm({...form,confirmPassword:e.target.value})} placeholder="Confirm password" autoComplete="new-password" onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className={`w-full bg-slate-950 border rounded-lg p-3 text-sm text-white ${form.confirmPassword && !passwordsMatch?'border-red-500/60':'border-slate-800'}`}/><div className="flex justify-between text-[10px]"><span className={passwordValid?'text-emerald-400':'text-slate-500'}>{passwordValid?'✓ Password length':'Minimum 8 characters'}</span>{form.confirmPassword && <span className={passwordsMatch?'text-emerald-400':'text-red-400'}>{passwordsMatch?'✓ Passwords match':'Passwords do not match'}</span>}</div></>}
        {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}
        <button onClick={()=>submit()} disabled={!canSubmit} className="w-full py-3 rounded-xl bg-sky-500 disabled:opacity-40 text-slate-950 font-semibold">{busy?'Please wait…':mode==='register'?'Create youth account':'Secure login'}</button>
      </div>;
    }

    // --- MAIN APP COMPONENT ---
    function App() {
      const [activeTab, setActiveTab] = useState('landing');
      const [darkMode, setDarkMode] = useState(() => localStorage.getItem('civicpulse-theme') !== 'light');
      const [reports, setReports] = useState(INITIAL_REPORTS);
      const [selectedReport, setSelectedReport] = useState(INITIAL_REPORTS[0]);
      
      // Before/After Slider
      const [sliderPos, setSliderPos] = useState(50);

      // Multi-step Citizen Form
      const [reportStep, setReportStep] = useState(1);
      const [uploadedImage, setUploadedImage] = useState(null);
      const [uploadedFile, setUploadedFile] = useState(null);
      const [aiAnalysis, setAiAnalysis] = useState(null);
      const [dashboard, setDashboard] = useState(null);
      const [isSubmitting, setIsSubmitting] = useState(false);
      const [apiOnline, setApiOnline] = useState(false);
      const [mapFilter, setMapFilter] = useState('All');
      const [trackingQuery, setTrackingQuery] = useState('');
      const [repairRequests, setRepairRequests] = useState([]);
      const [repairForm, setRepairForm] = useState({ complaint_id: '', estimated_price: '', plan: '', estimated_hours: 24 });
      const [adminView, setAdminView] = useState('queue');
      const [operationDetail, setOperationDetail] = useState(null);
      const [operationLoading, setOperationLoading] = useState(false);
      const [accountabilityReceipt, setAccountabilityReceipt] = useState(null);
      const [offerForm, setOfferForm] = useState({ contractor_id: '', budget_cap: '', sla_hours: 24 });
      const [fundingBudgets, setFundingBudgets] = useState({});
      const [authUser, setAuthUser] = useState(null);
      const [authMode, setAuthMode] = useState('login');
      const [authForm, setAuthForm] = useState({name:'',email:'',password:'',confirmPassword:'',phone:''});
      const [authBusy, setAuthBusy] = useState(false);
      const [authError, setAuthError] = useState('');
      const [isAnalyzing, setIsAnalyzing] = useState(false);
      const [analysisComplete, setAnalysisComplete] = useState(false);
      const [photoLocation, setPhotoLocation] = useState(null);
      const [showLocationMap, setShowLocationMap] = useState(false);
      const [reportForm, setReportForm] = useState({
        category: 'Let AI decide',
        severity: 'High',
        location: '',
        description: '',
        latitude: null,
        longitude: null,
        locationSource: null,
        locationConfirmed: false,
        locationAccuracy: null,
        photoCapturedAt: null,
        reporterContact: ''
      });

      // Admin Filters
      const [searchQuery, setSearchQuery] = useState('');
      const [queueFilters, setQueueFilters] = useState({days:'all',state:'unresolved',category:'all',severity:'all',sort:'priority'});
      const [toast, setToast] = useState(null);
      const authUserRef = useRef(null);
      const authVersionRef = useRef(0);
      const reportSubmissionKeyRef = useRef(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

      useEffect(() => { authUserRef.current = authUser; }, [authUser]);

      useEffect(() => () => { if (uploadedImage?.startsWith('blob:')) URL.revokeObjectURL(uploadedImage); }, [uploadedImage]);

      useEffect(() => {
        document.documentElement.classList.toggle('dark', darkMode);
        localStorage.setItem('civicpulse-theme', darkMode ? 'dark' : 'light');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode ? '#0B0F17' : '#f4f7fb');
      }, [darkMode]);

      useEffect(() => {
        loadSession();
        const timer = setInterval(() => refreshData(authUserRef.current), 30000);
        return () => clearInterval(timer);
      }, []);

      const loadSession = async () => {
        const requestVersion = authVersionRef.current;
        try {
          const user = await api('/auth/me');
          if (requestVersion !== authVersionRef.current) return;
          window.CIVICPULSE_CSRF = user.csrf_token;
          setAuthUser(user);
          await refreshData(user);
        } catch (error) {
          if (requestVersion !== authVersionRef.current) return;
          if (error.status === 401) {
            window.CIVICPULSE_CSRF = '';
            setAuthUser(null);
            await refreshData(null);
          } else {
            await refreshData(authUserRef.current);
            if (authUserRef.current) showToast('Connection interrupted. Your account remains signed in and will retry automatically.');
          }
        }
      };

      const refreshData = async (knownUser = authUser) => {
        try {
          const complaintData = await api('/complaints');
          const liveReports = complaintData.complaints.map(normalizeReport);
          setReports(liveReports);
          setApiOnline(true);
          setSelectedReport(current => liveReports.find(report => report.id === current?.id) || liveReports[0] || null);
          if (knownUser?.role === 'admin') {
            try { setDashboard(await api('/dashboard')); }
            catch (error) { setDashboard(null); showToast(`Dashboard metrics unavailable: ${error.message}`); }
          } else {
            setDashboard(null);
          }
          if (knownUser) {
            try { setRepairRequests((await api('/repair-requests')).requests || []); }
            catch (error) { setRepairRequests([]); showToast(`Repair records unavailable: ${error.message}`); }
          } else {
            setRepairRequests([]);
          }
        } catch (error) {
          setApiOnline(false);
          showToast(`Complaint database unavailable: ${error.message}`);
        }
      };

      const authenticate = async (forcedMode = null) => {
        const selectedMode = ['login', 'register'].includes(forcedMode) ? forcedMode : authMode;
        authVersionRef.current += 1;
        setAuthError('');
        if (selectedMode === 'register' && authForm.password !== authForm.confirmPassword) return setAuthError('Passwords do not match.');
        setAuthBusy(true);
        try {
          const path = selectedMode === 'register' ? '/auth/register' : '/auth/login';
          const payload = selectedMode === 'register' ? {name:authForm.name.trim(),email:authForm.email.trim(),password:authForm.password,phone:authForm.phone.trim()} : {email:authForm.email.trim(),password:authForm.password};
          const user = await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          window.CIVICPULSE_CSRF = user.csrf_token; setAuthUser(user); setAuthForm({name:'',email:'',password:'',confirmPassword:'',phone:''});
          await refreshData(user); showToast(`Welcome, ${user.name}.`);
        } catch (error) { setAuthError(error.message); showToast(error.message); }
        finally { setAuthBusy(false); }
      };

      const logout = async () => {
        authVersionRef.current += 1;
        try { await api('/auth/logout',{method:'POST'}); } catch (_) {}
        window.CIVICPULSE_CSRF=''; setAuthUser(null); setDashboard(null); setRepairRequests([]); setOperationDetail(null); setActiveTab('landing'); showToast('Logged out securely.');
      };

      const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3500);
      };

      const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) return showToast('Use a JPEG, PNG, WebP, or GIF image.');
        if (file.size > 4 * 1024 * 1024) return showToast('Image must be 4 MB or smaller.');
        setUploadedFile(file);
        setUploadedImage(URL.createObjectURL(file));
        setReportStep(2);
        setIsAnalyzing(true);
        setAnalysisComplete(false);
        try {
          const data = new FormData();
          data.append('image', file);
          data.append('description', reportForm.description || 'Civic issue shown in uploaded evidence');
          data.append('category_hint', reportForm.category || 'Let AI decide');
          const analysis = await api('/complaints/analyze', { method: 'POST', body: data });
          setAiAnalysis(analysis);
          setPhotoLocation(analysis.photo_location || null);
          setUploadedImage(absoluteMediaUrl(analysis.image_url) || URL.createObjectURL(file));
          setReportForm(form => ({ ...form, category: analysis.category, severity: analysis.severity }));
          setApiOnline(true);
        } catch (error) {
          setAiAnalysis(null);
          setPhotoLocation(null);
          showToast(`AI analysis unavailable: ${error.message}`);
        } finally {
          setIsAnalyzing(false);
          setAnalysisComplete(true);
        }
      };

      const handleFinalSubmit = async () => {
        if (!reportForm.location.trim() || !reportForm.description.trim()) return showToast('Location and description are required.');
        if (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= .75) return showToast('This image does not appear to show a civic issue.');
        setIsSubmitting(true);
        try {
          const data = new FormData();
          data.append('description', reportForm.description);
          data.append('area', reportForm.location);
          data.append('category_hint', reportForm.category);
          data.append('image_quality', uploadedFile ? 'usable' : 'missing');
          if (reportForm.latitude != null) data.append('latitude', reportForm.latitude);
          if (reportForm.longitude != null) data.append('longitude', reportForm.longitude);
          if (reportForm.locationSource) data.append('location_source', reportForm.locationSource);
          data.append('location_confirmed', String(reportForm.locationConfirmed));
          if (reportForm.locationAccuracy != null) data.append('location_accuracy_meters', reportForm.locationAccuracy);
          if (reportForm.photoCapturedAt) data.append('photo_captured_at', reportForm.photoCapturedAt);
          if (reportForm.reporterContact.trim()) data.append('reporter_contact', reportForm.reporterContact.trim());
          if (aiAnalysis?.analysis_token) data.append('analysis_token', aiAnalysis.analysis_token);
          if (uploadedFile) data.append('image', uploadedFile);
          const created = await api('/complaints/with-image', { method: 'POST', headers: {'Idempotency-Key': reportSubmissionKeyRef.current}, body: data });
          const newReport = normalizeReport(created);
          await refreshData();
          setSelectedReport(newReport);
          setTrackingQuery(newReport.id);
          reportSubmissionKeyRef.current = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
          if (created.reporter_verification_token) {
            sessionStorage.setItem(`civicpulse-reporter-${newReport.id}`, created.reporter_verification_token);
          }
          showToast(`Report ${newReport.id} logged${newReport.needs_review ? ' for human review' : ' and routed successfully'}.`);
          setActiveTab('track');
        } catch (error) {
          showToast(`Submission failed: ${error.message}`);
        } finally { setIsSubmitting(false); }
      };

      const trackById = async () => {
        if (!trackingQuery.trim()) return;
        try {
          const result = await api(`/track/${encodeURIComponent(trackingQuery.trim())}`);
          setSelectedReport(normalizeReport(result.complaint || result));
          showToast('Live tracking record loaded.');
        } catch (error) { showToast(error.message); }
      };

      const loadAccountabilityReceipt = async report => {
        try { setAccountabilityReceipt(await api(`/track/${encodeURIComponent(report.id)}/receipt`)); }
        catch (error) { showToast(error.message); }
      };

      const reverseGeocode = async (latitude, longitude, source, extra = {}) => {
        setReportForm(form => ({
          ...form, latitude, longitude, locationSource: source, locationConfirmed: true,
          locationAccuracy: extra.accuracy ?? null,
          photoCapturedAt: extra.capturedAt ?? form.photoCapturedAt,
        }));
        try {
          const place = await api(`/geo/reverse?latitude=${latitude}&longitude=${longitude}`);
          setReportForm(form => ({...form, location: place.display_name, latitude, longitude, locationSource: source, locationConfirmed: true}));
          showToast(`Location found: ${place.area || place.city || place.display_name}`);
        } catch (error) {
          setReportForm(form => ({...form, location: form.location || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}));
          showToast('Coordinates attached; the readable address lookup is unavailable.');
        }
      };

      const usePhotoLocation = () => {
        if (!photoLocation) return;
        reverseGeocode(photoLocation.latitude, photoLocation.longitude, 'photo_exif', {
          accuracy: photoLocation.accuracy_meters,
          capturedAt: photoLocation.captured_at,
        });
      };

      const captureLocation = () => {
        if (!navigator.geolocation) return showToast('GPS is not supported by this device.');
        navigator.geolocation.getCurrentPosition(
          position => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            showToast('GPS captured. Looking up the street address…');
            reverseGeocode(latitude, longitude, 'device_gps', {accuracy: position.coords.accuracy});
          },
          () => showToast('Location permission was not granted.'),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      };

      const selectMapLocation = (latitude, longitude) => {
        reverseGeocode(latitude, longitude, 'map_pin');
      };

      const approveResolution = async (report, stakeholder) => {
        try {
          const updated = await api(`/complaints/${report.id}/resolution-approval`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({stakeholder, approved:true}) });
          setSelectedReport(normalizeReport(updated)); await refreshData(); showToast(`${stakeholder} approval recorded.`);
        } catch (error) { showToast(error.message); }
      };

      const verifyAsReporter = async (report, outcome) => {
        const token = sessionStorage.getItem(`civicpulse-reporter-${report.id}`);
        if (!token) return showToast('This browser does not hold the private reporter verification link.');
        try {
          const updated = await api(`/complaints/${report.id}/reporter-verification`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,outcome})});
          setSelectedReport(normalizeReport(updated)); await refreshData();
          showToast(outcome === 'fixed' ? 'Thank you. Your confirmation was recorded.' : 'Your concern was recorded and the case was returned for review.');
        } catch (error) { showToast(error.message); }
      };

      const updateStatus = async (report, status) => {
        try {
          const updated = await api(`/complaints/${report.id}/status`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, note: `Status updated from command center to ${status}.` })
          });
          setSelectedReport(normalizeReport(updated));
          await refreshData();
          showToast(`${report.id} moved to ${status}.`);
        } catch (error) { showToast(error.message); }
      };

      const nextOperationalStatus = report => ({
        'Submitted': 'Assigned', 'Needs Review': 'Assigned', 'Assigned': 'Acknowledged',
        'Contractor Offer Sent': 'Acknowledged', 'Acknowledged': 'In Progress', 'Reopened - Needs Review': 'Assigned'
      })[report.status] || null;

      const inspectIncident = async report => {
        setOperationLoading(true);
        try {
          const detail = await api(`/operations/incidents/${report.id}`);
          setOperationDetail({...detail, complaint: normalizeReport(detail.complaint)});
          setOfferForm({ contractor_id: detail.contractor_matches?.[0]?.contractor_id || '', budget_cap: '', sla_hours: 24 });
          setAdminView('queue');
        } catch (error) { showToast(error.message); }
        finally { setOperationLoading(false); }
      };

      const assignContractor = async () => {
        if (!operationDetail || !offerForm.contractor_id || !offerForm.budget_cap) return showToast('Choose a contractor and enter a budget cap.');
        try {
          await api('/offers', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            complaint_id: operationDetail.complaint.id,
            contractor_id: offerForm.contractor_id,
            work_type: operationDetail.complaint.category,
            budget_cap: Number(offerForm.budget_cap),
            sla_hours: Number(offerForm.sla_hours),
            proof_required: 'Before/after photograph, GPS location and completion note'
          })});
          await refreshData(); await inspectIncident(operationDetail.complaint); showToast('Work order sent to contractor.');
        } catch (error) { showToast(error.message); }
      };

      const changeOfferStatus = async (offer, status) => {
        try {
          await api(`/offers/${offer.offer_id}/status`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status,note:`Contractor work order marked ${status}.`})});
          await refreshData(); await inspectIncident(operationDetail.complaint); showToast(`Work order ${status}.`);
        } catch (error) { showToast(error.message); }
      };

      const markAffected = async () => {
        try {
          const result = await api(`/complaints/${selectedReport.id}/affected-too`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_fingerprint: `browser-${navigator.language}`, note: 'Community confirmation from public tracking page.' })
          });
          setSelectedReport(normalizeReport(result.complaint));
          await refreshData();
          showToast(result.message);
        } catch (error) { showToast(error.message); }
      };

      const submitRepairRequest = async () => {
        if (!authUser || authUser.role !== 'youth') return showToast('Log in with a youth account first.');
        try {
          const created = await api('/repair-requests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({...repairForm, estimated_price: Number(repairForm.estimated_price), estimated_hours: Number(repairForm.estimated_hours)})
          });
          setRepairForm({ complaint_id: '', estimated_price: '', plan: '', estimated_hours: 24 });
          await refreshData();
          showToast(`Repair request ${created.request_id} sent to the authority.`);
        } catch (error) { showToast(error.message); }
      };

      const decideRepair = async (request, approved) => {
        try {
          await api(`/repair-requests/${request.request_id}/decision`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved, approved_budget: approved ? Number(fundingBudgets[request.request_id] || request.estimated_price) : null, note: approved ? 'Reviewed budget approved and reserved pending proof.' : 'Request declined by authority.' })
          });
          await refreshData(); showToast(approved ? 'Demo budget reservation recorded.' : 'Request rejected.');
        } catch (error) { showToast(error.message); }
      };

      const submitProofFile = async (request, file) => {
        if (!file) return;
        const data = new FormData();
        data.append('image', file);
        data.append('completion_note', `Completion evidence submitted for ${request.request_id}.`);
        try {
          await api(`/repair-requests/${request.request_id}/proof-with-image`, {method:'POST', body:data});
          await refreshData(); showToast('Completion photo uploaded for government verification.');
        } catch (error) { showToast(error.message); }
      };

      const releaseFunds = async (request) => {
        try {
          await api(`/repair-requests/${request.request_id}/release-funds`, { method: 'POST' });
          await refreshData(); showToast('Proof verified. Demo payment approved; reporter confirmation remains required.');
        } catch (error) { showToast(error.message); }
      };

      const reportCategories = [...new Set(reports.map(item => item.category).filter(Boolean))].sort();
      const filteredAdminReports = reports.filter(item => {
        const searchable = `${item.id} ${item.title || ''} ${item.category} ${item.location} ${item.status}`.toLowerCase();
        if (searchQuery && !searchable.includes(searchQuery.toLowerCase())) return false;
        if (queueFilters.category !== 'all' && item.category !== queueFilters.category) return false;
        if (queueFilters.severity !== 'all' && item.severity !== queueFilters.severity) return false;
        if (queueFilters.state === 'assigned' && !['Assigned','In Progress','Evidence Uploaded'].includes(item.status)) return false;
        if (queueFilters.state === 'unresolved' && item.status === 'Resolved') return false;
        if (queueFilters.state === 'resolved' && item.status !== 'Resolved') return false;
        if (queueFilters.state === 'needs_action' && !['Submitted','Needs Review'].includes(item.status)) return false;
        if (queueFilters.days !== 'all') {
          const reported = new Date(item.created_at || item.reportedAt || 0);
          if (!reported.getTime() || reported < new Date(Date.now() - Number(queueFilters.days) * 86400000)) return false;
        }
        return true;
      }).sort((a,b) => {
        if (queueFilters.sort === 'oldest') return new Date(a.created_at || a.reportedAt || 0) - new Date(b.created_at || b.reportedAt || 0);
        if (queueFilters.sort === 'newest') return new Date(b.created_at || b.reportedAt || 0) - new Date(a.created_at || a.reportedAt || 0);
        return Number(b.priority_score || 0) - Number(a.priority_score || 0);
      });

      const resetQueueFilters = () => {
        setSearchQuery('');
        setQueueFilters({days:'all',state:'unresolved',category:'all',severity:'all',sort:'priority'});
      };

      const resolvedReports = reports.filter(item => item.status === 'Resolved' || item.fully_verified).length;
      const criticalOpenReports = reports.filter(item => item.status !== 'Resolved' && ['Critical','High'].includes(item.severity)).length;
      const verifiedReports = reports.filter(item => item.fully_verified || Object.values(item.resolution_approvals || {}).filter(Boolean).length === 3).length;
      const landingStats = [
        { label: 'Reports visible', val: reports.length.toLocaleString(), trend: apiOnline && !reports.some(report=>report.data_label === 'Demo') ? 'Live public records' : 'Clearly labeled demo records', icon: 'map-pinned' },
        { label: 'Resolved', val: resolvedReports.toLocaleString(), trend: 'Evidence-backed closure', icon: 'badge-check' },
        { label: 'Priority open', val: criticalOpenReports.toLocaleString(), trend: 'High and critical', icon: 'siren' },
        { label: 'Fully verified', val: verifiedReports.toLocaleString(), trend: 'Three-party approval', icon: 'shield-check' }
      ];

      return (
        <div className="min-h-screen flex flex-col bg-[#0B0F17] transition-colors duration-200">
          {/* HEADER / NAVIGATION */}
          <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0B0F17]/80 border-b border-slate-800/80">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
              <button aria-label="CivicPulse home" className="flex items-center space-x-3 text-left rounded-lg" onClick={() => setActiveTab('landing')}>
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                  <Icon name="activity" className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="font-bold text-lg tracking-tight text-white flex items-center gap-1.5">
                    CIVIC<span className="text-sky-400">Pulse</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">PILOT</span>
                  </span>
                </div>
              </button>

              <nav className="hidden md:flex items-center space-x-1">
                {[
                  { id: 'landing', label: 'Platform' },
                  { id: 'report', label: 'Report Issue' },
                  { id: 'track', label: 'Track Report' },
                  { id: 'map', label: 'Civic Map' },
                  { id: 'community', label: 'Community Work' },
                  { id: 'admin', label: 'Command Center' },
                  { id: 'whatsapp', label: 'WhatsApp Intake' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                      activeTab === tab.id 
                        ? 'bg-slate-800 text-white border border-slate-700/60 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="flex items-center space-x-3">
                <span className={`hidden sm:inline-flex text-[10px] font-mono items-center gap-1.5 ${apiOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {apiOnline ? (reports.some(report=>report.data_label === 'Demo') ? 'DEMO API' : 'LIVE API') : 'OFFLINE PREVIEW'}
                </span>
                <button onClick={() => setDarkMode(value => !value)} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} className="w-9 h-9 shrink-0 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-sky-400 flex items-center justify-center transition-colors">
                  <Icon name={darkMode ? 'sun' : 'moon'} className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('admin')}
                  className="hidden sm:flex px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 hover:bg-sky-500/20 transition-all items-center gap-1.5"
                >
                  <Icon name="lock" className="w-3.5 h-3.5" />
                  Authority Portal
                </button>
              </div>
            </div>
          </header>

          <nav aria-label="Mobile navigation" className="mobile-nav md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 px-1 pt-2 grid grid-cols-6 shadow-[0_-12px_30px_rgba(2,8,23,.35)]">
            {[
              ['landing','home','Home'], ['report','camera','Report'], ['track','search','Track'],
              ['map','map','Map'], ['community','hand-coins','Community'], ['admin','layout-dashboard','Admin']
            ].map(([id, icon, label]) => <button key={id} aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)} className={`min-w-0 min-h-12 rounded-lg flex flex-col items-center justify-center gap-1 py-1 text-[9px] font-semibold transition-colors ${activeTab === id ? 'text-sky-400 bg-sky-500/10' : 'text-slate-500'}`}><Icon name={icon} className="w-4 h-4"/><span className="truncate w-full text-center">{label}</span></button>)}
          </nav>

          {/* TOAST NOTIFICATION */}
          {toast && (
            <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 reveal-up">
              <div className="bg-slate-900 border border-sky-500/40 text-slate-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
                <Icon name="check-circle-2" className="w-5 h-5 text-sky-400" />
                <span className="text-sm font-medium">{toast}</span>
              </div>
            </div>
          )}

          {/* MAIN BODY ROUTING */}
          <main id="main-content" className="flex-1" tabIndex="-1">
            {/* 1. LANDING PAGE */}
            {activeTab === 'landing' && (
              <div className="relative overflow-hidden">
                <div aria-hidden="true" className="surface-grid absolute inset-0 pointer-events-none" />
                <div aria-hidden="true" className="absolute top-12 left-1/2 -translate-x-1/2 w-[760px] h-[360px] bg-sky-500/10 blur-[130px] pointer-events-none rounded-full" />

                <section aria-labelledby="hero-title" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20 pb-14 sm:pb-20">
                  <div className="grid lg:grid-cols-[1.08fr_.92fr] items-center gap-12 lg:gap-16">
                    <div className="reveal-up max-w-3xl">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] sm:text-xs text-sky-400 font-mono shadow-sm">
                        <span className="relative flex w-2 h-2"><span className="soft-pulse absolute inset-0 rounded-full bg-sky-400"/><span className="relative w-2 h-2 rounded-full bg-sky-400"/></span>
                        Evidence-led civic action
                      </div>
                      <h1 id="hero-title" className="mt-6 text-[2.65rem] sm:text-6xl lg:text-7xl font-bold tracking-[-0.045em] text-white leading-[1.02]">
                        Report what is broken.<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-sky-400 to-blue-500">See who fixes it.</span>
                      </h1>
                      <p className="mt-6 text-base sm:text-lg leading-7 sm:leading-8 text-slate-400 max-w-2xl">
                        CivicPulse turns citizen evidence and location into a trackable public case—AI assessment, accountable assignment, repair evidence and citizen verification in one transparent workflow.
                      </p>
                      <div className="mt-8 flex flex-col sm:flex-row gap-3">
                        <button onClick={() => { setReportStep(1); setActiveTab('report'); }} className="group w-full sm:w-auto min-h-12 px-7 rounded-xl font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition-all shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2">
                          <Icon name="camera" className="w-5 h-5" /> Report a problem <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                        </button>
                        <button onClick={() => setActiveTab('track')} className="w-full sm:w-auto min-h-12 px-7 rounded-xl font-semibold bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-all flex items-center justify-center gap-2">
                          <Icon name="search" className="w-4 h-4 text-sky-400" /> Track a report
                        </button>
                      </div>
                      <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                        {['No account needed to report','Public tracking ID','Evidence required to close'].map(item => <span key={item} className="flex items-center gap-1.5"><Icon name="check" className="w-3.5 h-3.5 text-emerald-400" />{item}</span>)}
                      </div>
                    </div>

                    <div className="reveal-up-delay relative max-w-xl lg:ml-auto w-full">
                      <div className="absolute -inset-5 bg-sky-500/10 blur-3xl rounded-full" />
                      <div className="relative rounded-3xl border border-slate-700/80 bg-slate-900/85 backdrop-blur-xl p-4 sm:p-6 shadow-2xl shadow-black/30">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                          <div><div className="text-[10px] font-mono tracking-[.18em] text-sky-400">PUBLIC CASE FLOW</div><div className="mt-1 text-sm font-semibold text-white">From report to verified repair</div></div>
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono ${apiOnline ? 'text-emerald-400' : 'text-amber-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-400' : 'bg-amber-400'}`}/>{apiOnline ? 'LIVE' : 'PREVIEW'}</span>
                        </div>
                        <div className="py-5 space-y-4">
                          {[
                            ['camera','Citizen evidence received','Photo, description and location','complete'],
                            ['scan-search','AI triage and duplicate check','Severity and department suggested','complete'],
                            ['building-2','Authority assignment','Responsible team and SLA recorded','active'],
                            ['badge-check','Public verification','After-photo and three approvals','pending']
                          ].map(([icon,title,detail,state], index) => <div key={title} className="grid grid-cols-[2.5rem_1fr_auto] gap-3 items-center">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${state==='active'?'bg-sky-500/15 border-sky-500/40 text-sky-400':'bg-slate-950/70 border-slate-800 text-slate-500'}`}><Icon name={icon} className="w-4 h-4" /></div>
                            <div><div className="text-sm font-medium text-slate-200">{title}</div><div className="text-[11px] leading-5 text-slate-500">{detail}</div></div>
                            <div className={`text-[10px] font-mono ${state==='complete'?'text-emerald-400':state==='active'?'text-sky-400':'text-slate-600'}`}>{state==='complete'?'DONE':state==='active'?'ACTIVE':'NEXT'}</div>
                          </div>)}
                        </div>
                        <button onClick={() => setActiveTab('map')} className="w-full min-h-11 rounded-xl border border-slate-700 bg-slate-950/60 hover:border-sky-500/40 text-sm font-medium text-slate-300 transition-colors flex items-center justify-center gap-2"><Icon name="map" className="w-4 h-4 text-sky-400"/>Explore the public civic map</button>
                      </div>
                    </div>
                  </div>

                  <div aria-label="Platform activity" className="mt-16 sm:mt-20 grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-slate-800 bg-slate-800">
                    {landingStats.map((stat) => <div key={stat.label} className="bg-slate-950/95 p-4 sm:p-5">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><Icon name={stat.icon} className="w-3.5 h-3.5 text-sky-400"/>{stat.label}</div>
                      <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white font-mono">{stat.val}</div>
                      <div className="mt-1 text-[10px] sm:text-[11px] text-slate-500">{stat.trend}</div>
                    </div>)}
                  </div>
                </section>

                <section aria-labelledby="workflow-title" className="relative border-y border-slate-800/80 bg-slate-950/35">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
                    <div className="max-w-2xl mb-10 sm:mb-12">
                      <div className="text-[11px] font-mono tracking-[.18em] text-sky-400">ONE ACCOUNTABLE PIPELINE</div>
                      <h2 id="workflow-title" className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-white">Simple for citizens. Structured for authorities.</h2>
                      <p className="mt-3 text-sm sm:text-base leading-7 text-slate-400">Every action creates a visible record, so urgent work is easier to prioritize and resolved work is harder to fake.</p>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        { step:'01', icon:'camera', title:'Capture evidence', desc:'Upload a clear photo and confirm the location. AI fills the first assessment.' },
                        { step:'02', icon:'brain-circuit', title:'Triage responsibly', desc:'Severity, duplicates and department routing are suggested with confidence.' },
                        { step:'03', icon:'clipboard-check', title:'Act with ownership', desc:'Authorities assign work, budgets and SLAs to qualified teams or supervised low-risk community tasks.' },
                        { step:'04', icon:'shield-check', title:'Verify in public', desc:'After-evidence and three-party approval turn the map marker green.' }
                      ].map((item) => <article key={item.step} className="interactive-card bg-slate-900/55 border border-slate-800 p-5 sm:p-6 rounded-2xl">
                        <div className="flex items-center justify-between"><div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400"><Icon name={item.icon} className="w-4 h-4"/></div><span className="text-[11px] font-mono text-slate-600">{item.step}</span></div>
                        <h3 className="mt-5 text-base font-semibold text-white">{item.title}</h3>
                        <p className="mt-2 text-xs sm:text-sm text-slate-400 leading-6">{item.desc}</p>
                      </article>)}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* 2. CITIZEN REPORT FLOW */}
            {activeTab === 'report' && (
              <div className="max-w-3xl mx-auto px-4 py-12">
                <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <h1 className="text-2xl font-bold text-white">File a Civic Incident</h1>
                    <p className="text-xs text-slate-400 mt-1">Share a location and description; a photo is recommended but never required.</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-mono overflow-x-auto pb-1">
                    <span className={`px-2 py-1 rounded ${reportStep >= 1 ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'text-slate-600'}`}>1. Photo</span>
                    <span className="text-slate-700">→</span>
                    <span className={`px-2 py-1 rounded ${reportStep >= 2 ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'text-slate-600'}`}>2. AI Assessment</span>
                    <span className="text-slate-700">→</span>
                    <span className={`px-2 py-1 rounded ${reportStep >= 3 ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'text-slate-600'}`}>3. Submit</span>
                  </div>
                </div>

                {reportStep === 1 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6">
                    <div className="border-2 border-dashed border-slate-700 rounded-xl p-12 hover:border-sky-500/50 transition-colors bg-slate-950/50 flex flex-col items-center justify-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-400 border border-sky-500/20">
                        <Icon name="camera" className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">Take or Upload Photo</h3>
                        <p className="text-xs text-slate-400 mt-1">Visual evidence accelerates priority assignment.</p>
                      </div>
                      <label className="cursor-pointer px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-all shadow-md">
                        Select Photo
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhotoUpload} className="hidden" />
                      </label>
                      <button type="button" onClick={()=>{setUploadedFile(null);setUploadedImage(null);setAiAnalysis(null);setPhotoLocation(null);setAnalysisComplete(true);setReportStep(2)}} className="text-xs text-slate-400 underline underline-offset-4">Continue without a photo</button>
                    </div>

                    <div className="text-left bg-slate-950 border border-slate-800 p-4 rounded-xl flex items-start gap-3">
                      <Icon name="shield-check" className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-400 leading-relaxed">
                        <strong className="text-slate-200">Evidence Privacy:</strong> If the photo contains GPS, CivicPulse offers it for your confirmation after civic screening. Only approved coordinates are retained; the published image is safely re-encoded with all metadata removed.
                      </p>
                    </div>
                  </div>
                )}

                {reportStep === 2 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <div className="text-xs font-mono text-slate-400 mb-2">Uploaded Evidence Payload</div>
                        {uploadedImage ? <img src={uploadedImage} alt="Report preview" className="w-full h-56 object-cover rounded-xl border border-slate-800" /> : <div className="w-full h-56 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-sm text-slate-500">No photo supplied · human review required</div>}
                      </div>

                      <div className="flex flex-col justify-between">
                        {isAnalyzing ? (
                          <div className="h-full flex flex-col items-center justify-center space-y-4 py-8">
                            <Icon name="refresh-cw" className="w-8 h-8 text-sky-400 animate-spin" />
                            <div className="text-center">
                              <div className="text-sm font-medium text-white">Analyzing Image Features...</div>
                              <div className="text-xs font-mono text-slate-500 mt-1">Evaluating surface severity & duplicate matches</div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="bg-sky-500/10 border border-sky-500/30 p-3.5 rounded-xl">
                              <div className="text-xs text-sky-400 font-mono font-semibold">AI Assistant Assessment</div>
                              <p className="text-sm font-medium text-slate-100 mt-1">
                                “{aiAnalysis?.summary || 'Evidence preview ready. The final AI assessment will be confirmed on submission.'}”
                              </p>
                            </div>

                            <div className="space-y-2 text-xs font-mono">
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Category:</span>
                                <span className="text-white font-semibold">{aiAnalysis?.category || reportForm.category}</span>
                              </div>
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Analysis engine:</span>
                                <span className={aiAnalysis?.analysis_source === 'gemini-vision' ? 'text-emerald-400' : 'text-amber-400'}>{!aiAnalysis ? 'Pending final analysis' : aiAnalysis.analysis_source === 'gemini-vision' ? 'Gemini Vision' : 'Fallback rules'}</span>
                              </div>
                              {aiAnalysis?.is_civic_issue === false && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300">This image does not appear to contain a reportable civic issue.</div>}
                              {aiAnalysis?.analysis_warning && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">AI service fallback active. Your report can still be submitted and will enter human review.</div>}
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Severity:</span>
                                <span className="text-amber-400 font-semibold">{aiAnalysis?.severity || reportForm.severity}</span>
                              </div>
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Duplicates:</span>
                                <span className="text-slate-300">Checked automatically on submission</span>
                              </div>
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Routing to:</span>
                                <span className="text-sky-400">{aiAnalysis?.department || 'Pending final AI routing'}</span>
                              </div>
                              <div className="flex justify-between py-1.5 border-b border-slate-800">
                                <span className="text-slate-400">Confidence:</span>
                                <span className={aiAnalysis?.confidence < .7 ? 'text-amber-400' : 'text-emerald-400'}>
                                  {aiAnalysis ? `${Math.round(aiAnalysis.confidence * 100)}%${aiAnalysis.confidence < .7 ? ' · Human review' : ''}` : 'Pending'}
                                </span>
                              </div>
                              {aiAnalysis?.detected_language && <div className="flex justify-between py-1.5 border-b border-slate-800"><span className="text-slate-400">Citizen language:</span><span className="text-slate-300">{aiAnalysis.detected_language}</span></div>}
                            </div>
                            {aiAnalysis?.citizen_response && <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300"><span className="block text-[10px] font-mono text-slate-500 mb-1">RESPONSE TO CITIZEN</span>{aiAnalysis.citizen_response}</div>}
                          </div>
                        )}
                      </div>
                    </div>

                    {analysisComplete && (
                      <div className="border-t border-slate-800 pt-6 space-y-4">
                        {photoLocation && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < .75) && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-emerald-300">Photo location detected</div>
                              <div className="text-[11px] text-slate-400 mt-1 font-mono">{photoLocation.latitude.toFixed(5)}, {photoLocation.longitude.toFixed(5)}{photoLocation.captured_at ? ` · captured ${new Date(photoLocation.captured_at).toLocaleString()}` : ''}</div>
                              <div className="text-[10px] text-slate-500 mt-1">Use only if this is where the civic issue actually exists.</div>
                            </div>
                            <button type="button" onClick={usePhotoLocation} className="shrink-0 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold">Use photo location</button>
                          </div>
                        )}
                        {!photoLocation && uploadedFile && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < .75) && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">This photo has no usable GPS metadata. Use live GPS, enter an address, or choose the exact point on the map.</div>
                        )}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1">Location Coordinates / Address</label>
                          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                            <Icon name="map-pin" className="w-4 h-4 text-sky-400 shrink-0" />
                            <input 
                              type="text" 
                              value={reportForm.location}
                              placeholder="Enter an area or address"
                              onChange={(e) => setReportForm({...reportForm, location: e.target.value, locationSource: reportForm.latitude == null ? 'manual' : reportForm.locationSource, locationConfirmed: true})}
                              className="bg-transparent text-white focus:outline-none w-full"
                            />
                            <button type="button" onClick={captureLocation} className={`shrink-0 px-2 py-1 rounded text-[10px] font-mono ${reportForm.locationSource === 'device_gps' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400'}`}>{reportForm.locationSource === 'device_gps' ? 'GPS ADDED' : 'USE GPS'}</button>
                          </div>
                          {reportForm.locationSource && <div className="mt-2 text-[10px] font-mono text-emerald-400">Confirmed source: {reportForm.locationSource.replace('_', ' ')}{reportForm.locationAccuracy ? ` · ±${Math.round(reportForm.locationAccuracy)}m` : ''}</div>}
                          <button type="button" onClick={()=>setShowLocationMap(value=>!value)} className="mt-3 text-xs text-sky-400 underline underline-offset-4">{showLocationMap ? 'Hide map' : 'Choose exact point on map'}</button>
                          {showLocationMap && <div className="mt-3"><LocationPicker latitude={reportForm.latitude} longitude={reportForm.longitude} onPick={selectMapLocation}/><p className="text-[10px] text-slate-500 mt-2">Click the map or drag the marker, then confirm the readable address above.</p></div>}
                        </div>

                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1">Contact for private resolution verification (Optional)</label>
                          <input type="text" value={reportForm.reporterContact} onChange={e=>setReportForm({...reportForm,reporterContact:e.target.value})} placeholder="Email or phone — never shown publicly" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-sky-500/50" />
                        </div>

                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1">Additional Observations (Optional)</label>
                          <textarea 
                            rows={3}
                            value={reportForm.description}
                            onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-sky-500/50"
                          />
                        </div>

                        <div className="flex justify-end space-x-3 pt-2">
                          <button 
                            onClick={() => setReportStep(1)} 
                            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                          >
                            Re-take Photo
                          </button>
                          <button 
                            onClick={handleFinalSubmit}
                            disabled={isSubmitting || (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= .75)}
                            className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 flex items-center gap-2 shadow-lg shadow-sky-500/20"
                          >
                            {isSubmitting ? 'Submitting…' : 'Submit Report'} <Icon name="arrow-right" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. TRACK REPORT & BEFORE/AFTER INTERACTIVE SLIDER */}
            {activeTab === 'track' && !selectedReport && <div className="max-w-xl mx-auto px-4 py-16"><div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center"><h1 className="text-xl font-semibold text-white">Track a civic report</h1><p className="text-sm text-slate-400 mt-2">Enter the public tracking ID you received after submission.</p><div className="flex gap-2 mt-5"><input value={trackingQuery} onChange={e=>setTrackingQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&trackById()} placeholder="CP-XXXXXX" className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono"/><button onClick={trackById} className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Track</button></div></div></div>}
            {activeTab === 'track' && selectedReport && (
              <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-3">
                      <span className="text-xl font-bold font-mono text-sky-400">{selectedReport.id}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono border ${
                        selectedReport.status === 'Resolved' 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {selectedReport.status}
                      </span>
                    </div>
                    {selectedReport.incident_id && <div className="text-[10px] font-mono text-slate-500 mt-1">Incident cluster {selectedReport.incident_id}</div>}
                    <h1 className="text-lg font-semibold text-white mt-1">{selectedReport.title}</h1>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                      <Icon name="map-pin" className="w-3.5 h-3.5 text-slate-500" /> {selectedReport.location}
                    </p>
                  </div>

                  <div>
                    <div className="flex gap-2 mb-3">
                      <input value={trackingQuery} onChange={e => setTrackingQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && trackById()} placeholder="Enter tracking ID" className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500/50" />
                      <button onClick={trackById} className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-xs font-semibold">Track</button>
                    </div>
                    <select 
                      value={selectedReport.id}
                      onChange={(e) => setSelectedReport(reports.find(r => r.id === e.target.value))}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none"
                    >
                      {reports.map(r => (
                        <option key={r.id} value={r.id}>{r.id} - {r.category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                    <h2 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Progress Timeline</h2>
                    
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                      {selectedReport.timeline.map((item, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 ${
                            item.done ? 'bg-sky-500 border-slate-900' : 'bg-slate-900 border-slate-700'
                          }`} />
                          <div className="text-xs font-semibold text-white">{item.step}</div>
                          <div className="text-[11px] font-mono text-slate-400">{item.time}</div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-800 pt-4 space-y-2 text-xs">
                      <div className="text-slate-400">Assigned Authority</div>
                      <div className="text-slate-200 font-medium">{selectedReport.department}</div>
                    </div>
                  </div>

                  <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Resolution Verification</h2>
                      {selectedReport.afterImage && (
                        <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                          Before / After Match
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[['contractor','Contractor'],['reporter','Reporter'],['government','Government']].map(([key,label]) => {
                        const approved = selectedReport.resolution_approvals?.[key];
                        const canApprove = authUser?.role === 'admin' && key !== 'reporter';
                        return <button key={key} disabled={!canApprove || approved} onClick={() => canApprove && !approved && approveResolution(selectedReport,key)} title={key === 'reporter' ? 'Only the original reporter can confirm through their private link' : canApprove ? 'Record verified approval' : 'Authority approval required'} className={`rounded-lg border px-2 py-2 text-[10px] sm:text-xs font-mono disabled:cursor-default ${approved ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>{approved ? '✓ ' : '○ '}{label}</button>;
                      })}
                    </div>

                    {selectedReport.afterImage && sessionStorage.getItem(`civicpulse-reporter-${selectedReport.id}`) && <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3"><div className="text-xs font-semibold text-white">Reporter verification</div><p className="text-[11px] text-slate-400 mt-1">Only your private browser token can record this decision.</p><div className="grid grid-cols-3 gap-2 mt-3"><button onClick={()=>verifyAsReporter(selectedReport,'not_fixed')} className="rounded-lg border border-red-500/30 px-2 py-2 text-xs text-red-300">Not fixed</button><button onClick={()=>verifyAsReporter(selectedReport,'partially_fixed')} className="rounded-lg border border-amber-500/30 px-2 py-2 text-xs text-amber-300">Partial</button><button onClick={()=>verifyAsReporter(selectedReport,'fixed')} className="rounded-lg bg-emerald-500 px-2 py-2 text-xs font-semibold text-slate-950">Fixed</button></div></div>}

                    {selectedReport.afterImage ? (
                      <div className="relative h-72 w-full rounded-xl overflow-hidden select-none border border-slate-800">
                        <img src={selectedReport.afterImage} alt="After resolution" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute top-3 right-3 bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur-md">
                          AFTER RESOLUTION
                        </div>

                        <div 
                          className="absolute inset-0 overflow-hidden border-r-2 border-sky-400"
                          style={{ width: `${sliderPos}%` }}
                        >
                          <img src={selectedReport.beforeImage} alt="Before report" className="absolute inset-0 w-full h-full object-cover max-w-none" style={{ width: '100%', height: '100%' }} />
                          <div className="absolute top-3 left-3 bg-slate-950/80 text-slate-300 border border-slate-700/60 text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur-md">
                            BEFORE REPORTED
                          </div>
                        </div>

                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={sliderPos}
                          onChange={(e) => setSliderPos(Number(e.target.value))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                        />
                      </div>
                    ) : (
                      <div className="h-72 w-full rounded-xl overflow-hidden relative border border-slate-800">
                        <img src={selectedReport.beforeImage} alt="Reported problem" className="w-full h-full object-cover" />
                        <div className="absolute bottom-3 left-3 bg-slate-950/80 text-slate-300 border border-slate-800 text-xs px-3 py-1.5 rounded-lg backdrop-blur-md">
                          Resolution in progress. Final inspection photo pending.
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-slate-400 leading-relaxed">
                      {selectedReport.description}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                      <div className="text-xs text-slate-400"><span className="text-white font-semibold">{selectedReport.affected_count || 1}</span> citizens affected · <span className="text-white font-semibold">{selectedReport.duplicates || 1}</span> linked incident reports</div>
                      <button onClick={markAffected} className="px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-semibold">I’m affected too</button>
                    </div>
                    <button onClick={()=>loadAccountabilityReceipt(selectedReport)} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs text-sky-400">Generate Public Accountability Receipt</button>
                  </div>
                </div>
                {accountabilityReceipt && accountabilityReceipt.complaint_id === selectedReport.id && <section aria-label="Public accountability receipt" className="rounded-2xl border border-sky-500/30 bg-slate-900 p-5 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="text-[10px] font-mono text-sky-400">PUBLIC ACCOUNTABILITY RECEIPT</div><h2 className="text-lg font-semibold text-white">{accountabilityReceipt.incident_id || accountabilityReceipt.complaint_id}</h2></div><span className="text-[10px] font-mono text-slate-500 break-all">{accountabilityReceipt.receipt_hash}</span></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"><div className="rounded-lg bg-slate-950 p-3"><div className="text-slate-500">AI assessment</div><div className="text-white mt-1">{accountabilityReceipt.ai_assessment.category} · {Math.round((accountabilityReceipt.ai_assessment.confidence || 0)*100)}%</div></div><div className="rounded-lg bg-slate-950 p-3"><div className="text-slate-500">Priority</div><div className="text-white mt-1">{accountabilityReceipt.priority.score}/100</div></div><div className="rounded-lg bg-slate-950 p-3"><div className="text-slate-500">Incident reports</div><div className="text-white mt-1">{accountabilityReceipt.incident_report_count}</div></div><div className="rounded-lg bg-slate-950 p-3"><div className="text-slate-500">Verification</div><div className={accountabilityReceipt.resolution.fully_verified?'text-emerald-400 mt-1':'text-amber-400 mt-1'}>{accountabilityReceipt.resolution.fully_verified?'Fully verified':'Awaiting approvals'}</div></div></div><p className="text-xs text-slate-400">{accountabilityReceipt.priority.methodology}</p></section>}
              </div>
            )}

            {/* 4. PUBLIC CIVIC MAP */}
            {activeTab === 'map' && (
              <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <div>
                    <h1 className="text-lg font-bold text-white">Public Civic Intelligence Map</h1>
                    <p className="text-xs text-slate-400">Geographical density of incident reports across city sectors.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {['All', 'Roads', 'Sanitation', 'Water'].map((f) => (
                      <button onClick={() => setMapFilter(f)} key={f} className={`px-3 py-1.5 rounded-lg text-xs font-mono ${mapFilter === f ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4">
                  <AuthorityMap
                    reports={reports.filter(rep => mapFilter === 'All' || (mapFilter === 'Roads' && /road/i.test(rep.category)) || (mapFilter === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (mapFilter === 'Water' && /water|drain|sewer/i.test(rep.category)))}
                    onSelect={report => { setSelectedReport(report); setActiveTab('track'); }}
                  />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-[10px] sm:text-xs font-mono">
                    <div className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> All 3 approved</div>
                    <div className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> Partly approved</div>
                    <div className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> Moderate unresolved</div>
                    <div className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> High/critical unresolved</div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. AUTHORITY COMMAND CENTER */}
            {activeTab === 'community' && (
              <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
                <div><div className="text-xs font-mono text-sky-400">SUPERVISED COMMUNITY ACTION</div><h1 className="text-2xl font-bold text-white mt-1">Propose Low-Risk Micro-Maintenance</h1><p className="text-sm text-slate-400 mt-2">Only explicitly eligible cleanup and beautification tasks appear here. Infrastructure, utilities, traffic, drainage, and safety hazards require trained responders.</p></div>
                {!authUser ? <AuthCard title="Youth repair account" subtitle="Register or log in to submit proposals and recover your jobs on any device after logging out." mode={authMode} setMode={mode=>{setAuthMode(mode);setAuthError('')}} form={authForm} setForm={setAuthForm} submit={authenticate} busy={authBusy} error={authError} /> : authUser.role !== 'youth' ? <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center"><p className="text-sm text-slate-300">The administrator account cannot submit youth repair proposals.</p><button onClick={logout} className="mt-4 px-4 py-2 rounded-lg border border-slate-700 text-xs text-slate-300">Log out</button></div> : <>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-sky-500/10 border border-sky-500/20 rounded-xl p-4"><div><div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">{authUser.name}</span><span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-400">SESSION ACTIVE</span></div><div className="text-xs text-slate-400 mt-1">{authUser.email} · Your proposals and proof are linked to this account.</div></div><button onClick={logout} className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300">Log out</button></div>
                <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono"><div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400"><span className="text-sky-400">1.</span> Send plan</div><div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400"><span className="text-amber-400">2.</span> Await approval</div><div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400"><span className="text-emerald-400">3.</span> Upload after photo</div></div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <select value={repairForm.complaint_id} onChange={e => setRepairForm({...repairForm, complaint_id:e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"><option value="">Select an eligible low-risk task</option>{reports.filter(r => r.status !== 'Resolved' && r.volunteer_eligible === true).map(r => <option key={r.id} value={r.id}>{r.id} · {r.category} · {r.location}</option>)}</select>
                    <div className="grid sm:grid-cols-2 gap-3"><input type="number" min="1" value={repairForm.estimated_price} onChange={e=>setRepairForm({...repairForm,estimated_price:e.target.value})} placeholder="Estimate (PKR)" className="min-w-0 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"/><input type="number" min="1" value={repairForm.estimated_hours} onChange={e=>setRepairForm({...repairForm,estimated_hours:e.target.value})} placeholder="Hours" className="min-w-0 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white"/></div>
                    <textarea rows="4" value={repairForm.plan} onChange={e=>setRepairForm({...repairForm,plan:e.target.value})} placeholder="Explain materials, method, safety steps, and expected result" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white" />
                    <button onClick={submitRepairRequest} disabled={!repairForm.complaint_id || repairForm.plan.length < 10 || !repairForm.estimated_price} className="w-full py-3 rounded-xl bg-sky-500 disabled:opacity-40 text-slate-950 font-semibold">Send estimate to authority</button>
                  </div>
                  <div className="space-y-3">{repairRequests.length ? repairRequests.slice().reverse().map(req => <div key={req.request_id} className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="flex justify-between gap-3"><div><div className="font-mono text-sky-400 text-xs">{req.request_id} · {req.complaint_id}</div><div className="text-sm font-semibold text-white mt-1">{req.issue_title || req.applicant_name}</div></div><span className="text-[10px] text-amber-400 font-mono text-right">{req.status}</span></div><div className="text-xs text-slate-400 mt-2">Estimate: PKR {Number(req.estimated_price).toLocaleString()} · {req.estimated_hours}h</div><div className="text-[10px] text-slate-500 mt-1">Submitted {req.created_at ? new Date(req.created_at).toLocaleString() : 'recently'}</div>{req.admin_note && <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300"><span className="text-slate-500">Authority note:</span> {req.admin_note}</div>}{req.status === 'Approved - Awaiting Work' && <label className="block mt-3 cursor-pointer text-center text-xs px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Upload required after-repair photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e=>submitProofFile(req,e.target.files?.[0])}/></label>}{req.proof && <div className="mt-3 flex gap-3 items-center"><img src={absoluteMediaUrl(req.proof.after_image_url)} alt="Your after-repair proof" className="w-20 h-16 object-cover rounded-lg border border-slate-700"/><span className="text-xs text-emerald-400">After photo submitted for authority verification.</span></div>}</div>) : <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-sm text-slate-400">You have no repair proposals yet. Choose an open map problem and send a realistic plan and estimate.</div>}</div>
                </div>
                </>}
              </div>
            )}

            {activeTab === 'admin' && (
              authUser?.role !== 'admin' ? <div className="max-w-4xl mx-auto px-4 py-10 space-y-5"><AuthCard title="Administrator access" subtitle="This private command center contains funding decisions and operational controls." mode="login" setMode={()=>{}} form={authForm} setForm={setAuthForm} submit={()=>authenticate('login')} busy={authBusy} error={authError} allowRegister={false} />{authUser && <button onClick={logout} className="block mx-auto text-xs text-slate-400 underline">Log out of {authUser.email} first</button>}</div> :
              <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
                  <div>
                    <div className="text-xs font-mono text-sky-400 font-semibold uppercase tracking-wider">City Operations Command</div>
                    <h1 className="text-2xl font-bold text-white mt-1">What needs attention?</h1>
                    <p className="text-xs text-slate-400 mt-1">Start with unresolved work, narrow the list, then open one incident to act.</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 overflow-x-auto">{[['queue','list-filter','Work queue'],['map','map','Map'],['funding','hand-coins','Youth funding']].map(([id,icon,label])=><button key={id} onClick={()=>setAdminView(id)} className={`whitespace-nowrap px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 ${adminView===id?'bg-sky-500 text-slate-950':'text-slate-400'}`}><Icon name={icon} className="w-3.5 h-3.5"/>{label}</button>)}</div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs"><div className="flex gap-2"><span className="w-6 h-6 rounded-full bg-sky-500 text-slate-950 flex items-center justify-center font-bold shrink-0">1</span><div><div className="text-white font-semibold">Filter the queue</div><div className="text-slate-500 mt-0.5">Find urgent or older work.</div></div></div><div className="flex gap-2"><span className="w-6 h-6 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold shrink-0">2</span><div><div className="text-white font-semibold">Open one workspace</div><div className="text-slate-500 mt-0.5">Review evidence and AI signals.</div></div></div><div className="flex gap-2"><span className="w-6 h-6 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold shrink-0">3</span><div><div className="text-white font-semibold">Assign or advance</div><div className="text-slate-500 mt-0.5">Record the next accountable action.</div></div></div></div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Critical Unresolved', val: dashboard?.stats?.critical_count ?? reports.filter(r => r.severity === 'Critical' && r.status !== 'Resolved').length, alert: true },
                    { label: 'SLA Violations', val: dashboard?.stats?.overdue_cases ?? reports.filter(r => (r.sla_status || '').startsWith('Overdue')).length, alert: true },
                    { label: 'Active Issues', val: dashboard?.stats?.active_issues ?? reports.filter(r => r.status !== 'Resolved').length, alert: false },
                    { label: 'Clearance Rate', val: `${dashboard?.stats?.resolution_rate ?? Math.round(100 * reports.filter(r => r.status === 'Resolved').length / Math.max(reports.length, 1))}%`, alert: false }
                  ].map((kpi, idx) => (
                    <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs text-slate-400 font-mono">{kpi.label}</div>
                      <div className={`text-2xl font-bold font-mono mt-1 ${kpi.alert ? 'text-red-400' : 'text-white'}`}>
                        {kpi.val}
                      </div>
                    </div>
                  ))}
                </div>

                {dashboard?.stats?.accountability && <details className="bg-slate-900 border border-slate-800 rounded-xl group"><summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-white">Accountability measures</div><div className="text-xs text-slate-500 mt-0.5">Evidence-based outcomes, normalized beyond raw complaint counts.</div></div><span className="text-xs text-sky-400 group-open:hidden">View methodology</span><span className="text-xs text-sky-400 hidden group-open:inline">Hide</span></summary><div className="border-t border-slate-800 p-4"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Median response',dashboard.stats.accountability.median_response_hours,'hours'],['SLA compliance',dashboard.stats.accountability.sla_compliance_percent,'%'],['Verified resolutions',dashboard.stats.accountability.verified_resolution_rate_percent,'%'],['Median backlog age',dashboard.stats.accountability.median_backlog_age_hours,'hours']].map(([label,value,suffix])=><div key={label} className="rounded-lg bg-slate-950 border border-slate-800 p-3"><div className="text-[10px] text-slate-500 font-mono">{label}</div><div className="text-lg text-white font-semibold mt-1">{value == null ? 'Not enough data' : `${value} ${suffix}`}</div></div>)}</div><p className="text-[11px] text-slate-400 leading-relaxed mt-3">{dashboard.stats.methodology || 'Medians reduce outlier distortion. SLA and verified-resolution rates use only eligible records; severity-adjusted results account for case complexity.'}</p></div></details>}

                {dashboard?.insight && <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 flex gap-3"><Icon name="sparkles" className="w-5 h-5 text-sky-400 shrink-0" /><div><div className="text-xs font-mono text-sky-400">AI GOVERNANCE INSIGHT</div><p className="text-sm text-slate-200 mt-1">{dashboard.insight}</p></div></div>}

                {['queue','map'].includes(adminView) && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-white">Narrow the work</h2><p className="text-[11px] text-slate-500">Filters combine together. Showing {filteredAdminReports.length} of {reports.length} incidents.</p></div><button onClick={resetQueueFilters} className="text-xs text-sky-400 hover:text-sky-300">Reset filters</button></div><div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2"><input type="search" aria-label="Search incidents" placeholder="ID, area, category…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"/><select aria-label="Reported within" value={queueFilters.days} onChange={e=>setQueueFilters({...queueFilters,days:e.target.value})} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white"><option value="all">Any age</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="15">Last 15 days</option><option value="30">Last 30 days</option></select><select aria-label="Work state" value={queueFilters.state} onChange={e=>setQueueFilters({...queueFilters,state:e.target.value})} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white"><option value="all">Every status</option><option value="needs_action">Needs action</option><option value="assigned">Assigned work</option><option value="unresolved">All unresolved</option><option value="resolved">Resolved</option></select><select aria-label="Category" value={queueFilters.category} onChange={e=>setQueueFilters({...queueFilters,category:e.target.value})} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white"><option value="all">Every category</option>{reportCategories.map(category=><option key={category} value={category}>{category}</option>)}</select><select aria-label="Severity" value={queueFilters.severity} onChange={e=>setQueueFilters({...queueFilters,severity:e.target.value})} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white"><option value="all">Every severity</option>{['Critical','High','Medium','Low'].map(level=><option key={level}>{level}</option>)}</select></div><div className="flex flex-wrap gap-2"><span className="text-[10px] text-slate-500 py-1">Sort:</span>{[['priority','Highest priority'],['oldest','Oldest first'],['newest','Newest first']].map(([value,label])=><button key={value} onClick={()=>setQueueFilters({...queueFilters,sort:value})} className={`px-2.5 py-1 rounded-full border text-[10px] ${queueFilters.sort===value?'border-sky-500/40 bg-sky-500/10 text-sky-400':'border-slate-800 text-slate-500'}`}>{label}</button>)}</div></div>}

                {adminView === 'map' && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div className="flex justify-between items-center mb-4"><div><h2 className="text-sm font-semibold text-white">Filtered incident map</h2><p className="text-xs text-slate-400">The map follows the filters above.</p></div><div className="text-xs font-mono text-slate-400">{filteredAdminReports.filter(r=>Number.isFinite(r.coordinates?.lat)).length} mapped</div></div><AuthorityMap reports={filteredAdminReports} onSelect={report=>{setSelectedReport(report);showToast(`${report.id}: ${report.status}`)}} /></div>}

                {adminView === 'funding' && <div className="space-y-4"><div className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="text-sm font-semibold text-white">Community repair funding</h2><p className="text-xs text-slate-400 mt-1">Review the proposed method and estimate, set the approved escrow amount, require the youth worker's after photo, and release funds only after verification.</p></div>{repairRequests.length ? repairRequests.map(req=><div key={req.request_id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 grid lg:grid-cols-[1fr_280px] gap-5"><div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-mono text-sky-400">{req.request_id}</span><span className="text-xs font-mono text-slate-500">Problem {req.complaint_id}</span><span className="px-2 py-1 rounded bg-slate-950 text-[10px] font-mono text-amber-400">{req.status}</span></div><div className="text-base font-semibold text-white mt-3">{req.applicant_name} · PKR {Number(req.estimated_price).toLocaleString()}</div><div className="text-xs text-slate-400 mt-1">Contact: {req.applicant_contact} · ETA {req.estimated_hours} hours</div><div className="mt-4 p-3 rounded-lg bg-slate-950 border border-slate-800"><div className="text-[10px] font-mono text-slate-500 mb-1">WORK PLAN</div><p className="text-sm text-slate-300">{req.plan}</p></div>{req.proof && <div className="mt-4 flex items-center gap-3"><img src={absoluteMediaUrl(req.proof.after_image_url)} className="w-24 h-20 object-cover rounded-lg border border-slate-700" alt="Completion proof"/><div><div className="text-xs text-emerald-400">Youth after-photo received</div><div className="text-xs text-slate-400 mt-1">{req.proof.completion_note}</div></div></div>}</div><div className="space-y-3"><div className="rounded-xl bg-slate-950 border border-slate-800 p-3"><div className="text-[10px] font-mono text-slate-500">FUNDS</div><div className="text-sm text-white mt-1">{req.funds_status}</div>{req.approved_budget && <div className="text-lg font-bold text-emerald-400 mt-1">PKR {Number(req.approved_budget).toLocaleString()}</div>}</div>{req.status === 'Pending Admin Review' && <><label className="block text-xs text-slate-400">Approved escrow amount<input type="number" value={fundingBudgets[req.request_id] ?? req.estimated_price} onChange={e=>setFundingBudgets({...fundingBudgets,[req.request_id]:e.target.value})} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" /></label><div className="grid grid-cols-2 gap-2"><button onClick={()=>decideRepair(req,false)} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-400 text-xs">Reject</button><button onClick={()=>decideRepair(req,true)} className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-xs font-semibold">Reserve budget</button></div></>}{req.status === 'Approved - Awaiting Work' && <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">Waiting for the assigned youth account to upload the required after-repair photo.</div>}{req.status === 'Proof Submitted - Awaiting Verification' && <button onClick={()=>releaseFunds(req)} className="w-full px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold">Verify after photo & release funds</button>}</div></div>) : <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-400">No community funding requests are waiting.</div>}</div>}

                {adminView === 'queue' && <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white font-mono">Real-time Queue</h2>
                    <span className="text-xs font-mono text-slate-400">{filteredAdminReports.length} shown · {filteredAdminReports.filter(r => r.channel === 'WhatsApp').length} WhatsApp</span>
                  </div>

                  {(operationLoading || operationDetail) && <div className="border-b border-slate-800 p-5 bg-slate-950/40">{operationLoading ? <div className="text-sm text-slate-400">Loading operational record…</div> : <div className="space-y-5"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-mono text-sky-400">INCIDENT WORKSPACE · {operationDetail.complaint.id}</div><h3 className="text-lg font-bold text-white mt-1">{operationDetail.complaint.title}</h3><p className="text-xs text-slate-400 mt-1">{operationDetail.complaint.location}</p></div><button onClick={()=>setOperationDetail(null)} className="text-slate-500 hover:text-white">×</button></div><div className="grid lg:grid-cols-[220px_1fr] gap-5">{operationDetail.complaint.beforeImage ? <img src={operationDetail.complaint.beforeImage} alt="Citizen evidence" className="w-full h-44 object-cover rounded-xl border border-slate-800"/> : <div className="h-44 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xs text-slate-500">No image evidence</div>}<div className="grid sm:grid-cols-2 gap-3 text-xs"><div className="p-3 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500 font-mono">CITIZEN INPUT</div><p className="text-slate-200 mt-2 leading-relaxed">{operationDetail.complaint.description}</p></div><div className="p-3 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500 font-mono">AI ASSESSMENT</div><div className="text-white mt-2">{operationDetail.complaint.category} · {operationDetail.complaint.severity}</div><p className="text-slate-400 mt-1">{operationDetail.complaint.ai_reasoning || operationDetail.complaint.title}</p><div className="text-sky-400 mt-2">{operationDetail.complaint.confidence}</div></div><div className="sm:col-span-2 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20"><div className="text-sky-400 font-mono">RECOMMENDED NEXT ACTION</div><p className="text-slate-200 mt-1">{operationDetail.recommended_action}</p>{operationDetail.risk_signals.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{operationDetail.risk_signals.map(signal=><span key={signal} className="px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-300 text-[10px]">{signal}</span>)}</div>}</div></div></div><div className="grid lg:grid-cols-[1fr_1fr] gap-5"><div><div className="text-xs font-mono text-slate-400 mb-2">MATCHED CONTRACTORS</div><div className="flex gap-2"><select value={offerForm.contractor_id} onChange={e=>setOfferForm({...offerForm,contractor_id:e.target.value})} className="min-w-0 flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white">{operationDetail.contractor_matches.map(c=><option key={c.contractor_id} value={c.contractor_id}>{c.name} · {c.match_score}% · ★{c.rating}</option>)}</select><input type="number" placeholder="Budget PKR" value={offerForm.budget_cap} onChange={e=>setOfferForm({...offerForm,budget_cap:e.target.value})} className="w-28 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"/><button onClick={assignContractor} className="px-3 rounded-lg bg-sky-500 text-slate-950 text-xs font-semibold">Send work order</button></div></div><div><div className="text-xs font-mono text-slate-400 mb-2">ACTIVE WORK ORDERS</div>{operationDetail.offers.length ? <div className="space-y-2">{operationDetail.offers.map(offer=><div key={offer.offer_id} className="flex items-center justify-between gap-2 text-xs"><div><span className="text-white">{offer.contractor_name}</span><span className="text-slate-500"> · PKR {Number(offer.budget_cap).toLocaleString()} · {offer.status}</span></div><div className="flex gap-1">{offer.status==='Sent' && <button onClick={()=>changeOfferStatus(offer,'Accepted')} className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">Accept</button>}{offer.status==='Accepted' && <button onClick={()=>changeOfferStatus(offer,'In Progress')} className="px-2 py-1 rounded bg-sky-500/10 text-sky-400">Start</button>}</div></div>)}</div> : <div className="text-xs text-slate-500">No contractor assigned yet.</div>}</div></div></div>}</div>}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/50 text-[11px] font-mono text-slate-400 uppercase">
                          <th className="p-4">ID</th>
                          <th className="p-4">Category & Location</th>
                          <th className="p-4">Severity</th>
                          <th className="p-4">AI Signal</th>
                          <th className="p-4">Status</th>
                          <th className="p-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-xs">
                        {filteredAdminReports.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-4 font-mono font-bold text-sky-400">{item.id}</td>
                            <td className="p-4">
                              <div className="font-semibold text-white">{item.category}</div>
                              <div className="text-[11px] text-slate-400">{item.location}</div>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                                item.severity === 'Critical' 
                                  ? 'bg-red-500/10 text-red-400 border-red-500/30' 
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              }`}>
                                {item.severity}
                              </span>
                            </td>
                            <td className="p-4 font-mono text-[11px] text-slate-400">
                              {item.confidence}
                            </td>
                            <td className="p-4">
                              <span className="text-slate-300 font-medium">{item.status}</span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex justify-end gap-2">
                              <button disabled={!nextOperationalStatus(item)} onClick={() => nextOperationalStatus(item) && updateStatus(item, nextOperationalStatus(item))} className="px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 disabled:opacity-30 text-sky-400 font-medium text-xs">
                                {nextOperationalStatus(item) ? `Move to ${nextOperationalStatus(item)}` : 'Await evidence'}
                              </button>
                              <button 
                                onClick={() => inspectIncident(item)}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors"
                              >
                                Open workspace
                              </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!filteredAdminReports.length && <tr><td colSpan="6" className="p-10 text-center"><div className="text-sm text-slate-300">No incidents match these filters.</div><button onClick={resetQueueFilters} className="mt-2 text-xs text-sky-400">Reset and show unresolved work</button></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>}
              </div>
            )}

            {/* 6. WHATSAPP INTAKE SUMMARY */}
            {activeTab === 'whatsapp' && (
              <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
                <div><div className="text-xs font-mono text-emerald-400">WHATSAPP INTAKE</div><h1 className="text-2xl font-bold text-white mt-1">{reports.filter(r => r.channel === 'WhatsApp').length} reports received</h1><p className="text-sm text-slate-400 mt-2">WhatsApp submissions enter the same complaint pipeline and authority queue as portal reports.</p></div>
                <div className="grid sm:grid-cols-3 gap-4">{[['Total intake', reports.filter(r=>r.channel==='WhatsApp').length], ['Open', reports.filter(r=>r.channel==='WhatsApp' && r.status!=='Resolved').length], ['Resolved', reports.filter(r=>r.channel==='WhatsApp' && r.status==='Resolved').length]].map(([label,value])=><div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5"><div className="text-xs text-slate-400 font-mono">{label}</div><div className="text-3xl font-bold text-white mt-1">{value}</div></div>)}</div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800">{reports.filter(r=>r.channel==='WhatsApp').length ? reports.filter(r=>r.channel==='WhatsApp').map(report=><button key={report.id} onClick={()=>{setSelectedReport(report);setActiveTab('track')}} className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-slate-800/40"><div><div className="text-xs font-mono text-sky-400">{report.id}</div><div className="text-sm font-semibold text-white mt-1">{report.title}</div><div className="text-xs text-slate-400 mt-1">{report.location}</div></div><span className="text-xs text-slate-300">{report.status}</span></button>) : <div className="p-8 text-center text-sm text-slate-400">No WhatsApp reports have been received yet.</div>}</div>
              </div>
            )}
          </main>

          {/* FOOTER */}
          <footer className="border-t border-slate-800/80 bg-[#0B0F17] py-6">
            <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500 font-mono">
              CIVICPulse Municipal Governance Engine — Public Infrastructure Core
            </div>
          </footer>
        </div>
      );
    }

    // MOUNT REACT APPLICATION
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
