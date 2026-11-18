/**
 * RoadIQ Municipal Command Center Client
 * Leaflet.js GIS, WebSocket Live Stream, Edge AI Telemetry & Triage Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  const state = {
    alerts: [],
    filteredAlerts: [],
    wardAnalytics: null,
    selectedAlert: null,
    activeTab: 'all', // 'all', 'critical', 'overdue', 'dispatched', 'resolved'
    filterSeverity: '',
    filterClass: '',
    filterWard: '',
    searchQuery: '',
    heatmapVisible: false,
    audioEnabled: true,
    wsConnected: false
  };

  // DOM Elements
  const roadMapEl = document.getElementById('roadMap');
  const incidentListEl = document.getElementById('incidentList');
  const clockDisplayEl = document.getElementById('clockDisplay');
  const wsStatusBadgeEl = document.getElementById('wsStatusBadge');
  const audioIconEl = document.getElementById('audioIcon');
  
  // KPI Elements
  const kpiTotalEventsEl = document.getElementById('kpiTotalEvents');
  const kpiPotholeCountEl = document.getElementById('kpiPotholeCount');
  const kpiManholeCountEl = document.getElementById('kpiManholeCount');
  const kpiCriticalCountEl = document.getElementById('kpiCriticalCount');
  const kpiConfirmedCountEl = document.getElementById('kpiConfirmedCount');
  
  // Tab Counter Elements
  const tabCountAllEl = document.getElementById('tabCountAll');
  const tabCountCriticalEl = document.getElementById('tabCountCritical');
  const tabCountOverdueEl = document.getElementById('tabCountOverdue');
  const tabCountDispatchedEl = document.getElementById('tabCountDispatched');
  const tabCountResolvedEl = document.getElementById('tabCountResolved');

  // Filter Elements
  const filterSeverityEl = document.getElementById('filterSeverity');
  const filterClassEl = document.getElementById('filterClass');
  const filterWardEl = document.getElementById('filterWard');
  const triageSearchInputEl = document.getElementById('triageSearchInput');
  const feedTabs = document.querySelectorAll('.feed-tab');

  // Action Buttons
  const btnWardAnalytics = document.getElementById('btnWardAnalytics');
  const analyticsBreachBadge = document.getElementById('analyticsBreachBadge');
  const btnSimulate = document.getElementById('btnSimulate');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnReseed = document.getElementById('btnReseed');
  const btnAudioToggle = document.getElementById('btnAudioToggle');
  const btnToggleHeatmap = document.getElementById('btnToggleHeatmap');
  const btnRecenterMap = document.getElementById('btnRecenterMap');

  // Modal Elements
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalRoadName = document.getElementById('modalRoadName');
  const modalEventId = document.getElementById('modalEventId');
  const modalTimestamp = document.getElementById('modalTimestamp');
  const modalWard = document.getElementById('modalWard');
  const modalDefectImg = document.getElementById('modalDefectImg');
  const modalHudClass = document.getElementById('modalHudClass');
  const modalHudSpeed = document.getElementById('modalHudSpeed');
  const modalCoords = document.getElementById('modalCoords');
  const btnGoogleMaps = document.getElementById('btnGoogleMaps');
  const btnFocusOnMap = document.getElementById('btnFocusOnMap');
  
  // Modal Telemetry Elements
  const modalSevBubble = document.getElementById('modalSevBubble');
  const modalSevLabel = document.getElementById('modalSevLabel');
  const modalSevCalculation = document.getElementById('modalSevCalculation');
  const modalDepthCm = document.getElementById('modalDepthCm');
  const modalMetricVisual = document.getElementById('modalMetricVisual');
  const modalMetricZrms = document.getElementById('modalMetricZrms');
  const modalMetricPeakFreq = document.getElementById('modalMetricPeakFreq');
  const modalMetricDeflection = document.getElementById('modalMetricDeflection');
  const modalMetricOnsetRate = document.getElementById('modalMetricOnsetRate');
  const modalMetricGyro = document.getElementById('modalMetricGyro');
  const modalCurrentStatusBadge = document.getElementById('modalCurrentStatusBadge');
  const modalStatusSelect = document.getElementById('modalStatusSelect');
  const modalCrewInput = document.getElementById('modalCrewInput');
  const modalNotesInput = document.getElementById('modalNotesInput');
  const modalConfirmationText = document.getElementById('modalConfirmationText');
  const btnSaveWorkOrder = document.getElementById('btnSaveWorkOrder');
  const toastContainer = document.getElementById('toastContainer');

  // Modal SLA Elements
  const modalSlaStatusBadge = document.getElementById('modalSlaStatusBadge');
  const modalSlaCountdown = document.getElementById('modalSlaCountdown');
  const modalSlaProgressFill = document.getElementById('modalSlaProgressFill');
  const modalSlaMeta = document.getElementById('modalSlaMeta');

  // Ward Analytics & SLA Drawer Elements
  const analyticsDrawer = document.getElementById('analyticsDrawer');
  const btnRefreshAnalytics = document.getElementById('btnRefreshAnalytics');
  const btnFilterOverdueFromDrawer = document.getElementById('btnFilterOverdueFromDrawer');
  const analyticsGeneratedAt = document.getElementById('analyticsGeneratedAt');
  const anOverallHealth = document.getElementById('anOverallHealth');
  const anOverallGrade = document.getElementById('anOverallGrade');
  const anOpenResolved = document.getElementById('anOpenResolved');
  const anCompliancePct = document.getElementById('anCompliancePct');
  const anAvgDepth = document.getElementById('anAvgDepth');
  const anBreachedCount = document.getElementById('anBreachedCount');
  const anAtRiskCount = document.getElementById('anAtRiskCount');
  const anSeverityBar = document.getElementById('anSeverityBar');
  const anSeverityLegend = document.getElementById('anSeverityLegend');
  const anStatusPipeline = document.getElementById('anStatusPipeline');
  const wardLeaderboard = document.getElementById('wardLeaderboard');
  const slaWatchlist = document.getElementById('slaWatchlist');

  // Safe HTML Escaping Utility
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Conditionally load Temporal polyfill when native Temporal is unavailable
  const durationFormatter = typeof Intl !== 'undefined' && typeof Intl.DurationFormat === 'function'
    ? new Intl.DurationFormat('en-US', { style: 'narrow' })
    : null;

  (async () => {
    if (typeof globalThis.Temporal === 'undefined') {
      try {
        const mod = await import('https://esm.sh/temporal-polyfill');
        if (mod && mod.Temporal) {
          globalThis.Temporal = mod.Temporal;
          if (state.alerts.length > 0) {
            renderIncidentList();
          }
          if (analyticsDrawer && analyticsDrawer.open && state.wardAnalytics) {
            renderWardAnalytics(state.wardAnalytics);
          }
        }
      } catch (err) {
        console.debug('Temporal polyfill unavailable offline; using server-computed SLA durations.', err);
      }
    }
  })();

  // Format balanced SLA duration using Temporal + Intl.DurationFormat
  function formatDurationFromMinutes(absMinutes) {
    const clamped = Math.max(0, Math.round(absMinutes));
    const days = Math.floor(clamped / 1440);
    const hours = Math.floor((clamped % 1440) / 60);
    const minutes = clamped % 60;
    const parts = days > 0 ? { days, hours } : (hours > 0 ? { hours, minutes } : { minutes });

    if (durationFormatter) {
      return durationFormatter.format(parts);
    }
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function computeLiveSlaDisplay(alert) {
    const status = alert.sla_status || (alert.status === 'Resolved' ? 'met' : 'on_track');
    if (status === 'met') {
      return {
        slaStatus: 'met',
        badgeText: '✓ SLA Met',
        countdownText: 'Resolved within municipal workflow',
      };
    }

    let isBreached = status === 'breached';
    let formattedSpan = '';

    if (typeof globalThis.Temporal !== 'undefined' && alert.sla_deadline) {
      try {
        const nowZdt = globalThis.Temporal.Now.zonedDateTimeISO();
        const deadlineZdt = globalThis.Temporal.Instant.from(alert.sla_deadline)
          .toZonedDateTimeISO(nowZdt.timeZoneId);
        const diff = nowZdt.until(deadlineZdt, { largestUnit: 'day', smallestUnit: 'minute' });
        isBreached = diff.sign < 0;
        const absDiff = diff.abs();
        const displayDur = absDiff.days > 0
          ? absDiff.round({ largestUnit: 'day', smallestUnit: 'hour' })
          : absDiff;
        formattedSpan = typeof displayDur.toLocaleString === 'function'
          ? displayDur.toLocaleString('en-US', { style: 'narrow' })
          : formatDurationFromMinutes(Math.abs(alert.sla_remaining_minutes || 0));
      } catch (err) {
        formattedSpan = formatDurationFromMinutes(Math.abs(alert.sla_remaining_minutes || 0));
      }
    } else {
      const mins = Number(alert.sla_remaining_minutes ?? 0);
      isBreached = status === 'breached' || mins < 0;
      formattedSpan = formatDurationFromMinutes(Math.abs(mins));
    }

    const effectiveStatus = isBreached ? 'breached' : status;
    if (effectiveStatus === 'breached') {
      return {
        slaStatus: 'breached',
        badgeText: `⏱ Overdue ${formattedSpan}`,
        countdownText: `Breached by ${formattedSpan}`,
      };
    }
    if (effectiveStatus === 'at_risk') {
      return {
        slaStatus: 'at_risk',
        badgeText: `⚠️ ${formattedSpan} left`,
        countdownText: `${formattedSpan} remaining (At Risk)`,
      };
    }
    return {
      slaStatus: 'on_track',
      badgeText: `⏳ ${formattedSpan} left`,
      countdownText: `${formattedSpan} remaining`,
    };
  }

  // Corridor Coordinates (Punjab NH-44 / LPU / Phagwara)
  const CORRIDOR_CENTER = [31.2505, 75.7112];
  const CORRIDOR_ZOOM = 13;

  // Initialize Leaflet Map
  const map = L.map('roadMap', {
    center: CORRIDOR_CENTER,
    zoom: CORRIDOR_ZOOM,
    zoomControl: true
  });

  // Basemap Tile Layers (Zero API Key Required, Clean High-Contrast GIS & Street Map)
  const esriDarkBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a> &copy; OpenStreetMap contributors',
    maxZoom: 16
  });

  const esriDarkRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    attribution: '',
    maxZoom: 16
  });

  const darkCanvasGroup = L.layerGroup([esriDarkBase, esriDarkRef]);

  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  });

  const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Earthstar Geographics',
    maxZoom: 18
  });
  const satelliteGroup = L.layerGroup([esriSatellite, esriDarkRef]);

  let currentBasemap = darkCanvasGroup;
  currentBasemap.addTo(map);

  function setBasemap(style) {
    map.removeLayer(currentBasemap);
    if (style === 'osm') {
      currentBasemap = osmLayer;
    } else if (style === 'satellite') {
      currentBasemap = satelliteGroup;
    } else {
      currentBasemap = darkCanvasGroup;
    }
    currentBasemap.addTo(map);
  }

  // Layer Groups
  const markersLayerGroup = L.layerGroup().addTo(map);
  // Marker Registry for GIS Interaction
  const markersByEventId = new Map();

  // Unlock AudioContext on first user interaction to comply with browser policy
  function unlockAudioOnGesture() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    } else if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    document.removeEventListener('click', unlockAudioOnGesture);
    document.removeEventListener('keydown', unlockAudioOnGesture);
  }
  document.addEventListener('click', unlockAudioOnGesture, { once: true });
  document.addEventListener('keydown', unlockAudioOnGesture, { once: true });

  let heatmapLayer = null;

  // Audio Chime Synthesizer via Web Audio API (zero external assets needed)
  let audioCtx = null;
  function playAlertChime(isCritical = false) {
    if (!state.audioEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (isCritical) {
        // High urgency 2-tone alarm
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174.66, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else {
        // Subtle ping
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      console.warn("Audio synthesis unavailable:", e);
    }
  }

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'danger') icon = '🚨';
    if (type === 'warning') icon = '⚠️';
    if (type === 'success') icon = '✅';

    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Clock Update
  function updateClock() {
    const now = new Date();
    clockDisplayEl.textContent = now.toUTCString().slice(17, 25) + ' UTC';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Create Custom SVG Leaflet Marker Pin
  function createMarkerIcon(alert) {
    const sev = alert.severity_score;
    const isCritical = sev >= 4;
    const isMultiVehicle = alert.confirmation_count >= 3;

    const html = `
      <div class="custom-leaflet-marker">
        ${isCritical ? '<div class="marker-pulse-ring"></div>' : ''}
        <div class="marker-pin sev-${sev}" title="${alert.anomaly_class} S-${sev}">
          ${isMultiVehicle ? '🛡️' : sev}
        </div>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: 'leaflet-custom-div-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });
  }

  // Populate Marker Popup Content
  function createPopupContent(alert) {
    const snap = alert.sensor_snapshot || {};
    return `
      <div class="map-popup-card">
        <div class="map-popup-header">
          <span class="map-popup-title">${alert.anomaly_class}</span>
          <span class="sev-tag sev-${alert.severity_score}">S-${alert.severity_score} ${alert.severity_label}</span>
        </div>
        <div class="map-popup-road">${alert.road_name}</div>
        <div class="map-popup-stats">
          <span>Defl: ${snap.suspension_deflection_d || '--'}mm</span>
          <span>Depth: ~${alert.estimated_depth_cm}cm</span>
          <span>${alert.confirmation_count} Cars</span>
        </div>
        <button class="btn btn-sm btn-primary map-popup-btn" onclick="window.inspectAlertById('${alert.event_id}')">
          Inspect Telemetry & Proof
        </button>
      </div>
    `;
  }

  // Render Map Markers
  function renderMapMarkers() {
    markersLayerGroup.clearLayers();

    const heatPoints = [];

    markersByEventId.clear();

    state.filteredAlerts.forEach(alert => {
      const lat = alert.latitude;
      const lon = alert.longitude;

      // Add to markers layer
      const marker = L.marker([lat, lon], { icon: createMarkerIcon(alert) });
      marker.bindPopup(createPopupContent(alert));
      
      marker.on('click', () => {
        highlightIncidentCard(alert.event_id);
      });

      markersByEventId.set(alert.event_id, marker);
      markersLayerGroup.addLayer(marker);

      // Collect data for heatmap: [lat, lon, intensity]
      // Severity 5 gives 1.0, S-4 gives 0.8, etc.
      heatPoints.push([lat, lon, (alert.severity_score / 5.0) * 1.2]);
    });

    // Update Heatmap if active
    if (heatmapLayer) {
      map.removeLayer(heatmapLayer);
    }
    if (state.heatmapVisible) {
      heatmapLayer = L.heatLayer(heatPoints, {
        radius: 28,
        blur: 18,
        maxZoom: 16,
        gradient: { 0.2: '#10B981', 0.5: '#F59E0B', 0.8: '#F97316', 1.0: '#EF4444' }
      }).addTo(map);
    }
  }

  // Render Incident Feed Cards
  function renderIncidentList() {
    if (state.filteredAlerts.length === 0) {
      incidentListEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 32px;">🔍</div>
          <div>No incidents match current filters.</div>
          <button class="btn btn-sm btn-outline" id="btnResetFilters">Clear Filters</button>
        </div>
      `;
      const btnReset = document.getElementById('btnResetFilters');
      if (btnReset) {
        btnReset.addEventListener('click', resetFilters);
      }
      return;
    }

    incidentListEl.innerHTML = '';

    state.filteredAlerts.forEach(alert => {
      const snap = alert.sensor_snapshot || {};
      const card = document.createElement('div');
      card.className = `incident-card ${alert.priority_flag ? 'critical-border' : ''}`;
      card.id = `card-${alert.event_id}`;
      if (state.selectedAlert && state.selectedAlert.event_id === alert.event_id) {
        card.classList.add('active-selected');
      }

      const statusClass = (alert.status || 'New').toLowerCase().replace(' ', '-');
      const slaView = computeLiveSlaDisplay(alert);

      card.innerHTML = `
        <div class="card-top-row">
          <div class="badge-class">
            <span>${alert.anomaly_class === 'Pothole' ? '🕳️' : (alert.anomaly_class === 'Manhole Cover' ? '⚙️' : '⚠️')}</span>
            <span>${escapeHtml(alert.anomaly_class)}</span>
          </div>
          <span class="sev-tag sev-${alert.severity_score}">
            S-${alert.severity_score} ${escapeHtml(alert.severity_label)}
          </span>
        </div>

        <div class="card-road-title" title="${escapeHtml(alert.road_name)}">
          ${escapeHtml(alert.road_name)}
        </div>

        <div class="card-meta-line">
          <div class="meta-stats">
            <span>Defl: <strong>${snap.suspension_deflection_d || '--'}mm</strong></span>
            <span>Depth: <strong>~${alert.estimated_depth_cm}cm</strong></span>
          </div>
          ${alert.confirmation_count >= 3 ? `<span class="confirmation-badge">🛡️ ${alert.confirmation_count} Cars</span>` : ''}
        </div>

        <div class="card-footer-row">
          <span class="status-pill ${statusClass}">${escapeHtml(alert.status)}</span>
          <span class="sla-pill sla-${slaView.slaStatus}">${escapeHtml(slaView.badgeText)}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        highlightIncidentCard(alert.event_id, true);
        openInspectionModal(alert);
      });

      incidentListEl.appendChild(card);
    });
  }

  // Highlight Card when Marker is Clicked
  function highlightIncidentCard(eventId, focusMap = false) {
    document.querySelectorAll('.incident-card').forEach(c => c.classList.remove('active-selected'));
    const targetCard = document.getElementById(`card-${eventId}`);
    if (targetCard) {
      targetCard.classList.add('active-selected');
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (focusMap) {
      const marker = markersByEventId.get(eventId);
      if (marker) {
        map.panTo(marker.getLatLng(), { animate: true });
        marker.openPopup();
      }
    }
  }

  // Update KPI & Tab Counters
  function updateCounters() {
    const total = state.alerts.length;
    const critical = state.alerts.filter(a => a.severity_score >= 4 && a.status !== 'Resolved').length;
    const overdue = state.alerts.filter(a => a.status !== 'Resolved' && a.sla_status === 'breached').length;
    const dispatched = state.alerts.filter(a => a.status === 'Dispatched').length;
    const resolved = state.alerts.filter(a => a.status === 'Resolved').length;
    const confirmed = state.alerts.filter(a => a.confirmation_count >= 3).length;
    const potholes = state.alerts.filter(a => a.anomaly_class === 'Pothole').length;
    const manholes = state.alerts.filter(a => a.anomaly_class === 'Manhole Cover').length;

    kpiTotalEventsEl.textContent = total;
    kpiCriticalCountEl.textContent = critical;
    kpiConfirmedCountEl.textContent = confirmed;
    kpiPotholeCountEl.textContent = `${potholes} Potholes`;
    kpiManholeCountEl.textContent = `${manholes} Manholes`;

    tabCountAllEl.textContent = total;
    tabCountCriticalEl.textContent = critical;
    if (tabCountOverdueEl) tabCountOverdueEl.textContent = overdue;
    tabCountDispatchedEl.textContent = dispatched;
    tabCountResolvedEl.textContent = resolved;

    if (analyticsBreachBadge) {
      analyticsBreachBadge.textContent = overdue;
      analyticsBreachBadge.style.display = overdue > 0 ? 'inline-flex' : 'none';
    }
  }

  // Filter Pipeline
  function applyFilters() {
    state.filteredAlerts = state.alerts.filter(a => {
      // Tab filter
      if (state.activeTab === 'critical' && (a.severity_score < 4 || a.status === 'Resolved')) return false;
      if (state.activeTab === 'overdue' && (a.status === 'Resolved' || a.sla_status !== 'breached')) return false;
      if (state.activeTab === 'dispatched' && a.status !== 'Dispatched') return false;
      if (state.activeTab === 'resolved' && a.status !== 'Resolved') return false;

      // Severity dropdown
      if (state.filterSeverity && a.severity_score !== parseInt(state.filterSeverity, 10)) {
        return false;
      }

      // Class dropdown
      if (state.filterClass && a.anomaly_class !== state.filterClass) {
        return false;
      }

      // Ward dropdown
      if (state.filterWard && !a.ward_id.includes(state.filterWard)) {
        return false;
      }

      // Search keyword
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        const road = (a.road_name || '').toLowerCase();
        const ward = (a.ward_id || '').toLowerCase();
        const id = (a.event_id || '').toLowerCase();
        const vehicle = (a.vehicle_id || '').toLowerCase();
        if (!road.includes(query) && !ward.includes(query) && !id.includes(query) && !vehicle.includes(query)) {
          return false;
        }
      }

      return true;
    });

    const btnQuickReset = document.getElementById('btnQuickResetFilters');
    const isFiltered = Boolean(
      state.activeTab !== 'all' ||
      state.filterSeverity ||
      state.filterClass ||
      state.filterWard ||
      state.searchQuery
    );
    if (btnQuickReset) {
      btnQuickReset.style.display = isFiltered ? 'inline-flex' : 'none';
    }

    renderMapMarkers();
    renderIncidentList();
  }

  function resetFilters() {
    state.activeTab = 'all';
    state.filterSeverity = '';
    state.filterClass = '';
    state.filterWard = '';
    state.searchQuery = '';
    
    filterSeverityEl.value = '';
    filterClassEl.value = '';
    filterWardEl.value = '';
    triageSearchInputEl.value = '';

    feedTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'all'));
    applyFilters();
  }

  // Predictive Risk Intelligence
  async function fetchPredictiveRisk(alert) {
    const snap = alert.sensor_snapshot || {};
    const card = document.getElementById('predictiveRiskCard');
    const unavailMsg = document.getElementById('riskUnavailableMsg');
    
    if (!card) return;
    card.style.display = 'block';
    
    const payload = {
      vehicle_speed: alert.vehicle_speed || 45.0,
      imu_z_rms: snap.imu_z_rms || 1.0,
      gyro_x_peak: snap.gyro_x_peak || 15.0,
      peak_frequency: snap.peak_frequency || 12.0,
      kurtosis: snap.kurtosis || 4.0,
      suspension_deflection_d: snap.suspension_deflection_d || 10.0,
      suspension_onset_rate_r: snap.suspension_onset_rate_r || 0.8,
      visual_confidence: snap.visual_confidence || 0.92
    };
    
    try {
      const resp = await fetch('/api/predict-risk', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      
      if (resp.status === 503) {
        if (unavailMsg) unavailMsg.style.display = 'block';
        return;
      }
      if (unavailMsg) unavailMsg.style.display = 'none';
      
      const data = await resp.json();
      if (!data.model_available) {
        if (unavailMsg) unavailMsg.style.display = 'block';
        return;
      }
      
      // Update UI
      const gaugeEl = document.getElementById('riskGaugeEl');
      const labelEl = document.getElementById('predictedRiskLabel');
      const classEl = document.getElementById('predictedRiskClass');
      const confEl = document.getElementById('predictedConfidence');
      const prioEl = document.getElementById('predictedPriority');
      
      const risk = data.predicted_risk || 'Unknown';
      const cls = data.risk_class ?? '—';
      const conf = data.confidence != null ? (data.confidence * 100).toFixed(1) + '%' : '—';
      const prioMap = {Low: 'Schedule within 7 days', Medium: 'Inspect within 72h', High: 'Priority dispatch (24-48h)'};
      
      if (labelEl) labelEl.textContent = risk;
      if (classEl) classEl.textContent = `Class ${cls}`;
      if (confEl) confEl.textContent = conf;
      if (prioEl) prioEl.textContent = prioMap[risk] || '—';
      
      if (gaugeEl) {
        gaugeEl.className = 'risk-gauge risk-' + risk.toLowerCase();
      }
      
      const probs = data.probabilities || {};
      const setBar = (id, fillId, val) => {
        const el = document.getElementById(id);
        const fill = document.getElementById(fillId);
        if (el) el.textContent = val != null ? (val * 100).toFixed(0) + '%' : '—';
        if (fill) fill.style.width = val != null ? (val * 100) + '%' : '0%';
      };
      setBar('probLowVal', 'probBarLow', probs.low);
      setBar('probMedVal', 'probBarMed', probs.medium);
      setBar('probHighVal', 'probBarHigh', probs.high);
      
    } catch (err) {
      console.warn('Predictive risk fetch failed:', err);
      if (unavailMsg) {
        unavailMsg.textContent = '⚠️ Could not fetch ML prediction.';
        unavailMsg.style.display = 'block';
      }
    }
  }

  // Open Detailed Modal & Populate Telemetry
  function openInspectionModal(alert) {
    state.selectedAlert = alert;
    const snap = alert.sensor_snapshot || {};
    const d_mm = snap.suspension_deflection_d || 0.0;
    const r_mm_ms = snap.suspension_onset_rate_r || 0.0;
    const raw_s = (0.15 * d_mm + 2.0 * r_mm_ms).toFixed(2);

    modalRoadName.textContent = alert.road_name;
    modalEventId.textContent = alert.event_id;
    modalTimestamp.textContent = new Date(alert.timestamp).toUTCString();
    modalWard.textContent = alert.ward_id;

    // Visual proof image with leak prevention
    const modalNoImagePlaceholder = document.getElementById('modalNoImagePlaceholder');
    if (alert.image_base64 && alert.image_base64.trim()) {
      modalDefectImg.src = alert.image_base64;
      modalDefectImg.style.display = 'block';
      if (modalNoImagePlaceholder) modalNoImagePlaceholder.style.display = 'none';
    } else {
      modalDefectImg.src = '';
      modalDefectImg.style.display = 'none';
      if (modalNoImagePlaceholder) modalNoImagePlaceholder.style.display = 'flex';
    }
    modalHudClass.textContent = `${alert.anomaly_class.toUpperCase()} DETECTED`;
    modalHudSpeed.textContent = `SPEED: ${alert.vehicle_speed} km/h`;

    // Coordinates
    modalCoords.textContent = `${alert.latitude.toFixed(4)}° N, ${alert.longitude.toFixed(4)}° E`;
    btnGoogleMaps.href = `https://www.google.com/maps/search/?api=1&query=${alert.latitude},${alert.longitude}`;

    // Severity Box
    modalSevBubble.className = `sev-score-bubble sev-${alert.severity_score}`;
    modalSevBubble.textContent = `S-${alert.severity_score}`;
    modalSevLabel.textContent = `${alert.severity_label} — ${alert.municipal_action}`;
    modalSevCalculation.textContent = `0.15 · ${d_mm}mm + 2.0 · ${r_mm_ms}mm/ms = ${raw_s} → Clip [1..5] = ${alert.severity_score}`;
    modalDepthCm.textContent = `~${alert.estimated_depth_cm} cm`;

    // SLA Window & Progress Bar
    const slaView = computeLiveSlaDisplay(alert);
    if (modalSlaStatusBadge) {
      modalSlaStatusBadge.className = `sla-pill sla-${slaView.slaStatus}`;
      modalSlaStatusBadge.textContent = slaView.badgeText;
    }
    if (modalSlaCountdown) {
      modalSlaCountdown.textContent = slaView.countdownText;
    }
    if (modalSlaProgressFill) {
      const pct = Math.min(100, Math.max(4, Number(alert.sla_elapsed_pct || 0)));
      modalSlaProgressFill.className = `sla-progress-fill sla-${slaView.slaStatus}`;
      modalSlaProgressFill.style.width = `${slaView.slaStatus === 'breached' ? 100 : pct}%`;
    }
    if (modalSlaMeta) {
      const deadlineText = alert.sla_deadline ? new Date(alert.sla_deadline).toUTCString() : '--';
      modalSlaMeta.textContent = `Target Window: ${alert.sla_hours || '--'}h • Deadline: ${deadlineText}`;
    }

    // Multi-modal metrics
    modalMetricVisual.textContent = `${((snap.visual_confidence || 0.94) * 100).toFixed(1)}%`;
    modalMetricZrms.textContent = `${snap.imu_z_rms || '--'} g`;
    modalMetricPeakFreq.textContent = `${snap.peak_frequency || '--'} Hz`;
    modalMetricDeflection.textContent = `${d_mm} mm`;
    modalMetricOnsetRate.textContent = `${r_mm_ms} mm/ms`;
    modalMetricGyro.textContent = `${snap.gyro_x_peak || '--'} °/s`;

    // Triage inputs
    modalCurrentStatusBadge.textContent = `Status: ${alert.status}`;
    modalStatusSelect.value = alert.status;
    modalCrewInput.value = alert.assigned_crew || '';
    modalNotesInput.value = alert.notes || '';

    modalConfirmationText.textContent = alert.confirmation_count >= 3 
      ? `🛡️ Confirmed by ${alert.confirmation_count} independent vehicles (Priority Elevated)`
      : `🛡️ Sighted by ${alert.confirmation_count} vehicle(s)`;

    modalBackdrop.classList.add('open');

    // Fetch predictive risk for this alert
    fetchPredictiveRisk(alert);
  }

  function closeInspectionModal() {
    modalBackdrop.classList.remove('open');
    state.selectedAlert = null;
    document.querySelectorAll('.incident-card').forEach(c => c.classList.remove('active-selected'));
    const riskCard = document.getElementById('predictiveRiskCard');
    if (riskCard) riskCard.style.display = 'none';
  }

  // Expose global inspector for popup onclick
  window.inspectAlertById = function(eventId) {
    const alert = state.alerts.find(a => a.event_id === eventId);
    if (alert) openInspectionModal(alert);
  };

  // Center on Incident Map
  btnFocusOnMap.addEventListener('click', () => {
    if (state.selectedAlert) {
      map.setView([state.selectedAlert.latitude, state.selectedAlert.longitude], 16, { animate: true });
      closeInspectionModal();
    }
  });

  // Save Work Order Changes
  btnSaveWorkOrder.addEventListener('click', async () => {
    if (!state.selectedAlert) return;
    const eventId = state.selectedAlert.event_id;
    const newStatus = modalStatusSelect.value;
    const newCrew = modalCrewInput.value.trim();
    const newNotes = modalNotesInput.value.trim();

    try {
      btnSaveWorkOrder.disabled = true;
      btnSaveWorkOrder.innerHTML = '<span>Saving...</span>';

      const res = await fetch(`/api/alerts/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          assigned_crew: newCrew,
          notes: newNotes
        })
      });

      if (!res.ok) throw new Error('Failed to update alert');
      const updated = await res.json();

      // Update in local state
      const idx = state.alerts.findIndex(a => a.event_id === eventId);
      if (idx !== -1) {
        state.alerts[idx] = updated;
      }
      applyFilters();
      updateCounters();
      refreshAnalyticsIfOpen();
      showToast(`Work order for ${updated.road_name} updated to "${newStatus}"`, 'success');
      closeInspectionModal();
    } catch (e) {
      showToast(e.message, 'danger');
    } finally {
      btnSaveWorkOrder.disabled = false;
      btnSaveWorkOrder.innerHTML = '<span>Save & Update Work Order</span>';
    }
  });

  // Modal Backdrop and Close
  modalCloseBtn.addEventListener('click', closeInspectionModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeInspectionModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop.classList.contains('open')) {
      closeInspectionModal();
    }
  });

  // Fetch Initial Data
  async function loadAlerts() {
    try {
      const res = await fetch('/api/alerts?limit=200');
      if (!res.ok) throw new Error('API fetch failed');
      const data = await res.json();
      state.alerts = data.alerts || [];
      updateCounters();
      applyFilters();
    } catch (e) {
      console.error("Alert load error:", e);
      incidentListEl.innerHTML = `<div class="empty-state">Failed to load alerts from server: ${e.message}</div>`;
    }
  }

  // Setup WebSocket Live Streaming
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/live`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      state.wsConnected = true;
      wsStatusBadgeEl.classList.remove('disconnected');
      wsStatusBadgeEl.innerHTML = `<span class="dot"></span> LIVE WS`;
      console.log("WebSocket connected to RoadIQ edge feed.");
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleLiveEvent(msg);
      } catch (err) {
        console.warn("WS Parse error:", err);
      }
    };

    socket.onclose = () => {
      state.wsConnected = false;
      wsStatusBadgeEl.classList.add('disconnected');
      wsStatusBadgeEl.innerHTML = `<span class="dot" style="background:#EF4444;"></span> OFFLINE`;
      console.warn("WebSocket disconnected. Reconnecting in 3s...");
      setTimeout(initWebSocket, 3000);
    };

    socket.onerror = (err) => {
      console.warn("WebSocket error:", err);
    };
  }

  // Handle Live Real-Time Events
  function handleLiveEvent(msg) {
    if (msg.type === 'NEW_ALERT' || msg.type === 'SIMULATED_TRIGGER' || msg.type === 'UPDATED_CONFIRMATION') {
      const alert = msg.alert;
      const isCritical = alert.severity_score >= 4;

      // Play audio notification
      playAlertChime(isCritical);

      // Show toast
      showToast(
        `<strong>${escapeHtml(alert.anomaly_class)} (S-${alert.severity_score})</strong> ${msg.type === 'UPDATED_CONFIRMATION' ? 'confirmed' : 'detected'} on ${escapeHtml(alert.road_name)}!`,
        isCritical ? 'danger' : 'warning'
      );

      // Check if existing in state (e.g. de-duplicated)
      const existingIdx = state.alerts.findIndex(a => a.event_id === alert.event_id);
      if (existingIdx !== -1) {
        state.alerts[existingIdx] = alert;
      } else {
        state.alerts.unshift(alert);
      }

      updateCounters();
      applyFilters();
      refreshAnalyticsIfOpen();

      // Trigger card flash
      setTimeout(() => {
        const card = document.getElementById(`card-${alert.event_id}`);
        if (card) {
          card.classList.add('flash-new');
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    } else if (msg.type === 'STATUS_CHANGE') {
      const updated = msg.alert;
      const idx = state.alerts.findIndex(a => a.event_id === updated.event_id);
      if (idx !== -1) {
        state.alerts[idx] = updated;
        updateCounters();
        applyFilters();
        refreshAnalyticsIfOpen();
      }
    } else if (msg.type === 'DELETE_ALERT') {
      state.alerts = state.alerts.filter(a => a.event_id !== msg.event_id);
      updateCounters();
      applyFilters();
      refreshAnalyticsIfOpen();
    }
  }

  // Event Listeners for Controls
  filterSeverityEl.addEventListener('change', (e) => {
    state.filterSeverity = e.target.value;
    applyFilters();
  });

  filterClassEl.addEventListener('change', (e) => {
    state.filterClass = e.target.value;
    applyFilters();
  });

  filterWardEl.addEventListener('change', (e) => {
    state.filterWard = e.target.value;
    applyFilters();
  });

  triageSearchInputEl.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    applyFilters();
  });

  feedTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      feedTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.tab;
      applyFilters();
    });
  });

  // Simulate Edge Hit Trigger
  btnSimulate.addEventListener('click', async () => {
    try {
      btnSimulate.disabled = true;
      btnSimulate.innerHTML = '<span class="btn-icon">⚡</span><span>Triggering...</span>';

      const res = await fetch('/api/simulator/trigger', { method: 'POST' });
      if (!res.ok) throw new Error('Simulation endpoint failed');
      const data = await res.json();
      console.log("Simulated edge trigger successful:", data);
    } catch (e) {
      showToast(`Simulation error: ${e.message}`, 'danger');
    } finally {
      setTimeout(() => {
        btnSimulate.disabled = false;
        btnSimulate.innerHTML = '<span class="btn-icon">⚡</span><span>Simulate Edge Hit</span>';
      }, 800);
    }
  });

  // Export CSV
  btnExportCsv.addEventListener('click', () => {
    window.location.href = '/api/export/csv';
    showToast('Downloading PWD Municipal Work Order CSV...', 'success');
  });

  // Reseed Data
  btnReseed.addEventListener('click', async () => {
    if (!confirm("Reseed 12 km Punjab corridor with fresh defect dataset?")) return;
    try {
      showToast('Reseeding database with Punjab road corridor data...', 'info');
      const res = await fetch('/api/seed', { method: 'POST' });
      if (!res.ok) throw new Error('Reseed failed');
      await loadAlerts();
      refreshAnalyticsIfOpen();
      showToast('Corridor successfully reseeded!', 'success');
    } catch (e) {
      showToast(`Reseed error: ${e.message}`, 'danger');
    }
  });

  // Audio Toggle
  btnAudioToggle.addEventListener('click', () => {
    state.audioEnabled = !state.audioEnabled;
    audioIconEl.textContent = state.audioEnabled ? '🔔' : '🔕';
    showToast(state.audioEnabled ? 'Audio alerts enabled' : 'Audio alerts muted', 'info');
  });

  // Heatmap Toggle
  btnToggleHeatmap.addEventListener('click', () => {
    state.heatmapVisible = !state.heatmapVisible;
    btnToggleHeatmap.classList.toggle('active', state.heatmapVisible);
    renderMapMarkers();
    showToast(state.heatmapVisible ? 'Damage density heatmap enabled' : 'Damage density heatmap disabled', 'info');
  });

  // Recenter Map
  btnRecenterMap.addEventListener('click', () => {
    map.setView(CORRIDOR_CENTER, CORRIDOR_ZOOM, { animate: true });
  });

  // Basemap Selector
  const selectBasemap = document.getElementById('selectBasemap');
  if (selectBasemap) {
    selectBasemap.addEventListener('change', (e) => {
      setBasemap(e.target.value);
      showToast(`Switched map basemap to ${selectBasemap.options[selectBasemap.selectedIndex].text}`, 'info');
    });
  }


  // Dynamic Edge AI and Municipal Stats
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const stats = await res.json();
      const kpiLatencyEl = document.getElementById('kpiLatency');
      if (kpiLatencyEl && stats.avg_edge_latency_ms) {
        kpiLatencyEl.textContent = `${stats.avg_edge_latency_ms} ms`;
      }
    } catch (e) {
      console.warn("Could not load /api/stats:", e);
    }
  }

  // Quick Reset Button
  const btnQuickResetFilters = document.getElementById('btnQuickResetFilters');
  if (btnQuickResetFilters) {
    btnQuickResetFilters.addEventListener('click', resetFilters);
  }

  // Dot Legend Click-to-Filter
  document.querySelectorAll('.dot-legend[data-filter-class]').forEach(dot => {
    dot.addEventListener('click', () => {
      const targetClass = dot.dataset.filterClass;
      if (state.filterClass === targetClass) {
        state.filterClass = '';
        filterClassEl.value = '';
      } else {
        state.filterClass = targetClass;
        filterClassEl.value = targetClass;
      }
      applyFilters();
    });
  });

  // Handle Window Resize for Leaflet
  window.addEventListener('resize', () => {
    map.invalidateSize();
  });

  // =========================================================================
  // Ward Analytics & SLA Compliance Drawer (<dialog closedby="any">)
  // =========================================================================
  function gradeClassName(grade) {
    return `grade-${(grade || 'good').toLowerCase()}`;
  }

  function renderWardAnalytics(data) {
    if (!data || !data.corridor_summary) return;
    const summary = data.corridor_summary;

    if (analyticsGeneratedAt && data.generated_at) {
      analyticsGeneratedAt.textContent = `Updated ${new Date(data.generated_at).toUTCString()} • Click any ward to focus map`;
    }

    if (anOverallHealth) {
      anOverallHealth.textContent = `${summary.overall_health_score.toFixed(1)}/100`;
    }
    if (anOverallGrade) {
      anOverallGrade.textContent = summary.overall_health_grade;
      anOverallGrade.className = `health-grade-pill ${gradeClassName(summary.overall_health_grade)}`;
    }
    if (anOpenResolved) {
      anOpenResolved.textContent = `${summary.open_alerts} open • ${summary.resolved_alerts} resolved`;
    }
    if (anCompliancePct) {
      anCompliancePct.textContent = `${summary.sla_compliance_pct.toFixed(1)}%`;
    }
    if (anAvgDepth) {
      anAvgDepth.textContent = `Avg depth: ${summary.avg_estimated_depth_cm.toFixed(1)} cm`;
    }
    if (anBreachedCount) {
      anBreachedCount.textContent = summary.sla_breached_count;
    }
    if (anAtRiskCount) {
      anAtRiskCount.textContent = summary.sla_at_risk_count;
    }

    // Stacked Severity Distribution Bar
    const sevMeta = [
      { key: '5', label: 'S-5 Critical (24h)', color: 'var(--sev-5-crimson)' },
      { key: '4', label: 'S-4 High (48h)', color: 'var(--sev-4-orange)' },
      { key: '3', label: 'S-3 Medium (72h)', color: 'var(--sev-3-amber)' },
      { key: '2', label: 'S-2 Low (7d)', color: 'var(--sev-2-emerald)' },
      { key: '1', label: 'S-1 Minor (14d)', color: 'var(--sev-1-teal)' },
    ];
    const sevCounts = data.severity_breakdown || {};
    const totalForBar = Math.max(1, summary.total_alerts || 0);

    if (anSeverityBar) {
      anSeverityBar.innerHTML = sevMeta
        .map(item => {
          const count = sevCounts[item.key] || 0;
          if (!count) return '';
          const widthPct = ((count / totalForBar) * 100).toFixed(2);
          return `<div class="stacked-bar-segment sev-${item.key}" style="width: ${widthPct}%" title="${item.label}: ${count}"></div>`;
        })
        .join('');
    }

    if (anSeverityLegend) {
      anSeverityLegend.innerHTML = sevMeta
        .map(item => {
          const count = sevCounts[item.key] || 0;
          return `
            <span class="stacked-legend-item">
              <span class="stacked-legend-dot" style="background: ${item.color};"></span>
              <span>${item.label}: <strong>${count}</strong></span>
            </span>
          `;
        })
        .join('');
    }

    // Triage Status Pipeline
    if (anStatusPipeline) {
      const stages = ['New', 'Under Review', 'Dispatched', 'In Repair', 'Resolved'];
      const statusCounts = data.status_breakdown || {};
      anStatusPipeline.innerHTML = stages
        .map(stage => `
          <div class="pipeline-chip">
            <div class="pipeline-chip-count">${statusCounts[stage] || 0}</div>
            <div class="pipeline-chip-label">${escapeHtml(stage)}</div>
          </div>
        `)
        .join('');
    }

    // Ward Leaderboard
    if (wardLeaderboard) {
      const wards = data.wards || [];
      if (wards.length === 0) {
        wardLeaderboard.innerHTML = '<div class="empty-state">No municipal ward telemetry available yet.</div>';
      } else {
        wardLeaderboard.innerHTML = '';
        wards.forEach(ward => {
          const gradeCls = gradeClassName(ward.health_grade);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ward-row-card';
          btn.innerHTML = `
            <div class="ward-row-top">
              <span class="ward-row-name">${escapeHtml(ward.ward_id)}</span>
              <span class="ward-score-group">
                <span class="ward-score-num">${ward.health_score.toFixed(1)}</span>
                <span class="health-grade-pill ${gradeCls}">${escapeHtml(ward.health_grade)}</span>
              </span>
            </div>
            <div class="ward-health-meter" aria-hidden="true">
              <div class="ward-health-fill ${gradeCls}" style="width: ${Math.max(4, ward.health_score)}%;"></div>
            </div>
            <div class="ward-row-metrics">
              <span>Open: <strong>${ward.open_alerts}</strong> / ${ward.total_alerts}</span>
              <span class="${ward.critical_open > 0 ? 'ward-metric-danger' : ''}">S-4/5 Open: <strong>${ward.critical_open}</strong></span>
              <span class="${ward.sla_breached > 0 ? 'ward-metric-danger' : ''}">SLA Breached: <strong>${ward.sla_breached}</strong></span>
              <span>Compliance: <strong>${ward.sla_compliance_pct.toFixed(0)}%</strong></span>
              <span>Avg Sev: <strong>${ward.avg_severity.toFixed(1)}</strong></span>
            </div>
          `;
          btn.addEventListener('click', () => {
            focusWardFromAnalytics(ward);
          });
          wardLeaderboard.appendChild(btn);
        });
      }
    }

    // SLA Escalation Watchlist
    if (slaWatchlist) {
      const urgent = data.sla_alerts || [];
      if (urgent.length === 0) {
        slaWatchlist.innerHTML = '<div class="empty-state">All open incidents are currently within their PWD SLA windows.</div>';
      } else {
        slaWatchlist.innerHTML = '';
        urgent.slice(0, 20).forEach(item => {
          const slaView = computeLiveSlaDisplay(item);
          const row = document.createElement('div');
          row.className = `sla-watch-item sla-${slaView.slaStatus}`;
          row.innerHTML = `
            <div class="sla-watch-main">
              <div class="sla-watch-title-row">
                <span class="sev-tag sev-${item.severity_score}">S-${item.severity_score}</span>
                <span class="sla-watch-road">${escapeHtml(item.road_name)}</span>
              </div>
              <div class="sla-watch-meta">
                <span>${escapeHtml(item.ward_id)}</span>
                <span>•</span>
                <span>Status: <strong>${escapeHtml(item.status)}</strong></span>
                <span>•</span>
                <span>Crew: ${escapeHtml(item.assigned_crew || 'Unassigned')}</span>
              </div>
            </div>
            <div class="sla-watch-actions">
              <span class="sla-pill sla-${slaView.slaStatus}">${escapeHtml(slaView.badgeText)}</span>
              <button type="button" class="btn btn-sm btn-outline sla-inspect-btn">Inspect</button>
            </div>
          `;
          const inspectBtn = row.querySelector('.sla-inspect-btn');
          if (inspectBtn) {
            inspectBtn.addEventListener('click', () => {
              if (analyticsDrawer && analyticsDrawer.open) {
                analyticsDrawer.close('inspect');
              }
              const fullAlert = state.alerts.find(a => a.event_id === item.event_id);
              if (fullAlert) {
                highlightIncidentCard(fullAlert.event_id, true);
                openInspectionModal(fullAlert);
              } else {
                map.setView([item.latitude, item.longitude], 16, { animate: true });
              }
            });
          }
          slaWatchlist.appendChild(row);
        });
      }
    }
  }

  function focusWardFromAnalytics(ward) {
    if (analyticsDrawer && analyticsDrawer.open) {
      analyticsDrawer.close('filter-ward');
    }
    state.activeTab = 'all';
    feedTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'all'));
    state.filterWard = ward.ward_short;
    if (filterWardEl) {
      const hasOption = Array.from(filterWardEl.options).some(opt => opt.value === ward.ward_short);
      filterWardEl.value = hasOption ? ward.ward_short : '';
    }
    applyFilters();

    const wardPoints = state.filteredAlerts.map(a => [a.latitude, a.longitude]);
    if (wardPoints.length > 0) {
      map.fitBounds(L.latLngBounds(wardPoints), { padding: [50, 50], maxZoom: 15, animate: true });
    }
    showToast(`Focused on ${ward.ward_short} (Health: ${ward.health_score}/100)`, 'info');
  }

  async function loadWardAnalytics(showSpinner = false) {
    if (showSpinner && wardLeaderboard) {
      wardLeaderboard.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Calculating ward health metrics...</span>
        </div>
      `;
    }
    try {
      const res = await fetch('/api/analytics/wards');
      if (!res.ok) throw new Error('Failed to load ward analytics');
      const data = await res.json();
      state.wardAnalytics = data;
      renderWardAnalytics(data);
    } catch (e) {
      console.error('Ward analytics error:', e);
      if (wardLeaderboard) {
        wardLeaderboard.innerHTML = `<div class="empty-state">Unable to load ward analytics: ${escapeHtml(e.message)}</div>`;
      }
    }
  }

  function refreshAnalyticsIfOpen() {
    if (analyticsDrawer && analyticsDrawer.open) {
      loadWardAnalytics(false);
    }
  }

  if (btnWardAnalytics && analyticsDrawer) {
    btnWardAnalytics.addEventListener('click', () => {
      if (!analyticsDrawer.open) {
        analyticsDrawer.showModal();
      }
      loadWardAnalytics(true);
    });

    // Clear returnValue on close so stale button values never leak
    analyticsDrawer.addEventListener('close', () => {
      analyticsDrawer.returnValue = '';
    });

    // Fallback for browsers without native <dialog closedby="any"> support (e.g., Safari)
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutsideDialog = (event, dialog) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      analyticsDrawer.addEventListener('pointerdown', (e) => {
        pressedOutside = isOutsideDialog(e, analyticsDrawer);
      });
      analyticsDrawer.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutsideDialog(e, analyticsDrawer)) {
          analyticsDrawer.close();
        }
        pressedOutside = false;
      });
    }
  }

  if (btnRefreshAnalytics) {
    btnRefreshAnalytics.addEventListener('click', () => {
      loadWardAnalytics(true);
      showToast('Refreshed ward road health & SLA metrics', 'info');
    });
  }

  if (btnFilterOverdueFromDrawer) {
    btnFilterOverdueFromDrawer.addEventListener('click', () => {
      if (analyticsDrawer && analyticsDrawer.open) {
        analyticsDrawer.close('filter-overdue');
      }
      state.activeTab = 'overdue';
      feedTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'overdue'));
      applyFilters();
      showToast('Filtered triage feed to SLA-breached incidents', 'warning');
    });
  }

  // Keep live SLA countdown pills refreshed every 60 seconds
  setInterval(() => {
    if (state.alerts.length > 0) {
      renderIncidentList();
    }
    if (analyticsDrawer && analyticsDrawer.open && state.wardAnalytics) {
      renderWardAnalytics(state.wardAnalytics);
    }
  }, 60000);

  // Initial Boot
  loadStats();
  loadAlerts();
  initWebSocket();
});
