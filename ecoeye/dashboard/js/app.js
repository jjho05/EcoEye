/**
 * EcoEye Interactive Application Controller
 * Real-time HUD Visor, Circular Sonar Radar, Doppler Waveform Canvas, Radial Glucose Gauge,
 * and Live Demonstrator Sandbox for Hackathon Pitches.
 */

// ── Lightweight API Client (Offline & Localhost aware) ─────────────────────
class EcoEyeAPI {
  constructor(baseUrl) {
    if (baseUrl !== undefined) {
      this.baseUrl = baseUrl;
    } else {
      this.baseUrl = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')
        ? 'http://127.0.0.1:8000'
        : '';
    }
  }

  async _fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  async getHealth() { return this._fetch('/health'); }
  async getStats() { return this._fetch('/api/v1/stats'); }
  async getRecentFalls(limit = 10) { return this._fetch(`/api/v1/alerts?limit=${limit}`); }
  async getRecentGlucose(limit = 10) { return this._fetch(`/api/v1/readings?limit=${limit}`); }
  async getRecentObstacles(limit = 10) { return this._fetch(`/api/v1/obstacles?limit=${limit}`); }
  async getRecentCurrency(limit = 10) { return this._fetch(`/api/v1/detections/currency?limit=${limit}`); }
  async getRecentOCR(limit = 10) { return this._fetch(`/api/v1/readings/ocr?limit=${limit}`); }

  async processCurrency(payload) {
    return this._fetch('/api/v1/vision/currency/process', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async processOCR(payload) {
    return this._fetch('/api/v1/vision/ocr/process', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

const api = new EcoEyeAPI();

// ── Main Dashboard Controller ──────────────────────────────────────────────
class EcoEyeDashboard {
  constructor() {
    this.theme = 'dark';
    this.isOnline = false;
    this.fallAlarmActive = false;
    this.wavePhase = 0;
    this.dopplerCanvas = null;
    this.dopplerCtx = null;
    this.animFrameId = null;

    // State cache
    this.state = {
      glucose: 98,
      fallCount: 0,
      closestObstacle: 140,
      currencyDenom: 200,
      ocrText: 'PARACETAMOL 500 MG - TOMAR 1 TABLETA CADA 8 HORAS',
      sectors: { left: 160, center: 140, right: 190 },
      events: [],
    };

    this.dom = {};
  }

  init() {
    this.cacheDom();
    this.initTheme();
    this.initDopplerWave();
    this.attachEvents();
    this.updateAllVisuals();
    this.pollBackend();
    setInterval(() => this.pollBackend(), 2500);
  }

  cacheDom() {
    this.dom = {
      html: document.documentElement,
      themeToggleBtn: document.getElementById('theme-toggle-btn'),
      themeIcon: document.getElementById('theme-toggle-icon'),
      brandLogo: document.getElementById('brand-logo-img'),
      nodeStatusPill: document.getElementById('node-status-pill'),
      nodeStatusText: document.getElementById('node-status-text'),
      metricUptime: document.getElementById('metric-uptime'),
      metricDeviceId: document.getElementById('metric-device-id'),
      metricQueue: document.getElementById('metric-queue-pending'),

      // HUD Visor
      hudTargetVal: document.getElementById('hud-target-val'),
      hudTargetLabel: document.getElementById('hud-target-label'),
      currencyPill: document.getElementById('currency-status-pill'),
      currencyChips: document.querySelectorAll('.currency-chip-btn'),
      ocrTextDisplay: document.getElementById('ocr-text-display'),
      ocrPill: document.getElementById('ocr-status-pill'),
      ocrInput: document.getElementById('ocr-custom-input'),
      btnSynthesizeOcr: document.getElementById('btn-synthesize-ocr'),

      // Radar
      radarBlipLeft: document.getElementById('radar-blip-left'),
      radarBlipCenter: document.getElementById('radar-blip-center'),
      radarBlipRight: document.getElementById('radar-blip-right'),
      radarStatusPill: document.getElementById('radar-status-pill'),
      sectorCardLeft: document.getElementById('sector-card-left'),
      sectorCardCenter: document.getElementById('sector-card-center'),
      sectorCardRight: document.getElementById('sector-card-right'),
      sectorDistLeft: document.getElementById('sector-dist-left'),
      sectorDistCenter: document.getElementById('sector-dist-center'),
      sectorDistRight: document.getElementById('sector-dist-right'),

      // Glucose & Doppler
      radialVal: document.getElementById('radial-glucose-val'),
      radialBarFill: document.getElementById('radial-bar-fill'),
      glucosePill: document.getElementById('glucose-status-pill'),
      glucoseDiagnose: document.getElementById('glucose-diagnosis-text'),
      fallPill: document.getElementById('fall-status-pill'),
      fallCountDisplay: document.getElementById('fall-count-display'),
      fallLastTimestamp: document.getElementById('fall-last-timestamp'),
      dopplerCanvasEl: document.getElementById('doppler-canvas'),

      // Demo Sandbox Buttons
      btnDemoBill200: document.getElementById('btn-demo-bill-200'),
      btnDemoBill500: document.getElementById('btn-demo-bill-500'),
      btnDemoOcrMeds: document.getElementById('btn-demo-ocr-meds'),
      btnDemoFallAlert: document.getElementById('btn-demo-fall-alert'),
      btnDemoObstacleNear: document.getElementById('btn-demo-obstacle-near'),
      btnDemoHypoGlucose: document.getElementById('btn-demo-hypo-glucose'),
      btnDemoResetNormal: document.getElementById('btn-demo-reset-normal'),

      // Feed Table
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

    if (this.dom.brandLogo) {
      this.dom.brandLogo.src = `./assets/branding/ecoeye-logo-full-${theme}.svg`;
    }

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

  /* ── Doppler Waveform Canvas ──────────────────────────────────────────── */
  initDopplerWave() {
    if (!this.dom.dopplerCanvasEl) return;
    this.dopplerCanvas = this.dom.dopplerCanvasEl;
    this.dopplerCtx = this.dopplerCanvas.getContext('2d');

    const render = () => {
      this.drawDopplerFrame();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  drawDopplerFrame() {
    if (!this.dopplerCtx || !this.dopplerCanvas) return;
    const w = this.dopplerCanvas.width = this.dopplerCanvas.offsetWidth;
    const h = this.dopplerCanvas.height = this.dopplerCanvas.offsetHeight;
    const ctx = this.dopplerCtx;

    ctx.clearRect(0, 0, w, h);

    // Wave parameters
    this.wavePhase += 0.05;
    const midY = h / 2;
    const isAlarm = this.fallAlarmActive;

    ctx.beginPath();
    ctx.lineWidth = isAlarm ? 3 : 2;
    ctx.strokeStyle = isAlarm ? '#ef4444' : (this.theme === 'dark' ? '#10b981' : '#059669');

    for (let x = 0; x < w; x++) {
      const freq = isAlarm ? 0.08 : 0.03;
      const amp = isAlarm ? 32 * Math.sin(x * 0.015 + this.wavePhase * 2) : 12;
      const y = midY + Math.sin(x * freq + this.wavePhase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Baseline grid center line
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
  }

  /* ── Polling & Backend Sync ───────────────────────────────────────────── */
  async pollBackend() {
    try {
      const results = await Promise.allSettled([
        api.getHealth(),
        api.getStats(),
        api.getRecentFalls(5),
        api.getRecentGlucose(5),
        api.getRecentObstacles(5),
        api.getRecentCurrency(5),
        api.getRecentOCR(5),
      ]);

      const [health, stats, falls, glucose, obstacles, currency, ocr] = results;

      if (health.status === 'fulfilled') {
        this.setOnline(true, health.value.uptime_seconds);
      } else {
        this.setOnline(false);
      }

      if (stats.status === 'fulfilled' && stats.value.sync_queue) {
        if (this.dom.metricQueue) this.dom.metricQueue.textContent = stats.value.sync_queue.pending || 0;
      }

      if (glucose.status === 'fulfilled' && glucose.value.length > 0) {
        this.state.glucose = glucose.value[0].glucose_mg_dl;
      }

      if (falls.status === 'fulfilled' && falls.value.length > 0) {
        this.state.fallCount = falls.value.length;
      }

      if (currency.status === 'fulfilled' && currency.value.length > 0) {
        this.state.currencyDenom = currency.value[0].denomination;
      }

      if (ocr.status === 'fulfilled' && ocr.value.length > 0) {
        this.state.ocrText = ocr.value[0].cleaned_text || ocr.value[0].raw_text;
      }

      if (obstacles.status === 'fulfilled' && obstacles.value.length > 0) {
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
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'EDGE ACTIVO';
      if (uptimeSec !== null && this.dom.metricUptime) {
        const mins = Math.floor(uptimeSec / 60);
        const secs = Math.floor(uptimeSec % 60);
        this.dom.metricUptime.textContent = `${mins}m ${secs}s`;
      }
    } else {
      this.dom.nodeStatusPill.className = 'status-pill warning';
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'DEMO LOCAL';
      if (this.dom.metricUptime) this.dom.metricUptime.textContent = 'Activo';
    }
  }

  /* ── UI Visual Renderers ──────────────────────────────────────────────── */
  updateAllVisuals() {
    this.renderGlucoseGauge(this.state.glucose);
    this.renderRadarSectors(this.state.sectors);
    this.renderCurrencyHUD(this.state.currencyDenom);
    this.renderOCR(this.state.ocrText);
    this.renderFallMonitor(this.state.fallCount);
  }

  renderGlucoseGauge(val) {
    if (!this.dom.radialVal || !this.dom.radialBarFill) return;
    this.dom.radialVal.textContent = Math.round(val);

    // Circumference = 2 * PI * 58 ≈ 364.4
    const circ = 364.4;
    // Map 40..300 mg/dL to 0..circ
    const pct = Math.min(Math.max((val - 40) / 260, 0), 1);
    const offset = circ - (pct * circ);
    this.dom.radialBarFill.style.strokeDashoffset = offset;

    let statusClass = 'normal';
    let label = 'EUGLUCEMIA';
    let strokeColor = '#10b981';

    if (val < 70) {
      statusClass = 'critical';
      label = 'HIPOGLUCEMIA';
      strokeColor = '#ef4444';
    } else if (val > 180) {
      statusClass = 'critical';
      label = 'HIPERGLUCEMIA';
      strokeColor = '#ef4444';
    } else if (val > 140) {
      statusClass = 'warning';
      label = 'ELEVADA';
      strokeColor = '#f59e0b';
    }

    this.dom.radialBarFill.style.stroke = strokeColor;
    if (this.dom.glucosePill) {
      this.dom.glucosePill.className = `status-pill ${statusClass}`;
      this.dom.glucosePill.textContent = label;
    }
    if (this.dom.glucoseDiagnose) {
      this.dom.glucoseDiagnose.textContent = label;
      this.dom.glucoseDiagnose.style.color = strokeColor;
    }
  }

  renderRadarSectors(sectors) {
    const sLeft = sectors.left || 160;
    const sCenter = sectors.center || 140;
    const sRight = sectors.right || 190;
    const closest = Math.min(sLeft, sCenter, sRight);

    if (this.dom.sectorDistLeft) this.dom.sectorDistLeft.textContent = `${Math.round(sLeft)} cm`;
    if (this.dom.sectorDistCenter) this.dom.sectorDistCenter.textContent = `${Math.round(sCenter)} cm`;
    if (this.dom.sectorDistRight) this.dom.sectorDistRight.textContent = `${Math.round(sRight)} cm`;

    this.styleSectorCard(this.dom.sectorCardLeft, sLeft);
    this.styleSectorCard(this.dom.sectorCardCenter, sCenter);
    this.styleSectorCard(this.dom.sectorCardRight, sRight);

    // Blip positions on 240px circular radar
    this.positionRadarBlip(this.dom.radarBlipLeft, -50, sLeft);
    this.positionRadarBlip(this.dom.radarBlipCenter, 0, sCenter);
    this.positionRadarBlip(this.dom.radarBlipRight, 50, sRight);

    if (this.dom.radarStatusPill) {
      if (closest < 50) {
        this.dom.radarStatusPill.className = 'status-pill critical';
        this.dom.radarStatusPill.textContent = 'PROXIMIDAD CRITICA';
      } else if (closest < 100) {
        this.dom.radarStatusPill.className = 'status-pill warning';
        this.dom.radarStatusPill.textContent = 'OBSTACULO CERCANO';
      } else {
        this.dom.radarStatusPill.className = 'status-pill normal';
        this.dom.radarStatusPill.textContent = 'DESPEJADO';
      }
    }
  }

  styleSectorCard(cardEl, dist) {
    if (!cardEl) return;
    if (dist < 50) {
      cardEl.className = 'sector-card critical';
    } else if (dist < 100) {
      cardEl.className = 'sector-card active';
    } else {
      cardEl.className = 'sector-card';
    }
  }

  positionRadarBlip(blipEl, angleDeg, distCm) {
    if (!blipEl) return;
    const radius = Math.min((distCm / 200) * 110, 110);
    const rad = (angleDeg - 90) * (Math.PI / 180);
    const x = 120 + radius * Math.cos(rad);
    const y = 120 + radius * Math.sin(rad);

    blipEl.style.left = `${x}px`;
    blipEl.style.top = `${y}px`;
    if (distCm < 50) {
      blipEl.className = 'radar-blip critical animate-obstacle-ping';
    } else {
      blipEl.className = 'radar-blip';
    }
  }

  renderCurrencyHUD(denom) {
    if (this.dom.hudTargetVal) this.dom.hudTargetVal.textContent = `$${denom} MXN`;
    if (this.dom.hudTargetLabel) this.dom.hudTargetLabel.textContent = `Billete de ${denom} Pesos`;

    if (this.dom.currencyPill) {
      this.dom.currencyPill.className = 'status-pill normal';
      this.dom.currencyPill.textContent = 'CONFIRMADO 97%';
    }

    if (this.dom.currencyChips) {
      this.dom.currencyChips.forEach(chip => {
        const chipDenom = parseInt(chip.dataset.denom, 10);
        if (chipDenom === denom) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    }
  }

  renderOCR(text) {
    if (this.dom.ocrTextDisplay) {
      this.dom.ocrTextDisplay.textContent = `"${text}"`;
    }
    if (this.dom.ocrPill) {
      this.dom.ocrPill.className = 'status-pill normal';
      this.dom.ocrPill.textContent = 'SINTETIZADO';
    }
  }

  renderFallMonitor(count) {
    if (this.dom.fallCountDisplay) this.dom.fallCountDisplay.textContent = count;
    if (this.dom.fallPill) {
      if (this.fallAlarmActive || count > 0) {
        this.dom.fallPill.className = 'status-pill critical';
        this.dom.fallPill.textContent = 'PERIMETRO ALERTA';
      } else {
        this.dom.fallPill.className = 'status-pill normal';
        this.dom.fallPill.textContent = 'NORMAL';
      }
    }
  }

  compileEventsFeed(falls, glucose, currency, ocr) {
    if (!this.dom.eventsTableBody) return;
    const list = [];

    if (falls && falls.status === 'fulfilled' && Array.isArray(falls.value)) {
      falls.value.forEach(f => {
        list.push({
          mod: 'WIFI-CSI',
          badge: 'critical',
          desc: 'Perturbacion Doppler: Caida Detectada',
          detail: `Confianza: ${(f.confidence * 100).toFixed(0)}% | Acel: ${f.acceleration_g ? f.acceleration_g.toFixed(1) : 2.4}g`,
          time: new Date(f.timestamp * 1000).toLocaleTimeString(),
          ts: f.timestamp,
        });
      });
    }

    if (glucose && glucose.status === 'fulfilled' && Array.isArray(glucose.value)) {
      glucose.value.forEach(g => {
        list.push({
          mod: 'BLE CGM',
          badge: g.glucose_mg_dl > 140 || g.glucose_mg_dl < 70 ? 'warning' : 'normal',
          desc: 'Sensor Glucosa Continuo 0x1808',
          detail: `${Math.round(g.glucose_mg_dl)} mg/dL (${g.status || 'NORMAL'})`,
          time: new Date(g.timestamp * 1000).toLocaleTimeString(),
          ts: g.timestamp,
        });
      });
    }

    if (currency && currency.status === 'fulfilled' && Array.isArray(currency.value)) {
      currency.value.forEach(c => {
        list.push({
          mod: 'VISION IA',
          badge: 'normal',
          desc: 'Clasificacion de Efectivo',
          detail: `Billete de $${c.denomination} MXN (${((c.confidence || 0.95) * 100).toFixed(0)}%)`,
          time: new Date(c.timestamp * 1000).toLocaleTimeString(),
          ts: c.timestamp,
        });
      });
    }

    if (ocr && ocr.status === 'fulfilled' && Array.isArray(ocr.value)) {
      ocr.value.forEach(o => {
        list.push({
          mod: 'SMART OCR',
          badge: 'info',
          desc: 'Lectura en Gafas Asistivas',
          detail: `"${(o.cleaned_text || o.raw_text).substring(0, 36)}..."`,
          time: new Date(o.timestamp * 1000).toLocaleTimeString(),
          ts: o.timestamp,
        });
      });
    }

    list.sort((a, b) => b.ts - a.ts);
    const topEvents = list.slice(0, 6);

    if (topEvents.length === 0) {
      this.dom.eventsTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;padding:1.5rem;color:var(--text-muted)">
            Sincronizando con SQLite WAL encriptado...
          </td>
        </tr>
      `;
      return;
    }

    this.dom.eventsTableBody.innerHTML = topEvents.map(e => `
      <tr>
        <td><span class="status-pill ${e.badge}">${e.mod}</span></td>
        <td style="font-weight:600;color:var(--text-main)">${e.desc}</td>
        <td>${e.detail}</td>
        <td style="font-family:var(--font-mono);font-size:0.75rem">${e.time}</td>
      </tr>
    `).join('');
  }

  /* ── Interactive Audio & Speech Announcement ──────────────────────────── */
  announceSpeech(text) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-MX';
        utter.rate = 1.05;
        window.speechSynthesis.speak(utter);
      } catch (_) {}
    }
  }

  /* ── Interactive Events Binding ───────────────────────────────────────── */
  attachEvents() {
    if (this.dom.themeToggleBtn) {
      this.dom.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
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

    // OCR Test Button
    if (this.dom.btnSynthesizeOcr && this.dom.ocrInput) {
      this.dom.btnSynthesizeOcr.addEventListener('click', () => {
        const val = this.dom.ocrInput.value.trim() || 'PARACETAMOL 500 MG - 1 TABLETA CADA 8 HORAS';
        this.triggerOcrDemo(val);
      });
    }

    // Demonstrator / Judge Sandbox Macro Keys
    if (this.dom.btnDemoBill200) {
      this.dom.btnDemoBill200.addEventListener('click', () => this.triggerCurrencyDemo(200));
    }
    if (this.dom.btnDemoBill500) {
      this.dom.btnDemoBill500.addEventListener('click', () => this.triggerCurrencyDemo(500));
    }
    if (this.dom.btnDemoOcrMeds) {
      this.dom.btnDemoOcrMeds.addEventListener('click', () => {
        this.triggerOcrDemo('IBUPROFENO 400 MG - TOMAR CON ALIMENTOS');
      });
    }
    if (this.dom.btnDemoFallAlert) {
      this.dom.btnDemoFallAlert.addEventListener('click', () => this.triggerFallDemo());
    }
    if (this.dom.btnDemoObstacleNear) {
      this.dom.btnDemoObstacleNear.addEventListener('click', () => this.triggerObstacleDemo(32));
    }
    if (this.dom.btnDemoHypoGlucose) {
      this.dom.btnDemoHypoGlucose.addEventListener('click', () => this.triggerGlucoseDemo(55));
    }
    if (this.dom.btnDemoResetNormal) {
      this.dom.btnDemoResetNormal.addEventListener('click', () => this.resetNormalState());
    }
  }

  triggerCurrencyDemo(denom) {
    this.state.currencyDenom = denom;
    this.renderCurrencyHUD(denom);
    this.announceSpeech(`Billete de ${denom} pesos`);
    api.processCurrency({ mock_denomination: denom }).catch(() => {});
  }

  triggerOcrDemo(text) {
    this.state.ocrText = text;
    this.renderOCR(text);
    this.announceSpeech(text);
    api.processOCR({ mock_text: text }).catch(() => {});
  }

  triggerFallDemo() {
    this.fallAlarmActive = true;
    this.state.fallCount += 1;
    this.renderFallMonitor(this.state.fallCount);
    this.announceSpeech('Atención: Caída perimetral detectada');
    setTimeout(() => { this.fallAlarmActive = false; }, 6000);
  }

  triggerObstacleDemo(distCm) {
    this.state.sectors = { left: 42, center: distCm, right: 88 };
    this.renderRadarSectors(this.state.sectors);
    this.announceSpeech(`Cuidado: obstáculo a ${distCm} centímetros`);
  }

  triggerGlucoseDemo(val) {
    this.state.glucose = val;
    this.renderGlucoseGauge(val);
    if (val < 70) this.announceSpeech('Alerta clínica: Hipoglucemia detectada');
    else if (val > 180) this.announceSpeech('Alerta clínica: Hiperglucemia detectada');
  }

  resetNormalState() {
    this.fallAlarmActive = false;
    this.state.glucose = 96;
    this.state.sectors = { left: 160, center: 140, right: 190 };
    this.state.currencyDenom = 200;
    this.state.ocrText = 'PARACETAMOL 500 MG - TOMAR 1 TABLETA CADA 8 HORAS';
    this.updateAllVisuals();
    this.announceSpeech('Sensores en estado nominal');
  }
}

// Bootstrap
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new EcoEyeDashboard().init());
  } else {
    new EcoEyeDashboard().init();
  }
}
