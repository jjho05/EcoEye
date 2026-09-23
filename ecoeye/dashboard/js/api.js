/**
 * EcoEye Frontend API Client.
 * Communicates with the local FastAPI Edge Gateway at /api/v1/*.
 * Supports authentication tokens, configuration mutations, and medical report exports.
 * Universal Browser / Vanilla JS compatible (works on file:/// and http://).
 */

(function (global) {
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

    getToken() {
      try {
        return localStorage.getItem('ecoeye_token') || null;
      } catch (_) {
        return null;
      }
    }

    setToken(token) {
      try {
        if (token) localStorage.setItem('ecoeye_token', token);
        else localStorage.removeItem('ecoeye_token');
      } catch (_) {}
    }

    async _fetch(endpoint, options = {}) {
      const url = `${this.baseUrl}${endpoint}`;
      const token = this.getToken();
      const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && errData.detail) errorMsg = errData.detail;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      return await response.json();
    }

    // ── Authentication ────────────────────────────────────────────────────────
    async login(username, password) {
      const res = await this._fetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (res && res.token) {
        this.setToken(res.token);
      }
      return res;
    }

    async getCurrentUser() {
      return this._fetch('/api/v1/auth/me');
    }

    async logout() {
      try {
        await this._fetch('/api/v1/auth/logout', { method: 'POST' });
      } finally {
        this.setToken(null);
      }
    }

    async getDemoRoles() {
      return this._fetch('/api/v1/auth/roles');
    }

    // ── System Health & Telemetry ─────────────────────────────────────────────
    async getHealth() {
      return this._fetch('/health');
    }

    async getStats() {
      return this._fetch('/api/v1/stats');
    }

    // ── Sensor Readings ───────────────────────────────────────────────────────
    async getRecentFalls(limit = 20) {
      return this._fetch(`/api/v1/alerts?limit=${limit}`);
    }

    async getRecentGlucose(limit = 20) {
      return this._fetch(`/api/v1/readings?limit=${limit}`);
    }

    async getRecentObstacles(limit = 20, sector = null) {
      const q = sector ? `&sector=${encodeURIComponent(sector)}` : '';
      return this._fetch(`/api/v1/obstacles?limit=${limit}${q}`);
    }

    async getRecentCurrency(limit = 20) {
      return this._fetch(`/api/v1/detections/currency?limit=${limit}`);
    }

    async getRecentOCR(limit = 20) {
      return this._fetch(`/api/v1/readings/ocr?limit=${limit}`);
    }

    // ── Interactive Inferences ────────────────────────────────────────────────
    async processOCR(payload) {
      return this._fetch('/api/v1/vision/ocr/process', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    async processCurrency(payload) {
      return this._fetch('/api/v1/vision/currency/process', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    async recordGlucose(valueMgDl, mealContext = 'ayunas', sensorId = 'cgm-dexcom-g7') {
      return this._fetch('/api/v1/readings/glucose', {
        method: 'POST',
        body: JSON.stringify({
          value_mg_dl: valueMgDl,
          meal_context: mealContext,
          sensor_id: sensorId,
        }),
      });
    }

    async triggerCsiProtocolTest(variance = 3.85, inactivitySecs = 4.5, location = 'Sala Principal') {
      return this._fetch('/api/v1/sensors/csi/test-trigger', {
        method: 'POST',
        body: JSON.stringify({
          variance: variance,
          inactivity_secs: inactivitySecs,
          location: location,
        }),
      });
    }


    // ── Configuration & Sync Management ───────────────────────────────────────
    async getConfig() {
      return this._fetch('/api/v1/config');
    }

    async updateConfig(updates) {
      return this._fetch('/api/v1/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    }

    async getQueueStats() {
      return this._fetch('/api/v1/queue');
    }

    async flushSyncQueue() {
      return this._fetch('/api/v1/sync/flush', { method: 'POST' });
    }

    async exportMedicalReport() {
      return this._fetch('/api/v1/export/report');
    }

    // ── Remote Database (Neon PostgreSQL) ───────────────────────────────────
    async getDatabaseStatus() {
      return this._fetch('/api/v1/database/status');
    }

    async syncDatabase(batchSize = 25) {
      return this._fetch(`/api/v1/database/sync?batch_size=${batchSize}`, { method: 'POST' });
    }

    async getDatabaseAlerts(limit = 50) {
      return this._fetch(`/api/v1/database/alerts?limit=${limit}`);
    }

    // ── Caregivers & Obstacles ──────────────────────────────────────────────
    async getCaregivers() {
      return this._fetch('/api/v1/caregivers');
    }

    async createCaregiver(caregiverData) {
      return this._fetch('/api/v1/caregivers', {
        method: 'POST',
        body: JSON.stringify(caregiverData),
      });
    }

    async dispatchAlert(alertId) {
      return this._fetch(`/api/v1/alerts/${alertId}/dispatch`, {
        method: 'POST',
      });
    }

    async recordObstacle(obstacleData) {
      return this._fetch('/api/v1/obstacles', {
        method: 'POST',
        body: JSON.stringify(obstacleData),
      });
    }
  }


  const apiInstance = new EcoEyeAPI();
  global.EcoEyeAPI = EcoEyeAPI;
  global.api = apiInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EcoEyeAPI, api: apiInstance };
  }
})(typeof window !== 'undefined' ? window : globalThis);
