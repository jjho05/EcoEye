/**
 * EcoEye Frontend API Client.
 * Communicates with the local FastAPI Edge Gateway at /api/v1/*.
 */

export class EcoEyeAPI {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async _fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[API ERROR] ${endpoint}:`, err);
      throw err;
    }
  }

  // System Health & Telemetry
  async getHealth() {
    return this._fetch('/health');
  }

  async getStats() {
    return this._fetch('/api/v1/stats');
  }

  // Fall Events (WiFi CSI)
  async getRecentFalls(limit = 20) {
    return this._fetch(`/api/v1/alerts?limit=${limit}`);
  }

  // Glucose Readings (BLE GATT)
  async getRecentGlucose(limit = 20) {
    return this._fetch(`/api/v1/readings?limit=${limit}`);
  }

  // Obstacle Detections
  async getRecentObstacles(limit = 20, sector = null) {
    const q = sector ? `&sector=${encodeURIComponent(sector)}` : '';
    return this._fetch(`/api/v1/obstacles?limit=${limit}${q}`);
  }

  // Currency Detections
  async getRecentCurrency(limit = 20) {
    return this._fetch(`/api/v1/detections/currency?limit=${limit}`);
  }

  // OCR Readings
  async getRecentOCR(limit = 20) {
    return this._fetch(`/api/v1/readings/ocr?limit=${limit}`);
  }

  // Interactive Inferences
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

  // Sync Queue Stats
  async getQueueStats() {
    return this._fetch('/api/v1/queue');
  }
}

export const api = new EcoEyeAPI();
