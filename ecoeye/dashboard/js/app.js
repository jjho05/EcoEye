/**
 * EcoEye Dashboard Application Controller
 * Handles theme toggling, live telemetry polling, DOM updates, and interactive controls.
 */

import { api } from './api.js';

class DashboardApp {
  constructor() {
    this.theme = 'dark';
    this.pollingInterval = 2500;
    this.timerId = null;
    this.isOnline = false;

    // DOM Elements Cache
    this.dom = {
      html: document.documentElement,
      themeToggleBtn: document.getElementById('theme-toggle-btn'),
      themeIcon: document.getElementById('theme-toggle-icon'),
      brandLogo: document.getElementById('brand-logo-img'),
      refreshBtn: document.getElementById('btn-manual-refresh'),

      // Hero
      nodeStatusBadge: document.getElementById('node-status-badge'),
      nodeStatusDot: document.getElementById('node-status-dot'),
      nodeStatusText: document.getElementById('node-status-text'),
      metricUptime: document.getElementById('metric-uptime'),
      metricDeviceId: document.getElementById('metric-device-id'),
      metricQueuePending: document.getElementById('metric-queue-pending'),

      // Obstacle Radar
      radarStatusBadge: document.getElementById('radar-status-badge'),
      radarClosestDist: document.getElementById('radar-closest-dist'),
      sectorLeft: document.getElementById('sector-left'),
      sectorCenter: document.getElementById('sector-center'),
      sectorRight: document.getElementById('sector-right'),
      sectorLeftDist: document.getElementById('sector-left-dist'),
      sectorCenterDist: document.getElementById('sector-center-dist'),
      sectorRightDist: document.getElementById('sector-right-dist'),

      // Glucose Monitor
      glucoseValue: document.getElementById('glucose-value'),
      glucoseBadge: document.getElementById('glucose-badge'),
      glucoseBarFill: document.getElementById('glucose-bar-fill'),
      glucoseTimestamp: document.getElementById('glucose-timestamp'),

      // Fall Monitor
      fallCount: document.getElementById('fall-count'),
      fallBadge: document.getElementById('fall-badge'),
      fallLastEvent: document.getElementById('fall-last-event'),

      // Currency Detection
      currencyValue: document.getElementById('currency-value'),
      currencyConfidence: document.getElementById('currency-confidence'),
      currencyBadge: document.getElementById('currency-badge'),

      // OCR Smart Glasses
      ocrText: document.getElementById('ocr-text'),
      ocrConfidence: document.getElementById('ocr-confidence'),
      ocrBadge: document.getElementById('ocr-badge'),

      // Interactive Testers
      testCurrencyBtn: document.getElementById('btn-test-currency'),
      testOcrBtn: document.getElementById('btn-test-ocr'),
      ocrInputText: document.getElementById('ocr-input-text'),

      // Activity Table
      activityTableBody: document.getElementById('activity-table-body'),
    };
  }

  init() {
    this.initTheme();
    this.attachEventListeners();
    this.fetchData();
    this.startPolling();
  }

  /* ── Theme Management ─────────────────────────────────────────────────── */
  initTheme() {
    const saved = localStorage.getItem('ecoeye-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.theme = saved || (prefersDark ? 'dark' : 'light');
    this.applyTheme(this.theme);
  }

  applyTheme(theme) {
    this.theme = theme;
    this.dom.html.setAttribute('data-theme', theme);
    localStorage.setItem('ecoeye-theme', theme);

    if (this.dom.brandLogo) {
      this.dom.brandLogo.src = `/assets/branding/ecoeye-logo-full-${theme}.svg`;
    }

    if (this.dom.themeIcon) {
      if (theme === 'dark') {
        // Sun icon for switching to light mode
        this.dom.themeIcon.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
        // Moon icon for switching to dark mode
        this.dom.themeIcon.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        `;
      }
    }
  }

  toggleTheme() {
    const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(nextTheme);
  }

  /* ── Event Handlers ───────────────────────────────────────────────────── */
  attachEventListeners() {
    if (this.dom.themeToggleBtn) {
      this.dom.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    }

    if (this.dom.refreshBtn) {
      this.dom.refreshBtn.addEventListener('click', () => {
        this.fetchData();
      });
    }

    if (this.dom.testCurrencyBtn) {
      this.dom.testCurrencyBtn.addEventListener('click', () => this.handleTestCurrency());
    }

    if (this.dom.testOcrBtn) {
      this.dom.testOcrBtn.addEventListener('click', () => this.handleTestOCR());
    }
  }

  /* ── Data Polling Engine ──────────────────────────────────────────────── */
  startPolling() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => this.fetchData(), this.pollingInterval);
  }

  stopPolling() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  async fetchData() {
    try {
      const results = await Promise.allSettled([
        api.getHealth(),
        api.getStats(),
        api.getRecentFalls(10),
        api.getRecentGlucose(10),
        api.getRecentObstacles(10),
        api.getRecentCurrency(10),
        api.getRecentOCR(10),
      ]);

      const [healthRes, statsRes, fallsRes, glucoseRes, obstaclesRes, currencyRes, ocrRes] = results;

      if (healthRes.status === 'fulfilled') {
        this.updateHealthUI(healthRes.value);
        this.setOnlineStatus(true);
      } else {
        this.setOnlineStatus(false);
      }

      if (statsRes.status === 'fulfilled') {
        this.updateStatsUI(statsRes.value);
      }

      if (fallsRes.status === 'fulfilled') {
        this.updateFallsUI(fallsRes.value);
      }

      if (glucoseRes.status === 'fulfilled') {
        this.updateGlucoseUI(glucoseRes.value);
      }

      if (obstaclesRes.status === 'fulfilled') {
        this.updateObstaclesUI(obstaclesRes.value);
      }

      if (currencyRes.status === 'fulfilled') {
        this.updateCurrencyUI(currencyRes.value);
      }

      if (ocrRes.status === 'fulfilled') {
        this.updateOcrUI(ocrRes.value);
      }

      this.updateActivityFeed(fallsRes, glucoseRes, currencyRes, ocrRes);

    } catch (err) {
      console.warn('[EcoEye Controller] Polling cycle encounter:', err);
      this.setOnlineStatus(false);
    }
  }

  setOnlineStatus(online) {
    this.isOnline = online;
    if (!this.dom.nodeStatusBadge) return;

    if (online) {
      this.dom.nodeStatusBadge.className = 'status-badge normal';
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'EDGE ACTIVO';
    } else {
      this.dom.nodeStatusBadge.className = 'status-badge critical';
      if (this.dom.nodeStatusText) this.dom.nodeStatusText.textContent = 'DESCONECTADO';
    }
  }

  /* ── UI Renderers ─────────────────────────────────────────────────────── */
  updateHealthUI(data) {
    if (this.dom.metricDeviceId && data.device_id) {
      this.dom.metricDeviceId.textContent = data.device_id;
    }
    if (this.dom.metricUptime && data.uptime_seconds !== undefined) {
      const mins = Math.floor(data.uptime_seconds / 60);
      const secs = Math.floor(data.uptime_seconds % 60);
      this.dom.metricUptime.textContent = `${mins}m ${secs}s`;
    }
  }

  updateStatsUI(data) {
    if (this.dom.metricQueuePending && data.sync_queue) {
      const pending = data.sync_queue.pending || 0;
      this.dom.metricQueuePending.textContent = pending.toString();
    }
  }

  updateFallsUI(falls) {
    if (!this.dom.fallCount) return;
    const count = Array.isArray(falls) ? falls.length : 0;
    this.dom.fallCount.textContent = count.toString();

    if (count > 0 && falls[0]) {
      const latest = falls[0];
      const timeStr = new Date(latest.timestamp * 1000).toLocaleTimeString();
      this.dom.fallLastEvent.textContent = `Ultimo: ${timeStr} (conf: ${(latest.confidence * 100).toFixed(0)}%)`;
      this.dom.fallBadge.className = 'status-badge critical';
      this.dom.fallBadge.textContent = 'ALERTA CAIDA';
    } else {
      this.dom.fallLastEvent.textContent = 'Sin incidentes registrados';
      this.dom.fallBadge.className = 'status-badge normal';
      this.dom.fallBadge.textContent = 'NORMAL';
    }
  }

  updateGlucoseUI(readings) {
    if (!this.dom.glucoseValue) return;

    if (!Array.isArray(readings) || readings.length === 0) {
      this.dom.glucoseValue.textContent = '--';
      this.dom.glucoseBadge.className = 'status-badge info';
      this.dom.glucoseBadge.textContent = 'ESPERANDO';
      return;
    }

    const latest = readings[0];
    const val = latest.glucose_mg_dl;
    this.dom.glucoseValue.textContent = val.toFixed(0);

    const timeStr = new Date(latest.timestamp * 1000).toLocaleTimeString();
    if (this.dom.glucoseTimestamp) {
      this.dom.glucoseTimestamp.textContent = `Actualizado ${timeStr}`;
    }

    // Range Fill: Map 50mg/dL - 300mg/dL to 0% - 100%
    const pct = Math.min(Math.max(((val - 50) / 250) * 100, 5), 100);
    if (this.dom.glucoseBarFill) {
      this.dom.glucoseBarFill.style.width = `${pct}%`;
    }

    // Clinical Status
    if (val < 70) {
      this.dom.glucoseBadge.className = 'status-badge critical';
      this.dom.glucoseBadge.textContent = 'HIPOGLUCEMIA';
    } else if (val <= 140) {
      this.dom.glucoseBadge.className = 'status-badge normal';
      this.dom.glucoseBadge.textContent = 'EUGLUCEMIA';
    } else if (val <= 180) {
      this.dom.glucoseBadge.className = 'status-badge warning';
      this.dom.glucoseBadge.textContent = 'ELEVADA';
    } else {
      this.dom.glucoseBadge.className = 'status-badge critical';
      this.dom.glucoseBadge.textContent = 'HIPERGLUCEMIA';
    }
  }

  updateObstaclesUI(obstacles) {
    if (!this.dom.radarClosestDist) return;

    // Reset sectors
    const sectors = { left: 999, center: 999, right: 999 };

    if (Array.isArray(obstacles) && obstacles.length > 0) {
      obstacles.forEach(obs => {
        const sec = (obs.sector || 'center').toLowerCase();
        const dist = obs.distance_cm !== undefined ? obs.distance_cm : 999;
        if (sectors[sec] !== undefined && dist < sectors[sec]) {
          sectors[sec] = dist;
        }
      });
    }

    const closest = Math.min(sectors.left, sectors.center, sectors.right);
    this.dom.radarClosestDist.textContent = closest < 999 ? closest.toFixed(0) : '--';

    this.renderSectorBox(this.dom.sectorLeft, this.dom.sectorLeftDist, sectors.left);
    this.renderSectorBox(this.dom.sectorCenter, this.dom.sectorCenterDist, sectors.center);
    this.renderSectorBox(this.dom.sectorRight, this.dom.sectorRightDist, sectors.right);

    if (closest < 50) {
      this.dom.radarStatusBadge.className = 'status-badge critical';
      this.dom.radarStatusBadge.textContent = 'PROXIMIDAD CRITICA';
    } else if (closest < 120) {
      this.dom.radarStatusBadge.className = 'status-badge warning';
      this.dom.radarStatusBadge.textContent = 'OBSTACULO CERCANO';
    } else {
      this.dom.radarStatusBadge.className = 'status-badge normal';
      this.dom.radarStatusBadge.textContent = 'DESPEJADO';
    }
  }

  renderSectorBox(boxEl, distEl, distance) {
    if (!boxEl || !distEl) return;
    if (distance >= 999) {
      boxEl.className = 'sector-box';
      distEl.textContent = '--';
    } else {
      distEl.textContent = `${distance.toFixed(0)} cm`;
      if (distance < 50) {
        boxEl.className = 'sector-box active critical';
      } else if (distance < 120) {
        boxEl.className = 'sector-box active';
      } else {
        boxEl.className = 'sector-box';
      }
    }
  }

  updateCurrencyUI(detections) {
    if (!this.dom.currencyValue) return;

    if (!Array.isArray(detections) || detections.length === 0) {
      this.dom.currencyValue.textContent = '--';
      this.dom.currencyConfidence.textContent = '0%';
      this.dom.currencyBadge.className = 'status-badge info';
      this.dom.currencyBadge.textContent = 'SIN DETECCION';
      return;
    }

    const latest = detections[0];
    this.dom.currencyValue.textContent = `$${latest.denomination.toFixed(0)}`;
    const confPct = ((latest.confidence || 0) * 100).toFixed(0);
    this.dom.currencyConfidence.textContent = `${confPct}%`;
    this.dom.currencyBadge.className = 'status-badge normal';
    this.dom.currencyBadge.textContent = `${latest.currency} AUDIBLE`;
  }

  updateOcrUI(readings) {
    if (!this.dom.ocrText) return;

    if (!Array.isArray(readings) || readings.length === 0) {
      this.dom.ocrText.textContent = 'Esperando captura de texto en campo visual...';
      this.dom.ocrConfidence.textContent = '0%';
      this.dom.ocrBadge.className = 'status-badge info';
      this.dom.ocrBadge.textContent = 'EN ESPERA';
      return;
    }

    const latest = readings[0];
    this.dom.ocrText.textContent = latest.cleaned_text || latest.raw_text || 'Texto procesado';
    const confPct = ((latest.confidence || 0) * 100).toFixed(0);
    this.dom.ocrConfidence.textContent = `${confPct}%`;
    this.dom.ocrBadge.className = 'status-badge normal';
    this.dom.ocrBadge.textContent = 'SINTETIZADO';
  }

  updateActivityFeed(fallsRes, glucoseRes, currencyRes, ocrRes) {
    if (!this.dom.activityTableBody) return;

    const events = [];

    if (fallsRes.status === 'fulfilled' && Array.isArray(fallsRes.value)) {
      fallsRes.value.forEach(f => {
        events.push({
          type: 'FALL',
          label: 'Caida Detectada (WiFi CSI)',
          timestamp: f.timestamp,
          detail: `Confianza ${(f.confidence * 100).toFixed(0)}% | Aceleracion ${f.acceleration_g ? f.acceleration_g.toFixed(1) : 0}g`,
          badgeClass: 'critical',
        });
      });
    }

    if (glucoseRes.status === 'fulfilled' && Array.isArray(glucoseRes.value)) {
      glucoseRes.value.forEach(g => {
        events.push({
          type: 'GLUCOSE',
          label: 'Lectura Glucosa BLE',
          timestamp: g.timestamp,
          detail: `${g.glucose_mg_dl.toFixed(0)} mg/dL (${g.status || 'NORMAL'})`,
          badgeClass: g.glucose_mg_dl > 180 || g.glucose_mg_dl < 70 ? 'warning' : 'normal',
        });
      });
    }

    if (currencyRes.status === 'fulfilled' && Array.isArray(currencyRes.value)) {
      currencyRes.value.forEach(c => {
        events.push({
          type: 'CURRENCY',
          label: 'Deteccion Moneda',
          timestamp: c.timestamp,
          detail: `$${c.denomination.toFixed(0)} ${c.currency} (${((c.confidence || 0) * 100).toFixed(0)}%)`,
          badgeClass: 'normal',
        });
      });
    }

    if (ocrRes.status === 'fulfilled' && Array.isArray(ocrRes.value)) {
      ocrRes.value.forEach(o => {
        events.push({
          type: 'OCR',
          label: 'Lectura Texto OCR',
          timestamp: o.timestamp,
          detail: `"${this.truncateText(o.cleaned_text || o.raw_text, 40)}"`,
          badgeClass: 'info',
        });
      });
    }

    // Sort descending by timestamp
    events.sort((a, b) => b.timestamp - a.timestamp);
    const topEvents = events.slice(0, 8);

    if (topEvents.length === 0) {
      this.dom.activityTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;padding:1.5rem;color:var(--text-muted)">
            Sin registros de actividad recientes
          </td>
        </tr>
      `;
      return;
    }

    this.dom.activityTableBody.innerHTML = topEvents.map(evt => {
      const timeStr = new Date(evt.timestamp * 1000).toLocaleTimeString();
      return `
        <tr>
          <td><span class="status-badge ${evt.badgeClass}">${evt.type}</span></td>
          <td style="font-weight:600;color:var(--text-primary)">${this.escapeHtml(evt.label)}</td>
          <td>${this.escapeHtml(evt.detail)}</td>
          <td style="font-family:var(--font-mono);font-size:var(--text-xs)">${timeStr}</td>
        </tr>
      `;
    }).join('');
  }

  /* ── Interactive Actions ──────────────────────────────────────────────── */
  async handleTestCurrency() {
    try {
      const denominations = [20, 50, 100, 200, 500];
      const randomDenom = denominations[Math.floor(Math.random() * denominations.length)];
      await api.processCurrency({ mock_denomination: randomDenom });
      await this.fetchData();
    } catch (err) {
      console.error('[Test Currency Failed]:', err);
    }
  }

  async handleTestOCR() {
    try {
      const sampleTexts = [
        'PARACETAMOL 500 MG - TOMAR 1 CADA 8 HORAS',
        'FARMACIA SAN RAFAEL - TICKET DE COMPRA TOTAL $145.00',
        'LINEA 1 DEL METRO - DIRECCION PANTITLAN',
        'SALIDA DE EMERGENCIA - RUTA DE EVACUACION',
      ];
      const custom = this.dom.ocrInputText ? this.dom.ocrInputText.value.trim() : '';
      const textToTest = custom || sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
      
      await api.processOCR({ mock_text: textToTest });
      if (this.dom.ocrInputText) this.dom.ocrInputText.value = '';
      await this.fetchData();
    } catch (err) {
      console.error('[Test OCR Failed]:', err);
    }
  }

  /* ── Utilities ────────────────────────────────────────────────────────── */
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  truncateText(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new DashboardApp();
  app.init();
});
