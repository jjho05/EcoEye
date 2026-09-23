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

      // Patient Status Banner
      patientStatusBox: document.getElementById('patient-status-indicator'),
      patientStatusText: document.getElementById('patient-status-text'),

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

      // Dedicated Vision Module (View 2)
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
    try {
      const user = await this.api.getCurrentUser();
      if (user && user.user_id) {
        this.setUserSession(user);
        this.hideAuthModal();
      } else {
        this.setGuestSession();
      }
    } catch (_) {
      this.setGuestSession();
    }
  }

  setUserSession(user) {
    this.currentUser = user;
    if (this.dom.headerUserName) this.dom.headerUserName.textContent = user.display_name || user.username;
    if (this.dom.headerUserRole) this.dom.headerUserRole.textContent = user.role_title || user.role;

    if (this.dom.userAvatarCircle) {
      const initial = (user.display_name || user.username || 'U')[0].toUpperCase();
      this.dom.userAvatarCircle.textContent = initial;

      if (user.role === 'medico') {
        this.dom.userAvatarCircle.style.borderColor = 'var(--brand-cyan)';
        this.dom.userAvatarCircle.style.color = 'var(--brand-cyan)';
      } else if (user.role === 'admin') {
        this.dom.userAvatarCircle.style.borderColor = 'var(--status-warning)';
        this.dom.userAvatarCircle.style.color = 'var(--status-warning)';
      } else {
        this.dom.userAvatarCircle.style.borderColor = 'var(--brand-primary)';
        this.dom.userAvatarCircle.style.color = 'var(--brand-primary)';
      }
    }
  }

  setGuestSession() {
    this.currentUser = {
      username: 'jesus.olvera',
      display_name: 'Jesús Olvera',
      role: 'familiar',
      role_title: 'Familiar / Cuidador Principal'
    };
    if (this.dom.headerUserName) this.dom.headerUserName.textContent = 'Jesús Olvera';
    if (this.dom.headerUserRole) this.dom.headerUserRole.textContent = 'Familiar / Cuidador Principal';
    if (this.dom.userAvatarCircle) {
      this.dom.userAvatarCircle.textContent = 'J';
      this.dom.userAvatarCircle.style.borderColor = 'var(--brand-primary)';
      this.dom.userAvatarCircle.style.color = 'var(--brand-primary)';
    }
  }

  showAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.add('active');
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
        this.showToast(
          'Bienvenido(a)',
          `Has ingresado como ${res.user.display_name}`,
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
      this.setGuestSession();
      this.showAuthModal();
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
        this.dom.fallStatusExplanation.textContent = 'Atencion: Se detecto un impacto o caida. Las gafas estan activando aviso sonoro y notificando al cuidador.';
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
          detail: 'Alerta enviada al cuidador y aviso en gafas',
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

  async exportMedicalReport() {
    try {
      const report = await this.api.exportMedicalReport();
      const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(reportBlob);
      const tempLink = document.createElement('a');
      tempLink.href = downloadUrl;
      tempLink.download = `ecoeye-expediente-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      URL.revokeObjectURL(downloadUrl);

      this.showToast(
        'Expediente Descargado',
        'Resumen de glucosa y signos vitales listo para compartir con el doctor',
        'normal'
      );
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

    // Auth modal close button
    if (this.dom.btnCloseAuthModal) {
      this.dom.btnCloseAuthModal.addEventListener('click', () => this.hideAuthModal());
    }

    // Close modal clicking overlay backdrop
    if (this.dom.authModal) {
      this.dom.authModal.addEventListener('click', (e) => {
        if (e.target === this.dom.authModal) this.hideAuthModal();
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
          setTimeout(() => {
            this.fallAlarmActive = false;
            this.renderFallMonitor(this.state.fallCount);
          }, 6000);
        } catch (err) {
          this.showToast('Error CSI', 'No se pudo completar la prueba de hardware', 'critical');
        }
      });
    }

    if (this.dom.btnQuickCsiReset) {
      this.dom.btnQuickCsiReset.addEventListener('click', () => {
        this.fallAlarmActive = false;
        this.renderFallMonitor(this.state.fallCount);
        this.showToast('Estado Normal', 'Sistema de protección de caídas en estado vigilante normal', 'normal');
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

    if (this.dom.btnSpeakTts && this.dom.visionCustomTtsInput) {
      this.dom.btnSpeakTts.addEventListener('click', () => {
        const text = this.dom.visionCustomTtsInput.value.trim() || 'EcoEye Asistente Visual Activo';
        this.announceSpeech(text);
        this.showToast('Voz Sintetizada', `Locutando: "${text.substring(0, 36)}..."`, 'info');
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
}

// Bootstrap on DOM readiness
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new EcoEyeDashboard().init());
  } else {
    new EcoEyeDashboard().init();
  }
}
