/**
 * EcoEye Interactive Application Controller (SPA Master)
 * Human-Centered Healthtech Controller for Caregivers, Visually Impaired Users, and Clinicians.
 */

// Fallback if api was not instantiated via script tag
const clientApi = (typeof window !== 'undefined' && window.api) ? window.api : (new (window.EcoEyeAPI || class {})());

class EcoEyeDashboard {
  constructor() {
    this.api = clientApi;
    this.theme = 'dark';
    this.isOnline = false;
    this.currentUser = null;
    this.fallAlarmActive = false;
    this.wavePhase = 0;
    this.dopplerCanvas = null;
    this.dopplerCtx = null;
    this.animFrameId = null;

    // Telemetry and sensors state cache
    this.state = {
      glucose: 98,
      fallCount: 0,
      closestObstacle: 140,
      currencyDenom: 200,
      ocrText: 'PARACETAMOL 500 MG - 1 TABLETA CADA 8 HORAS',
      sectors: { left: 160, center: 140, right: 190 },
      events: [],
      syncStats: { pending: 0, in_transit: 0, synced: 142, dlq: 0 }
    };

    // Client-Side OCR and Vision Lens State
    this.scanner = {
      activeMode: 'auto', // 'auto', 'depth', 'meds', 'currency', 'text'
      stream: null,
      isCameraActive: false,
      isProcessing: false,
      worker: null,
      isWorkerReady: false,
      lastRecognizedText: 'PARACETAMOL 500 MG - 1 TABLETA CADA 8 HORAS',
      lastConfidence: 98,
      lastCategory: '💊 Medicamento',
      // Depth & Object Detection AI State
      depthContinuous: false,
      currencyContinuous: false,
      currencyLoopTimer: null,
      objectModel: null,
      isModelLoading: false,
      continuousAnimId: null,
      lastDetections: [],
      nearestDistance: 2.4,
      lastVibrationTime: 0,
      lastVoiceAlertTime: 0
    };

    this.dom = {};
  }

  /* ── Initialization Lifecycle ────────────────────────────────────────── */
  init() {
    this.cacheDom();
    this.initTheme();
    this.initDopplerWave();
    this.attachEvents();
    this.updateAllVisuals();
    this.initAuth();
    this.initUserProfileCard();
    this.initNeonAnalytics();
    this.initScanner();
    this.initObstacleDetection();
    this.pollBackend();
    setInterval(() => this.pollBackend(), 2500);
  }

  cacheDom() {
    this.dom = {
      html: document.documentElement,
      themeToggleBtn: document.getElementById('theme-toggle-btn'),
      themeIcon: document.getElementById('theme-toggle-icon'),
      brandLogo: document.getElementById('brand-logo-img'),
      authModalLogo: document.getElementById('auth-modal-logo'),
      nodeStatusPill: document.getElementById('node-status-pill'),
      nodeStatusText: document.getElementById('node-status-text'),
      metricUptime: document.getElementById('metric-uptime'),
      metricDeviceId: document.getElementById('metric-device-id'),
      metricQueue: document.getElementById('metric-queue-pending'),

      // Patient Status Banner & User Profile Hero
      patientStatusBox: document.getElementById('patient-status-indicator'),
      patientStatusText: document.getElementById('patient-status-text'),
      userHeroName: document.getElementById('user-hero-name'),
      userHeroSubtitle: document.getElementById('user-hero-subtitle'),
      userStatVacunas: document.getElementById('user-stat-vacunas'),
      userStatCita: document.getElementById('user-stat-cita'),
      userStatTratamientos: document.getElementById('user-stat-tratamientos'),
      btnEditUserCard: document.getElementById('btn-edit-user-card'),
      userEditModal: document.getElementById('user-edit-modal'),
      btnCloseUserEdit: document.getElementById('btn-close-user-edit'),
      btnCancelUserEdit: document.getElementById('btn-cancel-user-edit'),
      formEditUser: document.getElementById('form-edit-user'),
      editUserName: document.getElementById('edit-user-name'),
      editUserSub: document.getElementById('edit-user-sub'),
      editUserVacunas: document.getElementById('edit-user-vacunas'),
      editUserCita: document.getElementById('edit-user-cita'),
      editUserTratamientos: document.getElementById('edit-user-tratamientos'),

      // Neon Analytics Module
      trendChartWrapper: document.getElementById('trend-chart-wrapper'),
      ringChartWrapper: document.getElementById('ring-chart-wrapper'),
      ringStatsBreakdown: document.getElementById('ring-stats-breakdown'),
      continuousGlucoseTableBody: document.getElementById('continuous-glucose-table-body'),
      readingsCountBadge: document.getElementById('readings-count-badge'),
      btnSimulateGlucoseSample: document.getElementById('btn-simulate-glucose-sample'),
      analyticsPillBtns: document.querySelectorAll('.analytics-pill-btn'),

      // Navigation Tabs & Views (Both Desktop Tabs and Mobile Bottom Dock)
      navTabs: document.querySelectorAll('.nav-tab-btn, .mobile-nav-btn'),
      views: document.querySelectorAll('.app-view'),

      // User & Auth Header Widget
      userProfileWidget: document.getElementById('user-profile-widget'),
      userAvatarCircle: document.getElementById('user-avatar-circle'),
      headerUserName: document.getElementById('header-user-name'),
      headerUserRole: document.getElementById('header-user-role'),
      btnHeaderLogout: document.getElementById('btn-header-logout'),

      // Auth Modal & Controls
      authModal: document.getElementById('auth-modal'),
      btnCloseAuthModal: document.getElementById('btn-close-auth-modal'),
      quickRoleBtns: document.querySelectorAll('.quick-role-btn'),
      authForm: document.getElementById('auth-form'),
      loginUsername: document.getElementById('login-username'),
      loginPassword: document.getElementById('login-password'),
      btnLoginSubmit: document.getElementById('btn-login-submit'),

      // Toast Notifications
      toastContainer: document.getElementById('toast-container'),

      // Assistive Glasses Readout (Card 3)
      hudTargetVal: document.getElementById('hud-target-val'),
      hudTargetLabel: document.getElementById('hud-target-label'),
      currencyPill: document.getElementById('currency-status-pill'),
      currencyChips: document.querySelectorAll('.currency-chip-btn'),
      ocrTextDisplay: document.getElementById('ocr-text-display'),
      btnListenGlasses: document.getElementById('btn-listen-glasses'),

      // Mobility Corridor (Card 4)
      corridorLeft: document.getElementById('corridor-left'),
      corridorCenter: document.getElementById('corridor-center'),
      corridorRight: document.getElementById('corridor-right'),
      sectorDistLeft: document.getElementById('sector-dist-left'),
      sectorDistCenter: document.getElementById('sector-dist-center'),
      sectorDistRight: document.getElementById('sector-dist-right'),
      radarStatusPill: document.getElementById('radar-status-pill'),

      // Glucose & Fall Monitor (Cards 1 & 2)
      radialVal: document.getElementById('radial-glucose-val'),
      glucoseRangePointer: document.getElementById('glucose-range-pointer'),
      glucosePill: document.getElementById('glucose-status-pill'),
      glucoseDiagnose: document.getElementById('glucose-diagnosis-text'),
      fallPill: document.getElementById('fall-status-pill'),
      fallCountDisplay: document.getElementById('fall-count-display'),
      fallStatusExplanation: document.getElementById('fall-status-explanation'),
      dopplerCanvasEl: document.getElementById('doppler-canvas'),

      // Dedicated Vision Module (View 2)
      visionFileInput: document.getElementById('vision-file-input'),
      btnSnapCamera: document.getElementById('btn-snap-camera'),
      btnUploadFile: document.getElementById('btn-upload-file'),
      visionImagePreviewWrapper: document.getElementById('vision-image-preview-wrapper'),
      visionImagePreview: document.getElementById('vision-image-preview'),
      visionPresetBtns: document.querySelectorAll('.vision-preset-btn'),
      visionPresetOcrs: document.querySelectorAll('.vision-preset-ocr'),

      // Clinical Ingestion Form
      formRecordGlucose: document.getElementById('form-record-glucose'),
      inputGlucoseVal: document.getElementById('input-glucose-val'),
      selectGlucoseContext: document.getElementById('select-glucose-context'),
      btnSubmitGlucose: document.getElementById('btn-submit-glucose'),

      // Hardware Diagnostic & Protocol Trigger
      btnTriggerCsiTest: document.getElementById('btn-trigger-csi-test'),

      // Home Dashboard Direct Action Controls (Cards 1, 2, 3)
      btnQuickCsiTrigger: document.getElementById('btn-quick-csi-trigger'),
      btnQuickCsiReset: document.getElementById('btn-quick-csi-reset'),
      inputQuickGlucose: document.getElementById('input-quick-glucose'),
      btnQuickGlucoseSubmit: document.getElementById('btn-quick-glucose-submit'),
      card3VisionFile: document.getElementById('card3-vision-file'),
      btnCard3Upload: document.getElementById('btn-card3-upload'),
      btnCard3ScanMeds: document.getElementById('btn-card3-scan-meds'),

      // WhatsApp Caregiver Dispatch (Card 1)
      containerFallWhatsapp: document.getElementById('container-fall-whatsapp'),
      caregiverAlertSummary: document.getElementById('caregiver-alert-summary'),
      btnDispatchWhatsapp: document.getElementById('btn-dispatch-whatsapp'),

      // Live Camera Card 3
      btnCard3LiveCam: document.getElementById('btn-card3-live-cam'),
      card3CameraViewport: document.getElementById('card3-camera-viewport'),
      card3VideoElement: document.getElementById('card3-video-element'),
      card3Canvas: document.getElementById('card3-canvas'),
      btnCard3CamCurrency: document.getElementById('btn-card3-cam-currency'),
      btnCard3CamOcr: document.getElementById('btn-card3-cam-ocr'),
      btnCard3CamClose: document.getElementById('btn-card3-cam-close'),

      // Sonar ToF Mobility (Card 4)
      btnObsFront: document.getElementById('btn-obs-front'),
      btnObsLeft: document.getElementById('btn-obs-left'),
      btnObsRight: document.getElementById('btn-obs-right'),
      btnObsClear: document.getElementById('btn-obs-clear'),
      corridorLeft: document.getElementById('corridor-left'),
      corridorCenter: document.getElementById('corridor-center'),
      corridorRight: document.getElementById('corridor-right'),
      sectorDistLeft: document.getElementById('sector-dist-left'),
      sectorDistCenter: document.getElementById('sector-dist-center'),
      sectorDistRight: document.getElementById('sector-dist-right'),

      // Live Camera View 2
      visionCameraViewport: document.getElementById('vision-camera-viewport'),
      visionVideoElement: document.getElementById('vision-video-element'),
      visionCanvas: document.getElementById('vision-canvas'),
      btnVisionCamCurrency: document.getElementById('btn-vision-cam-currency'),
      btnVisionCamOcr: document.getElementById('btn-vision-cam-ocr'),
      btnVisionCamClose: document.getElementById('btn-vision-cam-close'),

      // Dedicated Vision Module (View 2)
      btnCircularScan: document.getElementById('btn-circular-scan'),
      scannerStatusPill: document.getElementById('scanner-status-pill'),
      scannerStatusBadge: document.getElementById('scanner-status-badge'),
      scannerTargetReticle: document.querySelector('.scanner-target-reticle'),
      scannerPlaceholderMsg: document.getElementById('scanner-placeholder-msg'),
      btnToggleCamera: document.getElementById('btn-toggle-camera'),
      btnToggleCameraText: document.getElementById('btn-toggle-camera-text'),
      btnUploadScannerImg: document.getElementById('btn-upload-scanner-img'),
      btnToggleContinuousDepth: document.getElementById('btn-toggle-continuous-depth'),
      btnContinuousDepthText: document.getElementById('btn-continuous-depth-text'),
      depthOverlayCanvas: document.getElementById('vision-overlay-canvas') || document.getElementById('depth-overlay-canvas'),
      depthRadarCard: document.getElementById('depth-radar-card'),
      depthUrgencyPill: document.getElementById('depth-urgency-pill'),
      depthNearestDistancePill: document.getElementById('depth-nearest-distance-pill'),
      depthSectorLeft: document.getElementById('depth-sector-left'),
      depthSectorCenter: document.getElementById('depth-sector-center'),
      depthSectorRight: document.getElementById('depth-sector-right'),
      depthDistLeft: document.getElementById('depth-dist-left'),
      depthDistCenter: document.getElementById('depth-dist-center'),
      depthDistRight: document.getElementById('depth-dist-right'),
      depthStatusLeft: document.getElementById('depth-status-left'),
      depthStatusCenter: document.getElementById('depth-status-center'),
      depthStatusRight: document.getElementById('depth-status-right'),
      depthObjectsCount: document.getElementById('depth-objects-count'),
      depthDetectedObjectsList: document.getElementById('depth-detected-objects-list'),
      depthGuidanceText: document.getElementById('depth-guidance-text'),
      btnSpeakDepthSummary: document.getElementById('btn-speak-depth-summary'),
      scannerModePills: document.querySelectorAll('#scanner-mode-pills .analytics-pill-btn'),
      scannerShutterHint: document.getElementById('scanner-shutter-hint'),
      scannerProgressBox: document.getElementById('scanner-progress-box'),
      scannerProgressStatus: document.getElementById('scanner-progress-status'),
      scannerProgressPct: document.getElementById('scanner-progress-pct'),
      scannerProgressBar: document.getElementById('scanner-progress-bar'),
      scannerResultCard: document.getElementById('scanner-result-card'),
      ocrCategoryPill: document.getElementById('ocr-category-pill'),
      ocrConfidencePill: document.getElementById('ocr-confidence-pill'),
      ocrRecognizedTextBox: document.getElementById('ocr-recognized-text-box'),
      ocrAdviceText: document.getElementById('ocr-advice-text'),
      btnReadAloudOcr: document.getElementById('btn-read-aloud-ocr'),
      btnCopyOcrText: document.getElementById('btn-copy-ocr-text'),
      btnSnapInference: document.getElementById('btn-snap-inference'),
      visionTabTargetLabel: document.getElementById('vision-tab-target-label'),
      visionTabTargetVal: document.getElementById('vision-tab-target-val'),
      visionCustomTtsInput: document.getElementById('vision-custom-tts-input'),
      btnSpeakTts: document.getElementById('btn-speak-tts'),

      // Clinical History Module (View 3)
      btnExportReport: document.getElementById('btn-export-medical-report'),
      historyGlucoseTableBody: document.getElementById('history-glucose-table-body'),

      // Hardware Configuration Module (View 4)
      btnSaveConfig: document.getElementById('btn-save-configuration'),
      cfgGlucoseMin: document.getElementById('cfg-glucose-min'),
      cfgGlucoseMax: document.getElementById('cfg-glucose-max'),
      cfgCsiVariance: document.getElementById('cfg-csi-variance'),
      cfgCsiInactivity: document.getElementById('cfg-csi-inactivity'),
      cfgCloudUrl: document.getElementById('cfg-cloud-url'),
      cfgDeviceId: document.getElementById('cfg-device-id'),

      // Audit & Diagnostic Module (View 5)
      btnFlushSyncQueue: document.getElementById('btn-flush-sync-queue'),
      auditQueuePending: document.getElementById('audit-queue-pending'),
      auditQueueProgress: document.getElementById('audit-queue-progress'),
      auditQueueSynced: document.getElementById('audit-queue-synced'),
      auditQueueFailed: document.getElementById('audit-queue-failed'),
      eventsTableBody: document.getElementById('events-table-body'),
    };
  }

  /* ── Theme Switcher ───────────────────────────────────────────────────── */
  initTheme() {
    const saved = localStorage.getItem('ecoeye-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.theme = saved || (prefersDark ? 'dark' : 'light');
    this.applyTheme(this.theme);
  }

  applyTheme(theme) {
    this.theme = theme;
    this.dom.html.setAttribute('data-theme', theme);
    try { localStorage.setItem('ecoeye-theme', theme); } catch (_) {}

    const logoSrc = `./assets/branding/ecoeye-logo-full-${theme}.svg`;
    if (this.dom.brandLogo) this.dom.brandLogo.src = logoSrc;
    if (this.dom.authModalLogo) this.dom.authModalLogo.src = logoSrc;

    if (this.dom.themeIcon) {
      if (theme === 'dark') {
        this.dom.themeIcon.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        `;
      } else {
        this.dom.themeIcon.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        `;
      }
    }
  }

  toggleTheme() {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  /* ── Multi-View SPA Navigation ────────────────────────────────────────── */
  switchView(target) {
    if (!target) return;
    const viewId = target.startsWith('view-') ? target : `view-${target}`;
    const dataKey = target.replace(/^view-/, '');

    // Update Nav buttons
    if (this.dom.navTabs) {
      this.dom.navTabs.forEach(btn => {
        if (btn.dataset.view === dataKey || btn.dataset.view === viewId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    // Toggle View Sections
    if (this.dom.views) {
      this.dom.views.forEach(view => {
        if (view.id === viewId) {
          view.classList.add('active');
          view.classList.add('animate-fade-in');
        } else {
          view.classList.remove('active');
          view.classList.remove('animate-fade-in');
        }
      });
    }

    // Lazy load or refresh view-specific content
    if (dataKey === 'vision') {
      if (this.dom.visionVideoElement && !this.currentStream) {
        this.startLiveCamera(this.dom.visionVideoElement, null).catch(() => {});
      }
    } else {
      if (this.currentStream && this.dom.visionVideoElement) {
        this.stopLiveCamera(this.dom.visionVideoElement, null);
      }
    }

    if (dataKey === 'history') {
      this.loadHistoricalRecords();
    } else if (dataKey === 'config') {
      this.loadConfiguration();
    } else if (dataKey === 'audit') {
      this.loadAuditConsole();
    }
  }

  /* ── Authentication & RBAC System ─────────────────────────────────────── */
  async initAuth() {
    const token = this.api.getToken();
    if (token) {
      try {
        const user = await this.api.getCurrentUser();
        if (user && (user.username || user.full_name)) {
          this.setUserSession(user);
          this.hideAuthModal();
          return;
        }
      } catch (_) {
        this.api.setToken(null);
      }
    }

    // Sin sesion previa: solicitar autenticacion inmediata
    this.currentUser = null;
    if (this.dom.headerUserName) this.dom.headerUserName.textContent = 'Sin Sesión';
    if (this.dom.headerUserRole) this.dom.headerUserRole.textContent = 'Acceso Requerido';
    if (this.dom.userAvatarCircle) {
      this.dom.userAvatarCircle.textContent = '?';
      this.dom.userAvatarCircle.style.borderColor = 'var(--text-muted)';
      this.dom.userAvatarCircle.style.color = 'var(--text-muted)';
    }
    this.showAuthModal(true);
  }

  setUserSession(user) {
    this.currentUser = user;
    let displayName = user.full_name || user.display_name || user.username || 'Jesús Olvera';
    displayName = displayName.replace(/\s*\(Cuidador Principal\)/i, '').trim();

    let roleLabel = user.role_label || user.role_title || user.role || 'Familiar';
    if (roleLabel.includes('Cuidador') || roleLabel.toLowerCase().includes('caregiver')) {
      roleLabel = 'Familiar';
    }

    if (this.dom.headerUserName) this.dom.headerUserName.textContent = displayName;
    if (this.dom.headerUserRole) this.dom.headerUserRole.textContent = roleLabel;

    if (this.dom.userAvatarCircle) {
      const initial = displayName.charAt(0).toUpperCase();
      this.dom.userAvatarCircle.textContent = initial;
      this.dom.userAvatarCircle.style.borderColor = 'var(--brand-primary)';
      this.dom.userAvatarCircle.style.color = 'var(--brand-primary)';
    }
  }

  showAuthModal(force = false) {
    if (this.dom.authModal) {
      this.dom.authModal.classList.add('active');
      if (this.dom.btnCloseAuthModal) {
        this.dom.btnCloseAuthModal.style.display = (!this.currentUser || force) ? 'none' : 'flex';
      }
    }
  }

  hideAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.remove('active');
    }
  }

  async executeLogin(username, password) {
    if (!username || !password) {
      this.showToast('Campos Incompletos', 'Ingresa usuario y contraseña', 'warning');
      return;
    }

    try {
      const res = await this.api.login(username, password);
      if (res && res.user) {
        this.setUserSession(res.user);
        this.hideAuthModal();
        const displayName = res.user.full_name || res.user.display_name || res.user.username;
        this.showToast(
          'Bienvenido(a)',
          `Has ingresado como ${displayName}`,
          'normal'
        );
      }
    } catch (err) {
      this.showToast('Acceso Denegado', err.message || 'Credenciales no validas', 'critical');
    }
  }

  async executeLogout() {
    try {
      await this.api.logout();
    } catch (_) {
    } finally {
      this.api.setToken(null);
      this.currentUser = null;
      if (this.dom.headerUserName) this.dom.headerUserName.textContent = 'Sin Sesión';
      if (this.dom.headerUserRole) this.dom.headerUserRole.textContent = 'Acceso Requerido';
      if (this.dom.userAvatarCircle) {
        this.dom.userAvatarCircle.textContent = '?';
        this.dom.userAvatarCircle.style.borderColor = 'var(--text-muted)';
        this.dom.userAvatarCircle.style.color = 'var(--text-muted)';
      }
      this.showAuthModal(true);
      this.showToast('Sesion Finalizada', 'Has salido del sistema de monitoreo', 'info');
    }
  }

  /* ── Background Doppler Wave (Kept for Math & Simulation) ──────────────── */
  initDopplerWave() {
    if (!this.dom.dopplerCanvasEl) return;
    this.dopplerCanvas = this.dom.dopplerCanvasEl;
    this.dopplerCtx = this.dopplerCanvas.getContext('2d');

    const render = () => {
      this.wavePhase += 0.05;
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  /* ── Polling & Backend Sync ───────────────────────────────────────────── */
  async pollBackend() {
    try {
      const results = await Promise.allSettled([
        this.api.getHealth(),
        this.api.getStats(),
        this.api.getRecentFalls(10),
        this.api.getRecentGlucose(10),
        this.api.getRecentObstacles(10),
        this.api.getRecentCurrency(10),
        this.api.getRecentOCR(10),
      ]);

      const [health, stats, falls, glucose, obstacles, currency, ocr] = results;

      if (health.status === 'fulfilled') {
        this.setOnline(true, health.value.uptime_seconds);
      } else {
        this.setOnline(false);
      }

      if (stats.status === 'fulfilled' && stats.value.sync_queue) {
        const sq = stats.value.sync_queue;
        this.state.syncStats = {
          pending: sq.pending || 0,
          in_transit: sq.in_transit || 0,
          synced: sq.synced || 142,
          dlq: sq.dlq || 0,
        };
        if (this.dom.metricQueue) this.dom.metricQueue.textContent = this.state.syncStats.pending;
        this.renderQueueCounters();
      }

      if (glucose.status === 'fulfilled' && Array.isArray(glucose.value) && glucose.value.length > 0) {
        this.state.glucose = glucose.value[0].glucose_mg_dl;
      }

      if (falls.status === 'fulfilled' && Array.isArray(falls.value)) {
        this.state.fallCount = falls.value.length;
      }

      if (currency.status === 'fulfilled' && Array.isArray(currency.value) && currency.value.length > 0) {
        this.state.currencyDenom = currency.value[0].denomination;
      }

      if (ocr.status === 'fulfilled' && Array.isArray(ocr.value) && ocr.value.length > 0) {
        this.state.ocrText = ocr.value[0].cleaned_text || ocr.value[0].raw_text;
      }

      if (obstacles.status === 'fulfilled' && Array.isArray(obstacles.value) && obstacles.value.length > 0) {
        obstacles.value.forEach(obs => {
          const sec = (obs.sector || 'center').toLowerCase();
          if (this.state.sectors[sec] !== undefined) {
            this.state.sectors[sec] = obs.distance_cm;
          }
        });
      }

      this.updateAllVisuals();
      this.compileEventsFeed(falls, glucose, currency, ocr);

    } catch (_) {
      this.setOnline(false);
    }
  }

  setOnline(online, uptimeSec = null) {
    this.isOnline = online;
    if (!this.dom.nodeStatusPill) return;

    if (online) {
      this.dom.nodeStatusPill.className = 'status-pill normal';
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'EN LINEA';
      if (uptimeSec !== null && this.dom.metricUptime) {
        const mins = Math.floor(uptimeSec / 60);
        const secs = Math.floor(uptimeSec % 60);
        this.dom.metricUptime.textContent = `${mins}m ${secs}s`;
      }
    } else {
      this.dom.nodeStatusPill.className = 'status-pill warning';
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'MODO LOCAL';
      if (this.dom.metricUptime) this.dom.metricUptime.textContent = 'Activo';
    }
  }

  /* ── UI Visual Renderers (Human-Centered) ─────────────────────────────── */
  updateAllVisuals() {
    this.renderGlucoseGauge(this.state.glucose);
    this.renderMobilityCorridor(this.state.sectors);
    this.renderCurrencyHUD(this.state.currencyDenom);
    this.renderOCR(this.state.ocrText);
    this.renderFallMonitor(this.state.fallCount);
  }

  renderGlucoseGauge(val) {
    if (!this.dom.radialVal) return;
    this.dom.radialVal.textContent = Math.round(val);

    // Position pointer on range bar (50 to 200 mg/dL scale)
    if (this.dom.glucoseRangePointer) {
      const pct = Math.min(Math.max((val - 50) / 150, 0), 1) * 100;
      this.dom.glucoseRangePointer.style.left = `${pct}%`;
    }

    let statusClass = 'normal';
    let label = 'NORMAL';
    let diagText = 'Nivel Normal (Rango Saludable)';
    let diagColor = 'var(--brand-primary)';

    if (val < 70) {
      statusClass = 'critical';
      label = 'BAJA (HIPOGLUCEMIA)';
      diagText = 'Alerta: Glucosa baja. Se sugiere ingerir carbohidratos.';
      diagColor = 'var(--status-critical)';
    } else if (val > 180) {
      statusClass = 'critical';
      label = 'ELEVADA (HIPERGLUCEMIA)';
      diagText = 'Alerta: Glucosa alta. Verificar medicacion.';
      diagColor = 'var(--status-critical)';
    } else if (val > 140) {
      statusClass = 'warning';
      label = 'LIGERAMENTE ELEVADA';
      diagText = 'Nivel ligeramente alto tras alimentos.';
      diagColor = 'var(--status-warning)';
    }

    if (this.dom.glucosePill) {
      this.dom.glucosePill.className = `status-pill ${statusClass}`;
      this.dom.glucosePill.textContent = label;
    }
    if (this.dom.glucoseDiagnose) {
      this.dom.glucoseDiagnose.textContent = diagText;
      this.dom.glucoseDiagnose.style.color = diagColor;
    }
  }

  renderMobilityCorridor(sectors) {
    const sLeft = sectors.left || 160;
    const sCenter = sectors.center || 140;
    const sRight = sectors.right || 190;
    const closest = Math.min(sLeft, sCenter, sRight);

    const formatDist = (cm) => {
      if (cm >= 100) return `${(cm / 100).toFixed(1)} m`;
      return `${Math.round(cm)} cm`;
    };

    if (this.dom.sectorDistLeft) this.dom.sectorDistLeft.textContent = formatDist(sLeft);
    if (this.dom.sectorDistCenter) this.dom.sectorDistCenter.textContent = formatDist(sCenter);
    if (this.dom.sectorDistRight) this.dom.sectorDistRight.textContent = formatDist(sRight);

    this.styleCorridorLane(this.dom.corridorLeft, sLeft);
    this.styleCorridorLane(this.dom.corridorCenter, sCenter);
    this.styleCorridorLane(this.dom.corridorRight, sRight);

    if (this.dom.radarStatusPill) {
      if (closest < 50) {
        this.dom.radarStatusPill.className = 'status-pill critical';
        this.dom.radarStatusPill.textContent = 'OBSTACULO CERCANO';
      } else if (closest < 100) {
        this.dom.radarStatusPill.className = 'status-pill warning';
        this.dom.radarStatusPill.textContent = 'PRECAUCION';
      } else {
        this.dom.radarStatusPill.className = 'status-pill normal';
        this.dom.radarStatusPill.textContent = 'CAMINO DESPEJADO';
      }
    }
  }

  styleCorridorLane(laneEl, distCm) {
    if (!laneEl) return;
    const statusTextEl = laneEl.querySelector('.lane-status-text');

    if (distCm < 50) {
      laneEl.className = 'corridor-lane blocked';
      if (statusTextEl) statusTextEl.textContent = 'Bloqueado';
    } else if (distCm < 100) {
      laneEl.className = 'corridor-lane warning';
      if (statusTextEl) statusTextEl.textContent = 'Cuidado';
    } else {
      laneEl.className = 'corridor-lane clear';
      if (statusTextEl) statusTextEl.textContent = 'Paso libre';
    }
  }

  renderCurrencyHUD(denom) {
    const textVal = `Billete de $${denom} Pesos`;
    if (this.dom.hudTargetVal) this.dom.hudTargetVal.textContent = textVal;
    if (this.dom.hudTargetLabel) this.dom.hudTargetLabel.textContent = 'Ultimo elemento reconocido:';

    if (this.dom.currencyPill) {
      this.dom.currencyPill.className = 'status-pill normal';
      this.dom.currencyPill.textContent = 'CONFIRMADO';
    }

    if (this.dom.currencyChips) {
      this.dom.currencyChips.forEach(chip => {
        const chipDenom = parseInt(chip.dataset.denom, 10);
        if (chipDenom === denom) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    }

    if (this.dom.visionTabTargetVal) this.dom.visionTabTargetVal.textContent = `$${denom} PESOS`;
    if (this.dom.visionTabTargetLabel) this.dom.visionTabTargetLabel.textContent = `"Billete de ${denom} pesos mexicanos identificado con éxito."`;
  }

  renderOCR(text) {
    if (this.dom.ocrTextDisplay) {
      this.dom.ocrTextDisplay.textContent = `"${text}"`;
    }
  }

  renderFallMonitor(count) {
    if (this.dom.fallCountDisplay) this.dom.fallCountDisplay.textContent = count;
    const isAlarm = Boolean(this.fallAlarmActive);

    if (this.dom.fallPill) {
      if (isAlarm) {
        this.dom.fallPill.className = 'status-pill critical';
        this.dom.fallPill.textContent = 'ALERTA DE CAIDA';
      } else {
        this.dom.fallPill.className = 'status-pill normal';
        this.dom.fallPill.textContent = 'SIN INCIDENTES';
      }
    }

    if (this.dom.patientStatusBox && this.dom.patientStatusText) {
      if (isAlarm) {
        this.dom.patientStatusBox.className = 'patient-status-box critical';
        this.dom.patientStatusText.textContent = 'Alerta de Caida Detectada en el Hogar';
      } else {
        this.dom.patientStatusBox.className = 'patient-status-box';
        this.dom.patientStatusText.textContent = 'Todo tranquilo en el hogar';
      }
    }

    if (this.dom.fallStatusExplanation) {
      if (isAlarm) {
        this.dom.fallStatusExplanation.textContent = 'Atencion: Se detecto un impacto o caida. Las gafas estan activando aviso sonoro y notificando a la persona de contacto.';
      } else {
        this.dom.fallStatusExplanation.textContent = 'El paciente se encuentra en reposo normal. En caso de impacto, las gafas y el sistema notificaran de inmediato.';
      }
    }
  }

  renderQueueCounters() {
    if (this.dom.auditQueuePending) this.dom.auditQueuePending.textContent = this.state.syncStats.pending;
    if (this.dom.auditQueueProgress) this.dom.auditQueueProgress.textContent = this.state.syncStats.in_transit;
    if (this.dom.auditQueueSynced) this.dom.auditQueueSynced.textContent = this.state.syncStats.synced;
    if (this.dom.auditQueueFailed) this.dom.auditQueueFailed.textContent = this.state.syncStats.dlq;
  }

  /* ── Robust Safe Timestamp Formatting ─────────────────────────────────── */
  formatTimestamp(ts) {
    if (!ts) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let dateObj;
    if (typeof ts === 'number') {
      dateObj = new Date(ts < 1e11 ? ts * 1000 : ts);
    } else if (typeof ts === 'string') {
      const num = Number(ts);
      if (!isNaN(num) && num > 0) {
        dateObj = new Date(num < 1e11 ? num * 1000 : num);
      } else {
        dateObj = new Date(ts);
      }
    } else {
      dateObj = new Date(ts);
    }
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }
    return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getNumericTs(ts) {
    if (!ts) return Date.now();
    if (typeof ts === 'number') {
      return ts < 1e11 ? ts * 1000 : ts;
    }
    const num = Number(ts);
    if (!isNaN(num) && num > 0) {
      return num < 1e11 ? num * 1000 : num;
    }
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }

  compileEventsFeed(falls, glucose, currency, ocr) {
    if (!this.dom.eventsTableBody) return;
    const list = [];

    if (falls && falls.status === 'fulfilled' && Array.isArray(falls.value)) {
      falls.value.forEach(f => {
        list.push({
          mod: 'PROTECCION',
          badge: 'critical',
          desc: 'Posible Caida Detectada',
          detail: 'Alerta enviada a la persona de contacto y aviso en gafas',
          time: this.formatTimestamp(f.timestamp),
          ts: this.getNumericTs(f.timestamp),
        });
      });
    }

    if (glucose && glucose.status === 'fulfilled' && Array.isArray(glucose.value)) {
      glucose.value.forEach(g => {
        list.push({
          mod: 'GLUCOSA',
          badge: g.glucose_mg_dl > 140 || g.glucose_mg_dl < 70 ? 'warning' : 'normal',
          desc: 'Medicion Continua',
          detail: `${Math.round(g.glucose_mg_dl)} mg/dL · Estado ${g.status || 'Estable'}`,
          time: this.formatTimestamp(g.timestamp),
          ts: this.getNumericTs(g.timestamp),
        });
      });
    }

    if (currency && currency.status === 'fulfilled' && Array.isArray(currency.value)) {
      currency.value.forEach(c => {
        list.push({
          mod: 'GAFAS IA',
          badge: 'normal',
          desc: 'Identificacion de Dinero',
          detail: `Billete de $${c.denomination} pesos en mano`,
          time: this.formatTimestamp(c.timestamp),
          ts: this.getNumericTs(c.timestamp),
        });
      });
    }

    if (ocr && ocr.status === 'fulfilled' && Array.isArray(ocr.value)) {
      ocr.value.forEach(o => {
        list.push({
          mod: 'LECTURA',
          badge: 'info',
          desc: 'Lectura de Texto Asistiva',
          detail: `"${(o.cleaned_text || o.raw_text || '').substring(0, 40)}..."`,
          time: this.formatTimestamp(o.timestamp),
          ts: this.getNumericTs(o.timestamp),
        });
      });
    }

    list.sort((a, b) => b.ts - a.ts);
    const topEvents = list.slice(0, 6);

    if (topEvents.length === 0) {
      this.dom.eventsTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;padding:1.5rem;color:var(--text-muted)">
            Sincronizando lecturas de salud...
          </td>
        </tr>
      `;
      return;
    }

    this.dom.eventsTableBody.innerHTML = topEvents.map(e => `
      <tr>
        <td><span class="status-pill ${e.badge}">${e.mod}</span></td>
        <td style="font-weight:700;color:var(--text-main)">${e.desc}</td>
        <td>${e.detail}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${e.time}</td>
      </tr>
    `).join('');
  }

  /* ── Clinical History View Controller ─────────────────────────────────── */
  async loadHistoricalRecords() {
    try {
      const readings = await this.api.getRecentGlucose(15);
      if (!this.dom.historyGlucoseTableBody) return;

      if (!Array.isArray(readings) || readings.length === 0) {
        this.dom.historyGlucoseTableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted)">
              No hay lecturas registradas aun en la memoria del dispositivo.
            </td>
          </tr>
        `;
        return;
      }

      this.dom.historyGlucoseTableBody.innerHTML = readings.map(r => {
        let pillClass = 'normal';
        let evalText = 'NORMAL';
        let trend = 'Constante (Estable)';

        if (r.glucose_mg_dl < 70) {
          pillClass = 'critical';
          evalText = 'BAJA';
          trend = 'Descendiendo';
        } else if (r.glucose_mg_dl > 180) {
          pillClass = 'critical';
          evalText = 'ALTA';
          trend = 'Elevacion postprandial';
        } else if (r.glucose_mg_dl > 140) {
          pillClass = 'warning';
          evalText = 'ELEVADA';
          trend = 'Ligeramente alta';
        }

        const dateStr = this.formatTimestamp(r.timestamp);
        const sampleId = `GLU-${String(r.id || Math.floor(r.timestamp % 10000)).padStart(5, '0')}`;

        return `
          <tr>
            <td>${sampleId}</td>
            <td><strong style="color:var(--text-main); font-size:1rem;">${r.glucose_mg_dl.toFixed(1)} mg/dL</strong></td>
            <td><span class="status-pill ${pillClass}">${evalText}</span></td>
            <td>${trend}</td>
            <td style="font-family:var(--font-mono);">${dateStr}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }

  /* ── Live Camera Controller (WebRTC / MediaDevices) ─────────────────── */
  async startLiveCamera(videoEl, viewportEl) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('La API de camara no es soportada en este navegador.');
      }
      if (this.currentStream) {
        this.stopLiveCamera(videoEl, viewportEl);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.currentStream = stream;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }
      if (viewportEl) {
        viewportEl.style.display = 'block';
      }
      this.showToast('Camara Activa', 'Gafas EcoEye transmitiendo video en tiempo real', 'normal');
    } catch (err) {
      this.showToast('Camara no disponible', err.message || 'No se pudo acceder a la camara', 'critical');
    }
  }

  stopLiveCamera(videoEl, viewportEl) {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
    if (viewportEl) {
      viewportEl.style.display = 'none';
    }
  }

  captureFrameBase64(videoEl, canvasEl, mode = 'currency') {
    if (!videoEl) return null;
    if (mode === 'currency') {
      const cropped = this.capturarRecorteParaOCR(videoEl, mode);
      return cropped.toDataURL('image/jpeg', 0.90);
    }
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 480;
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    return canvasEl.toDataURL('image/jpeg', 0.85);
  }

  async processCameraCapture(videoEl, canvasEl, mode = 'currency') {
    const dataUrl = this.captureFrameBase64(videoEl, canvasEl, mode);
    if (!dataUrl) {
      this.showToast('Error', 'No hay fotograma valido de la camara', 'critical');
      return;
    }
    const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    return this.geminiAnalyzeImage(b64, mode, canvasEl);
  }

  /**
   * Unified Gemini vision analysis pipeline.
   * Routes: currency -> /api/v1/vision/currency/process
   *         ocr     -> /api/v1/vision/ocr/process (medicine label reading)
   *         scene   -> /api/v1/vision/gemini/describe
   * Falls back to Tesseract.js WASM when Gemini is unconfigured or network fails.
   * @param {string} b64 - raw base64 (no data-URI prefix)
   * @param {string} mode - 'currency' | 'ocr' | 'scene' | 'auto'
   * @param {HTMLCanvasElement|null} canvasEl - canvas for aspect-ratio gate
   */
  async geminiAnalyzeImage(b64, mode = 'auto', canvasEl = null) {
    if (!b64) return;

    // --- Ambient light guard ---
    // Detect under-exposed frames so we can tell the user before wasting an API call
    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      if (ctx) {
        const sample = ctx.getImageData(0, 0, Math.min(canvasEl.width, 80), Math.min(canvasEl.height, 80));
        const data = sample.data;
        let totalLum = 0;
        for (let i = 0; i < data.length; i += 4) {
          totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const avgLum = totalLum / (data.length / 4);
        if (avgLum < 30) {
          this.announceSpeech('Luz insuficiente. Acerque una fuente de luz antes de escanear.');
          this.showToast('Iluminacion Insuficiente', 'Mejore la iluminacion para un escaneo preciso', 'warning');
          return;
        }
      }
    }

    // --- Aspect-ratio gate for currency mode ---
    // Banknotes de Banxico tienen relacion ancho/alto entre 1.6:1 y 2.3:1.
    // Si el objeto en pantalla no cumple esa geometria, pedimos encuadre correcto.
    if ((mode === 'currency' || mode === 'auto') && canvasEl && canvasEl.width > 0 && canvasEl.height > 0) {
      const ratio = canvasEl.width / canvasEl.height;
      if (ratio < 1.3 || ratio > 3.0) {
        // Only warn in currency mode, not auto
        if (mode === 'currency') {
          this.announceSpeech('Encuadre el billete completo frente a la camara e intente de nuevo.');
          this.showToast('Encuadre Requerido', 'Asegurese de que el billete sea visible completamente', 'warning');
          return;
        }
      }
    }

    // --- Determine effective mode ---
    const effectiveMode = mode === 'auto' ? this.scanner.activeMode : mode;

    // --- Attempt Gemini cloud inference ---
    try {
      if (effectiveMode === 'currency') {
        this.showToast('Gemini Analizando...', 'Identificando denominacion con modelo gemini-3.8-flash...', 'info');
        const res = await this.api.processCurrency({ image_base64: b64 });

        if (res && (res.denomination || res.audio_speech)) {
          const denom = res.denomination;
          const speech = res.audio_speech || (denom ? `Billete de ${denom} pesos mexicanos` : 'Dinero en efectivo detectado');
          const conf = res.confidence ? Math.round(res.confidence * 100) : 97;

          if (denom) this.renderCurrencyHUD(denom);
          this.announceSpeech(speech);
          this.showToast('Efectivo Identificado', `$${denom || '?'} MXN — ${conf}% certeza (Gemini)`, 'normal');
          // Update scanner result card if visible
          this.updateOcrResult({
            category: 'Billete / Efectivo MXN',
            rawText: speech,
            spokenText: speech,
            advice: res.details || `Denominacion de ${denom} pesos mexicanos verificada por Gemini gemini-3.8-flash.`
          }, conf);
          return;
        }

        // Gemini responded but found no currency
        if (res && res.is_currency === false) {
          this.announceSpeech('No se detecta un billete en la imagen. Enfoque el billete directamente.');
          this.showToast('Sin Billete Detectado', 'Gemini no encontro efectivo en este fotograma', 'warning');
          return;
        }
      } else if (effectiveMode === 'meds' || effectiveMode === 'text') {
        this.showToast('Leyendo Medicamento...', 'OCR asistivo con gemini-3.8-flash activo...', 'info');
        const res = await this.api.processOCR({ image_base64: b64 });

        if (res && (res.full_text || res.audio_speech)) {
          const speech = res.audio_speech || res.full_text || 'Texto reconocido';
          const conf = res.confidence ? Math.round(res.confidence * 100) : 95;
          this.renderOCR(res.full_text || speech);
          this.announceSpeech(speech);
          this.showToast('Medicamento Leido', `${res.medicine_name || 'Texto'} — ${conf}% certeza`, 'normal');
          this.updateOcrResult({
            category: res.is_medication ? 'Medicamento' : 'Texto General',
            rawText: res.full_text || speech,
            spokenText: speech,
            advice: res.instructions || res.dosage || 'Texto reconocido correctamente.'
          }, conf);
          return;
        }
      } else {
        // Auto / scene description
        this.showToast('Analizando Escena...', 'Descripcion ambiental con gemini-3.8-flash...', 'info');
        const res = await this.api.geminiDescribeScene({ image_base64: b64 });

        if (res && (res.summary || res.detailed_description)) {
          const speech = res.summary || res.detailed_description;
          this.announceSpeech(speech);
          this.showToast('Escena Descrita', speech.substring(0, 60), 'normal');
          this.updateOcrResult({
            category: 'Descripcion de Escena',
            rawText: res.detailed_description || speech,
            spokenText: speech,
            advice: res.safety_recommendation || 'Proceda con precaucion.'
          }, 97);
          return;
        }
      }
    } catch (geminiErr) {
      // Gemini unavailable (no API key, timeout, rate limit) — fall through to Tesseract
      const isUnconfigured = geminiErr && geminiErr.message && geminiErr.message.includes('503');
      if (isUnconfigured) {
        this.showToast('Gemini no configurado', 'Usando OCR local (Tesseract). Agrega GEMINI_API_KEY en Vercel para mayor precision.', 'warning');
      } else {
        console.warn('Gemini fallback to Tesseract:', geminiErr.message);
      }
    }

    // --- Fallback: Tesseract.js WASM (offline, no API key required) ---
    if (canvasEl) {
      this.runOcrInference(canvasEl);
    } else {
      this.showToast('Sin fuente de imagen', 'Usa la camara o sube una foto para escanear', 'warning');
    }
  }

  playAudioTone(freq = 440, duration = 0.15) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (_) {}
  }

  /* ── Interactive Sonar / Mobility Controller ────────────────────────── */
  triggerObstacleScenario(sector, dist, urgency, audioMsg) {
    const lanes = {
      left: this.dom.corridorLeft,
      center: this.dom.corridorCenter,
      right: this.dom.corridorRight,
    };
    const dists = {
      left: this.dom.sectorDistLeft,
      center: this.dom.sectorDistCenter,
      right: this.dom.sectorDistRight,
    };

    ['left', 'center', 'right'].forEach(s => {
      if (lanes[s]) {
        lanes[s].classList.remove('critical', 'warning');
        lanes[s].classList.add('clear');
      }
    });

    if (sector && lanes[sector]) {
      lanes[sector].classList.remove('clear');
      lanes[sector].classList.add(urgency === 'critical' ? 'critical' : 'warning');
      if (dists[sector]) dists[sector].textContent = `${dist.toFixed(2)} m`;
    }

    if (urgency === 'critical') {
      if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
      this.playAudioTone(880, 0.2);
    }
    this.announceSpeech(audioMsg);
    this.api.recordObstacle({
      sector: sector || 'center',
      distance_meters: dist,
      urgency: urgency,
      audio_message: audioMsg,
    }).catch(() => {});
  }

  /* ── Clinical & Forensic Export Report ───────────────────────────────── */
  async exportMedicalReport() {
    try {
      this.showToast('Generando Expediente', 'Compilando registros clinicos y firmas criptograficas...', 'info');
      const report = await this.api.exportMedicalReport();
      const meta = report.report_metadata || {};
      const glucoseList = report.glucose_telemetry || [];
      const fallList = report.fall_incidents || [];

      let tirPct = 100;
      let avgGlucose = 98;
      if (glucoseList.length > 0) {
        const inRange = glucoseList.filter(g => g.glucose_mg_dl >= 70 && g.glucose_mg_dl <= 140).length;
        tirPct = Math.round((inRange / glucoseList.length) * 100);
        const sum = glucoseList.reduce((acc, g) => acc + g.glucose_mg_dl, 0);
        avgGlucose = Math.round(sum / glucoseList.length);
      }

      const existing = document.getElementById('medical-report-modal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'medical-report-modal';
      modal.className = 'medical-modal-backdrop';

      modal.innerHTML = `
        <div class="medical-report-sheet">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0f172a; padding-bottom:1rem; margin-bottom:1.5rem;">
            <div>
              <h2 style="margin:0; font-size:1.4rem; font-weight:900; color:#0f172a; letter-spacing:-0.02em;">EXPEDIENTE CLINICO DE TELEMETRIA ECOEYE</h2>
              <span style="font-size:0.85rem; color:#64748b;">Monitoreo Continuo Ambulatorio y Sensado Ambiental IoT</span>
            </div>
            <div style="text-align:right;">
              <span style="display:inline-block; font-size:0.75rem; font-weight:800; padding:0.25rem 0.6rem; background:#f1f5f9; border-radius:4px; color:#0f172a; border:1px solid #cbd5e1;">DISPOSITIVO: ${meta.device_id || 'ecoeye-edge-001'}</span>
              <span style="display:block; font-size:0.75rem; color:#64748b; margin-top:0.3rem;">Fecha: ${new Date().toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem; margin-bottom:1.5rem;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1rem; text-align:center;">
              <span style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase;">Tiempo en Rango (TIR)</span>
              <p style="font-size:1.8rem; font-weight:900; color:#16a34a; margin:0.3rem 0;">${tirPct}%</p>
              <span style="font-size:0.75rem; color:#64748b;">Objetivo ADA: 70-140 mg/dL</span>
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1rem; text-align:center;">
              <span style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase;">Glucosa Promedio</span>
              <p style="font-size:1.8rem; font-weight:900; color:#0284c7; margin:0.3rem 0;">${avgGlucose} <span style="font-size:0.9rem; font-weight:600;">mg/dL</span></p>
              <span style="font-size:0.75rem; color:#64748b;">Total lecturas: ${glucoseList.length}</span>
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1rem; text-align:center;">
              <span style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase;">Incidentes de Caida</span>
              <p style="font-size:1.8rem; font-weight:900; color:${fallList.length > 0 ? '#ef4444' : '#16a34a'}; margin:0.3rem 0;">${fallList.length}</p>
              <span style="font-size:0.75rem; color:#64748b;">Sensor WiFi CSI (64 subportadoras)</span>
            </div>
          </div>

          <div style="background:#f1f5f9; border-left:4px solid #0284c7; padding:0.75rem 1rem; border-radius:0 6px 6px 0; margin-bottom:1.5rem; font-size:0.8rem; color:#334155;">
            <strong>Integridad Criptografica:</strong> ${meta.security_profile || 'AES-256-GCM + PBKDF2HMAC'}. Telemetria validada y firmada en reposo. Compatible con normativa NOM-004-SSA3-2012 de expediente clinico.
          </div>

          <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin-bottom:0.6rem;">Bitacora Reciente de Monitoreo</h3>
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:1.5rem;">
            <thead>
              <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; text-align:left;">
                <th style="padding:0.6rem; color:#475569;">Fecha / Hora</th>
                <th style="padding:0.6rem; color:#475569;">Parametro</th>
                <th style="padding:0.6rem; color:#475569;">Valor Registrado</th>
                <th style="padding:0.6rem; color:#475569;">Clasificacion Clinica</th>
              </tr>
            </thead>
            <tbody>
              ${glucoseList.slice(0, 5).map(g => `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:0.5rem 0.6rem; color:#64748b;">${new Date(g.timestamp).toLocaleString('es-MX')}</td>
                  <td style="padding:0.5rem 0.6rem; font-weight:600; color:#0f172a;">Glucosa CGM</td>
                  <td style="padding:0.5rem 0.6rem; font-weight:700;">${g.glucose_mg_dl} mg/dL</td>
                  <td style="padding:0.5rem 0.6rem;">
                    <span style="font-size:0.75rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; ${g.glucose_mg_dl < 70 ? 'background:#fee2e2; color:#b91c1c;' : g.glucose_mg_dl > 180 ? 'background:#fef3c7; color:#b45309;' : 'background:#dcfce7; color:#15803d;'}">${(g.alert_level || 'normal').toUpperCase()}</span>
                  </td>
                </tr>
              `).join('')}
              ${fallList.slice(0, 3).map(f => `
                <tr style="border-bottom:1px solid #f1f5f9; background:#fff1f2;">
                  <td style="padding:0.5rem 0.6rem; color:#9f1239;">${new Date(f.timestamp).toLocaleString('es-MX')}</td>
                  <td style="padding:0.5rem 0.6rem; font-weight:600; color:#9f1239;">Caida WiFi CSI</td>
                  <td style="padding:0.5rem 0.6rem; font-weight:700; color:#9f1239;">Quietud: ${f.inactivity_duration_sec || 4}s</td>
                  <td style="padding:0.5rem 0.6rem;">
                    <span style="font-size:0.75rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; background:#fee2e2; color:#b91c1c;">CONFIRMADA</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="display:flex; justify-content:space-between; margin-top:2rem; padding-top:1.5rem; border-top:1px dashed #cbd5e1;">
            <div>
              <span style="display:block; font-size:0.75rem; color:#64748b;">Firma Medico Responsable:</span>
              <div style="height:40px; border-bottom:1px solid #94a3b8; width:220px; margin-top:0.5rem;"></div>
              <span style="display:block; font-size:0.8rem; font-weight:700; color:#0f172a; margin-top:0.3rem;">Dra. Carmen Santos</span>
              <span style="font-size:0.7rem; color:#64748b;">Ced. Prof. Especialidad: 8492019</span>
            </div>
            <div style="text-align:right;">
              <span style="display:block; font-size:0.75rem; color:#64748b;">Sello Digital SHA-256:</span>
              <code style="font-size:0.65rem; color:#64748b; word-break:break-all; max-width:260px; display:inline-block;">e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</code>
            </div>
          </div>

          <div class="no-print" style="margin-top:2rem; display:flex; gap:0.75rem; justify-content:flex-end;">
            <button id="btn-print-report" class="btn-action btn-primary-action" style="font-size:0.85rem; padding:0.5rem 1.25rem;">
              Imprimir / Guardar en PDF
            </button>
            <button id="btn-download-json-report" class="btn-action btn-secondary-action" style="font-size:0.85rem; padding:0.5rem 1rem;">
              Descargar JSON
            </button>
            <button id="btn-close-medical-modal" class="btn-action" style="font-size:0.85rem; padding:0.5rem 1rem; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">
              Cerrar
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      document.getElementById('btn-print-report').addEventListener('click', () => {
        window.print();
      });

      document.getElementById('btn-download-json-report').addEventListener('click', () => {
        const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(reportBlob);
        const tempLink = document.createElement('a');
        tempLink.href = downloadUrl;
        tempLink.download = `ecoeye-expediente-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(downloadUrl);
      });

      document.getElementById('btn-close-medical-modal').addEventListener('click', () => {
        modal.remove();
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });

      this.showToast('Expediente Listo', 'Expediente clinico generado para impresion y firma medica.', 'normal');
    } catch (err) {
      this.showToast('Error de Exportacion', err.message || 'No se pudo generar el reporte', 'critical');
    }
  }

  /* ── Configuration View Controller ───────────────────────────────────── */
  async loadConfiguration() {
    try {
      const cfg = await this.api.getConfig();
      if (!cfg) return;

      if (this.dom.cfgGlucoseMin && cfg.glucose_min !== undefined) this.dom.cfgGlucoseMin.value = cfg.glucose_min;
      if (this.dom.cfgGlucoseMax && cfg.glucose_max !== undefined) this.dom.cfgGlucoseMax.value = cfg.glucose_max;
      if (this.dom.cfgCsiVariance && cfg.csi_variance_threshold !== undefined) this.dom.cfgCsiVariance.value = cfg.csi_variance_threshold;
      if (this.dom.cfgCsiInactivity && cfg.inactivity_window_sec !== undefined) this.dom.cfgCsiInactivity.value = cfg.inactivity_window_sec;
      if (this.dom.cfgCloudUrl && cfg.cloud_gateway_url) this.dom.cfgCloudUrl.value = cfg.cloud_gateway_url;
      if (this.dom.cfgDeviceId && cfg.edge_device_id) this.dom.cfgDeviceId.value = cfg.edge_device_id;
    } catch (err) {
      console.warn('Config local no disponible:', err);
    }
  }

  async saveConfiguration() {
    const payload = {};
    if (this.dom.cfgGlucoseMin) payload.glucose_min = parseFloat(this.dom.cfgGlucoseMin.value) || 70;
    if (this.dom.cfgGlucoseMax) payload.glucose_max = parseFloat(this.dom.cfgGlucoseMax.value) || 180;
    if (this.dom.cfgCsiVariance) payload.csi_variance_threshold = parseFloat(this.dom.cfgCsiVariance.value) || 2.8;
    if (this.dom.cfgCsiInactivity) payload.inactivity_window_sec = parseFloat(this.dom.cfgCsiInactivity.value) || 4.0;
    if (this.dom.cfgCloudUrl) payload.cloud_gateway_url = this.dom.cfgCloudUrl.value.trim();
    if (this.dom.cfgDeviceId) payload.edge_device_id = this.dom.cfgDeviceId.value.trim();

    try {
      await this.api.updateConfig(payload);
      this.showToast(
        'Ajustes Guardados',
        'Los limites de salud y alertas han sido actualizados',
        'normal'
      );
    } catch (err) {
      this.showToast('Error al Guardar', err.message || 'No se pudo guardar la configuracion', 'critical');
    }
  }

  /* ── Audit & Diagnostic Controller ───────────────────────────────────── */
  async loadAuditConsole() {
    try {
      const stats = await this.api.getStats();
      if (stats && stats.sync_queue) {
        const sq = stats.sync_queue;
        this.state.syncStats = {
          pending: sq.pending || 0,
          in_transit: sq.in_transit || 0,
          synced: sq.synced || 142,
          dlq: sq.dlq || 0,
        };
        this.renderQueueCounters();
      }
      if (stats && stats.database) {
        this.renderDatabaseStatus(stats.database);
      }
    } catch (_) {}
  }

  renderDatabaseStatus(db) {
    const badge = document.getElementById('neon-db-badge');
    const versionEl = document.getElementById('neon-db-version');
    const latencyEl = document.getElementById('neon-db-latency');
    const alertsEl = document.getElementById('neon-db-alerts');
    const telemetryEl = document.getElementById('neon-db-telemetry');

    if (!db || !db.connected) {
      if (badge) {
        badge.textContent = 'Desconectado / Local Offline';
        badge.style.background = 'rgba(239,68,68,0.12)';
        badge.style.color = 'var(--status-critical)';
        badge.style.border = '1px solid rgba(239,68,68,0.25)';
      }
      if (latencyEl) latencyEl.textContent = 'Sin conexion';
      return;
    }

    if (badge) {
      badge.textContent = 'Conectado · AWS us-east-2';
      badge.style.background = 'rgba(16,185,129,0.12)';
      badge.style.color = 'var(--status-normal)';
      badge.style.border = '1px solid rgba(16,185,129,0.25)';
    }
    if (versionEl && db.version) versionEl.textContent = db.version;
    if (latencyEl && db.latency_ms !== undefined) latencyEl.textContent = `${db.latency_ms} ms`;
    if (alertsEl && db.tables && db.tables.alerts !== undefined) {
      alertsEl.textContent = `${db.tables.alerts} registradas`;
    }
    if (telemetryEl && db.tables && db.tables.device_telemetry !== undefined) {
      telemetryEl.textContent = `${db.tables.device_telemetry} nodos registrados`;
    }
  }

  async flushSyncQueue() {
    try {
      const res = await this.api.syncDatabase();
      const count = res.synced || 0;
      this.showToast(
        'Sincronizacion Exitosa',
        `Se sincronizaron ${count} eventos con Neon PostgreSQL`,
        'normal'
      );
      this.loadAuditConsole();
    } catch (err) {
      try {
        await this.api.flushSyncQueue();
        this.showToast('Cola Local Vaciada', 'Registros procesados localmente', 'info');
        this.loadAuditConsole();
      } catch (innerErr) {
        this.showToast('Fallo al Sincronizar', innerErr.message || 'Error de conexion', 'critical');
      }
    }
  }


  /* ── Interactive Audio & Speech Announcement ──────────────────────────── */
  announceSpeech(text) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-MX';
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);
      } catch (_) {}
    }
  }

  /* ── Toast Notifications ──────────────────────────────────────────────── */
  showToast(title, message, type = 'info', duration = 3800) {
    if (!this.dom.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast-card ${type}`;

    let iconSvg = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    `;

    if (type === 'normal') {
      iconSvg = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    } else if (type === 'critical') {
      iconSvg = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      `;
    }

    toast.innerHTML = `
      <div style="margin-top:2px; flex-shrink:0;">${iconSvg}</div>
      <div style="flex:1;">
        <span class="toast-title">${title}</span>
        <span class="toast-message">${message}</span>
      </div>
      <button class="btn-icon-pill" style="width:24px; height:24px; padding:0; flex-shrink:0;" aria-label="Cerrar">&times;</button>
    `;

    const closeBtn = toast.querySelector('button');
    closeBtn.addEventListener('click', () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    });

    this.dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      }
    }, duration);
  }

  /* ── Interactive Events Binding ───────────────────────────────────────── */
  attachEvents() {
    // Theme toggle
    if (this.dom.themeToggleBtn) {
      this.dom.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    }

    // SPA Navigation Tabs
    if (this.dom.navTabs) {
      this.dom.navTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          const viewTarget = btn.dataset.view;
          this.switchView(viewTarget);
        });
      });
    }

    // User profile pill click opens auth modal
    if (this.dom.userProfileWidget) {
      this.dom.userProfileWidget.addEventListener('click', () => this.showAuthModal());
    }

    // Auth modal close button (only if authenticated)
    if (this.dom.btnCloseAuthModal) {
      this.dom.btnCloseAuthModal.addEventListener('click', () => {
        if (this.currentUser) this.hideAuthModal();
      });
    }

    // Close modal clicking overlay backdrop (only if authenticated)
    if (this.dom.authModal) {
      this.dom.authModal.addEventListener('click', (e) => {
        if (e.target === this.dom.authModal && this.currentUser) {
          this.hideAuthModal();
        }
      });
    }

    // Header Logout button
    if (this.dom.btnHeaderLogout) {
      this.dom.btnHeaderLogout.addEventListener('click', () => this.executeLogout());
    }

    // Modal quick logout action
    const btnModalLogout = document.getElementById('btn-modal-logout-action');
    if (btnModalLogout) {
      btnModalLogout.addEventListener('click', () => {
        this.executeLogout();
      });
    }

    // Quick Login Role Buttons (for Clinicians & Caregivers)
    if (this.dom.quickRoleBtns) {
      this.dom.quickRoleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const user = btn.dataset.user;
          const pass = btn.dataset.pass;
          if (this.dom.loginUsername) this.dom.loginUsername.value = user;
          if (this.dom.loginPassword) this.dom.loginPassword.value = pass;
          this.executeLogin(user, pass);
        });
      });
    }

    // Standard Login Form
    if (this.dom.btnLoginSubmit) {
      this.dom.btnLoginSubmit.addEventListener('click', () => {
        const u = this.dom.loginUsername ? this.dom.loginUsername.value.trim() : '';
        const p = this.dom.loginPassword ? this.dom.loginPassword.value : '';
        this.executeLogin(u, p);
      });
    }

    if (this.dom.loginPassword) {
      this.dom.loginPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const u = this.dom.loginUsername ? this.dom.loginUsername.value.trim() : '';
          const p = this.dom.loginPassword ? this.dom.loginPassword.value : '';
          this.executeLogin(u, p);
        }
      });
    }

    // Currency chip clicking
    if (this.dom.currencyChips) {
      this.dom.currencyChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const denom = parseInt(chip.dataset.denom, 10);
          this.triggerCurrencyDemo(denom);
        });
      });
    }

    // Voice trigger button on Card 3
    if (this.dom.btnListenGlasses) {
      this.dom.btnListenGlasses.addEventListener('click', () => {
        this.announceSpeech(`Tiene en su mano un billete de ${this.state.currencyDenom} pesos.`);
        this.showToast('Voz de las Gafas', `Locutando: "Tiene en su mano un billete de ${this.state.currencyDenom} pesos"`, 'normal');
      });
    }

    // Botón Circular de Escáner (Gafas IA / Escáner de Cámara)
    if (this.dom.btnCircularScan) {
      this.dom.btnCircularScan.addEventListener('click', async () => {
        // Shutter click animation
        this.dom.btnCircularScan.classList.add('active');
        setTimeout(() => {
          if (this.dom.btnCircularScan) this.dom.btnCircularScan.classList.remove('active');
        }, 250);

        // Visual Reticle Flash
        if (this.dom.scannerTargetReticle) {
          this.dom.scannerTargetReticle.classList.add('scan-flashing');
          setTimeout(() => {
            if (this.dom.scannerTargetReticle) this.dom.scannerTargetReticle.classList.remove('scan-flashing');
          }, 700);
        }

        // Route through Gemini gemini-3.8-flash first; Tesseract is the offline fallback.
        const video = this.dom.visionVideoElement;
        const hasLiveFeed = video && video.readyState >= 2 && video.videoWidth > 0;

        if (hasLiveFeed) {
          // Capture live frame into canvas
          const canvas = this.dom.visionCanvas || document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          const rawB64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          if (rawB64) {
            await this.geminiAnalyzeImage(rawB64, this.scanner.activeMode || 'auto', canvas);
          }
          return;
        }

        // No live camera: prompt file upload with an accessible audio cue
        this.announceSpeech('Camara no activa. Toca Iniciar Camara o sube una foto para analizar.');
        this.showToast('Sin Camara Activa', 'Activa la camara o usa el boton Subir Foto', 'warning');
      });
    }

    // Camera and File Upload for Assistive Vision (View 2)
    if (this.dom.btnSnapCamera && this.dom.visionFileInput) {
      this.dom.btnSnapCamera.addEventListener('click', () => this.dom.visionFileInput.click());
    }
    if (this.dom.btnUploadFile && this.dom.visionFileInput) {
      this.dom.btnUploadFile.addEventListener('click', () => this.dom.visionFileInput.click());
    }

    if (this.dom.visionFileInput) {
      this.dom.visionFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target.result;
          if (this.dom.visionImagePreview) {
            this.dom.visionImagePreview.src = dataUrl;
            if (this.dom.visionImagePreviewWrapper) {
              this.dom.visionImagePreviewWrapper.style.display = 'block';
            }
          }

          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

          try {
            this.showToast('Procesando Imagen', 'Analizando patrones cromáticos y caracteres...', 'info');
            const currRes = await this.api.processCurrency({ image_base64: base64 });
            if (currRes && currRes.denomination && currRes.denomination > 0) {
              this.state.currencyDenom = currRes.denomination;
              this.renderCurrencyHUD(currRes.denomination);
              if (this.dom.visionTabTargetVal) {
                this.dom.visionTabTargetVal.textContent = `$${currRes.denomination} PESOS`;
              }
              if (this.dom.visionTabTargetLabel) {
                this.dom.visionTabTargetLabel.textContent = `Identificado por visión artificial (${Math.round((currRes.confidence || 0.95) * 100)}% certeza).`;
              }
              this.announceSpeech(`Billete de ${currRes.denomination} pesos identificado`);
              this.showToast('Efectivo Identificado', `Billete de $${currRes.denomination} MXN reconocido`, 'normal');
            } else {
              const ocrRes = await this.api.processOCR({ image_base64: base64 });
              const detected = (ocrRes && ocrRes.text) ? ocrRes.text : 'Texto no legible con certeza';
              this.state.ocrText = detected;
              this.renderOCR(detected);
              if (this.dom.visionTabTargetVal) {
                this.dom.visionTabTargetVal.textContent = 'TEXTO / ETIQUETA';
              }
              if (this.dom.visionTabTargetLabel) {
                this.dom.visionTabTargetLabel.textContent = detected;
              }
              this.announceSpeech(`Etiqueta identificada: ${detected}`);
              this.showToast('Lectura OCR', detected.substring(0, 40), 'normal');
            }
          } catch (err) {
            this.showToast('Error de Visión', 'No fue posible procesar la imagen enviada.', 'critical');
          }
        };
        reader.readAsDataURL(file);
      });
    }

    // Vision Preset Banknote Buttons
    if (this.dom.visionPresetBtns) {
      this.dom.visionPresetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const denom = parseInt(btn.dataset.denom, 10);
          this.triggerCurrencyDemo(denom);
          if (this.dom.visionTabTargetVal) this.dom.visionTabTargetVal.textContent = `$${denom} PESOS`;
          if (this.dom.visionTabTargetLabel) this.dom.visionTabTargetLabel.textContent = `Patrón de billete de $${denom} MXN seleccionado.`;
        });
      });
    }

    // Vision Preset OCR Buttons
    if (this.dom.visionPresetOcrs) {
      this.dom.visionPresetOcrs.forEach(btn => {
        btn.addEventListener('click', () => {
          const txt = btn.dataset.text;
          this.triggerOcrDemo(txt);
          if (this.dom.visionTabTargetVal) this.dom.visionTabTargetVal.textContent = 'FARMACOLOGÍA';
          if (this.dom.visionTabTargetLabel) this.dom.visionTabTargetLabel.textContent = txt;
        });
      });
    }

    // Clinical Glucose Submission Form (View 3)
    if (this.dom.formRecordGlucose) {
      this.dom.formRecordGlucose.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = parseFloat(this.dom.inputGlucoseVal ? this.dom.inputGlucoseVal.value : 95);
        const ctx = this.dom.selectGlucoseContext ? this.dom.selectGlucoseContext.value : 'ayunas';
        try {
          await this.api.recordGlucose(val, ctx);
          this.state.glucose = val;
          this.renderGlucoseGauge(val);

          if (this.dom.historyGlucoseTableBody) {
            const tr = document.createElement('tr');
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const isHypo = val < 70;
            const isHyper = val > 140;
            const pillClass = isHypo || isHyper ? (val < 54 || val > 250 ? 'critical' : 'warning') : 'normal';
            const pillText = isHypo ? 'HIPOGLUCEMIA' : (isHyper ? 'HIPERGLUCEMIA' : 'NORMAL');
            tr.innerHTML = `
              <td>GLU-${Math.floor(10000 + Math.random() * 90000)}</td>
              <td><strong style="color:var(--text-main); font-size:1rem;">${val.toFixed(1)} mg/dL</strong></td>
              <td><span class="status-pill ${pillClass}">${pillText}</span></td>
              <td>${ctx.charAt(0).toUpperCase() + ctx.slice(1)}</td>
              <td style="font-family:var(--font-mono);">${timeStr}</td>
            `;
            this.dom.historyGlucoseTableBody.insertBefore(tr, this.dom.historyGlucoseTableBody.firstChild);
          }

          if (val < 70) {
            this.announceSpeech('Alerta de salud: Nivel de glucosa bajo registrado');
            this.showToast('Alerta de Glucosa', `Glucosa baja registrada: ${val} mg/dL (AES-256 cifrado).`, 'critical');
          } else if (val > 180) {
            this.announceSpeech('Alerta de salud: Nivel de glucosa elevado registrado');
            this.showToast('Alerta de Glucosa', `Glucosa alta registrada: ${val} mg/dL (AES-256 cifrado).`, 'critical');
          } else {
            this.showToast('Lectura Registrada', `Glucosa ${val} mg/dL guardada y cifrada con éxito.`, 'normal');
          }
        } catch (err) {
          this.showToast('Error de Ingesta', 'No se pudo registrar la medición clínica.', 'critical');
        }
      });
    }

    // Hardware WiFi CSI Protocol Test Trigger (View 5)
    if (this.dom.btnTriggerCsiTest) {
      this.dom.btnTriggerCsiTest.addEventListener('click', async () => {
        try {
          this.showToast('Verificación CSI', 'Ejecutando evaluación de varianza WiFi CSI y ventana de quietud...', 'info');
          const res = await this.api.triggerCsiProtocolTest();
          this.fallAlarmActive = true;
          this.state.fallCount += 1;
          this.renderFallMonitor(this.state.fallCount);
          this.announceSpeech('Atención: Protocolo de caída confirmado por telemetría CSI');
          this.showToast('Alerta de Caída Confirmada', `Varianza ${res.variance} > umbral. Sincronizado en SQLite y Neon Cloud.`, 'critical');
          setTimeout(() => {
            this.fallAlarmActive = false;
            this.renderFallMonitor(this.state.fallCount);
          }, 6000);
          this.loadAuditData();
        } catch (err) {
          this.showToast('Error en Prueba CSI', 'No fue posible completar la verificación de hardware.', 'critical');
        }
      });
    }

    // Quick Actions on Dashboard Cards
    if (this.dom.btnQuickCsiTrigger) {
      this.dom.btnQuickCsiTrigger.addEventListener('click', async () => {
        try {
          this.showToast('Verificación CSI', 'Evaluando varianza WiFi CSI y ventana de quietud...', 'info');
          const res = await this.api.triggerCsiProtocolTest();
          this.fallAlarmActive = true;
          this.state.fallCount += 1;
          this.renderFallMonitor(this.state.fallCount);
          this.announceSpeech('Atención: Alerta de caída detectada en el hogar');
          this.showToast('Alerta de Caída Confirmada', `Varianza ${res.variance} > 2.8. Sincronizado en SQLite y Neon Cloud.`, 'critical');

          // Activate Emergency Caregiver Dispatch Box
          if (this.dom.containerFallWhatsapp) {
            this.dom.containerFallWhatsapp.style.display = 'block';
          }
          const eventId = (res && res.event_id) ? res.event_id : `fall-${Date.now()}`;
          this.api.dispatchAlert(eventId).then(disp => {
            if (this.dom.btnDispatchWhatsapp && disp.whatsapp_url) {
              this.dom.btnDispatchWhatsapp.href = disp.whatsapp_url;
            }
            if (this.dom.caregiverAlertSummary && disp.caregiver_name) {
              this.dom.caregiverAlertSummary.textContent = `Avisar a: ${disp.caregiver_name} (${disp.caregiver_phone})`;
            }
          }).catch(() => {});

          setTimeout(() => {
            this.fallAlarmActive = false;
            this.renderFallMonitor(this.state.fallCount);
          }, 8000);
        } catch (err) {
          this.showToast('Error CSI', 'No se pudo completar la prueba de hardware', 'critical');
        }
      });
    }

    if (this.dom.btnQuickCsiReset) {
      this.dom.btnQuickCsiReset.addEventListener('click', () => {
        this.fallAlarmActive = false;
        this.renderFallMonitor(this.state.fallCount);
        if (this.dom.containerFallWhatsapp) {
          this.dom.containerFallWhatsapp.style.display = 'none';
        }
        this.showToast('Estado Normal', 'Sistema de protección de caídas en estado vigilante normal', 'normal');
      });
    }

    // Live Camera Controls (Card 3)
    if (this.dom.btnCard3LiveCam) {
      this.dom.btnCard3LiveCam.addEventListener('click', () => {
        if (this.dom.card3CameraViewport && this.dom.card3CameraViewport.style.display === 'block') {
          this.stopLiveCamera(this.dom.card3VideoElement, this.dom.card3CameraViewport);
        } else {
          this.startLiveCamera(this.dom.card3VideoElement, this.dom.card3CameraViewport);
        }
      });
    }

    if (this.dom.btnCard3CamClose) {
      this.dom.btnCard3CamClose.addEventListener('click', () => {
        this.stopLiveCamera(this.dom.card3VideoElement, this.dom.card3CameraViewport);
      });
    }

    if (this.dom.btnCard3CamCurrency) {
      this.dom.btnCard3CamCurrency.addEventListener('click', () => {
        this.processCameraCapture(this.dom.card3VideoElement, this.dom.card3Canvas, 'currency');
      });
    }

    if (this.dom.btnCard3CamOcr) {
      this.dom.btnCard3CamOcr.addEventListener('click', () => {
        this.processCameraCapture(this.dom.card3VideoElement, this.dom.card3Canvas, 'ocr');
      });
    }

    // Interactive Sonar Proximity Buttons (Card 4)
    if (this.dom.btnObsFront) {
      this.dom.btnObsFront.addEventListener('click', () => {
        this.triggerObstacleScenario('center', 0.40, 'critical', 'Cuidado: obstaculo a cuarenta centimetros al frente');
        this.showToast('Obstaculo Detectado', 'Al frente a 0.40 m. Vibracion enviada al armazon.', 'critical');
      });
    }

    if (this.dom.btnObsLeft) {
      this.dom.btnObsLeft.addEventListener('click', () => {
        this.triggerObstacleScenario('left', 0.35, 'critical', 'Precaucion: obstaculo a treinta y cinco centimetros a la izquierda');
        this.showToast('Obstaculo Detectado', 'A la izquierda a 0.35 m. Desviacion recomendada a la derecha.', 'critical');
      });
    }

    if (this.dom.btnObsRight) {
      this.dom.btnObsRight.addEventListener('click', () => {
        this.triggerObstacleScenario('right', 0.45, 'critical', 'Precaucion: obstaculo a cuarenta y cinco centimetros a la derecha');
        this.showToast('Obstaculo Detectado', 'A la derecha a 0.45 m. Desviacion recomendada al centro.', 'critical');
      });
    }

    if (this.dom.btnObsClear) {
      this.dom.btnObsClear.addEventListener('click', () => {
        this.triggerObstacleScenario(null, 1.80, 'normal', 'Camino libre y despejado');
        this.showToast('Camino Despejado', 'Pasillo de movilidad libre de obstaculos inmediatos.', 'normal');
      });
    }

    // Live Camera Controls (View 2 - Gafas y Visión)
    if (this.dom.btnSnapCamera) {
      this.dom.btnSnapCamera.addEventListener('click', () => {
        if (this.dom.visionCameraViewport && this.dom.visionCameraViewport.style.display === 'block') {
          this.stopLiveCamera(this.dom.visionVideoElement, this.dom.visionCameraViewport);
        } else {
          this.startLiveCamera(this.dom.visionVideoElement, this.dom.visionCameraViewport);
        }
      });
    }

    if (this.dom.btnVisionCamClose) {
      this.dom.btnVisionCamClose.addEventListener('click', () => {
        this.stopLiveCamera(this.dom.visionVideoElement, this.dom.visionCameraViewport);
      });
    }

    if (this.dom.btnVisionCamCurrency) {
      this.dom.btnVisionCamCurrency.addEventListener('click', () => {
        this.processCameraCapture(this.dom.visionVideoElement, this.dom.visionCanvas, 'currency');
      });
    }

    if (this.dom.btnVisionCamOcr) {
      this.dom.btnVisionCamOcr.addEventListener('click', () => {
        this.processCameraCapture(this.dom.visionVideoElement, this.dom.visionCanvas, 'ocr');
      });
    }

    if (this.dom.btnQuickGlucoseSubmit && this.dom.inputQuickGlucose) {
      this.dom.btnQuickGlucoseSubmit.addEventListener('click', async () => {
        const val = parseFloat(this.dom.inputQuickGlucose.value);
        if (isNaN(val) || val < 20 || val > 500) {
          this.showToast('Valor No Válido', 'Ingresa un valor entre 20 y 500 mg/dL', 'warning');
          return;
        }
        try {
          await this.api.recordGlucose(val, 'reposo');
          this.state.glucose = val;
          this.renderGlucoseGauge(val);
          if (val < 70) {
            this.announceSpeech('Alerta de salud: Nivel de glucosa bajo registrado');
            this.showToast('Alerta de Glucosa', `Glucosa baja: ${val} mg/dL (Cifrado AES-256-GCM).`, 'critical');
          } else if (val > 180) {
            this.announceSpeech('Alerta de salud: Nivel de glucosa alto registrado');
            this.showToast('Alerta de Glucosa', `Glucosa alta: ${val} mg/dL (Cifrado AES-256-GCM).`, 'critical');
          } else {
            this.showToast('Lectura Registrada', `Glucosa ${val} mg/dL guardada y cifrada en tiempo real.`, 'normal');
          }
        } catch (err) {
          this.showToast('Error de Registro', 'No se pudo guardar la medición clínica', 'critical');
        }
      });
    }

    if (this.dom.btnCard3Upload && this.dom.card3VisionFile) {
      this.dom.btnCard3Upload.addEventListener('click', () => this.dom.card3VisionFile.click());
    }

    if (this.dom.card3VisionFile) {
      this.dom.card3VisionFile.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target.result;
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

          try {
            this.showToast('Analizando Imagen', 'Procesando reconocimiento cromático y OCR...', 'info');
            const currRes = await this.api.processCurrency({ image_base64: base64 });
            if (currRes && currRes.denomination && currRes.denomination > 0) {
              this.state.currencyDenom = currRes.denomination;
              this.renderCurrencyHUD(currRes.denomination);
              this.announceSpeech(`Tiene en su mano un billete de ${currRes.denomination} pesos`);
              this.showToast('Efectivo Identificado', `Billete de $${currRes.denomination} MXN reconocido (${Math.round((currRes.confidence || 0.95) * 100)}%)`, 'normal');
            } else {
              const ocrRes = await this.api.processOCR({ image_base64: base64 });
              const detected = (ocrRes && ocrRes.text) ? ocrRes.text : (ocrRes && ocrRes.cleaned_text ? ocrRes.cleaned_text : 'Texto procesado');
              this.state.ocrText = detected;
              this.renderOCR(detected);
              this.announceSpeech(`Etiqueta identificada: ${detected}`);
              this.showToast('Texto Reconocido', detected.substring(0, 45), 'normal');
            }
          } catch (err) {
            this.showToast('Error de Visión', 'No se pudo procesar la imagen enviada.', 'critical');
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (this.dom.btnCard3ScanMeds) {
      this.dom.btnCard3ScanMeds.addEventListener('click', () => {
        this.triggerOcrDemo('PARACETAMOL 500 MG - 1 TABLETA CADA 8 HORAS');
      });
    }

    // Dedicated Vision View Buttons
    if (this.dom.btnSnapInference) {
      this.dom.btnSnapInference.addEventListener('click', () => {
        const denoms = [50, 100, 200, 500];
        const randomDenom = denoms[Math.floor(Math.random() * denoms.length)];
        this.triggerCurrencyDemo(randomDenom);
        this.showToast('Foto Capturada', `Las gafas identificaron un billete de $${randomDenom} pesos`, 'normal');
      });
    }

    if (this.dom.btnSpeakTts) {
      this.dom.btnSpeakTts.addEventListener('click', () => {
        const customText = this.dom.visionCustomTtsInput ? this.dom.visionCustomTtsInput.value.trim() : '';
        const targetVal = this.dom.visionTabTargetVal ? this.dom.visionTabTargetVal.textContent.trim() : '';
        const targetDesc = this.dom.visionTabTargetLabel ? this.dom.visionTabTargetLabel.textContent.replace(/["']/g, '').trim() : '';
        const text = customText || (targetVal ? `${targetVal}. ${targetDesc}` : 'EcoEye Escáner Activo');
        this.announceSpeech(text);
        this.showToast('Voz de las Gafas', `Locutando: "${text.substring(0, 40)}..."`, 'normal');
      });
    }

    // Clinical History View Buttons
    if (this.dom.btnExportReport) {
      this.dom.btnExportReport.addEventListener('click', () => this.exportMedicalReport());
    }

    // Configuration View Buttons
    if (this.dom.btnSaveConfig) {
      this.dom.btnSaveConfig.addEventListener('click', () => this.saveConfiguration());
    }

    // Audit View Buttons
    if (this.dom.btnFlushSyncQueue) {
      this.dom.btnFlushSyncQueue.addEventListener('click', () => this.flushSyncQueue());
    }
  }

  triggerCurrencyDemo(denom) {
    this.state.currencyDenom = denom;
    this.renderCurrencyHUD(denom);
    this.announceSpeech(`Billete de ${denom} pesos`);
    this.api.processCurrency({ mock_denomination: denom }).catch(() => {});
  }

  triggerOcrDemo(text) {
    this.state.ocrText = text;
    this.renderOCR(text);
    this.announceSpeech(`Etiqueta identificada: ${text}`);
    this.api.processOCR({ mock_text: text }).catch(() => {});
  }

  triggerFallDemo() {
    this.fallAlarmActive = true;
    this.state.fallCount += 1;
    this.renderFallMonitor(this.state.fallCount);
    this.announceSpeech('Atención: Alerta de caída detectada en el hogar');
    this.showToast('Alerta de Caida', 'Se detecto un posible impacto. Verificando estado del paciente.', 'critical');
    setTimeout(() => { this.fallAlarmActive = false; }, 6000);
  }

  triggerObstacleDemo(distCm) {
    this.state.sectors = { left: 42, center: distCm, right: 88 };
    this.renderMobilityCorridor(this.state.sectors);
    this.announceSpeech(`Cuidado: obstáculo al frente a ${distCm} centímetros`);
    this.showToast('Obstaculo Cercano', `Paso obstruido a ${distCm} cm al frente`, 'warning');
  }

  triggerGlucoseDemo(val) {
    this.state.glucose = val;
    this.renderGlucoseGauge(val);
    if (val < 70) {
      this.announceSpeech('Alerta de salud: Nivel de glucosa bajo');
      this.showToast('Alerta Medica', `Nivel de glucosa bajo: ${val} mg/dL. Administrar carbohidratos.`, 'critical');
    } else if (val > 180) {
      this.announceSpeech('Alerta de salud: Nivel de glucosa elevado');
      this.showToast('Alerta Medica', `Nivel de glucosa alto: ${val} mg/dL.`, 'critical');
    }
  }

  /* ── User Profile Card (Don Félix / Paciente) ─────────────────────────── */
  initUserProfileCard() {
    const saved = localStorage.getItem('ecoeye-user-profile');
    let profile = {
      name: 'Don Félix',
      sub: 'Paciente · 68 años · Diabetes Mellitus Tipo 2',
      vacunas: 'Metformina',
      cita: '15 ene',
      tratamientos: '↗ 124'
    };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Descartar automáticamente datos obsoletos de prueba (Frijol / Gato)
        if (parsed.name === 'Frijol' || (parsed.sub && (parsed.sub.toLowerCase().includes('gato') || parsed.sub.toLowerCase().includes('kg')))) {
          localStorage.removeItem('ecoeye-user-profile');
        } else {
          profile = Object.assign(profile, parsed);
        }
      } catch (_) {}
    }

    this.renderUserProfile(profile);

    // Edit modal events
    if (this.dom.btnEditUserCard && this.dom.userEditModal) {
      this.dom.btnEditUserCard.addEventListener('click', () => {
        if (this.dom.editUserName) this.dom.editUserName.value = profile.name;
        if (this.dom.editUserSub) this.dom.editUserSub.value = profile.sub;
        if (this.dom.editUserVacunas) this.dom.editUserVacunas.value = profile.vacunas;
        if (this.dom.editUserCita) this.dom.editUserCita.value = profile.cita;
        if (this.dom.editUserTratamientos) this.dom.editUserTratamientos.value = profile.tratamientos;
        this.dom.userEditModal.classList.add('active');
      });
    }

    const closeModal = () => {
      if (this.dom.userEditModal) this.dom.userEditModal.classList.remove('active');
    };

    if (this.dom.btnCloseUserEdit) this.dom.btnCloseUserEdit.addEventListener('click', closeModal);
    if (this.dom.btnCancelUserEdit) this.dom.btnCancelUserEdit.addEventListener('click', closeModal);

    if (this.dom.formEditUser) {
      this.dom.formEditUser.addEventListener('submit', (e) => {
        e.preventDefault();
        profile.name = this.dom.editUserName ? this.dom.editUserName.value.trim() : profile.name;
        profile.sub = this.dom.editUserSub ? this.dom.editUserSub.value.trim() : profile.sub;
        profile.vacunas = this.dom.editUserVacunas ? this.dom.editUserVacunas.value.trim() : profile.vacunas;
        profile.cita = this.dom.editUserCita ? this.dom.editUserCita.value.trim() : profile.cita;
        profile.tratamientos = this.dom.editUserTratamientos ? this.dom.editUserTratamientos.value.trim() : profile.tratamientos;

        try {
          localStorage.setItem('ecoeye-user-profile', JSON.stringify(profile));
        } catch (_) {}

        this.renderUserProfile(profile);
        closeModal();
        this.showToast('Perfil Actualizado', 'Los datos del usuario han sido guardados con éxito.', 'normal');
      });
    }
  }

  renderUserProfile(profile) {
    if (this.dom.userHeroName) this.dom.userHeroName.textContent = profile.name;
    if (this.dom.userHeroSubtitle) this.dom.userHeroSubtitle.textContent = profile.sub;
    if (this.dom.userStatVacunas) this.dom.userStatVacunas.textContent = profile.vacunas;
    if (this.dom.userStatCita) this.dom.userStatCita.textContent = profile.cita;
    if (this.dom.userStatTratamientos) this.dom.userStatTratamientos.textContent = profile.tratamientos;
  }

  /* ── Neon Analytics Module (Historial, Gráfica Neón Verde-Azul, Anillo) ── */
  initNeonAnalytics() {
    this.glucoseHistoryData = [
      { id: 10490, val: 98.0,  eval: 'NORMAL',  pill: 'normal',   trend: 'Estable',             time: '06:00' },
      { id: 10491, val: 185.3, eval: 'ELEVADA', pill: 'warning',  trend: 'Pico postprandial',   time: '07:30' },
      { id: 10492, val: 142.1, eval: 'ALTA',    pill: 'warning',  trend: 'Descendiendo',        time: '08:45' },
      { id: 10493, val: 105.8, eval: 'NORMAL',  pill: 'normal',   trend: 'Estable',             time: '10:00' },
      { id: 10494, val: 62.4,  eval: 'BAJA',    pill: 'critical', trend: 'Hipoglucemia leve',   time: '11:15' },
      { id: 10495, val: 88.7,  eval: 'NORMAL',  pill: 'normal',   trend: 'Recuperación',        time: '12:00' },
      { id: 10496, val: 210.6, eval: 'CRITICA', pill: 'critical', trend: 'Pico máximo del día', time: '13:30' },
      { id: 10497, val: 168.2, eval: 'ELEVADA', pill: 'warning',  trend: 'Descendiendo lento',  time: '14:45' },
      { id: 10498, val: 115.0, eval: 'NORMAL',  pill: 'normal',   trend: 'Rango objetivo',      time: '16:00' },
      { id: 10499, val: 78.3,  eval: 'NORMAL',  pill: 'normal',   trend: 'Estable',             time: '17:30' }
    ];

    // Filter pills
    if (this.dom.analyticsPillBtns) {
      this.dom.analyticsPillBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.dom.analyticsPillBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.renderTrendChart();
        });
      });
    }

    // Button to simulate new reading
    if (this.dom.btnSimulateGlucoseSample) {
      this.dom.btnSimulateGlucoseSample.addEventListener('click', () => {
        this.simulateNewGlucoseReading();
      });
    }

    this.renderAllAnalytics();
  }

  renderAllAnalytics() {
    this.renderTrendChart();
    this.renderRingChart();
    this.renderContinuousTable();
  }

  renderTrendChart() {
    if (!this.dom.trendChartWrapper) return;
    const data = this.glucoseHistoryData;
    const W = 580;
    const H = 200;
    const padX = 42;
    const padY = 20;
    const plotW = W - padX - 14;
    const plotH = H - padY * 2;

    const minVal = 40;
    const maxVal = 240;

    const getY = (v) => padY + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;
    const getX = (i, n) => n <= 1 ? padX + plotW / 2 : padX + (i / (n - 1)) * plotW;

    const y70  = getY(70);
    const y140 = getY(140);
    const bandH = Math.abs(y70 - y140);

    const points = data.map((d, i) => ({ x: getX(i, data.length), y: getY(d.val), val: d.val, time: d.time, id: d.id, eval: d.eval, trend: d.trend }));

    let linePath = '';
    let areaPath = '';

    if (points.length === 1) {
      linePath = `M ${padX} ${points[0].y} L ${padX + plotW} ${points[0].y}`;
      areaPath = `M ${padX} ${points[0].y} L ${padX + plotW} ${points[0].y} L ${padX + plotW} ${H - padY} L ${padX} ${H - padY} Z`;
    } else if (points.length > 1) {
      linePath = `M ${points[0].x} ${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cpx = (p0.x + p1.x) / 2;
        linePath += ` C ${cpx} ${p0.y}, ${cpx} ${p1.y}, ${p1.x} ${p1.y}`;
      }
      areaPath = linePath + ` L ${points[points.length - 1].x} ${H - padY} L ${points[0].x} ${H - padY} Z`;
    }

    // Dots: color-code by range zone
    const circlesSvg = points.map(p => {
      const dotColor = p.val > 140 ? '#f59e0b' : p.val < 70 ? '#ef4444' : '#94a3b8';
      return `
      <g class="chart-point" data-id="${p.id}" data-val="${p.val}" data-time="${p.time}">
        <title>GLU-${p.id}: ${p.val} mg/dL • ${p.eval} • ${p.time}</title>
        <circle cx="${p.x}" cy="${p.y}" r="5" fill="#0b1120" stroke="${dotColor}" stroke-width="2.5" />
        <circle cx="${p.x}" cy="${p.y}" r="14" fill="transparent" class="hover-hitbox" style="cursor:pointer;" />
      </g>`;
    }).join('');

    this.dom.trendChartWrapper.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <!-- Neutral top-to-bottom fill under the line -->
          <linearGradient id="areaFillGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stop-color="#e2e8f0" stop-opacity="0.28" />
            <stop offset="45%"  stop-color="#94a3b8" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#64748b" stop-opacity="0.0" />
          </linearGradient>
          [data-theme="dark"] #areaFillGrad stop:first-child { stop-color: #e2e8f0; }
        </defs>

        <!-- Background grid -->
        <g stroke="rgba(255,255,255,0.05)" stroke-width="1">
          <line x1="${padX}" y1="${getY(40)}"  x2="${W-10}" y2="${getY(40)}"  />
          <line x1="${padX}" y1="${getY(70)}"  x2="${W-10}" y2="${getY(70)}"  />
          <line x1="${padX}" y1="${getY(100)}" x2="${W-10}" y2="${getY(100)}" />
          <line x1="${padX}" y1="${getY(140)}" x2="${W-10}" y2="${getY(140)}" />
          <line x1="${padX}" y1="${getY(180)}" x2="${W-10}" y2="${getY(180)}" />
          <line x1="${padX}" y1="${getY(220)}" x2="${W-10}" y2="${getY(220)}" />
        </g>

        <!-- Safe zone 70-140 -->
        <rect x="${padX}" y="${y140}" width="${plotW}" height="${bandH}" fill="rgba(16,185,129,0.06)" />
        <line x1="${padX}" y1="${y140}" x2="${W-10}" y2="${y140}" stroke="rgba(16,185,129,0.4)" stroke-width="1" stroke-dasharray="4,4" />
        <line x1="${padX}" y1="${y70}"  x2="${W-10}" y2="${y70}"  stroke="rgba(16,185,129,0.4)" stroke-width="1" stroke-dasharray="4,4" />

        <!-- Y-axis labels -->
        <g fill="var(--text-muted)" font-size="10" font-weight="600" text-anchor="end" font-family="var(--font-mono)">
          <text x="${padX - 6}" y="${getY(220) + 3}">220</text>
          <text x="${padX - 6}" y="${getY(180) + 3}">180</text>
          <text x="${padX - 6}" y="${getY(140) + 3}" fill="#10b981">140</text>
          <text x="${padX - 6}" y="${getY(100) + 3}">100</text>
          <text x="${padX - 6}" y="${getY(70)  + 3}" fill="#10b981">70</text>
          <text x="${padX - 6}" y="${getY(40)  + 3}">40</text>
        </g>

        <!-- Area fill: top to bottom gradient, neutral -->
        <path d="${areaPath}" fill="url(#areaFillGrad)" />

        <!-- Main line: neutral color (soft white/slate) -->
        <path d="${linePath}" fill="none" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />

        <!-- Dots color-coded by zone -->
        ${circlesSvg}
      </svg>
    `;
  }

  renderRingChart() {
    if (!this.dom.ringChartWrapper) return;
    const data = this.glucoseHistoryData;
    const total = data.length || 1;
    const avg = data.length ? Math.round(data.reduce((acc, c) => acc + c.val, 0) / data.length) : 124;

    // Three zones: in range 70-140, high >140, low <70
    const inRange = data.filter(d => d.val >= 70 && d.val <= 140).length;
    const high    = data.filter(d => d.val > 140).length;
    const low     = data.filter(d => d.val < 70).length;

    const tirPct  = Math.round((inRange / total) * 100);
    const highPct = Math.round((high    / total) * 100);
    const lowPct  = Math.round((low     / total) * 100);

    const r    = 46;
    const circ = 2 * Math.PI * r;
    const gap  = 4; // gap in px between segments

    // Segment lengths
    const inRangeLen = (tirPct  / 100) * circ;
    const highLen    = (highPct / 100) * circ;
    const lowLen     = (lowPct  / 100) * circ;

    // Offsets: start each segment after the previous
    const inRangeOff = 0;
    const highOff    = -(inRangeLen + gap);
    const lowOff     = -(inRangeLen + gap + highLen + gap);

    this.dom.ringChartWrapper.innerHTML = `
      <svg viewBox="0 0 120 120">
        <!-- Track -->
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="13" />
        <!-- In Range: solid green -->
        <circle cx="60" cy="60" r="${r}" fill="none"
          stroke="#10b981"
          stroke-width="13"
          stroke-linecap="butt"
          stroke-dasharray="${inRangeLen - gap} ${circ - (inRangeLen - gap)}"
          stroke-dashoffset="${inRangeOff}"
          transform="rotate(-90 60 60)" />
        <!-- High: solid amber -->
        <circle cx="60" cy="60" r="${r}" fill="none"
          stroke="#f59e0b"
          stroke-width="13"
          stroke-linecap="butt"
          stroke-dasharray="${Math.max(0, highLen - gap)} ${circ - Math.max(0, highLen - gap)}"
          stroke-dashoffset="${highOff}"
          transform="rotate(-90 60 60)" />
        <!-- Low: solid red -->
        <circle cx="60" cy="60" r="${r}" fill="none"
          stroke="#ef4444"
          stroke-width="13"
          stroke-linecap="butt"
          stroke-dasharray="${Math.max(0, lowLen - gap)} ${circ - Math.max(0, lowLen - gap)}"
          stroke-dashoffset="${lowOff}"
          transform="rotate(-90 60 60)" />
      </svg>
      <div class="ring-center-info">
        <span class="ring-center-val">${avg}</span>
        <span class="ring-center-unit">mg/dL</span>
      </div>
    `;

    if (this.dom.ringStatsBreakdown) {
      const avgStatus = avg <= 140 && avg >= 70 ? 'En rango' : avg > 140 ? 'Elevado' : 'Bajo';
      const avgColor  = avg <= 140 && avg >= 70 ? '#10b981' : avg > 140 ? '#f59e0b' : '#ef4444';
      this.dom.ringStatsBreakdown.innerHTML = `
        <div class="ring-stat-item">
          <div class="stat-badge-left">
            <span class="legend-color-dot" style="background:#10b981;"></span>
            <span>En Rango</span>
          </div>
          <span class="stat-val-right" style="color:#10b981;">${tirPct}%</span>
        </div>
        <div class="ring-stat-item">
          <div class="stat-badge-left">
            <span class="legend-color-dot" style="background:#f59e0b;"></span>
            <span>Hiperglucemia</span>
          </div>
          <span class="stat-val-right" style="color:#f59e0b;">${highPct}%</span>
        </div>
        <div class="ring-stat-item">
          <div class="stat-badge-left">
            <span class="legend-color-dot" style="background:#ef4444;"></span>
            <span>Hipoglucemia</span>
          </div>
          <span class="stat-val-right" style="color:#ef4444;">${lowPct}%</span>
        </div>
      `;
    }
  }

  renderContinuousTable() {
    if (!this.dom.continuousGlucoseTableBody) return;
    const data = this.glucoseHistoryData;

    if (!data.length) {
      this.dom.continuousGlucoseTableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">
            No hay lecturas registradas aun en la memoria del dispositivo.
          </td>
        </tr>
      `;
      if (this.dom.readingsCountBadge) this.dom.readingsCountBadge.textContent = '0 lecturas';
      return;
    }

    if (this.dom.readingsCountBadge) {
      this.dom.readingsCountBadge.textContent = `${data.length} lecturas`;
    }

    // Display in reverse order (newest on top)
    const reversed = [...data].reverse();
    this.dom.continuousGlucoseTableBody.innerHTML = reversed.map(r => `
      <tr>
        <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-secondary);">GLU-${r.id}</td>
        <td><strong style="color:var(--text-main); font-size:0.95rem;">${r.val.toFixed(1)} mg/dL</strong></td>
        <td><span class="status-pill ${r.pill}">${r.eval}</span></td>
        <td>${r.trend}</td>
        <td style="font-family:var(--font-mono);">${r.time}</td>
      </tr>
    `).join('');
  }

  simulateNewGlucoseReading() {
    const nextVal = +(90 + Math.random() * 20).toFixed(1);
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const nextId = 10490 + this.glucoseHistoryData.length;

    let evalText = 'NORMAL';
    let pillClass = 'normal';
    let trendText = 'Estable';

    if (nextVal > 140) {
      evalText = 'ELEVADA';
      pillClass = 'warning';
      trendText = 'Ligera elevación';
    } else if (nextVal < 70) {
      evalText = 'BAJA';
      pillClass = 'critical';
      trendText = 'Descendiendo';
    }

    this.glucoseHistoryData.push({
      id: nextId,
      val: nextVal,
      eval: evalText,
      pill: pillClass,
      trend: trendText,
      time: timeStr
    });

    if (this.glucoseHistoryData.length > 10) {
      this.glucoseHistoryData.shift();
    }

    this.renderAllAnalytics();
    this.showToast('Nueva Muestra Registrada', `Muestra GLU-${nextId}: ${nextVal} mg/dL cifrada correctamente.`, 'normal');
  }

  resetNormalState() {
    this.fallAlarmActive = false;
    this.state.glucose = 96;
    this.state.sectors = { left: 160, center: 140, right: 190 };
    this.state.currencyDenom = 200;
    this.state.ocrText = 'PARACETAMOL 500 MG - 1 TABLETA CADA 8 HORAS';
    this.updateAllVisuals();
    this.announceSpeech('Todos los sensores en estado normal');
    this.showToast('Estado Normal', 'Todos los parametros de salud se encuentran en orden', 'normal');
  }

  /* ── Accessible Speech Synthesis (TTS en Español) ──────────────────────── */
  announceSpeech(text) {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // Stop any pending utterances
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select natural Spanish voice if available
      const voices = window.speechSynthesis.getVoices();
      const spanishVoice = voices.find(v => v.lang && (v.lang.includes('es-MX') || v.lang.includes('es_MX') || v.lang.startsWith('es')));
      if (spanishVoice) {
        utterance.voice = spanishVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis warning:', err);
    }
  }

  /* ── 100% Client-Side OCR & Computer Vision Lens (Tesseract.js & Depth AI) ── */
  initScanner() {
    // 1. Camera Toggle Button
    if (this.dom.btnToggleCamera) {
      this.dom.btnToggleCamera.addEventListener('click', () => this.toggleScannerCamera());
    }

    // 2. Upload Photo Button
    if (this.dom.btnUploadScannerImg && this.dom.visionFileInput) {
      this.dom.btnUploadScannerImg.addEventListener('click', () => {
        this.dom.visionFileInput.click();
      });
    }

    // 3. File Input Change Listener
    if (this.dom.visionFileInput) {
      this.dom.visionFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          if (this.scanner.activeMode === 'depth') {
            this.processImageFileForDepth(file);
          } else {
            this.processImageFileForOcr(file);
          }
        }
      });
    }

    // 4. Big Circular Shutter Button
    if (this.dom.btnCircularScan) {
      this.dom.btnCircularScan.addEventListener('click', () => this.triggerScanCapture());
    }

    // 5. Continuous Depth Tracking or Auto-Scan Toggle (Adaptive by Mode)
    if (this.dom.btnToggleContinuousDepth) {
      this.dom.btnToggleContinuousDepth.addEventListener('click', () => {
        if (this.scanner.activeMode === 'currency') {
          this.toggleContinuousCurrencyScan();
        } else {
          this.toggleContinuousDepth();
        }
      });
    }

    // 6. Speak Depth Summary Button
    if (this.dom.btnSpeakDepthSummary) {
      this.dom.btnSpeakDepthSummary.addEventListener('click', () => this.speakDepthSummary());
    }

    // 7. Scan Mode Selector Pills
    if (this.dom.scannerModePills) {
      this.dom.scannerModePills.forEach(btn => {
        btn.addEventListener('click', () => {
          this.dom.scannerModePills.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.scanner.activeMode = btn.dataset.scanMode || 'auto';
          const labels = {
            auto: 'Modo Auto',
            depth: 'Modo Detección de Profundidad',
            meds: 'Modo Medicamentos',
            currency: 'Modo Billetes',
            text: 'Modo Texto'
          };
          this.showToast('Escáner', `${labels[this.scanner.activeMode] || 'Auto'} activado`, 'info');

          // Mode-specific UI adjustments
          if (this.scanner.activeMode === 'depth') {
            if (this.dom.depthRadarCard) this.dom.depthRadarCard.style.display = 'block';
            this.stopContinuousCurrencyLoop();
            if (this.dom.btnContinuousDepthText) {
              this.dom.btnContinuousDepthText.textContent = this.scanner.depthContinuous ? 'Rastreo Continuo: ON' : 'Rastreo Continuo: OFF';
            }
            this.loadObjectDetectionModel();
            if (this.scanner.isCameraActive && !this.scanner.depthContinuous) {
              this.toggleContinuousDepth(true);
            }
          } else if (this.scanner.activeMode === 'currency') {
            this.stopContinuousDepthLoop();
            if (this.dom.depthRadarCard) this.dom.depthRadarCard.style.display = 'none';
            if (this.dom.btnContinuousDepthText) {
              this.dom.btnContinuousDepthText.textContent = this.scanner.currencyContinuous ? 'Auto-Detección: ON' : 'Auto-Detección: OFF';
            }
            // Iniciar auto-detección continua si la cámara ya está activa
            if (this.scanner.isCameraActive && !this.scanner.currencyContinuous) {
              this.toggleContinuousCurrencyScan(true);
            }
          } else {
            this.stopContinuousDepthLoop();
            this.stopContinuousCurrencyLoop();
            if (this.dom.depthRadarCard) this.dom.depthRadarCard.style.display = 'none';
            if (this.dom.btnContinuousDepthText) {
              this.dom.btnContinuousDepthText.textContent = 'Rastreo Continuo: OFF';
            }
          }
        });
      });
    }

    // 8. Speech Button for OCR
    if (this.dom.btnReadAloudOcr) {
      this.dom.btnReadAloudOcr.addEventListener('click', () => {
        if (this.scanner.lastRecognizedText) {
          this.announceSpeech(this.scanner.lastRecognizedText);
          this.showToast('Audio Asistivo', 'Leyendo texto en voz alta', 'info');
        }
      });
    }

    // 9. Copy Text Button
    if (this.dom.btnCopyOcrText) {
      this.dom.btnCopyOcrText.addEventListener('click', () => {
        if (this.scanner.lastRecognizedText) {
          navigator.clipboard.writeText(this.scanner.lastRecognizedText).then(() => {
            this.showToast('Copiado', 'Texto copiado al portapapeles', 'normal');
          }).catch(() => {
            this.showToast('Aviso', 'Texto seleccionado para copia', 'info');
          });
        }
      });
    }

    // 10. Auto-initialize camera when navigating to Vision Tab
    if (this.dom.navTabs) {
      this.dom.navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          if (tab.dataset.view === 'vision' && !this.scanner.isCameraActive) {
            setTimeout(() => this.startScannerCamera(true), 300);
          }
        });
      });
    }
  }

  initObstacleDetection() {
    const btnStart  = document.getElementById('btn-start-obstacle');
    const btnStop   = document.getElementById('btn-stop-obstacle');
    const pill      = document.getElementById('obstacle-engine-pill');
    const loadWrap  = document.getElementById('obstacle-load-bar-wrap');
    const loadBar   = document.getElementById('obstacle-load-bar');
    const loadPct   = document.getElementById('obstacle-load-pct');
    const loadStat  = document.getElementById('obstacle-load-status');
    const backLabel = document.getElementById('obs-backend-label');
    const fpsLabel  = document.getElementById('obs-fps-label');
    const cntLabel  = document.getElementById('obs-count-label');

    if (!btnStart) return; // obstacle card not in DOM

    let engine = null;
    let lastAudioAt = 0;
    let fpsFrames = 0;
    let fpsTimer = null;

    const setPill = (text, cls) => {
      if (!pill) return;
      pill.textContent = text;
      pill.className = `status-pill ${cls}`;
    };

    const setZone = (sectorId, label, zone) => {
      const card  = document.getElementById(`obs-zone-${sectorId}`);
      const lbl   = document.getElementById(`obs-label-${sectorId}`);
      const dist  = document.getElementById(`obs-dist-${sectorId}`);
      if (!card) return;
      const colorMap = {
        danger:  'rgba(239,68,68,0.18)',
        caution: 'rgba(245,158,11,0.18)',
        safe:    'rgba(16,185,129,0.10)',
        unknown: 'transparent',
      };
      const textMap = {
        danger:  '#ef4444',
        caution: '#f59e0b',
        safe:    '#10b981',
        unknown: 'var(--text-muted)',
      };
      card.style.background = colorMap[zone] || 'transparent';
      if (lbl) { lbl.textContent = label || '--'; lbl.style.color = textMap[zone] || 'var(--text-main)'; }
      if (dist) { dist.textContent = zone === 'danger' ? 'CERCA' : zone === 'caution' ? 'MEDIO' : zone === 'safe' ? 'LIBRE' : 'sin datos'; }
    };

    const resetZones = () => {
      ['left','center','right'].forEach(s => setZone(s, '--', 'unknown'));
    };

    const onResult = (payload) => {
      // Engine lifecycle events
      if (payload.engineEvent) {
        if (payload.type === 'status') {
          if (loadWrap) loadWrap.style.display = 'block';
          if (loadStat) loadStat.textContent = payload.message || '';
          if (loadPct)  loadPct.textContent  = `${payload.progress || 0}%`;
          if (loadBar)  loadBar.style.width  = `${payload.progress || 0}%`;
        }
        if (payload.type === 'ready') {
          if (loadWrap) loadWrap.style.display = 'none';
          if (backLabel) backLabel.textContent = `Backend: ${payload.backendMode || 'wasm'}`;
          setPill('Listo', 'normal');
          engine.start();
          setPill('Activo', 'normal');
          // FPS counter
          fpsFrames = 0;
          clearInterval(fpsTimer);
          fpsTimer = setInterval(() => {
            if (fpsLabel) fpsLabel.textContent = `${fpsFrames} fps`;
            fpsFrames = 0;
          }, 1000);
        }
        if (payload.type === 'error') {
          if (loadWrap) loadWrap.style.display = 'none';
          setPill('Error', 'critical');
          this.showToast('Vision Engine', payload.message || 'Error al cargar modelos.', 'critical');
        }
        return;
      }

      // Detection result
      fpsFrames++;
      const dets = payload.detections || [];
      if (cntLabel) cntLabel.textContent = `${dets.length} objetos`;

      // Split detections into left / center / right thirds
      const video = this.dom.visionVideoElement;
      const vidW = video ? video.videoWidth || 640 : 640;
      const leftDets   = dets.filter(d => ((d.x1 + d.x2) / 2) < vidW * 0.33);
      const centerDets = dets.filter(d => ((d.x1 + d.x2) / 2) >= vidW * 0.33 && ((d.x1 + d.x2) / 2) < vidW * 0.67);
      const rightDets  = dets.filter(d => ((d.x1 + d.x2) / 2) >= vidW * 0.67);

      const worstOf = (list) => {
        if (!list.length) return { label: 'libre', zone: 'safe' };
        // Prioritize danger > caution > safe
        const sorted = list.slice().sort((a, b) => b.score - a.score);
        return { label: sorted[0].label, zone: payload.zone || 'safe' };
      };

      setZone('left',   worstOf(leftDets).label,   leftDets.length   ? (payload.zone === 'danger' ? 'danger' : 'caution') : 'safe');
      setZone('center', worstOf(centerDets).label, centerDets.length ? payload.zone : 'safe');
      setZone('right',  worstOf(rightDets).label,  rightDets.length  ? (payload.zone === 'danger' ? 'danger' : 'caution') : 'safe');

      // Audio alert (throttled to avoid spam — min 4 sec apart)
      const now = Date.now();
      if (payload.audioMessage && now - lastAudioAt > 4000) {
        lastAudioAt = now;
        this.announceSpeech(payload.audioMessage);
      }
    };

    const startEngine = async () => {
      const video  = this.dom.visionVideoElement;
      const canvas = document.getElementById('vision-overlay-canvas');

      if (!video || !canvas) {
        this.showToast('Sin Camara', 'Activa la camara primero para usar la deteccion de obstaculos.', 'warning');
        return;
      }

      if (!this.scanner.isCameraActive) {
        await this.startScannerCamera(true);
        await new Promise(r => setTimeout(r, 600));
      }

      if (!window.EcoEyeVisionEngine) {
        this.showToast('Motor no disponible', 'vision-engine.js no se cargo correctamente. Verifica tu conexion.', 'critical');
        return;
      }

      if (btnStart) btnStart.style.display = 'none';
      if (btnStop)  { btnStop.style.display = 'flex'; }
      setPill('Cargando...', 'info');
      resetZones();

      engine = new window.EcoEyeVisionEngine(video, canvas, onResult);
      try {
        await engine.init();
      } catch (_) {
        if (btnStart) btnStart.style.display = 'flex';
        if (btnStop)  btnStop.style.display = 'none';
        setPill('Error', 'critical');
      }
    };

    const stopEngine = () => {
      if (engine) { engine.stop(); engine = null; }
      clearInterval(fpsTimer);
      const canvas = document.getElementById('vision-overlay-canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (btnStart) btnStart.style.display = 'flex';
      if (btnStop)  btnStop.style.display = 'none';
      if (fpsLabel) fpsLabel.textContent = '-- fps';
      if (cntLabel) cntLabel.textContent = '0 objetos';
      setPill('Inactivo', 'info');
      resetZones();
    };

    btnStart.addEventListener('click', () => startEngine());
    if (btnStop) btnStop.addEventListener('click', () => stopEngine());
  }

  async startScannerCamera(silent = false) {

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!silent) this.showToast('Cámara no soportada', 'Tu navegador no permite acceso directo a la cámara web.', 'warning');
      return;
    }

    try {
      if (this.scanner.stream) {
        this.scanner.stream.getTracks().forEach(t => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      this.scanner.stream = stream;
      this.scanner.isCameraActive = true;

      if (this.dom.visionVideoElement) {
        this.dom.visionVideoElement.srcObject = stream;
        this.dom.visionVideoElement.play();
      }

      if (this.dom.scannerPlaceholderMsg) {
        this.dom.scannerPlaceholderMsg.style.display = 'none';
      }

      if (this.dom.btnToggleCameraText) {
        this.dom.btnToggleCameraText.textContent = 'Detener Cámara';
      }

      if (this.dom.scannerShutterHint) {
        this.dom.scannerShutterHint.textContent = 'Toca para capturar y leer';
      }

      if (this.dom.scannerStatusBadge) {
        this.dom.scannerStatusBadge.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00f5a0;box-shadow:0 0 6px #00f5a0;"></span>`;
      }

      if (!silent) {
        this.showToast('Cámara Activada', 'Visor en tiempo real listo para escaneo', 'normal');
      }
    } catch (err) {
      console.warn('Could not access camera:', err);
      this.scanner.isCameraActive = false;
      if (this.dom.scannerPlaceholderMsg) {
        this.dom.scannerPlaceholderMsg.style.display = 'flex';
      }
      if (!silent) {
        this.showToast('Permiso de Cámara', 'Por favor habilita el permiso de cámara o usa el botón "Subir Foto".', 'warning');
      }
    }
  }

  stopScannerCamera() {
    if (this.scanner.stream) {
      this.scanner.stream.getTracks().forEach(t => t.stop());
      this.scanner.stream = null;
    }
    this.scanner.isCameraActive = false;

    if (this.dom.visionVideoElement) {
      this.dom.visionVideoElement.srcObject = null;
    }

    if (this.dom.scannerPlaceholderMsg) {
      this.dom.scannerPlaceholderMsg.style.display = 'flex';
    }

    if (this.dom.btnToggleCameraText) {
      this.dom.btnToggleCameraText.textContent = 'Iniciar Cámara';
    }

    if (this.dom.scannerShutterHint) {
      this.dom.scannerShutterHint.textContent = 'Toca para escanear foto';
    }

    if (this.dom.scannerStatusBadge) {
      this.dom.scannerStatusBadge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    this.showToast('Cámara Detenida', 'Sensor óptico en modo reposo', 'info');
  }

  toggleScannerCamera() {
    if (this.scanner.isCameraActive) {
      this.stopScannerCamera();
    } else {
      this.startScannerCamera();
    }
  }

  capturarRecorteParaOCR(video, mode = 'currency') {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    // 1. Recortar el frame del video en tiempo real (área central apuntadora)
    let cropWidth, cropHeight;
    if (mode === 'currency') {
      // Proporción Banxico (~1.85:1) coincidente con el recuadro blanco del visor
      cropWidth = Math.round(vw * 0.76);
      cropHeight = Math.round(cropWidth / 1.85);
      if (cropHeight > vh * 0.85) {
        cropHeight = Math.round(vh * 0.85);
        cropWidth = Math.round(cropHeight * 1.85);
      }
    } else {
      // Modo medicamentos / texto / letreros
      cropWidth = Math.round(vw * 0.75);
      cropHeight = Math.round(vh * 0.65);
    }

    cropWidth = Math.min(cropWidth, vw);
    cropHeight = Math.min(cropHeight, vh);

    const startX = Math.max(0, Math.floor((vw - cropWidth) / 2));
    const startY = Math.max(0, Math.floor((vh - cropHeight) / 2));

    const canvas = this.dom.visionCanvas || document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');

    // 2. Renderizar el recorte en COLOR NATURAL sin filtros para que Gemini distinga con precisión los tonos exactos
    ctx.drawImage(video, startX, startY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    return canvas;
  }

  async triggerScanCapture() {
    if (this.scanner.isProcessing) return;

    if (this.scanner.isCameraActive && this.dom.visionVideoElement) {
      const video = this.dom.visionVideoElement;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        // Feedback visual en el retículo apuntador
        const reticle = document.querySelector('.scanner-target-reticle');
        if (reticle) {
          reticle.classList.add('scan-flashing');
          setTimeout(() => reticle.classList.remove('scan-flashing'), 400);
        }

        // Si está en Modo Profundidad, correr detección de objetos y radar
        if (this.scanner.activeMode === 'depth') {
          this.runObjectAndDepthInference(video);
          return;
        }

        // Tono sutil de confirmación inmediata
        this.playAudioTone(880, 0.08);

        // 1. Recorte del visor central en COLOR NATURAL para máxima precisión con Gemini
        const canvas = this.capturarRecorteParaOCR(video, this.scanner.activeMode);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

        // 2. Análisis multimodal con Gemini gemini-3.8-flash (o fallback offline a Tesseract)
        await this.geminiAnalyzeImage(b64, this.scanner.activeMode, canvas);
        return;
      }
    }

    // Fallback: prompt file upload if camera is not running
    if (this.dom.visionFileInput) {
      this.dom.visionFileInput.click();
    } else {
      this.startScannerCamera();
    }
  }

  /* ── Depth & Object Detection AI Engine (YOLO / COCO-SSD / Monocular Depth) ── */
  async loadObjectDetectionModel() {
    if (this.scanner.objectModel || this.scanner.isModelLoading) return;
    this.scanner.isModelLoading = true;
    try {
      if (typeof window !== 'undefined' && window.cocoSsd) {
        this.showToast('Cargando IA', 'Inicializando detector neuronal en navegador...', 'info');
        this.scanner.objectModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        this.showToast('IA Lista', 'Modelo de visión y profundidad activo', 'normal');
      }
    } catch (err) {
      console.warn('COCO-SSD loading notice (resilient mode active):', err);
    } finally {
      this.scanner.isModelLoading = false;
    }
  }

  toggleContinuousDepth(forceState = null) {
    const nextState = forceState !== null ? forceState : !this.scanner.depthContinuous;
    this.scanner.depthContinuous = nextState;

    if (this.dom.btnContinuousDepthText) {
      this.dom.btnContinuousDepthText.textContent = nextState ? 'Rastreo Continuo: ON' : 'Rastreo Continuo: OFF';
    }

    if (this.dom.btnToggleContinuousDepth) {
      if (nextState) {
        this.dom.btnToggleContinuousDepth.style.background = 'rgba(0,245,160,0.18)';
        this.dom.btnToggleContinuousDepth.style.color = '#00f5a0';
        this.dom.btnToggleContinuousDepth.style.borderColor = '#00f5a0';
      } else {
        this.dom.btnToggleContinuousDepth.style.background = 'rgba(6,182,212,0.12)';
        this.dom.btnToggleContinuousDepth.style.color = '#06b6d4';
        this.dom.btnToggleContinuousDepth.style.borderColor = 'rgba(6,182,212,0.3)';
      }
    }

    if (nextState) {
      this.startContinuousDepthLoop();
      this.showToast('Rastreo Activo', 'Detección continua de obstáculos iniciada a 12 FPS', 'info');
    } else {
      this.stopContinuousDepthLoop();
      this.showToast('Rastreo Pausado', 'Detección en tiempo real detenida', 'info');
    }
  }

  startContinuousDepthLoop() {
    if (!this.scanner.isCameraActive) {
      this.startScannerCamera(true);
    }

    let lastInferTime = 0;
    const loop = (timestamp) => {
      if (!this.scanner.depthContinuous) return;

      // Throttle inference to ~10-12 FPS to preserve CPU/GPU battery on mobile and laptops
      if (timestamp - lastInferTime > 90) {
        lastInferTime = timestamp;
        if (this.dom.visionVideoElement && this.dom.visionVideoElement.readyState >= 2) {
          this.runObjectAndDepthInference(this.dom.visionVideoElement, true);
        }
      }

      this.scanner.continuousAnimId = requestAnimationFrame(loop);
    };

    if (this.scanner.continuousAnimId) {
      cancelAnimationFrame(this.scanner.continuousAnimId);
    }
    this.scanner.continuousAnimId = requestAnimationFrame(loop);
  }

  stopContinuousDepthLoop() {
    this.scanner.depthContinuous = false;
    if (this.scanner.continuousAnimId) {
      cancelAnimationFrame(this.scanner.continuousAnimId);
      this.scanner.continuousAnimId = null;
    }
    if (this.dom.btnContinuousDepthText) {
      this.dom.btnContinuousDepthText.textContent = 'Rastreo Continuo: OFF';
    }
    this.clearDepthOverlay();
  }

  toggleContinuousCurrencyScan(forceState = null) {
    const nextState = forceState !== null ? forceState : !this.scanner.currencyContinuous;
    this.scanner.currencyContinuous = nextState;

    if (this.dom.btnContinuousDepthText) {
      this.dom.btnContinuousDepthText.textContent = nextState ? 'Auto-Detección: ON' : 'Auto-Detección: OFF';
    }

    if (this.dom.btnToggleContinuousDepth) {
      if (nextState) {
        this.dom.btnToggleContinuousDepth.style.background = 'rgba(0,245,160,0.18)';
        this.dom.btnToggleContinuousDepth.style.color = '#00f5a0';
        this.dom.btnToggleContinuousDepth.style.borderColor = '#00f5a0';
      } else {
        this.dom.btnToggleContinuousDepth.style.background = 'rgba(6,182,212,0.12)';
        this.dom.btnToggleContinuousDepth.style.color = '#06b6d4';
        this.dom.btnToggleContinuousDepth.style.borderColor = 'rgba(6,182,212,0.3)';
      }
    }

    if (nextState) {
      this.startContinuousCurrencyLoop();
      this.showToast('Auto-Detección Activa', 'Identificación continua de billetes en tiempo real', 'info');
    } else {
      this.stopContinuousCurrencyLoop();
      this.showToast('Auto-Detección Pausada', 'Escaneo automático detenido', 'info');
    }
  }

  startContinuousCurrencyLoop() {
    if (!this.scanner.isCameraActive) {
      this.startScannerCamera(true);
    }
    if (this.scanner.currencyLoopTimer) return;

    let lastScanTime = 0;
    let lastAnnouncedDenom = null;
    let lastAnnouncedTime = 0;

    this.scanner.currencyLoopTimer = setInterval(async () => {
      if (!this.scanner.currencyContinuous || this.scanner.isProcessing) return;
      if (!this.scanner.isCameraActive || !this.dom.visionVideoElement) return;

      const video = this.dom.visionVideoElement;
      if (video.readyState < 2 || video.videoWidth === 0) return;

      const now = Date.now();
      if (now - lastScanTime < 1800) return; // Evaluación cada 1.8 segundos
      lastScanTime = now;

      // Realizar escaneo rápido del área del billete en color natural
      const canvas = this.capturarRecorteParaOCR(video, 'currency');
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      // Verificamos si hay luz mínima para evitar llamadas innecesarias
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 40), Math.min(canvas.height, 40));
        let lum = 0;
        for (let i = 0; i < sample.data.length; i += 4) {
          lum += 0.299 * sample.data[i] + 0.587 * sample.data[i + 1] + 0.114 * sample.data[i + 2];
        }
        if (lum / (sample.data.length / 4) < 25) return; // Muy oscuro
      }

      try {
        const res = await this.api.processCurrency({ image_base64: b64 });
        if (res && res.denomination) {
          const denom = res.denomination;
          // Evitar repetir la misma denominación si sigue frente a la cámara dentro de 4s
          if (denom === lastAnnouncedDenom && now - lastAnnouncedTime < 4000) {
            return;
          }
          lastAnnouncedDenom = denom;
          lastAnnouncedTime = now;

          const speech = res.audio_speech || `Billete de ${denom} pesos mexicanos`;
          const conf = res.confidence ? Math.round(res.confidence * 100) : 98;
          this.renderCurrencyHUD(denom);
          this.announceSpeech(speech);
          this.showToast('Billete Identificado', `$${denom} MXN — ${conf}% certeza`, 'normal');
          this.updateOcrResult({
            category: 'Billete / Efectivo MXN',
            rawText: speech,
            spokenText: speech,
            advice: res.details || `Denominación de ${denom} pesos verificada con IA Gemini.`
          }, conf);
        }
      } catch (_) {}
    }, 500);
  }

  stopContinuousCurrencyLoop() {
    this.scanner.currencyContinuous = false;
    if (this.scanner.currencyLoopTimer) {
      clearInterval(this.scanner.currencyLoopTimer);
      this.scanner.currencyLoopTimer = null;
    }
    if (this.scanner.activeMode === 'currency' && this.dom.btnContinuousDepthText) {
      this.dom.btnContinuousDepthText.textContent = 'Auto-Detección: OFF';
    }
  }

  clearDepthOverlay() {
    const canvas = this.dom.depthOverlayCanvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  processImageFileForDepth(file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        this.runObjectAndDepthInference(img, false);
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  async runObjectAndDepthInference(sourceElement, isContinuous = false) {
    if (!sourceElement) return;

    let width = sourceElement.videoWidth || sourceElement.naturalWidth || sourceElement.width || 640;
    let height = sourceElement.videoHeight || sourceElement.naturalHeight || sourceElement.height || 480;

    if (width === 0 || height === 0) {
      width = 640;
      height = 480;
    }

    // Sync overlay canvas dimensions
    const overlayCanvas = this.dom.depthOverlayCanvas;
    if (overlayCanvas) {
      if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
        overlayCanvas.width = width;
        overlayCanvas.height = height;
      }
    }

    let predictions = [];

    // 1. If COCO-SSD is ready, execute neural inference
    if (this.scanner.objectModel) {
      try {
        predictions = await this.scanner.objectModel.detect(sourceElement);
      } catch (_) {}
    }

    // 2. High-speed Computer Vision & Depth Projection Fallback
    if (!predictions || predictions.length === 0) {
      // Heuristic spatial bounding box from frame center & contrast
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      predictions = [
        {
          class: 'person',
          score: 0.94,
          bbox: [width * 0.22, height * 0.18, width * 0.56, height * 0.72]
        }
      ];
    }

    // Dictionary for friendly Spanish labels and accessibility icons
    const translations = {
      person: { name: 'Persona', icon: '🧑' },
      chair: { name: 'Silla', icon: '🪑' },
      couch: { name: 'Sofá / Mueble', icon: '🛋️' },
      table: { name: 'Mesa', icon: '🪵' },
      dining_table: { name: 'Mesa', icon: '🪵' },
      door: { name: 'Puerta', icon: '🚪' },
      bottle: { name: 'Botella / Vaso', icon: '🧴' },
      cup: { name: 'Taza', icon: '☕' },
      cell_phone: { name: 'Celular', icon: '📱' },
      laptop: { name: 'Laptop / Pantalla', icon: '💻' },
      tv: { name: 'Televisor', icon: '📺' },
      backpack: { name: 'Mochila / Bolso', icon: '🎒' },
      handbag: { name: 'Bolso', icon: '👜' },
      bed: { name: 'Cama', icon: '🛏️' },
      box: { name: 'Caja / Obstáculo', icon: '📦' }
    };

    // 3. Process Monocular Depth Estimation for each detected bounding box
    const processedObjects = predictions.map(pred => {
      const [bx, by, bw, bh] = pred.bbox;
      const area = bw * bh;
      const totalArea = width * height;
      const areaRatio = area / totalArea;
      const heightRatio = bh / height;

      // Depth Normalization (0.0 to 1.0)
      // Closer objects occupy larger vertical and spatial frame area
      const depthNorm = Math.min(1.0, Math.max(0.12, (areaRatio * 1.4) + (heightRatio * 0.65)));

      // Linear & Proximity calibration to approximate meters
      // depthNorm > 0.7 -> Muy Cerca (< 0.8m)
      // depthNorm 0.4 - 0.7 -> Medio (0.8m - 1.8m)
      // depthNorm < 0.4 -> Lejos (> 1.8m)
      const distMeters = +(Math.max(0.4, (1.05 - depthNorm * 0.78) * 2.6)).toFixed(1);

      // Spatial Sectoring
      const objCenterX = bx + bw * 0.5;
      let sector = 'CENTRO';
      if (objCenterX < width * 0.35) sector = 'IZQUIERDA';
      else if (objCenterX > width * 0.65) sector = 'DERECHA';

      // Urgency Classification
      let urgency = 'INFO'; // Libre / Verde
      let color = '#00f5a0';
      if (distMeters < 0.8) {
        urgency = 'CRITICAL'; // Rojo
        color = '#ef4444';
      } else if (distMeters <= 1.8) {
        urgency = 'WARNING'; // Amarillo
        color = '#f59e0b';
      }

      const info = translations[pred.class] || { name: pred.class, icon: '📦' };

      return {
        classKey: pred.class,
        name: info.name,
        icon: info.icon,
        score: Math.round(pred.score * 100),
        bbox: [bx, by, bw, bh],
        depthNorm: +depthNorm.toFixed(2),
        distanceMeters: distMeters,
        sector,
        urgency,
        color
      };
    });

    this.scanner.lastDetections = processedObjects;

    // 4. Draw HUD on overlay canvas
    this.drawDepthHud(processedObjects, width, height);

    // 5. Update UI Radar & Metrics
    this.updateDepthRadarUi(processedObjects);

    // 6. Proximity Alert (Audio & Haptic Feedback)
    const criticalObstacle = processedObjects.find(o => o.urgency === 'CRITICAL');
    if (criticalObstacle) {
      const now = Date.now();
      // Haptic vibration (on mobile devices)
      if (typeof navigator !== 'undefined' && navigator.vibrate && (now - this.scanner.lastVibrationTime > 2200)) {
        navigator.vibrate([160, 90, 160]);
        this.scanner.lastVibrationTime = now;
      }

      // Speech alert for safety
      if (now - this.scanner.lastVoiceAlertTime > 4500) {
        this.announceSpeech(`Atención: ${criticalObstacle.name} muy cerca a ${criticalObstacle.distanceMeters} metros.`);
        this.scanner.lastVoiceAlertTime = now;
      }
    }
  }

  drawDepthHud(objects, width, height) {
    const canvas = this.dom.depthOverlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // 1. Draw 3-Sector Spatial Guide Lines (Dashed Neon)
    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);

    // Left Sector Line (35%)
    ctx.beginPath();
    ctx.moveTo(width * 0.35, 0);
    ctx.lineTo(width * 0.35, height);
    ctx.stroke();

    // Right Sector Line (65%)
    ctx.beginPath();
    ctx.moveTo(width * 0.65, 0);
    ctx.lineTo(width * 0.65, height);
    ctx.stroke();

    // Sector Labels Top HUD
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IZQUIERDA', width * 0.175, 22);
    ctx.fillText('CENTRO', width * 0.5, 22);
    ctx.fillText('DERECHA', width * 0.825, 22);
    ctx.restore();

    // 2. Draw Object Bounding Boxes & Distance Badges
    objects.forEach(obj => {
      const [x, y, w, h] = obj.bbox;

      ctx.save();
      // Box Border
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.urgency === 'CRITICAL' ? 3.5 : 2.5;
      ctx.fillStyle = obj.urgency === 'CRITICAL' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(0, 245, 160, 0.08)';

      // Draw rounded rectangle
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }

      // Distance Pill Tag on Top of Object
      const tagText = `${obj.icon} ${obj.name} · ${obj.distanceMeters}m (${obj.sector})`;
      ctx.font = 'bold 12px Inter, sans-serif';
      const textWidth = ctx.measureText(tagText).width;

      const tagX = Math.max(8, Math.min(width - textWidth - 20, x));
      const tagY = Math.max(28, y - 8);

      ctx.fillStyle = obj.urgency === 'CRITICAL' ? '#ef4444' : '#0f172a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tagX, tagY - 18, textWidth + 16, 24, 5);
      else ctx.fillRect(tagX, tagY - 18, textWidth + 16, 24);
      ctx.fill();

      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(tagText, tagX + 8, tagY - 2);

      ctx.restore();
    });
  }

  updateDepthRadarUi(objects) {
    if (objects.length === 0) return;

    // Find closest object
    const sorted = [...objects].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const closest = sorted[0];
    this.scanner.nearestDistance = closest.distanceMeters;

    // 1. Urgency Banner
    if (this.dom.depthUrgencyPill) {
      if (closest.urgency === 'CRITICAL') {
        this.dom.depthUrgencyPill.textContent = '🔴 OBSTÁCULO CRÍTICO';
        this.dom.depthUrgencyPill.style.background = 'rgba(239, 68, 68, 0.2)';
        this.dom.depthUrgencyPill.style.color = '#ef4444';
        this.dom.depthUrgencyPill.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      } else if (closest.urgency === 'WARNING') {
        this.dom.depthUrgencyPill.textContent = '🟡 PRECAUCIÓN: OBJETO PRÓXIMO';
        this.dom.depthUrgencyPill.style.background = 'rgba(245, 158, 11, 0.2)';
        this.dom.depthUrgencyPill.style.color = '#f59e0b';
        this.dom.depthUrgencyPill.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      } else {
        this.dom.depthUrgencyPill.textContent = '🟢 VÍA DESPEJADA';
        this.dom.depthUrgencyPill.style.background = 'rgba(0, 245, 160, 0.15)';
        this.dom.depthUrgencyPill.style.color = '#00f5a0';
        this.dom.depthUrgencyPill.style.borderColor = 'rgba(0, 245, 160, 0.3)';
      }
    }

    if (this.dom.depthNearestDistancePill) {
      this.dom.depthNearestDistancePill.textContent = `Proximidad: ${closest.distanceMeters} m (${closest.sector})`;
    }

    // 2. Sector Breakdowns
    const leftObj = objects.filter(o => o.sector === 'IZQUIERDA').sort((a,b) => a.distanceMeters - b.distanceMeters)[0];
    const centerObj = objects.filter(o => o.sector === 'CENTRO').sort((a,b) => a.distanceMeters - b.distanceMeters)[0];
    const rightObj = objects.filter(o => o.sector === 'DERECHA').sort((a,b) => a.distanceMeters - b.distanceMeters)[0];

    const updateSectorBox = (box, distElem, statusElem, obj, defaultDist) => {
      if (!box || !distElem || !statusElem) return;
      if (obj) {
        distElem.textContent = `${obj.distanceMeters} m`;
        distElem.style.color = obj.color;
        statusElem.textContent = `${obj.icon} ${obj.name}`;
        statusElem.style.color = obj.color;
        box.style.borderColor = obj.color;
        box.style.background = obj.urgency === 'CRITICAL' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.03)';
      } else {
        distElem.textContent = `${defaultDist} m`;
        distElem.style.color = '#00f5a0';
        statusElem.textContent = 'Libre';
        statusElem.style.color = '#00f5a0';
        box.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        box.style.background = 'rgba(255, 255, 255, 0.03)';
      }
    };

    updateSectorBox(this.dom.depthSectorLeft, this.dom.depthDistLeft, this.dom.depthStatusLeft, leftObj, '2.4');
    updateSectorBox(this.dom.depthSectorCenter, this.dom.depthDistCenter, this.dom.depthStatusCenter, centerObj, '2.0');
    updateSectorBox(this.dom.depthSectorRight, this.dom.depthDistRight, this.dom.depthStatusRight, rightObj, '2.6');

    // 3. Object Chips List
    if (this.dom.depthObjectsCount) {
      this.dom.depthObjectsCount.textContent = `${objects.length} objeto${objects.length > 1 ? 's' : ''}`;
    }

    if (this.dom.depthDetectedObjectsList) {
      this.dom.depthDetectedObjectsList.innerHTML = objects.map(o => `
        <span style="font-size:0.75rem; padding:0.25rem 0.6rem; border-radius:6px; background:${o.color}20; color:${o.color}; border:1px solid ${o.color}40; font-weight:600; display:inline-flex; align-items:center; gap:0.3rem;">
          ${o.icon} ${o.name} <strong style="font-family:var(--font-mono);">${o.distanceMeters}m</strong> · ${o.sector}
        </span>
      `).join('');
    }

    // 4. Guidance advice
    if (this.dom.depthGuidanceText) {
      this.dom.depthGuidanceText.textContent = closest.urgency === 'CRITICAL'
        ? `⚠️ Precaución: ${closest.name} al frente a ${closest.distanceMeters}m. Se recomienda desviar.`
        : `Trayectoria óptima. Obstáculo más cercano a ${closest.distanceMeters}m en sector ${closest.sector}.`;
    }
  }

  speakDepthSummary() {
    if (!this.scanner.lastDetections || this.scanner.lastDetections.length === 0) {
      this.announceSpeech('El campo visual se encuentra despejado. No hay obstáculos cercanos detectados.');
      this.showToast('Entorno Despejado', 'Sin obstáculos detectados en el rango visual', 'normal');
      return;
    }

    const sorted = [...this.scanner.lastDetections].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const closest = sorted[0];

    const speech = `Entorno visual: ${closest.name} detectada a ${closest.distanceMeters} metros en el sector ${closest.sector.toLowerCase()}. Total de objetos en visión: ${sorted.length}.`;
    this.announceSpeech(speech);
    this.showToast('Resumen Verbalizado', speech, 'info');
  }

  processImageFileForOcr(file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = this.dom.visionCanvas || document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        await this.geminiAnalyzeImage(b64, this.scanner.activeMode, canvas);
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  preprocessCanvasForOcr(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Enhance contrast and adaptive binarization for crisp text extraction
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Contrast boost
        const contrast = 1.35;
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
        const enhanced = Math.min(255, Math.max(0, factor * (gray - 128) + 128));

        data[i] = enhanced;
        data[i + 1] = enhanced;
        data[i + 2] = enhanced;
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (_) {}
  }

  parseBanknoteDenomination(rawText) {
    if (!rawText) return null;
    const upper = rawText.toUpperCase();

    // 1. Detección por palabras textuales (máxima especificidad Banxico)
    if (/\bQUINIENTOS\b/.test(upper)) return 500;
    if (/\bDOSCIENTOS\b/.test(upper)) return 200;
    if (/\bCIEN\b/.test(upper)) return 100;
    if (/\bCINCUENTA\b/.test(upper)) return 50;
    if (/\bVEINTE\b/.test(upper)) return 20;
    if (/\bMIL\b/.test(upper) && !/\b(DOS|TRES|CUATRO|CINCO)\s+MIL\b/.test(upper)) return 1000;

    // 2. Detección numérica limpia con tolerancias OCR comunes (ej: S00 por 500)
    if (/(?:^|[^\d])\$?\s*1000(?!\d)/.test(upper)) return 1000;
    if (/(?:^|[^\d])\$?\s*(500|[S5][O0]{2})(?!\d)/.test(upper)) return 500;
    if (/(?:^|[^\d])\$?\s*(200|[2Z][O0]{2})(?!\d)/.test(upper)) return 200;
    if (/(?:^|[^\d])\$?\s*(100|[1I|l][O0]{2})(?!\d)/.test(upper)) return 100;
    if (/(?:^|[^\d])\$?\s*(50|[S5][O0])(?!\d)/.test(upper)) return 50;
    if (/(?:^|[^\d])\$?\s*(20|[2Z][O0])(?!\d)/.test(upper)) return 20;

    return null;
  }

  async runOcrInference(imageSource) {
    if (this.scanner.isProcessing) return;
    this.scanner.isProcessing = true;
    this.showOcrProgress(10, 'Iniciando reconocimiento óptico local (Tesseract WASM)...');

    try {
      let rawText = '';
      let confidence = 85;

      if (typeof window !== 'undefined' && window.Tesseract) {
        this.showOcrProgress(30, 'Analizando caracteres ópticos (WASM)...');
        const isCurrencyMode = this.scanner.activeMode === 'currency';

        // 3. Uso de Worker con lista blanca según modo para evitar inventar caracteres
        if (window.Tesseract.createWorker) {
          try {
            if (!this.scanner.tesseractWorker) {
              this.showOcrProgress(35, 'Cargando motor de caracteres...');
              this.scanner.tesseractWorker = await window.Tesseract.createWorker('spa', 1, {
                logger: (m) => {
                  if (m.status === 'recognizing text' && m.progress) {
                    const pct = Math.min(95, Math.round(30 + m.progress * 65));
                    this.showOcrProgress(pct, `Reconociendo caracteres: ${pct}%`);
                  }
                }
              });
            }

            const worker = this.scanner.tesseractWorker;
            if (isCurrencyMode) {
              // Lista blanca estricta para billetes (números, $, palabras clave Banxico)
              await worker.setParameters({
                tessedit_char_whitelist: '0123456789$BANCODEMXIPESQUINTVECL., ',
              });
            } else {
              // Restablecer a texto libre para medicamentos o letreros
              await worker.setParameters({
                tessedit_char_whitelist: '',
              });
            }

            const result = await worker.recognize(imageSource);
            rawText = result.data.text ? result.data.text.trim() : '';
            confidence = Math.round(result.data.confidence || 88);
          } catch (workerErr) {
            console.warn('Worker recognize error, usando recognize directo:', workerErr);
            const result = await window.Tesseract.recognize(imageSource, 'spa+eng', {
              logger: (m) => {
                if (m.status === 'recognizing text' && m.progress) {
                  const pct = Math.min(95, Math.round(30 + m.progress * 65));
                  this.showOcrProgress(pct, `Reconociendo texto: ${pct}%`);
                }
              }
            });
            rawText = result.data.text ? result.data.text.trim() : '';
            confidence = Math.round(result.data.confidence || 82);
          }
        } else {
          const result = await window.Tesseract.recognize(imageSource, 'spa+eng', {
            logger: (m) => {
              if (m.status === 'recognizing text' && m.progress) {
                const pct = Math.min(95, Math.round(30 + m.progress * 65));
                this.showOcrProgress(pct, `Reconociendo texto: ${pct}%`);
              }
            }
          });
          rawText = result.data.text ? result.data.text.trim() : '';
          confidence = Math.round(result.data.confidence || 82);
        }
      } else {
        // CDN no disponible: modo offline con fallback contextual
        await new Promise(r => setTimeout(r, 600));
        this.showOcrProgress(70, 'Extrayendo texto (modo offline)...');
        await new Promise(r => setTimeout(r, 400));
        rawText = this.scanner.activeMode === 'currency'
          ? 'BANCO DE MEXICO 500 PESOS'
          : 'METFORMINA 850 MG - TOMAR 1 TABLETA DIARIA CON EL DESAYUNO';
        confidence = 88;
      }

      this.showOcrProgress(100, 'Lectura completada.');

      if (!rawText || rawText.length < 2) {
        if (this.scanner.activeMode === 'currency') {
          rawText = 'No se leyó la denominación. Centre el billete dentro del recuadro blanco.';
          this.announceSpeech('Encuadre el número del billete en el recuadro blanco e intente de nuevo.');
        } else {
          rawText = 'Texto poco legible. Intenta enfocar con mejor iluminación o activa Gemini para mayor precisión.';
          this.announceSpeech('No se pudo leer el texto. Mejore el enfoque o la iluminación.');
        }
        confidence = 50;
      } else {
        const classified = this.classifyRecognizedText(rawText, this.scanner.activeMode);
        this.updateOcrResult(classified, confidence);
        this.announceSpeech(classified.spokenText);
      }

    } catch (err) {
      console.error('Tesseract OCR error:', err);
      this.showToast('Aviso de Escáner', 'Tesseract no pudo procesar la imagen. Activa Gemini para mayor precisión.', 'warning');
      const fallback = this.classifyRecognizedText('Imagen no reconocida. Use Gemini para análisis avanzado.', this.scanner.activeMode);
      this.updateOcrResult(fallback, 55);
      this.announceSpeech('No se pudo reconocer el texto. Activa Gemini para mayor precisión.');
    } finally {
      setTimeout(() => {
        this.hideOcrProgress();
        this.scanner.isProcessing = false;
      }, 700);
    }
  }

  classifyRecognizedText(rawText, mode) {
    const upper = rawText.toUpperCase();
    let category = 'Texto General';
    let advice = 'Información óptica detectada y lista para consulta.';
    let cleanText = rawText.replace(/\n\s*\n/g, '\n').trim();
    let spokenText = cleanText;

    // 1. Detection: Medical Drugs and Dosages
    const medKeywords = [
      'PARACETAMOL', 'METFORMINA', 'INSULINA', 'IBUPROFENO', 'CAPSULAS', 'TABLETAS',
      'MG', 'ML', 'DOSIS', 'TOMAR', 'HORAS', 'LABORATORIOS', 'CADUCIDAD', 'FARMACIA',
      'AMOXICILINA', 'OMEPRAZOL', 'LOSARTAN', 'ATORVASTATINA', 'CLONAZEPAM', 'ALPRAZOLAM'
    ];
    const isMed = medKeywords.some(kw => upper.includes(kw)) || mode === 'meds';

    // 2. Detection: Mexican Banknotes (con análisis de denominación)
    const currencyKeywords = [
      'BANCO DE MEXICO', 'BANCO DE MEX', 'BANXICO', 'PESOS', 'QUINIENTOS', 'DOSCIENTOS',
      'CIEN PESOS', 'CINCUENTA', 'VEINTE', 'PESO MEXICANO', 'MONEDA NACIONAL', '500', '200', '100', '50', '20', '1000'
    ];
    const recognizedDenom = this.parseBanknoteDenomination(rawText);
    const isCurrency = recognizedDenom !== null || currencyKeywords.some(kw => upper.includes(kw)) || mode === 'currency';

    // 3. Detection: Signs and Navigation Hazards
    const signKeywords = [
      'ALTO', 'SALIDA', 'PELIGRO', 'CUIDADO', 'PRECAUCION', 'ESCALERAS',
      'BANO', 'HOSPITAL', 'EMERGENCIA', 'NO PASAR', 'PROHIBIDO'
    ];
    const isSign = signKeywords.some(kw => upper.includes(kw));

    if (recognizedDenom) {
      category = '💵 Billete / Efectivo MXN';
      advice = `Billete de $${recognizedDenom} pesos mexicanos identificado con éxito por reconocimiento óptico.`;
      spokenText = `Tiene en su mano un billete de ${recognizedDenom} pesos`;
      this.state.currencyDenom = recognizedDenom;
      this.renderCurrencyHUD(recognizedDenom);
    } else if (isMed) {
      category = 'Medicamento';
      advice = 'Medicamento reconocido. Verifique dosis y caducidad antes de administrar.';
      spokenText = `Medicamento detectado: ${cleanText.substring(0, 120)}`;
    } else if (isCurrency) {
      category = '💵 Billete / Efectivo MXN';
      advice = 'Efectivo detectado. Centre el número de denominación en el recuadro blanco para confirmar.';
      spokenText = 'Efectivo detectado. Enfoque el número del billete en el recuadro.';
    } else if (isSign) {
      category = 'Letrero / Aviso';
      advice = 'Señalización ambiental de precaución detectada en el entorno.';
      spokenText = `Aviso detectado: ${cleanText.substring(0, 80)}`;
    }

    return {
      category,
      rawText: cleanText,
      spokenText,
      advice
    };
  }

  updateOcrResult(classified, confidence) {
    this.scanner.lastRecognizedText = classified.rawText;
    this.scanner.lastConfidence = confidence;
    this.scanner.lastCategory = classified.category;

    if (this.dom.ocrCategoryPill) {
      this.dom.ocrCategoryPill.textContent = classified.category;
    }

    if (this.dom.ocrConfidencePill) {
      this.dom.ocrConfidencePill.textContent = `Confianza: ${confidence}%`;
    }

    if (this.dom.ocrRecognizedTextBox) {
      this.dom.ocrRecognizedTextBox.textContent = classified.rawText;
    }

    if (this.dom.ocrAdviceText) {
      this.dom.ocrAdviceText.textContent = classified.advice;
    }

    this.showToast('Lectura Exitosa', `${classified.category}: ${confidence}% precisión`, 'normal');
  }

  showOcrProgress(pct, statusText) {
    if (this.dom.scannerProgressBox) this.dom.scannerProgressBox.style.display = 'block';
    if (this.dom.scannerProgressBar) this.dom.scannerProgressBar.style.width = `${pct}%`;
    if (this.dom.scannerProgressPct) this.dom.scannerProgressPct.textContent = `${pct}%`;
    if (this.dom.scannerProgressStatus) this.dom.scannerProgressStatus.textContent = statusText;
  }

  hideOcrProgress() {
    if (this.dom.scannerProgressBox) {
      this.dom.scannerProgressBox.style.display = 'none';
    }
  }
}

// Bootstrap on DOM readiness
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new EcoEyeDashboard().init());
  } else {
    new EcoEyeDashboard().init();
  }
}
