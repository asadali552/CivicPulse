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
        const map = window.L.map(mapNode.current, { zoomControl: false }).setView(center, 12);
        window.L.control.zoom({ position: 'bottomright' }).addTo(map);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        located.forEach(report => {
          const state = markerState(report);
          const color = state.color;
          const marker = window.L.circleMarker([report.coordinates.lat, report.coordinates.lng], {
            radius: (report.severity === 'Critical' ? 10 : 8) + Math.min((report.incidentReportCount || 1) - 1, 6),
            color: color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2
          }).addTo(map);
          marker.bindPopup(`
            <div class="p-1 space-y-1.5 font-sans">
              <div class="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1">
                <strong class="font-mono text-sky-400 text-xs">${escapeHtml(report.incident_id || report.id)}</strong>
                <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(report.status)}</span>
              </div>
              <div class="text-xs font-semibold text-white">${escapeHtml(report.category)}</div>
              <div class="text-[11px] text-slate-400 flex items-center gap-1">${escapeHtml(report.location)}</div>
              <div class="text-[10px] font-mono text-sky-300 bg-sky-950/60 rounded px-1.5 py-0.5 mt-1">${escapeHtml(state.label)}</div>
              ${report.incidentReportCount > 1 ? `<div class="text-[10px] text-emerald-400 font-mono">👥 ${report.incidentReportCount} citizen reports linked</div>` : ''}
              ${report.community_repair_interest_count ? `<div class="text-[10px] text-amber-400 font-mono">🛠️ ${Number(report.community_repair_interest_count) || 0} proposal(s) received</div>` : ''}
            </div>
          `).on('click', () => onSelect(report));
        });
        if (located.length > 1) map.fitBounds(located.map(r => [r.coordinates.lat, r.coordinates.lng]), { padding: [40, 40] });
        mapInstance.current = map;
        return () => { map.remove(); mapInstance.current = null; };
      }, [reports]);
      return <div ref={mapNode} className="h-[460px] w-full rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl bg-civic-obsidian" />;
    }

    function LocationPicker({ latitude, longitude, onPick }) {
      const mapNode = useRef(null);
      const pickerNode = useRef(null);
      const onPickRef = useRef(onPick);
      useEffect(() => { onPickRef.current = onPick; }, [onPick]);
      useEffect(() => {
        if (!window.L || !mapNode.current) return;
        const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
        const center = hasLocation ? [latitude, longitude] : [30.1575, 71.5249];
        const map = window.L.map(mapNode.current, { zoomControl: false }).setView(center, hasLocation ? 17 : 12);
        window.L.control.zoom({ position: 'bottomright' }).addTo(map);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        const selectCenter = () => {
          const { lat, lng } = map.getCenter();
          pickerNode.current?.classList.remove('is-moving');
          onPickRef.current(lat, lng);
        };
        map.on('movestart', () => pickerNode.current?.classList.add('is-moving'));
        map.on('moveend', selectCenter);
        map.on('click', event => map.panTo(event.latlng));
        setTimeout(() => map.invalidateSize(), 0);
        return () => map.remove();
      }, []);
      return (
        <div ref={pickerNode} className="location-picker relative h-80 w-full rounded-2xl overflow-hidden glass-card border border-slate-800 shadow-xl">
          <div className="absolute top-3 left-3 z-[450] bg-slate-900/90 backdrop-blur-md border border-slate-700/80 text-[11px] font-mono text-sky-400 px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
            Drag map to place pin on exact spot
          </div>
          <div ref={mapNode} className="h-full w-full" aria-label="Move the map to place its center on the report location" />
          <div className="location-picker-pin" aria-hidden="true">
            <Icon name="map-pin" className="w-10 h-10 text-sky-400 drop-shadow-lg" />
          </div>
        </div>
      );
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
      return <span ref={iconRef} className={`inline-flex items-center justify-center ${className}`} aria-hidden="true" {...props}></span>;
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
      return (
        <div className="max-w-md mx-auto glass-panel border border-slate-700/70 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
          <div className="text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-[10px] font-mono text-sky-400 mb-2">
              SECURE PORTAL
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{subtitle}</p>
          </div>
          {allowRegister && (
            <div className="grid grid-cols-2 bg-slate-950/80 border border-slate-800/80 rounded-xl p-1 shadow-inner">
              <button onClick={()=>setMode('login')} className={`py-2 rounded-lg text-xs font-semibold transition-all ${mode==='login'?'bg-sky-500 text-slate-950 shadow-md':'text-slate-400 hover:text-slate-200'}`}>Login</button>
              <button onClick={()=>setMode('register')} className={`py-2 rounded-lg text-xs font-semibold transition-all ${mode==='register'?'bg-sky-500 text-slate-950 shadow-md':'text-slate-400 hover:text-slate-200'}`}>Register</button>
            </div>
          )}
          {allowRegister && mode==='register' && (
            <>
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" autoComplete="name" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
              <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone number (optional)" autoComplete="tel" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
            </>
          )}
          <input type={allowRegister?'email':'text'} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder={allowRegister ? 'Email address' : 'Admin username'} autoComplete="username" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
          <div className="relative">
            <input type={showPassword?'text':'password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Password" autoComplete={mode==='register'?'new-password':'current-password'} onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className="w-full glass-input rounded-xl p-3 pr-16 text-sm focus:outline-none"/>
            <button type="button" onClick={()=>setShowPassword(value=>!value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 hover:text-sky-400">{showPassword?'Hide':'Show'}</button>
          </div>
          {registering && (
            <>
              <input type={showPassword?'text':'password'} value={form.confirmPassword} onChange={e=>setForm({...form,confirmPassword:e.target.value})} placeholder="Confirm password" autoComplete="new-password" onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className={`w-full glass-input rounded-xl p-3 text-sm focus:outline-none ${form.confirmPassword && !passwordsMatch?'border-red-500/60':'border-slate-800'}`}/>
              <div className="flex justify-between text-[10px] font-mono px-1">
                <span className={passwordValid?'text-emerald-400':'text-slate-500'}>{passwordValid?'✓ 8+ chars':'Min 8 characters'}</span>
                {form.confirmPassword && <span className={passwordsMatch?'text-emerald-400':'text-red-400'}>{passwordsMatch?'✓ Passwords match':'Passwords do not match'}</span>}
              </div>
            </>
          )}
          {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2"><Icon name="alert-circle" className="w-4 h-4 text-red-400 shrink-0"/><span>{error}</span></div>}
          <button onClick={()=>submit()} disabled={!canSubmit} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/25 transition-all">
            {busy?'Authenticating…':mode==='register'?'Create account':'Sign in'}
          </button>
        </div>
      );
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
      const [contractorJobs, setContractorJobs] = useState([]);
      const [contractorProfile, setContractorProfile] = useState(null);
      const [contractors, setContractors] = useState([]);
      const [contractorForm, setContractorForm] = useState({service_area:'',skills:''});
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
            try { setContractors((await api('/contractors')).contractors || []); } catch (_) { setContractors([]); }
          } else {
            setDashboard(null);
          }
          if (knownUser?.role === 'contractor') {
            try { const work = await api('/offers'); setContractorJobs(work.offers || []); setContractorProfile(work.contractor || null); }
            catch (error) { setContractorJobs([]); showToast(`Contractor work unavailable: ${error.message}`); }
          } else { setContractorJobs([]); setContractorProfile(null); }
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

      const authenticateContractor = async () => {
        if (authMode === 'register' && authForm.password !== authForm.confirmPassword) return setAuthError('Passwords do not match.');
        setAuthBusy(true); setAuthError(''); authVersionRef.current += 1;
        try {
          const registering = authMode === 'register';
          const payload = registering ? {name:authForm.name.trim(),email:authForm.email.trim(),password:authForm.password,phone:authForm.phone.trim(),account_type:'contractor',service_area:contractorForm.service_area.trim(),skills:contractorForm.skills.split(',').map(v=>v.trim()).filter(Boolean)} : {email:authForm.email.trim(),password:authForm.password};
          const user = await api(registering ? '/auth/register' : '/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          if (user.role !== 'contractor') throw new Error('Use a registered contractor account.');
          window.CIVICPULSE_CSRF=user.csrf_token; setAuthUser(user); await refreshData(user); showToast(`Welcome, ${user.name}.`);
        } catch(error) { setAuthError(error.message); showToast(error.message); }
        finally { setAuthBusy(false); }
      };

      const updateContractorJob = async (offer, status) => {
        try { await api(`/offers/${offer.offer_id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})}); await refreshData(authUser); showToast(`Work order ${status.toLowerCase()}.`); }
        catch(error) { showToast(error.message); }
      };

      const approveContractor = async (contractor, approved) => {
        try { await api(`/contractors/${contractor.contractor_id}/approval`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved})}); await refreshData(authUser); showToast(`Contractor ${approved?'approved':'rejected'}.`); }
        catch(error) { showToast(error.message); }
      };

      const rateContractor = async (report, score) => {
        const authority = authUser?.role === 'admin';
        const token = sessionStorage.getItem(`civicpulse-reporter-${report.id}`);
        if (!authority && !token) return showToast('Only the original reporter or authority can rate this work.');
        try { const updated=await api(`/complaints/${report.id}/${authority?'authority':'reporter'}-contractor-rating`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score,token})}); setSelectedReport(normalizeReport(updated)); await refreshData(authUser); showToast(`${score}-star rating recorded.`); }
        catch(error) { showToast(error.message); }
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
          setReportForm(form => ({
            ...form,
            category: analysis.category,
            severity: analysis.severity,
            description: form.description.trim() || analysis.summary || 'Civic issue shown in uploaded evidence',
          }));
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
          <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#070A11]/85 border-b border-slate-800/80 shadow-lg shadow-black/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
              <button aria-label="CivicPulse home" className="flex items-center space-x-3 text-left group rounded-xl focus:outline-none" onClick={() => setActiveTab('landing')}>
                <div className="relative w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 via-sky-400 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/30 group-hover:shadow-sky-400/50 group-hover:scale-105 transition-all">
                  <Icon name="activity" className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-[#070A11]"></span>
                  </span>
                </div>
                <div>
                  <div className="font-extrabold text-xl tracking-tight text-white flex items-center gap-1.5 font-sans">
                    CIVIC<span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">PULSE</span>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30 tracking-wider">AI PILOT</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono hidden sm:block">Public Municipal Intelligence</div>
                </div>
              </button>

              <nav className="hidden lg:flex items-center space-x-1.5 p-1 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
                {[
                  { id: 'landing', label: 'Platform', icon: 'sparkles' },
                  { id: 'report', label: 'Report Issue', icon: 'camera' },
                  { id: 'track', label: 'Track Case', icon: 'search' },
                  { id: 'map', label: 'Public Map', icon: 'map' },
                  { id: 'community', label: 'Community Tasks', icon: 'hammer' },
                  { id: 'contractor', label: 'Contractor Hub', icon: 'hard-hat' }
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                        isActive 
                          ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-slate-950 shadow-md shadow-sky-500/20 font-bold' 
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      <Icon name={tab.icon} className={`w-3.5 h-3.5 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex items-center space-x-2.5">
                <span className={`hidden sm:inline-flex text-[10px] font-mono items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                  apiOnline 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {apiOnline ? (reports.some(report=>report.data_label === 'Demo') ? 'DEMO NODE' : 'LIVE API') : 'OFFLINE'}
                </span>
                <button 
                  onClick={() => setDarkMode(value => !value)} 
                  aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-300 hover:text-sky-400 hover:border-sky-500/40 flex items-center justify-center transition-all shadow-sm"
                >
                  <Icon name={darkMode ? 'sun' : 'moon'} className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('admin')}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Icon name="shield-alert" className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">Authority Portal</span>
                  <span className="sm:hidden">Admin</span>
                </button>
              </div>
            </div>
          </header>

          {/* MOBILE BOTTOM NAVIGATION */}
          <nav aria-label="Mobile navigation" className="mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[#070A11]/95 backdrop-blur-2xl border-t border-slate-800 px-2 pt-2 grid grid-cols-6 shadow-[0_-15px_35px_rgba(0,0,0,0.6)]">
            {[
              ['landing','home','Home'], ['report','camera','Report'], ['track','search','Track'],
              ['map','map','Map'], ['community','hammer','Youth'], ['admin','landmark','Authority']
            ].map(([id, icon, label]) => {
              const isActive = activeTab === id;
              return (
                <button 
                  key={id} 
                  aria-current={isActive ? 'page' : undefined} 
                  onClick={() => setActiveTab(id)} 
                  className={`min-w-0 min-h-12 rounded-xl flex flex-col items-center justify-center gap-1 py-1 text-[9px] font-semibold transition-all ${
                    isActive ? 'text-sky-400 bg-sky-500/15' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon name={icon} className="w-4 h-4"/>
                  <span className="truncate w-full text-center tracking-tight">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* TOAST NOTIFICATION */}
          {toast && (
            <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 reveal-up">
              <div className="glass-panel border border-sky-500/40 text-slate-100 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3.5">
                <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center shrink-0">
                  <Icon name="check" className="w-4 h-4 text-sky-400" />
                </div>
                <span className="text-xs sm:text-sm font-medium leading-snug">{toast}</span>
              </div>
            </div>
          )}

          {/* MAIN BODY ROUTING */}
          <main id="main-content" className="flex-1" tabIndex="-1">
            {/* 1. LANDING PAGE */}
            {activeTab === 'landing' && (
              <div className="relative overflow-hidden">
                <div aria-hidden="true" className="surface-grid absolute inset-0 pointer-events-none" />
                <div aria-hidden="true" className="aurora-glow absolute top-0 inset-x-0 h-[600px] pointer-events-none" />

                <section aria-labelledby="hero-title" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-14 sm:pb-24">
                  <div className="grid lg:grid-cols-[1.12fr_.88fr] items-center gap-12 lg:gap-16">
                    <div className="reveal-up max-w-3xl">
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-card border border-sky-500/30 text-[11px] sm:text-xs text-sky-400 font-mono shadow-sm">
                        <span className="relative flex w-2 h-2">
                          <span className="soft-pulse absolute inset-0 rounded-full bg-sky-400"/>
                          <span className="relative w-2 h-2 rounded-full bg-sky-400"/>
                        </span>
                        Next-Gen AI Civic Intelligence & Verification
                      </div>
                      
                      <h1 id="hero-title" className="mt-6 text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] text-white leading-[1.05]">
                        Report what is broken.<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-cyan-300 to-blue-500">
                          Verify who fixes it.
                        </span>
                      </h1>
                      
                      <p className="mt-6 text-base sm:text-lg leading-7 sm:leading-8 text-slate-300 max-w-2xl font-normal">
                        CivicPulse connects citizen photo evidence and location with AI triage, SLA accountability, verified repair proofs, and transparent public consensus.
                      </p>

                      <div className="mt-8 flex flex-col sm:flex-row gap-3.5">
                        <button 
                          onClick={() => { setReportStep(1); setActiveTab('report'); }} 
                          className="group w-full sm:w-auto min-h-13 px-8 rounded-2xl font-bold bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 transition-all shadow-xl shadow-sky-500/25 flex items-center justify-center gap-2.5 text-sm sm:text-base cursor-pointer"
                        >
                          <Icon name="camera" className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                          <span>Report an Issue</span>
                          <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                        <button 
                          onClick={() => setActiveTab('track')} 
                          className="w-full sm:w-auto min-h-13 px-8 rounded-2xl font-semibold glass-card border border-slate-700 hover:border-sky-500/50 text-slate-200 hover:text-white transition-all flex items-center justify-center gap-2 text-sm sm:text-base"
                        >
                          <Icon name="search" className="w-4 h-4 text-sky-400" />
                          <span>Track with Case ID</span>
                        </button>
                      </div>

                      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                        {['No account needed to file', 'Public SLA & Case ID', '3-Party proof to close'].map(item => (
                          <span key={item} className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                              <Icon name="check" className="w-2.5 h-2.5 text-emerald-400" />
                            </div>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="reveal-up-delay relative max-w-xl lg:ml-auto w-full">
                      <div className="absolute -inset-4 bg-gradient-to-tr from-sky-500/20 to-blue-600/10 blur-3xl rounded-full" />
                      <div className="relative rounded-3xl glass-panel border border-slate-700/80 p-6 sm:p-7 shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
                          <div>
                            <div className="text-[10px] font-mono tracking-[0.2em] text-sky-400 font-bold">PUBLIC INCIDENT PIPELINE</div>
                            <div className="mt-1 text-sm font-semibold text-white">4-Stage Accountability Flow</div>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold border ${
                            apiOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}/>
                            {apiOnline ? 'LIVE' : 'PREVIEW'}
                          </span>
                        </div>

                        <div className="py-5 space-y-4">
                          {[
                            ['camera', 'Citizen Evidence Logged', 'Photo, EXIF GPS & area details', 'complete'],
                            ['brain-circuit', 'Gemini Vision AI Triage', 'Severity, duplicates & agency suggested', 'complete'],
                            ['building-2', 'Operational Assignment', 'Contractor SLA & budget cap locked', 'active'],
                            ['shield-check', '3-Party Verification', 'After-photo match & reporter approval', 'pending']
                          ].map(([icon, title, detail, state]) => (
                            <div key={title} className="grid grid-cols-[2.75rem_1fr_auto] gap-3.5 items-center p-2 rounded-xl hover:bg-slate-800/30 transition-colors">
                              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border transition-all ${
                                state === 'complete' 
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' 
                                  : state === 'active' 
                                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-glow-sky' 
                                  : 'bg-slate-950/60 border-slate-800 text-slate-500'
                              }`}>
                                <Icon name={icon} className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="text-xs sm:text-sm font-semibold text-slate-100">{title}</div>
                                <div className="text-[11px] text-slate-400 leading-snug">{detail}</div>
                              </div>
                              <div className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                                state === 'complete' 
                                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' 
                                  : state === 'active' 
                                  ? 'text-sky-300 bg-sky-500/15 border-sky-500/40 animate-pulse' 
                                  : 'text-slate-500 bg-slate-900 border-slate-800'
                              }`}>
                                {state === 'complete' ? 'DONE' : state === 'active' ? 'IN PROGRESS' : 'PENDING'}
                              </div>
                            </div>
                          ))}
                        </div>

                        <button 
                          onClick={() => setActiveTab('map')} 
                          className="w-full min-h-12 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 hover:border-sky-500/40 text-xs sm:text-sm font-semibold text-slate-200 transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <Icon name="map-pin" className="w-4 h-4 text-sky-400" />
                          <span>Open Live City Incident Map</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* PLATFORM STATS GRID */}
                  <div aria-label="Platform activity metrics" className="mt-16 sm:mt-20 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {landingStats.map((stat) => (
                      <div key={stat.label} className="glass-card rounded-2xl p-5 border border-slate-800 hover:border-sky-500/40 transition-all">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-xs font-semibold tracking-tight">{stat.label}</span>
                          <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                            <Icon name={stat.icon} className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <div className="mt-3 text-3xl font-extrabold tracking-tight text-white font-mono">{stat.val}</div>
                        <div className="mt-1 text-[11px] text-slate-400 font-mono flex items-center gap-1">
                          <span className="text-emerald-400">●</span> {stat.trend}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 4-STEP ACCOUNTABLE PIPELINE SECTION */}
                <section aria-labelledby="workflow-title" className="relative border-t border-slate-800/80 bg-slate-950/40 py-16 sm:py-24">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl mb-12">
                      <div className="text-[11px] font-mono tracking-[0.2em] text-sky-400 font-bold uppercase">Public Governance Engine</div>
                      <h2 id="workflow-title" className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                        Simple for citizens. Structured for authorities.
                      </h2>
                      <p className="mt-3 text-sm sm:text-base leading-relaxed text-slate-400">
                        Every incident creates a verifiable trail from initial citizen submission to three-party signed verification.
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {[
                        { step: '01', icon: 'camera', title: 'Capture Evidence', desc: 'Upload photo with auto-detected GPS or choose exact map coordinates. AI prepares the preliminary triage.' },
                        { step: '02', icon: 'brain-circuit', title: 'AI Classification', desc: 'Gemini Vision assigns category, severity score, duplicate detection, and department routing with confidence scores.' },
                        { step: '03', icon: 'clipboard-check', title: 'Operational Assignment', desc: 'Authorities assign approved contractors or eligible supervised community youth cleanup teams with fixed SLAs.' },
                        { step: '04', icon: 'shield-check', title: '3-Party Verification', desc: 'Before/after photo matches, contractor confirmation, reporter sign-off, and authority approval close the issue.' }
                      ].map((item) => (
                        <article key={item.step} className="glass-card p-6 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-400">
                                <Icon name={item.icon} className="w-5 h-5"/>
                              </div>
                              <span className="text-xs font-mono font-bold text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full">{item.step}</span>
                            </div>
                            <h3 className="mt-5 text-base font-bold text-white">{item.title}</h3>
                            <p className="mt-2 text-xs sm:text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* 2. CITIZEN REPORT FLOW */}
            {activeTab === 'report' && (
              <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
                {/* STEPPER HEADER */}
                <div className="mb-8 p-5 rounded-3xl glass-panel border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Report a Civic Problem</h1>
                    <p className="text-xs text-slate-400 mt-0.5">Submit photo and confirmed coordinates for AI routing and tracking.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {[
                      { step: 1, label: 'Evidence' },
                      { step: 2, label: 'AI Review' },
                      { step: 3, label: 'Submit' }
                    ].map((s, idx) => (
                      <React.Fragment key={s.step}>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all ${
                          reportStep === s.step 
                            ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-bold shadow-glow-sky' 
                            : reportStep > s.step 
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold' 
                            : 'bg-slate-900/60 border-slate-800 text-slate-500'
                        }`}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-950 font-mono">
                            {reportStep > s.step ? '✓' : s.step}
                          </span>
                          <span className="hidden sm:inline">{s.label}</span>
                        </div>
                        {idx < 2 && <span className="text-slate-700 text-xs">→</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* STEP 1: PHOTO EVIDENCE INTAKE */}
                {reportStep === 1 && (
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-10 text-center space-y-6 shadow-2xl reveal-up">
                    <div className="border-2 border-dashed border-slate-700/80 hover:border-sky-500/60 rounded-3xl p-8 sm:p-14 transition-all bg-slate-950/40 flex flex-col items-center justify-center space-y-5">
                      <div className="w-20 h-20 rounded-3xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-glow-sky group-hover:scale-105 transition-transform">
                        <Icon name="camera" className="w-10 h-10 stroke-[2]" />
                      </div>
                      <div className="max-w-md">
                        <h3 className="text-xl font-bold text-white tracking-tight">Upload Incident Evidence</h3>
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                          Take a live photo or upload from camera roll. AI will immediately analyze problem type, depth, and duplicate reports.
                        </p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-3 w-full sm:w-auto">
                        <label className="cursor-pointer w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-xl shadow-sky-500/25 flex items-center justify-center gap-2">
                          <Icon name="upload-cloud" className="w-4 h-4 text-slate-950" />
                          <span>Select or Take Photo</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhotoUpload} className="hidden" />
                        </label>
                        <button 
                          type="button" 
                          onClick={() => {
                            setUploadedFile(null);
                            setUploadedImage(null);
                            setAiAnalysis(null);
                            setPhotoLocation(null);
                            setAnalysisComplete(true);
                            setReportStep(2);
                          }} 
                          className="text-xs text-slate-400 hover:text-sky-400 underline underline-offset-4 transition-colors"
                        >
                          Continue without photo (requires manual review)
                        </button>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 pt-2">
                        <span>JPEG</span> · <span>PNG</span> · <span>WEBP</span> · <span>MAX 4MB</span>
                      </div>
                    </div>

                    <div className="text-left glass-card border border-slate-800/80 p-4 sm:p-5 rounded-2xl flex items-start gap-3.5">
                      <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                        <Icon name="shield-check" className="w-4 h-4" />
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        <strong className="text-slate-200">Cryptographic Privacy Guarantee:</strong> If the photo contains GPS EXIF metadata, CivicPulse extracts it only for your review. Published photos are re-encoded and completely stripped of personal metadata.
                      </p>
                    </div>
                  </div>
                )}

                {/* STEP 2: AI VISION & GEOSPATIAL INTELLIGENCE */}
                {reportStep === 2 && (
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-7 shadow-2xl reveal-up">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* EVIDENCE PREVIEW / SCANNER */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
                          <span>Evidence Payload</span>
                          {uploadedImage && <span className="text-emerald-400">● Usable photo</span>}
                        </div>
                        {uploadedImage ? (
                          <div className="ai-laser-container relative w-full h-64 rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950">
                            <img src={uploadedImage} alt="Report preview" className="w-full h-full object-cover" />
                            {isAnalyzing && (
                              <>
                                <div className="ai-laser-beam"></div>
                                <div className="ai-laser-grid"></div>
                                <div className="absolute bottom-3 inset-x-3 z-30 bg-slate-950/90 backdrop-blur-md border border-sky-500/40 rounded-xl p-2.5 text-center shadow-lg">
                                  <div className="text-xs font-bold text-sky-300 font-mono flex items-center justify-center gap-2">
                                    <Icon name="scan" className="w-4 h-4 text-sky-400 animate-spin" />
                                    NEURAL VISION SCANNING...
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-64 rounded-2xl border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-xs text-slate-500 bg-slate-950/40 p-6 text-center">
                            <Icon name="image-off" className="w-8 h-8 text-slate-600 mb-2" />
                            <span>No photo supplied</span>
                            <span className="text-[10px] text-slate-600 mt-1">Incident will be logged for authority inspection</span>
                          </div>
                        )}
                      </div>

                      {/* AI ASSESSMENT SIGNALS */}
                      <div className="flex flex-col justify-between space-y-4">
                        {isAnalyzing ? (
                          <div className="h-64 flex flex-col items-center justify-center space-y-4 py-8 glass-card rounded-2xl border border-sky-500/20">
                            <Icon name="sparkles" className="w-10 h-10 text-sky-400 animate-pulse" />
                            <div className="text-center px-4">
                              <div className="text-sm font-bold text-white">Gemini Vision AI Triage</div>
                              <div className="text-xs font-mono text-slate-400 mt-1">Classifying severity, category & duplicate incident clusters...</div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3.5">
                            {/* AI Summary Quote */}
                            <div className="glass-card border border-sky-500/30 p-4 rounded-2xl bg-sky-950/20">
                              <div className="text-[10px] text-sky-400 font-mono font-bold flex items-center gap-1.5">
                                <Icon name="sparkles" className="w-3.5 h-3.5 text-sky-400" />
                                AI VISION ASSESSMENT
                              </div>
                              <p className="text-xs sm:text-sm font-medium text-slate-100 mt-1.5 leading-snug">
                                “{aiAnalysis?.summary || 'Evidence preview ready. The final AI assessment will be confirmed on submission.'}”
                              </p>
                            </div>

                            {/* Signal Badges Grid */}
                            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                              <div className="glass-card p-3 rounded-xl border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">CATEGORY</span>
                                <span className="text-white font-bold truncate block mt-0.5">{aiAnalysis?.category || reportForm.category}</span>
                              </div>
                              <div className="glass-card p-3 rounded-xl border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">SEVERITY</span>
                                <span className={`font-bold block mt-0.5 ${
                                  (aiAnalysis?.severity || reportForm.severity) === 'Critical' ? 'text-red-400' : 'text-amber-400'
                                }`}>
                                  {aiAnalysis?.severity || reportForm.severity}
                                </span>
                              </div>
                              <div className="glass-card p-3 rounded-xl border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">DEPARTMENT ROUTING</span>
                                <span className="text-sky-400 font-semibold truncate block mt-0.5">{aiAnalysis?.department || 'Civil Works'}</span>
                              </div>
                              <div className="glass-card p-3 rounded-xl border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">AI CONFIDENCE</span>
                                <span className={`font-bold block mt-0.5 ${aiAnalysis?.confidence < 0.7 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                  {aiAnalysis ? `${Math.round(aiAnalysis.confidence * 100)}%` : 'Pending'}
                                </span>
                              </div>
                            </div>

                            {aiAnalysis?.is_civic_issue === false && (
                              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
                                <Icon name="alert-triangle" className="w-4 h-4 text-red-400 shrink-0" />
                                <span>This photo does not appear to show a valid public civic problem.</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {analysisComplete && (
                      <div className="border-t border-slate-800/80 pt-6 space-y-5">
                        {/* PHOTO LOCATION DETECTED BANNER */}
                        {photoLocation && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < 0.75) && (
                          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                            <div>
                              <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 font-mono">
                                <Icon name="map-pin" className="w-4 h-4 text-emerald-400" />
                                PHOTO GPS EMBEDDED IN EXIF
                              </div>
                              <div className="text-[11px] text-slate-300 mt-1 font-mono">
                                {photoLocation.latitude.toFixed(5)}, {photoLocation.longitude.toFixed(5)}
                                {photoLocation.captured_at ? ` · Captured ${new Date(photoLocation.captured_at).toLocaleTimeString()}` : ''}
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={usePhotoLocation} 
                              className="shrink-0 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all shadow-md"
                            >
                              Use Photo GPS
                            </button>
                          </div>
                        )}

                        {/* LOCATION PICKER & ADDRESS INPUT */}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            Location & Street Coordinates <span className="text-sky-400">*</span>
                          </label>
                          <div className="flex items-center gap-2 glass-input rounded-xl px-3.5 py-2.5 text-sm">
                            <Icon name="map-pin" className="w-4 h-4 text-sky-400 shrink-0" />
                            <input 
                              type="text" 
                              value={reportForm.location}
                              placeholder="Enter street, area or landmark"
                              onChange={(e) => setReportForm({...reportForm, location: e.target.value, locationSource: reportForm.latitude == null ? 'manual' : reportForm.locationSource, locationConfirmed: true})}
                              className="bg-transparent text-white focus:outline-none w-full text-xs sm:text-sm"
                            />
                            <button 
                              type="button" 
                              onClick={captureLocation} 
                              className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all ${
                                reportForm.locationSource === 'device_gps' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/15 text-sky-400 border border-sky-500/30 hover:bg-sky-500/25'
                              }`}
                            >
                              {reportForm.locationSource === 'device_gps' ? '✓ GPS LOCKED' : 'USE DEVICE GPS'}
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <button 
                              type="button" 
                              onClick={() => setShowLocationMap(value => !value)} 
                              className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Icon name={showLocationMap ? 'chevron-up' : 'map'} className="w-3.5 h-3.5" />
                              {showLocationMap ? 'Hide Map Picker' : 'Choose Exact Point on Map'}
                            </button>
                            {reportForm.locationSource && (
                              <span className="text-[10px] font-mono text-emerald-400">
                                Source: {reportForm.locationSource.replace('_', ' ')}
                              </span>
                            )}
                          </div>

                          {showLocationMap && (
                            <div className="mt-3 reveal-up">
                              <LocationPicker latitude={reportForm.latitude} longitude={reportForm.longitude} onPick={selectMapLocation} />
                            </div>
                          )}
                        </div>

                        {/* PRIVATE REPORTER CONTACT */}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            Reporter Contact for Resolution Confirmation (Optional)
                          </label>
                          <input 
                            type="text" 
                            value={reportForm.reporterContact} 
                            onChange={e => setReportForm({...reportForm, reporterContact: e.target.value})} 
                            placeholder="Email or phone — private token for closing case" 
                            className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm focus:outline-none" 
                          />
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            Incident Summary & Details <span className="text-sky-400">*</span>
                          </label>
                          <textarea 
                            rows={3}
                            value={reportForm.description}
                            onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                            placeholder="Provide details about the issue..."
                            className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm focus:outline-none"
                          />
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex items-center justify-between pt-3">
                          <button 
                            onClick={() => setReportStep(1)} 
                            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                          >
                            ← Re-take Photo
                          </button>
                          <button 
                            onClick={handleFinalSubmit}
                            disabled={isSubmitting || (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= 0.75)}
                            className="px-7 py-3.5 rounded-2xl text-xs sm:text-sm font-bold bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 flex items-center gap-2 shadow-xl shadow-sky-500/25 transition-all"
                          >
                            {isSubmitting ? (
                              <>
                                <Icon name="refresh-cw" className="w-4 h-4 animate-spin text-slate-950" />
                                <span>Logging Case...</span>
                              </>
                            ) : (
                              <>
                                <span>Submit & Get Tracking ID</span>
                                <Icon name="arrow-right" className="w-4 h-4 text-slate-950" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. TRACK REPORT & BEFORE/AFTER INTERACTIVE SLIDER */}
            {activeTab === 'track' && !selectedReport && (
              <div className="max-w-xl mx-auto px-4 py-16">
                <div className="rounded-3xl glass-panel border border-slate-800 p-8 text-center space-y-4 shadow-2xl reveal-up">
                  <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto shadow-glow-sky">
                    <Icon name="search" className="w-7 h-7" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-white tracking-tight">Track a Civic Incident</h1>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                    Enter the case ID (e.g. CP-88412) to inspect real-time SLA progress, AI classification, and verified resolution proofs.
                  </p>
                  <div className="flex gap-2.5 mt-5">
                    <input 
                      value={trackingQuery} 
                      onChange={e => setTrackingQuery(e.target.value)} 
                      onKeyDown={e => e.key === 'Enter' && trackById()} 
                      placeholder="e.g. CP-88412" 
                      className="flex-1 glass-input rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none"
                    />
                    <button 
                      onClick={trackById} 
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/25 transition-all"
                    >
                      Track
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'track' && selectedReport && (
              <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-8 reveal-up">
                {/* INCIDENT HEADER CARD */}
                <div className="glass-panel border border-slate-800/80 rounded-3xl p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-2xl">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-2xl font-extrabold font-mono text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
                        {selectedReport.id}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                        selectedReport.status === 'Resolved' 
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' 
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/40 animate-pulse'
                      }`}>
                        {selectedReport.status}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border ${
                        selectedReport.severity === 'Critical' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {selectedReport.severity}
                      </span>
                    </div>

                    {selectedReport.incident_id && (
                      <div className="text-[11px] font-mono text-slate-400 mt-1 flex items-center gap-1.5">
                        <Icon name="git-merge" className="w-3.5 h-3.5 text-sky-400" />
                        Incident Cluster: <strong className="text-slate-200">{selectedReport.incident_id}</strong>
                      </div>
                    )}
                    <h1 className="text-xl font-bold text-white mt-2 tracking-tight">{selectedReport.title}</h1>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1 font-sans">
                      <Icon name="map-pin" className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>{selectedReport.location}</span>
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <div className="flex gap-2">
                      <input 
                        value={trackingQuery} 
                        onChange={e => setTrackingQuery(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && trackById()} 
                        placeholder="Search ID" 
                        className="glass-input rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none w-36" 
                      />
                      <button 
                        onClick={trackById} 
                        className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-all shadow-md"
                      >
                        Track
                      </button>
                    </div>
                    <select 
                      value={selectedReport.id}
                      onChange={(e) => setSelectedReport(reports.find(r => r.id === e.target.value))}
                      className="glass-input rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {reports.map(r => (
                        <option key={r.id} value={r.id} className="bg-slate-900 text-white">{r.id} · {r.category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2-COLUMN TIMELINE & EVIDENCE VERIFICATION WORKSPACE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                  {/* TIMELINE COLUMN */}
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <h2 className="text-xs font-bold text-sky-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="clock" className="w-4 h-4 text-sky-400" />
                        PROGRESS TIMELINE
                      </h2>
                      <span className="text-[10px] font-mono text-slate-400">SLA Active</span>
                    </div>
                    
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-slate-800">
                      {selectedReport.timeline.map((item, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            item.done ? 'bg-sky-400 border-slate-950 shadow-glow-sky' : 'bg-slate-950 border-slate-700'
                          }`} />
                          <div className="text-xs font-bold text-slate-100">{item.step}</div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">{item.time}</div>
                          {item.note && <div className="text-[10px] text-slate-500 mt-1 leading-snug">{item.note}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-800/80 pt-4 space-y-3">
                      <div className="text-xs text-slate-400 font-mono">Assigned Department</div>
                      <div className="glass-card p-3 rounded-xl text-xs font-semibold text-slate-200 flex items-center gap-2 border border-slate-800">
                        <Icon name="building-2" className="w-4 h-4 text-sky-400" />
                        <span>{selectedReport.department}</span>
                      </div>
                    </div>
                  </div>

                  {/* EVIDENCE & 3-PARTY VERIFICATION COLUMN */}
                  <div className="lg:col-span-2 glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <h2 className="text-xs font-bold text-sky-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="shield-check" className="w-4 h-4 text-sky-400" />
                        RESOLUTION & EVIDENCE
                      </h2>
                      {selectedReport.afterImage && (
                        <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 font-bold flex items-center gap-1">
                          <span>✓</span> After Photo Verified
                        </span>
                      )}
                    </div>

                    {/* 3-PARTY STAKEHOLDER CONSENSUS */}
                    <div>
                      <div className="text-[11px] font-mono text-slate-400 mb-2 font-semibold">3-PARTY RESOLUTION CONSENSUS</div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {[
                          ['contractor', 'Contractor Sign-off', 'hard-hat'],
                          ['reporter', 'Citizen Reporter', 'user-check'],
                          ['government', 'Authority Inspector', 'landmark']
                        ].map(([key, label, icon]) => {
                          const approved = selectedReport.resolution_approvals?.[key];
                          const canApprove = authUser?.role === 'admin' && key !== 'reporter';
                          return (
                            <button 
                              key={key} 
                              disabled={!canApprove || approved} 
                              onClick={() => canApprove && !approved && approveResolution(selectedReport, key)} 
                              title={key === 'reporter' ? 'Only the original reporter can verify with their private link' : canApprove ? 'Record verified approval' : 'Authority approval required'} 
                              className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all text-center ${
                                approved 
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-glow-emerald' 
                                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <Icon name={icon} className={`w-4 h-4 ${approved ? 'text-emerald-400' : 'text-slate-500'}`} />
                              <span className="text-[11px] font-bold tracking-tight">{label}</span>
                              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${approved ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-600 bg-slate-900'}`}>
                                {approved ? '✓ VERIFIED' : 'PENDING'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* REPORTER VERIFICATION PANEL */}
                    {selectedReport.afterImage && sessionStorage.getItem(`civicpulse-reporter-${selectedReport.id}`) && (
                      <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-2.5 reveal-up">
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                          <Icon name="key" className="w-4 h-4 text-sky-400" />
                          <span>Private Reporter Action (Token Authenticated)</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          Does the resolution photo match the on-ground reality? Your decision directly updates the public transparency ledger.
                        </p>
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <button onClick={() => verifyAsReporter(selectedReport, 'not_fixed')} className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/25 transition-colors">
                            ✕ Not Fixed
                          </button>
                          <button onClick={() => verifyAsReporter(selectedReport, 'partially_fixed')} className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors">
                            △ Partial Work
                          </button>
                          <button onClick={() => verifyAsReporter(selectedReport, 'fixed')} className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 transition-colors shadow-md">
                            ✓ Fixed & Satisfied
                          </button>
                        </div>
                      </div>
                    )}

                    {/* CONTRACTOR STAR RATING */}
                    {selectedReport.afterImage && selectedReport.assigned_contractor_id && (authUser?.role === 'admin' || sessionStorage.getItem(`civicpulse-reporter-${selectedReport.id}`)) && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Icon name="star" className="w-3.5 h-3.5 text-amber-400" />
                            Rate Contractor Performance
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">Rate quality, speed, and clean-up execution</p>
                        </div>
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4, 5].map(score => (
                            <button 
                              key={score} 
                              onClick={() => rateContractor(selectedReport, score)} 
                              className="text-2xl text-amber-400 hover:scale-125 transition-transform" 
                              aria-label={`${score} stars`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* INTERACTIVE BEFORE/AFTER IMAGE SLIDER */}
                    {selectedReport.afterImage ? (
                      <div className="relative h-80 sm:h-96 w-full rounded-2xl overflow-hidden select-none border border-slate-700/80 shadow-2xl bg-slate-950">
                        {/* AFTER IMAGE (BOTTOM) */}
                        <img src={selectedReport.afterImage} alt="After resolution" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute top-3.5 right-3.5 bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 text-[10px] font-mono px-3 py-1 rounded-full backdrop-blur-md font-bold shadow-lg">
                          AFTER RESOLUTION
                        </div>

                        {/* BEFORE IMAGE (TOP CLIPPED) */}
                        <div 
                          className="absolute inset-0 overflow-hidden"
                          style={{ width: `${sliderPos}%` }}
                        >
                          <img 
                            src={selectedReport.beforeImage} 
                            alt="Before report" 
                            className="absolute inset-0 w-full h-full object-cover max-w-none" 
                            style={{ width: '100%', height: '100%' }} 
                          />
                          <div className="absolute top-3.5 left-3.5 bg-slate-950/90 text-slate-200 border border-slate-700 text-[10px] font-mono px-3 py-1 rounded-full backdrop-blur-md font-bold shadow-lg">
                            BEFORE REPORTED
                          </div>
                        </div>

                        {/* SLIDER DIVIDER LINE & HANDLE */}
                        <div 
                          className="before-after-divider"
                          style={{ left: `${sliderPos}%` }}
                        >
                          <div className="before-after-handle">
                            <Icon name="move-horizontal" className="w-4 h-4 text-white stroke-[2.5]" />
                          </div>
                        </div>

                        {/* RANGE INPUT CONTROLLER */}
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={sliderPos}
                          onChange={(e) => setSliderPos(Number(e.target.value))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-40"
                          aria-label="Before after slider scrub"
                        />
                      </div>
                    ) : (
                      <div className="h-72 sm:h-80 w-full rounded-2xl overflow-hidden relative border border-slate-800 shadow-xl bg-slate-950">
                        <img src={selectedReport.beforeImage} alt="Reported problem" className="w-full h-full object-cover" />
                        <div className="absolute bottom-3.5 inset-x-3.5 bg-slate-950/85 text-slate-300 border border-slate-800 text-xs p-3 rounded-xl backdrop-blur-md flex items-center gap-2">
                          <Icon name="clock" className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Resolution in progress. Inspection proof photo will appear here when completed.</span>
                        </div>
                      </div>
                    )}

                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans glass-card p-4 rounded-2xl border border-slate-800">
                      {selectedReport.description}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4">
                      <div className="text-xs text-slate-400">
                        <span className="text-white font-bold">{selectedReport.affected_count || 1}</span> citizens affected · <span className="text-white font-bold">{selectedReport.duplicates || 1}</span> linked incident reports
                      </div>
                      <button 
                        onClick={markAffected} 
                        className="px-4 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Icon name="thumbs-up" className="w-3.5 h-3.5 text-sky-400" />
                        <span>I’m Affected Too (+1)</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => loadAccountabilityReceipt(selectedReport)} 
                      className="w-full py-3 rounded-xl glass-card border border-slate-700 hover:border-sky-500/50 text-xs font-semibold text-sky-400 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Icon name="file-text" className="w-4 h-4 text-sky-400" />
                      <span>Generate Cryptographic Public Accountability Receipt</span>
                    </button>
                  </div>
                </div>

                {/* ACCOUNTABILITY RECEIPT DISPLAY */}
                {accountabilityReceipt && accountabilityReceipt.complaint_id === selectedReport.id && (
                  <section aria-label="Public accountability receipt" className="rounded-3xl glass-panel border border-sky-500/40 p-6 sm:p-8 space-y-5 shadow-2xl reveal-up">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
                      <div>
                        <div className="text-[10px] font-mono text-sky-400 font-bold tracking-widest uppercase">CRYPTOGRAPHIC EVIDENCE RECEIPT</div>
                        <h2 className="text-xl font-extrabold text-white mt-1">{accountabilityReceipt.incident_id || accountabilityReceipt.complaint_id}</h2>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg break-all font-semibold">
                        SHA-256: {accountabilityReceipt.receipt_hash}
                      </span>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">AI CLASSIFICATION</div>
                        <div className="text-white font-bold mt-1">{accountabilityReceipt.ai_assessment.category}</div>
                        <div className="text-[11px] text-sky-400 mt-0.5">{Math.round((accountabilityReceipt.ai_assessment.confidence || 0)*100)}% Confidence</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">PRIORITY SCORE</div>
                        <div className="text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.priority.score}/100</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">LINKED REPORTS</div>
                        <div className="text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.incident_report_count}</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">STATUS</div>
                        <div className={`font-bold mt-1 ${accountabilityReceipt.resolution.fully_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {accountabilityReceipt.resolution.fully_verified ? 'Fully Verified (3/3)' : 'Awaiting Approvals'}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed font-sans">
                      {accountabilityReceipt.priority.methodology}
                    </p>
                  </section>
                )}
              </div>
            )}

            {/* 4. PUBLIC CIVIC MAP */}
            {activeTab === 'map' && (
              <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6 reveal-up">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel border border-slate-800 p-5 sm:p-6 rounded-3xl shadow-xl">
                  <div>
                    <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">GEOSPATIAL INCIDENT GRID</div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">Public Civic Intelligence Map</h1>
                    <p className="text-xs text-slate-400 mt-0.5">Geographical density of incident reports across municipal sectors with live resolution status.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {['All', 'Roads', 'Sanitation', 'Water'].map((f) => {
                      const count = reports.filter(rep => f === 'All' || (f === 'Roads' && /road/i.test(rep.category)) || (f === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (f === 'Water' && /water|drain|sewer/i.test(rep.category))).length;
                      return (
                        <button 
                          onClick={() => setMapFilter(f)} 
                          key={f} 
                          className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                            mapFilter === f 
                              ? 'bg-sky-500 text-slate-950 shadow-glow-sky' 
                              : 'glass-card text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span>{f}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${mapFilter === f ? 'bg-slate-950 text-sky-300' : 'bg-slate-900 text-slate-400'}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel border border-slate-800/80 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
                  <AuthorityMap
                    reports={reports.filter(rep => mapFilter === 'All' || (mapFilter === 'Roads' && /road/i.test(rep.category)) || (mapFilter === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (mapFilter === 'Water' && /water|drain|sewer/i.test(rep.category)))}
                    onSelect={report => { setSelectedReport(report); setActiveTab('track'); }}
                  />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-[11px] font-mono">
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-glow-emerald" /> 
                      <span>All 3 Approved (Verified)</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-glow-sky" /> 
                      <span>Partly Approved / Progress</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 
                      <span>Moderate Priority</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-glow-rose" /> 
                      <span>Critical / Urgent</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. COMMUNITY ACTION (YOUTH MICRO-MAINTENANCE) */}
            {activeTab === 'community' && (
              <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                <div className="glass-panel border border-slate-800 p-6 sm:p-7 rounded-3xl shadow-xl">
                  <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">SUPERVISED COMMUNITY ACTION</div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">Propose Low-Risk Micro-Maintenance</h1>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                    Only low-risk cleanup and neighborhood beautification tasks appear here. High-voltage, deep trenches, and hazardous tasks are restricted to certified municipal crews.
                  </p>
                </div>

                {!authUser ? (
                  <AuthCard 
                    title="Community Youth Worker Access" 
                    subtitle="Register or log in to submit neighborhood repair proposals and request authority escrow funding." 
                    mode={authMode} 
                    setMode={mode => { setAuthMode(mode); setAuthError(''); }} 
                    form={authForm} 
                    setForm={setAuthForm} 
                    submit={authenticate} 
                    busy={authBusy} 
                    error={authError} 
                  />
                ) : authUser.role !== 'youth' ? (
                  <div className="glass-panel border border-slate-800 rounded-3xl p-8 text-center space-y-4">
                    <p className="text-sm text-slate-300">The current active account is not registered as a youth worker.</p>
                    <button onClick={logout} className="px-5 py-2.5 rounded-xl glass-card border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white">
                      Log out
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4 glass-panel border border-sky-500/30 bg-sky-950/20 rounded-2xl p-4 sm:p-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{authUser.name}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 font-bold">
                            VERIFIED CITIZEN
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-mono">{authUser.email} · Proposals & proof linked to escrow balance</div>
                      </div>
                      <button onClick={logout} className="px-4 py-2 rounded-xl glass-card border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-300">
                        Log out
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-mono">
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-sky-400 font-bold block text-sm">01</span> Submit Plan & Estimate
                      </div>
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-amber-400 font-bold block text-sm">02</span> Authority Escrow Lock
                      </div>
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-emerald-400 font-bold block text-sm">03</span> After Photo & Payout
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* PROPOSAL FORM */}
                      <div className="glass-panel border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Submit New Proposal</h2>
                        <select 
                          value={repairForm.complaint_id} 
                          onChange={e => setRepairForm({...repairForm, complaint_id: e.target.value})} 
                          className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                        >
                          <option value="" className="bg-slate-900">Select an eligible low-risk task</option>
                          {reports.filter(r => r.status !== 'Resolved' && r.volunteer_eligible === true).map(r => (
                            <option key={r.id} value={r.id} className="bg-slate-900">{r.id} · {r.category} · {r.location}</option>
                          ))}
                        </select>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_price} 
                            onChange={e => setRepairForm({...repairForm, estimated_price: e.target.value})} 
                            placeholder="Estimate (PKR)" 
                            className="min-w-0 glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                          />
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_hours} 
                            onChange={e => setRepairForm({...repairForm, estimated_hours: e.target.value})} 
                            placeholder="Hours required" 
                            className="min-w-0 glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                          />
                        </div>
                        <textarea 
                          rows="4" 
                          value={repairForm.plan} 
                          onChange={e => setRepairForm({...repairForm, plan: e.target.value})} 
                          placeholder="Detail materials needed, safe tools, clean-up steps, and expected completion result..." 
                          className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                        />
                        <button 
                          onClick={submitRepairRequest} 
                          disabled={!repairForm.complaint_id || repairForm.plan.length < 10 || !repairForm.estimated_price} 
                          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition-all"
                        >
                          Send Proposal to Authority
                        </button>
                      </div>

                      {/* PROPOSAL HISTORY */}
                      <div className="space-y-3.5">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Your Proposal Ledger</h2>
                        {repairRequests.length ? repairRequests.slice().reverse().map(req => (
                          <div key={req.request_id} className="glass-card border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
                            <div className="flex justify-between gap-3">
                              <div>
                                <div className="font-mono text-sky-400 text-xs font-bold">{req.request_id} · {req.complaint_id}</div>
                                <div className="text-sm font-bold text-white mt-0.5">{req.issue_title || req.applicant_name}</div>
                              </div>
                              <span className="text-[10px] text-amber-400 font-mono font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full h-fit">
                                {req.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                              Budget: PKR {Number(req.estimated_price).toLocaleString()} · {req.estimated_hours}h
                            </div>
                            {req.admin_note && (
                              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-xs text-slate-300">
                                <span className="text-slate-500 font-mono text-[10px] block">AUTHORITY NOTE</span> {req.admin_note}
                              </div>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <label className="block cursor-pointer text-center text-xs px-4 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors font-bold">
                                📷 Upload Required After-Repair Photo
                                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => submitProofFile(req, e.target.files?.[0])} />
                              </label>
                            )}
                            {req.proof && (
                              <div className="flex gap-3 items-center glass-panel p-2.5 rounded-xl border border-slate-800">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} alt="Your after-repair proof" className="w-16 h-14 object-cover rounded-lg border border-slate-700" />
                                <span className="text-xs text-emerald-400 font-semibold">After photo uploaded for authority release.</span>
                              </div>
                            )}
                          </div>
                        )) : (
                          <div className="glass-card border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
                            No repair proposals yet. Choose an open problem on the map to get started.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 6. CONTRACTOR PORTAL */}
            {activeTab === 'contractor' && (
              authUser?.role !== 'contractor' ? (
                <div className="max-w-md mx-auto px-4 py-12 space-y-5 reveal-up">
                  <div className="flex glass-panel border border-slate-800 rounded-2xl p-1">
                    <button onClick={() => setAuthMode('login')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${authMode === 'login' ? 'bg-sky-500 text-slate-950 shadow-md' : 'text-slate-400'}`}>Login</button>
                    <button onClick={() => setAuthMode('register')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${authMode === 'register' ? 'bg-sky-500 text-slate-950 shadow-md' : 'text-slate-400'}`}>Register</button>
                  </div>
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-4 shadow-2xl">
                    <h1 className="text-xl font-extrabold text-white">Contractor Service Hub</h1>
                    {authMode === 'register' && (
                      <input value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} placeholder="Business or contractor name" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    )}
                    <input type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} placeholder="Contractor email" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    {authMode === 'register' && (
                      <>
                        <input value={authForm.phone} onChange={e => setAuthForm({...authForm, phone: e.target.value})} placeholder="Phone number" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                        <input value={contractorForm.service_area} onChange={e => setContractorForm({...contractorForm, service_area: e.target.value})} placeholder="Service area (e.g. Zone 4)" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                        <input value={contractorForm.skills} onChange={e => setContractorForm({...contractorForm, skills: e.target.value})} placeholder="Skills (Roads, Asphalt, Plumbing, Electrical)" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                      </>
                    )}
                    <input type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} placeholder="Password" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    {authMode === 'register' && (
                      <input type="password" value={authForm.confirmPassword} onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})} placeholder="Confirm password" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    )}
                    {authError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl">{authError}</div>}
                    <button onClick={authenticateContractor} disabled={authBusy} className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition-all">
                      {authBusy ? 'Authenticating…' : authMode === 'register' ? 'Submit Registration' : 'Contractor Sign In'}
                    </button>
                  </div>
                  {authUser && <button onClick={logout} className="block mx-auto text-xs text-slate-400 hover:text-white underline">Log out of current session</button>}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel border border-slate-800 p-6 rounded-3xl shadow-xl">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">CONTRACTOR OPERATIONS PORTAL</div>
                      <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">{contractorProfile?.name || 'Contractor Hub'}</h1>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">Status: {contractorProfile?.approval_status || 'Approved'} · Rating: ★ {contractorProfile?.rating || '5.0'}</p>
                    </div>
                    <button onClick={logout} className="px-4 py-2 rounded-xl glass-card border border-slate-700 text-xs font-semibold text-slate-300">
                      Log out
                    </button>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Assigned Work Orders</h2>
                    {contractorJobs.map(job => (
                      <div key={job.offer_id} className="glass-panel border border-slate-800/80 rounded-3xl p-6 space-y-3 shadow-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-mono text-sky-400 font-bold">{job.offer_id} · {job.complaint_id}</div>
                            <h3 className="text-base font-bold text-white mt-0.5">{job.issue_title}</h3>
                            <p className="text-xs text-slate-400 mt-1 font-mono">{job.work_location_area} · Budget: PKR {Number(job.budget_cap).toLocaleString()} · SLA: {job.sla_hours}h</p>
                          </div>
                          <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full h-fit">
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2.5 pt-2">
                          {job.status === 'Sent' && (
                            <>
                              <button onClick={() => updateContractorJob(job, 'Rejected')} className="px-4 py-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold transition-colors">
                                Reject
                              </button>
                              <button onClick={() => updateContractorJob(job, 'Accepted')} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors shadow-md">
                                Accept Order
                              </button>
                            </>
                          )}
                          {job.status === 'Accepted' && (
                            <button onClick={() => updateContractorJob(job, 'In Progress')} className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-colors shadow-md">
                              Start Work On-Site
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!contractorJobs.length && (
                      <div className="glass-panel border border-slate-800 rounded-3xl p-12 text-center text-xs text-slate-400">
                        No active work orders currently assigned to your team.
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {/* 7. AUTHORITY COMMAND CENTER */}
            {activeTab === 'admin' && (
              authUser?.role !== 'admin' ? (
                <div className="max-w-4xl mx-auto px-4 py-10 space-y-5 reveal-up">
                  <AuthCard
                    title="Municipal Authority Command Center"
                    subtitle="Executive governance console for dispatch, SLA auditing, and public escrow releases."
                    mode="login"
                    setMode={() => { }}
                    form={authForm}
                    setForm={setAuthForm}
                    submit={() => authenticate('login')}
                    busy={authBusy}
                    error={authError}
                    allowRegister={false}
                  />
                  {authUser && (
                    <button onClick={logout} className="block mx-auto text-xs text-slate-400 hover:text-white underline">
                      Log out of {authUser.email} first
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-8 reveal-up">
                  {/* COMMAND HEADER */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel border border-slate-800 p-6 rounded-3xl shadow-xl">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">MUNICIPAL OPERATIONS COMMAND</div>
                      <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">Executive Action Center</h1>
                      <p className="text-xs text-slate-400 mt-0.5">Filter incoming telemetry, inspect AI confidence scores, and dispatch verified contractors.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        ['queue', 'list-filter', 'Work Queue'],
                        ['map', 'map', 'Spatial Map'],
                        ['contractors', 'hard-hat', 'Contractors'],
                        ['whatsapp', 'message-circle', 'WhatsApp'],
                        ['funding', 'hand-coins', 'Youth Escrow']
                      ].map(([id, icon, label]) => (
                        <button
                          key={id}
                          onClick={() => setAdminView(id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold font-mono transition-all flex items-center gap-1.5 ${adminView === id
                              ? 'bg-sky-500 text-slate-950 shadow-glow-sky'
                              : 'glass-card border border-slate-800 text-slate-300 hover:text-white'
                            }`}
                        >
                          <Icon name={icon} className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* KPI STATS ROW */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Critical Unresolved', val: dashboard?.stats?.critical_count ?? reports.filter(r => r.severity === 'Critical' && r.status !== 'Resolved').length, alert: true, icon: 'alert-triangle' },
                      { label: 'SLA Violations', val: dashboard?.stats?.overdue_cases ?? reports.filter(r => (r.sla_status || '').startsWith('Overdue')).length, alert: true, icon: 'clock' },
                      { label: 'Active Queue', val: dashboard?.stats?.active_issues ?? reports.filter(r => r.status !== 'Resolved').length, alert: false, icon: 'inbox' },
                      { label: 'Clearance Rate', val: `${dashboard?.stats?.resolution_rate ?? Math.round(100 * reports.filter(r => r.status === 'Resolved').length / Math.max(reports.length, 1))}%`, alert: false, icon: 'check-circle' }
                    ].map((kpi, idx) => (
                      <div key={idx} className={`glass-panel rounded-2xl p-5 border transition-all ${kpi.alert && kpi.val > 0 ? 'border-red-500/40 bg-red-950/15' : 'border-slate-800'}`}>
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-xs font-mono font-semibold">{kpi.label}</span>
                          <Icon name={kpi.icon} className={`w-4 h-4 ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-sky-400'}`} />
                        </div>
                        <div className={`text-3xl font-extrabold font-mono mt-2 tracking-tight ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-white'}`}>
                          {kpi.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI GOVERNANCE INSIGHT */}
                  {dashboard?.insight && (
                    <div className="glass-panel border border-sky-500/30 bg-sky-950/20 rounded-2xl p-5 flex items-start gap-3.5 shadow-lg">
                      <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                        <Icon name="sparkles" className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider">AI GOVERNANCE INTELLIGENCE</div>
                        <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">{dashboard.insight}</p>
                      </div>
                    </div>
                  )}

                  {/* QUEUE FILTERS */}
                  {['queue', 'map'].includes(adminView) && (
                    <div className="glass-panel border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Telemetry Queue Filters</h2>
                          <p className="text-[11px] text-slate-400 font-mono">Showing {filteredAdminReports.length} of {reports.length} total municipal incidents</p>
                        </div>
                        <button onClick={resetQueueFilters} className="text-xs text-sky-400 hover:text-sky-300 font-mono font-semibold underline underline-offset-4">
                          Reset All Filters
                        </button>
                      </div>

                      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                        <input
                          type="search"
                          aria-label="Search incidents"
                          placeholder="Search ID, area, type…"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="lg:col-span-2 glass-input rounded-xl px-3.5 py-2.5 text-xs text-white"
                        />
                        <select aria-label="Reported within" value={queueFilters.days} onChange={e => setQueueFilters({ ...queueFilters, days: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">Any age</option>
                          <option value="1" className="bg-slate-900">Last 24 hours</option>
                          <option value="7" className="bg-slate-900">Last 7 days</option>
                          <option value="15" className="bg-slate-900">Last 15 days</option>
                          <option value="30" className="bg-slate-900">Last 30 days</option>
                        </select>
                        <select aria-label="Work state" value={queueFilters.state} onChange={e => setQueueFilters({ ...queueFilters, state: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All statuses</option>
                          <option value="needs_action" className="bg-slate-900">Needs action</option>
                          <option value="assigned" className="bg-slate-900">Assigned</option>
                          <option value="unresolved" className="bg-slate-900">Unresolved</option>
                          <option value="resolved" className="bg-slate-900">Resolved</option>
                        </select>
                        <select aria-label="Category" value={queueFilters.category} onChange={e => setQueueFilters({ ...queueFilters, category: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All categories</option>
                          {reportCategories.map(category => <option key={category} value={category} className="bg-slate-900">{category}</option>)}
                        </select>
                        <select aria-label="Severity" value={queueFilters.severity} onChange={e => setQueueFilters({ ...queueFilters, severity: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All severities</option>
                          {['Critical', 'High', 'Medium', 'Low'].map(level => <option key={level} value={level} className="bg-slate-900">{level}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-400">Sort by:</span>
                        {[
                          ['priority', 'Highest Priority'],
                          ['oldest', 'Oldest First'],
                          ['newest', 'Newest First']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setQueueFilters({ ...queueFilters, sort: value })}
                            className={`px-3 py-1 rounded-xl border text-[11px] font-bold transition-all ${queueFilters.sort === value ? 'border-sky-500/50 bg-sky-500/20 text-sky-300' : 'border-slate-800 text-slate-400 hover:text-white'
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SPATIAL MAP VIEW */}
                  {adminView === 'map' && (
                    <div className="glass-panel border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Filtered Incident Telemetry Map</h2>
                        <span className="text-xs font-mono text-slate-400">{filteredAdminReports.filter(r => Number.isFinite(r.coordinates?.lat)).length} mapped coordinates</span>
                      </div>
                      <AuthorityMap reports={filteredAdminReports} onSelect={report => { setSelectedReport(report); showToast(`${report.id}: ${report.status}`); }} />
                    </div>
                  )}

                  {/* WHATSAPP VIEW */}
                  {adminView === 'whatsapp' && (
                    <div className="space-y-4">
                      <div className="grid sm:grid-cols-3 gap-3">
                        {[
                          ['Total WhatsApp Intake', reports.filter(r => r.channel === 'WhatsApp').length],
                          ['Pending Triage', reports.filter(r => r.channel === 'WhatsApp' && r.status !== 'Resolved').length],
                          ['Resolved via Bot', reports.filter(r => r.channel === 'WhatsApp' && r.status === 'Resolved').length]
                        ].map(([label, value]) => (
                          <div key={label} className="glass-panel border border-slate-800 rounded-2xl p-5">
                            <div className="text-xs text-slate-400 font-mono">{label}</div>
                            <div className="text-3xl font-extrabold text-white font-mono mt-1">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CONTRACTORS VIEW */}
                  {adminView === 'contractors' && (
                    <div className="space-y-3">
                      {contractors.map(contractor => (
                        <div key={contractor.contractor_id} className="glass-panel border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-mono text-sky-400 font-bold">{contractor.contractor_id}</div>
                            <div className="text-base font-bold text-white mt-0.5">{contractor.name}</div>
                            <div className="text-xs text-slate-400 mt-1 font-mono">
                              {contractor.service_area} · {(contractor.skills || []).join(', ') || 'General Works'} · {contractor.approval_status || (contractor.verified ? 'Approved' : 'Pending Verification')}
                            </div>
                          </div>
                          {!contractor.verified && (
                            <div className="flex gap-2">
                              <button onClick={() => approveContractor(contractor, false)} className="px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold">
                                Reject
                              </button>
                              <button onClick={() => approveContractor(contractor, true)} className="px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold">
                                Approve Contractor
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ESCROW FUNDING VIEW */}
                  {adminView === 'funding' && (
                    <div className="space-y-4">
                      <div className="glass-panel border border-slate-800 rounded-3xl p-6">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Community Repair Escrow Dispatch</h2>
                        <p className="text-xs text-slate-400 mt-1">Review applicant work plans, lock budget in escrow, inspect completion proof photos, and release funds.</p>
                      </div>
                      {repairRequests.length ? repairRequests.map(req => (
                        <div key={req.request_id} className="glass-panel border border-slate-800 rounded-3xl p-6 grid lg:grid-cols-[1fr_300px] gap-6 shadow-xl">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono text-sky-400 font-bold">{req.request_id}</span>
                              <span className="text-xs font-mono text-slate-400">Incident: {req.complaint_id}</span>
                              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-400 font-bold">{req.status}</span>
                            </div>
                            <div className="text-lg font-bold text-white mt-2">{req.applicant_name} · PKR {Number(req.estimated_price).toLocaleString()}</div>
                            <div className="text-xs text-slate-400 mt-0.5 font-mono">Contact: {req.applicant_contact} · Est. Hours: {req.estimated_hours}h</div>
                            <div className="mt-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
                              <div className="text-[10px] font-mono text-slate-400 mb-1 font-bold">SUBMITTED WORK PLAN</div>
                              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{req.plan}</p>
                            </div>
                            {req.proof && (
                              <div className="mt-4 flex items-center gap-3 glass-card p-3 rounded-2xl border border-slate-800">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} className="w-24 h-20 object-cover rounded-xl border border-slate-700" alt="Completion proof" />
                                <div>
                                  <div className="text-xs text-emerald-400 font-bold">Youth completion photo uploaded</div>
                                  <div className="text-xs text-slate-400 mt-1">{req.proof.completion_note}</div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <div className="rounded-2xl glass-card border border-slate-800 p-4">
                              <div className="text-[10px] font-mono text-slate-400 font-bold">ESCROW STATUS</div>
                              <div className="text-xs text-white mt-1">{req.funds_status}</div>
                              {req.approved_budget && <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">PKR {Number(req.approved_budget).toLocaleString()}</div>}
                            </div>
                            {req.status === 'Pending Admin Review' && (
                              <>
                                <label className="block text-xs text-slate-400 font-mono">Approved Escrow Amount
                                  <input type="number" value={fundingBudgets[req.request_id] ?? req.estimated_price} onChange={e => setFundingBudgets({ ...fundingBudgets, [req.request_id]: e.target.value })} className="mt-1 w-full glass-input rounded-xl p-2.5 text-xs text-white font-mono" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button onClick={() => decideRepair(req, false)} className="px-3 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold">Reject</button>
                                  <button onClick={() => decideRepair(req, true)} className="px-3 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold shadow-md">Reserve Escrow</button>
                                </div>
                              </>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3.5 text-xs text-amber-300 leading-snug">
                                Waiting for youth worker on-site execution and after photo upload.
                              </div>
                            )}
                            {req.status === 'Proof Submitted - Awaiting Verification' && (
                              <button onClick={() => releaseFunds(req)} className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/25 transition-all">
                                ✓ Verify Proof & Release Funds
                              </button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="glass-panel border border-slate-800 rounded-3xl p-10 text-center text-xs text-slate-400">
                          No community funding requests currently awaiting review.
                        </div>
                      )}
                    </div>
                  )}

                  {/* WORK QUEUE VIEW */}
                  {adminView === 'queue' && (
                    <div className="glass-panel border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                      <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
                        <h2 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Real-Time Municipal Queue</h2>
                        <span className="text-xs font-mono text-slate-400">{filteredAdminReports.length} shown</span>
                      </div>

                      {/* INCIDENT WORKSPACE DRAWER */}
                      {(operationLoading || operationDetail) && (
                        <div className="border-b border-slate-800 p-6 bg-slate-950/80 reveal-up">
                          {operationLoading ? (
                            <div className="text-xs text-slate-400 font-mono">Loading incident workspace…</div>
                          ) : (
                            <div className="space-y-5">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-xs font-mono text-sky-400 font-bold">INCIDENT WORKSPACE · {operationDetail.complaint.id}</div>
                                  <h3 className="text-lg font-bold text-white mt-0.5">{operationDetail.complaint.title}</h3>
                                  <p className="text-xs text-slate-400 mt-0.5 font-mono">{operationDetail.complaint.location}</p>
                                </div>
                                <button onClick={() => setOperationDetail(null)} className="text-slate-400 hover:text-white text-lg font-bold">×</button>
                              </div>

                              <div className="grid lg:grid-cols-[240px_1fr] gap-5">
                                {operationDetail.complaint.beforeImage ? (
                                  <img src={operationDetail.complaint.beforeImage} alt="Citizen evidence" className="w-full h-48 object-cover rounded-2xl border border-slate-800 shadow-md" />
                                ) : (
                                  <div className="h-48 rounded-2xl glass-card border border-slate-800 flex items-center justify-center text-xs text-slate-500">
                                    No photo evidence supplied
                                  </div>
                                )}
                                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                  <div className="p-3.5 rounded-2xl glass-card border border-slate-800">
                                    <div className="text-slate-400 font-mono text-[10px] font-bold">CITIZEN INPUT</div>
                                    <p className="text-slate-200 mt-1.5 leading-relaxed">{operationDetail.complaint.description}</p>
                                  </div>
                                  <div className="p-3.5 rounded-2xl glass-card border border-slate-800">
                                    <div className="text-slate-400 font-mono text-[10px] font-bold">AI VISION ASSESSMENT</div>
                                    <div className="text-white font-bold mt-1.5">{operationDetail.complaint.category} · {operationDetail.complaint.severity}</div>
                                    <p className="text-slate-400 mt-1 text-[11px] leading-snug">{operationDetail.complaint.ai_reasoning || operationDetail.complaint.title}</p>
                                    <div className="text-sky-400 font-mono text-[11px] mt-1.5">Confidence: {operationDetail.complaint.confidence}</div>
                                  </div>
                                  <div className="sm:col-span-2 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/25">
                                    <div className="text-sky-400 font-mono text-[10px] font-bold">RECOMMENDED NEXT ACTION</div>
                                    <p className="text-slate-200 mt-1 text-xs">{operationDetail.recommended_action}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="grid lg:grid-cols-2 gap-5 pt-2">
                                <div>
                                  <div className="text-xs font-mono text-slate-400 mb-2 font-bold">MATCHED CONTRACTORS</div>
                                  <div className="flex gap-2">
                                    <select value={offerForm.contractor_id} onChange={e => setOfferForm({ ...offerForm, contractor_id: e.target.value })} className="min-w-0 flex-1 glass-input rounded-xl p-2.5 text-xs text-white">
                                      {operationDetail.contractor_matches.map(c => <option key={c.contractor_id} value={c.contractor_id} className="bg-slate-900">{c.name} · {c.match_score}% Match · ★{c.rating}</option>)}
                                    </select>
                                    <input type="number" placeholder="Budget PKR" value={offerForm.budget_cap} onChange={e => setOfferForm({ ...offerForm, budget_cap: e.target.value })} className="w-28 glass-input rounded-xl p-2.5 text-xs text-white font-mono" />
                                    <button onClick={assignContractor} className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold shadow-md">Dispatch Order</button>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-mono text-slate-400 mb-2 font-bold">ACTIVE WORK ORDERS</div>
                                  {operationDetail.offers.length ? (
                                    <div className="space-y-2">
                                      {operationDetail.offers.map(offer => (
                                        <div key={offer.offer_id} className="flex items-center justify-between gap-2 glass-card p-2.5 rounded-xl border border-slate-800 text-xs font-mono">
                                          <div>
                                            <span className="text-white font-bold">{offer.contractor_name}</span>
                                            <span className="text-slate-400"> · PKR {Number(offer.budget_cap).toLocaleString()} · {offer.status}</span>
                                          </div>
                                          <div className="flex gap-1.5">
                                            {offer.status === 'Sent' && <button onClick={() => changeOfferStatus(offer, 'Accepted')} className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">Accept</button>}
                                            {offer.status === 'Accepted' && <button onClick={() => changeOfferStatus(offer, 'In Progress')} className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-bold">Start</button>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-500 font-mono glass-card p-3 rounded-xl border border-slate-800">No contractor assigned yet.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* DATA TABLE */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-mono text-slate-400 uppercase">
                              <th className="p-4">ID</th>
                              <th className="p-4">Category & Location</th>
                              <th className="p-4">Severity</th>
                              <th className="p-4">AI Confidence</th>
                              <th className="p-4">Status</th>
                              <th className="p-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-xs">
                            {filteredAdminReports.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                                <td className="p-4 font-mono font-bold text-sky-400">{item.id}</td>
                                <td className="p-4">
                                  <div className="font-semibold text-white">{item.category}</div>
                                  <div className="text-[11px] text-slate-400 font-mono">{item.location}</div>
                                </td>
                                <td className="p-4">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${item.severity === 'Critical'
                                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    }`}>
                                    {item.severity}
                                  </span>
                                </td>
                                <td className="p-4 font-mono text-[11px] text-slate-300">
                                  {item.confidence}
                                </td>
                                <td className="p-4">
                                  <span className="text-slate-300 font-medium font-mono">{item.status}</span>
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      disabled={!nextOperationalStatus(item)}
                                      onClick={() => nextOperationalStatus(item) && updateStatus(item, nextOperationalStatus(item))}
                                      className="px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 disabled:opacity-30 text-sky-400 font-semibold text-xs transition-all"
                                    >
                                      {nextOperationalStatus(item) ? `→ ${nextOperationalStatus(item)}` : 'Await proof'}
                                    </button>
                                    <button
                                      onClick={() => inspectIncident(item)}
                                      className="px-3.5 py-1.5 rounded-xl glass-card border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold text-xs transition-all shadow-sm"
                                    >
                                      Workspace
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {!filteredAdminReports.length && (
                              <tr>
                                <td colSpan="6" className="p-12 text-center text-xs text-slate-400">
                                  No incidents match the active filter criteria.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

          </main>

          {/* FOOTER */}
          <footer className="border-t border-slate-800/80 bg-slate-950/80 py-8 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-400">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-slate-950 font-black text-[10px]">CP</div>
                <span className="text-slate-200 font-bold">CivicPulse</span>
                <span>— Open Municipal Accountability Engine</span>
              </div>
              <div className="flex items-center gap-4 text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>All Systems Operational</span>
                </span>
                <span>·</span>
                <span>SHA-256 Ledger Verified</span>
              </div>
            </div>
          </footer>
        </div>
      );
    }

    // MOUNT REACT APPLICATION
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
