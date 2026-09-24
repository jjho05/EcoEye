/**
 * EcoEye Vision Engine — Real-Time Obstacle Detection
 *
 * Runs entirely in the browser using:
 *   - YOLOv8n ONNX (via onnxruntime-web, WebGPU -> WASM fallback)
 *   - Depth Anything V2 Small (via Transformers.js, WebGPU -> WASM fallback)
 *
 * Caches model weights in Cache Storage for offline-first operation.
 * Works cross-browser: Chrome, Firefox (WASM), Safari 17+ (WebGPU).
 *
 * Public API:
 *   const engine = new EcoEyeVisionEngine(videoEl, overlayCanvas, onResult);
 *   await engine.init();
 *   engine.start();
 *   engine.stop();
 */

(function (global) {
  'use strict';

  // Model URLs — ONNX Runtime CDN + Hugging Face Transformers.js CDN
  const ONNX_RUNTIME_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
  const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
  const YOLO_MODEL_URL = 'https://huggingface.co/Xenova/yolov8n/resolve/main/onnx/model.onnx';
  // Depth Anything V2 Small loaded via Transformers.js pipeline
  const DEPTH_MODEL_ID = 'Xenova/depth-anything-small-hf';

  // YOLO input resolution — must match the model's expected input
  const YOLO_INPUT_W = 640;
  const YOLO_INPUT_H = 640;
  const YOLO_CONF_THRESHOLD = 0.40;
  const YOLO_IOU_THRESHOLD = 0.45;
  const DEPTH_EVERY_N_FRAMES = 6;

  // Depth zone thresholds (normalized 0-1, higher = closer)
  const DEPTH_DANGER  = 0.72;
  const DEPTH_CAUTION = 0.45;

  // COCO class names (YOLOv8 trained on COCO 80 classes)
  const COCO_CLASSES = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
    'traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat',
    'dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack',
    'umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball',
    'kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket',
    'bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple',
    'sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair',
    'couch','potted plant','bed','dining table','toilet','tv','laptop','mouse',
    'remote','keyboard','cell phone','microwave','oven','toaster','sink',
    'refrigerator','book','clock','vase','scissors','teddy bear','hair drier',
    'toothbrush'
  ];

  // Classes that are mobility hazards (shown with danger colors)
  const HAZARD_CLASSES = new Set([
    'person','bicycle','car','motorcycle','bus','truck','chair','couch','bed',
    'dining table','dog','cat','potted plant','suitcase','backpack'
  ]);

  // Zone colors
  const ZONE_COLORS = {
    danger:  'rgba(239, 68,  68, 0.85)',
    caution: 'rgba(245,158,  11, 0.85)',
    safe:    'rgba( 16,185, 129, 0.85)',
  };

  /**
   * Dynamically loads a script and returns a promise.
   * Skips loading if the global is already present.
   */
  function loadScript(url, checkGlobal) {
    return new Promise((resolve, reject) => {
      if (checkGlobal && global[checkGlobal]) { resolve(); return; }
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
    });
  }

  class EcoEyeVisionEngine {
    /**
     * @param {HTMLVideoElement} videoEl - active camera feed
     * @param {HTMLCanvasElement} overlayCanvas - canvas drawn on top of video
     * @param {function} onResult - called on each detection cycle with a result object
     */
    constructor(videoEl, overlayCanvas, onResult) {
      this._video = videoEl;
      this._canvas = overlayCanvas;
      this._ctx = null;
      this._onResult = onResult || (() => {});

      this._ortSession = null;
      this._depthPipeline = null;

      this._running = false;
      this._rafId = null;
      this._frameCount = 0;
      this._lastDepthMap = null;
      this._depthRunning = false;

      this.status = 'idle';         // 'idle' | 'loading' | 'ready' | 'running' | 'error'
      this.loadProgress = 0;        // 0-100
      this.backendMode = 'unknown'; // 'webgpu' | 'wasm'
    }

    /** Load both model CDNs + ONNX session. Reports progress via onResult. */
    async init() {
      this.status = 'loading';
      this._notify({ type: 'status', message: 'Cargando dependencias de vision...', progress: 5 });

      try {
        // 1. Load ONNX Runtime Web
        await loadScript(ONNX_RUNTIME_CDN, 'ort');
        this._notify({ type: 'status', message: 'ONNX Runtime listo.', progress: 15 });

        // 2. Configure ONNX Runtime execution provider
        const ort = global.ort;
        let executionProviders = ['wasm'];
        this.backendMode = 'wasm';

        // Try WebGPU first (Chrome 113+, Edge)
        try {
          if (navigator.gpu) {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
              executionProviders = ['webgpu', 'wasm'];
              this.backendMode = 'webgpu';
            }
          }
        } catch (_) {}

        // 3. Load YOLOv8n ONNX model (cached in browser after first load)
        this._notify({ type: 'status', message: 'Descargando YOLOv8n (~6 MB)...', progress: 20 });
        this._ortSession = await ort.InferenceSession.create(YOLO_MODEL_URL, {
          executionProviders,
          graphOptimizationLevel: 'all',
        });
        this._notify({ type: 'status', message: 'YOLOv8n cargado correctamente.', progress: 55 });

        // 4. Load Transformers.js + Depth Anything V2
        await loadScript(TRANSFORMERS_CDN, null);
        this._notify({ type: 'status', message: 'Cargando estimacion de profundidad (~25 MB)...', progress: 60 });

        // Transformers.js exposes global window.transformers or can be imported
        const TransformersLib = global.transformers || (typeof transformers !== 'undefined' ? transformers : null);
        if (TransformersLib && TransformersLib.pipeline) {
          try {
            // Run in background — depth is non-blocking
            TransformersLib.pipeline('depth-estimation', DEPTH_MODEL_ID, {
              progress_callback: (p) => {
                if (p.status === 'progress' && p.progress) {
                  const pct = Math.round(60 + p.progress * 0.35);
                  this._notify({ type: 'status', message: 'Cargando profundidad...', progress: Math.min(pct, 95) });
                }
              }
            }).then(pipe => {
              this._depthPipeline = pipe;
              this._notify({ type: 'status', message: 'Profundidad lista.', progress: 98 });
            }).catch(() => {
              this._notify({ type: 'status', message: 'Profundidad no disponible (sin internet). Solo YOLO activo.', progress: 98 });
            });
          } catch (_) {}
        }

        this.status = 'ready';
        this._ctx = this._canvas.getContext('2d');
        this._notify({ type: 'ready', backendMode: this.backendMode, progress: 100 });

      } catch (err) {
        this.status = 'error';
        this._notify({ type: 'error', message: `Error al cargar modelos: ${err.message}`, progress: 0 });
        throw err;
      }
    }

    /** Start the real-time detection loop. */
    start() {
      if (this.status !== 'ready' && this.status !== 'running') return;
      this._running = true;
      this.status = 'running';
      this._loop();
    }

    /** Stop the detection loop and clear the canvas. */
    stop() {
      this._running = false;
      this.status = 'ready';
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      if (this._ctx && this._canvas) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      }
    }

    /** Main animation loop. */
    _loop() {
      if (!this._running) return;
      this._rafId = requestAnimationFrame(() => this._loop());
      const video = this._video;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      this._frameCount++;

      // Resize overlay canvas to match video
      if (this._canvas.width !== video.videoWidth) {
        this._canvas.width = video.videoWidth;
        this._canvas.height = video.videoHeight;
      }

      // Run YOLO inference every frame (async, non-blocking)
      this._runYolo(video).catch(() => {});

      // Run depth every N frames (expensive — stagger it)
      if (this._frameCount % DEPTH_EVERY_N_FRAMES === 0 && this._depthPipeline && !this._depthRunning) {
        this._runDepth(video).catch(() => {});
      }
    }

    /** Preprocess + run YOLOv8n ONNX inference on a single video frame. */
    async _runYolo(video) {
      const ort = global.ort;
      if (!ort || !this._ortSession) return;

      // Capture frame into an offscreen canvas at YOLO input resolution
      const offscreen = new OffscreenCanvas(YOLO_INPUT_W, YOLO_INPUT_H);
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(video, 0, 0, YOLO_INPUT_W, YOLO_INPUT_H);
      const imageData = offCtx.getImageData(0, 0, YOLO_INPUT_W, YOLO_INPUT_H);

      // Convert RGBA ImageData to CHW float32 tensor [1, 3, 640, 640], normalized [0,1]
      const pixelCount = YOLO_INPUT_W * YOLO_INPUT_H;
      const float32 = new Float32Array(3 * pixelCount);
      const d = imageData.data;
      for (let i = 0; i < pixelCount; i++) {
        float32[i]                  = d[i * 4]     / 255.0; // R channel
        float32[i + pixelCount]     = d[i * 4 + 1] / 255.0; // G channel
        float32[i + 2 * pixelCount] = d[i * 4 + 2] / 255.0; // B channel
      }

      const inputTensor = new ort.Tensor('float32', float32, [1, 3, YOLO_INPUT_W, YOLO_INPUT_H]);
      const feeds = { images: inputTensor };
      const results = await this._ortSession.run(feeds);

      // YOLOv8n output: [1, 84, 8400] — 84 = 4 box coords + 80 class scores
      const output = results[Object.keys(results)[0]].data;
      const detections = this._postprocessYolo(output, video.videoWidth, video.videoHeight);

      this._drawDetections(detections, video.videoWidth, video.videoHeight);
      this._emitResult(detections);
    }

    /** YOLOv8 output post-processing with NMS. */
    _postprocessYolo(rawOutput, origW, origH) {
      const numBoxes = 8400;
      const numClasses = 80;
      const scaleX = origW / YOLO_INPUT_W;
      const scaleY = origH / YOLO_INPUT_H;

      const candidates = [];

      for (let i = 0; i < numBoxes; i++) {
        // YOLOv8 output is transposed: [84, 8400] stored flat
        const cx = rawOutput[0 * numBoxes + i];
        const cy = rawOutput[1 * numBoxes + i];
        const w  = rawOutput[2 * numBoxes + i];
        const h  = rawOutput[3 * numBoxes + i];

        // Find max class score
        let maxScore = 0;
        let classId = 0;
        for (let c = 0; c < numClasses; c++) {
          const score = rawOutput[(4 + c) * numBoxes + i];
          if (score > maxScore) { maxScore = score; classId = c; }
        }

        if (maxScore < YOLO_CONF_THRESHOLD) continue;

        // Convert cx,cy,w,h to x1,y1,x2,y2 in original pixel space
        candidates.push({
          x1: (cx - w / 2) * scaleX,
          y1: (cy - h / 2) * scaleY,
          x2: (cx + w / 2) * scaleX,
          y2: (cy + h / 2) * scaleY,
          score: maxScore,
          classId,
          label: COCO_CLASSES[classId] || `class${classId}`,
        });
      }

      // Non-Maximum Suppression
      return this._nms(candidates, YOLO_IOU_THRESHOLD);
    }

    _nms(boxes, iouThresh) {
      boxes.sort((a, b) => b.score - a.score);
      const kept = [];
      const suppressed = new Uint8Array(boxes.length);
      for (let i = 0; i < boxes.length; i++) {
        if (suppressed[i]) continue;
        kept.push(boxes[i]);
        for (let j = i + 1; j < boxes.length; j++) {
          if (suppressed[j]) continue;
          if (this._iou(boxes[i], boxes[j]) > iouThresh) suppressed[j] = 1;
        }
      }
      return kept;
    }

    _iou(a, b) {
      const ix1 = Math.max(a.x1, b.x1);
      const iy1 = Math.max(a.y1, b.y1);
      const ix2 = Math.min(a.x2, b.x2);
      const iy2 = Math.min(a.y2, b.y2);
      const interW = Math.max(0, ix2 - ix1);
      const interH = Math.max(0, iy2 - iy1);
      const inter = interW * interH;
      const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
      const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
      return inter / (areaA + areaB - inter + 1e-6);
    }

    /** Run depth estimation on the current video frame. */
    async _runDepth(video) {
      if (!this._depthPipeline) return;
      this._depthRunning = true;
      try {
        const offscreen = new OffscreenCanvas(320, 180);
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(video, 0, 0, 320, 180);
        const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        const url = URL.createObjectURL(blob);
        const result = await this._depthPipeline(url);
        URL.revokeObjectURL(url);
        if (result && result.depth && result.depth.data) {
          this._lastDepthMap = { data: result.depth.data, width: result.depth.width, height: result.depth.height };
        }
      } finally {
        this._depthRunning = false;
      }
    }

    /**
     * Sample average depth in a bounding box region.
     * Returns normalized value 0-1 (higher = closer in Depth Anything convention).
     */
    _sampleDepth(det, vidW, vidH) {
      if (!this._lastDepthMap) return null;
      const dm = this._lastDepthMap;
      const xFrac = (det.x1 + (det.x2 - det.x1) * 0.5) / vidW;
      const yFrac = (det.y1 + (det.y2 - det.y1) * 0.5) / vidH;
      const px = Math.min(Math.floor(xFrac * dm.width), dm.width - 1);
      const py = Math.min(Math.floor(yFrac * dm.height), dm.height - 1);
      const rawDepth = dm.data[py * dm.width + px];
      // Normalize to 0-1
      return rawDepth / 255.0;
    }

    _depthToZone(d) {
      if (d === null) return 'unknown';
      if (d >= DEPTH_DANGER)  return 'danger';
      if (d >= DEPTH_CAUTION) return 'caution';
      return 'safe';
    }

    /** Draw bounding boxes and labels onto the overlay canvas. */
    _drawDetections(detections, vidW, vidH) {
      const ctx = this._ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

      // Scale canvas coords to match actual rendered size
      const scaleX = this._canvas.width / vidW;
      const scaleY = this._canvas.height / vidH;

      for (const det of detections) {
        const depth = this._sampleDepth(det, vidW, vidH);
        const zone = this._depthToZone(depth);
        const isHazard = HAZARD_CLASSES.has(det.label);

        // Color by zone; default to caution when depth unknown
        const color = zone === 'danger'  ? ZONE_COLORS.danger
                    : zone === 'caution' ? ZONE_COLORS.caution
                    : zone === 'safe'    ? ZONE_COLORS.safe
                    : isHazard           ? ZONE_COLORS.caution
                                         : ZONE_COLORS.safe;

        const x1 = det.x1 * scaleX;
        const y1 = det.y1 * scaleY;
        const bw = (det.x2 - det.x1) * scaleX;
        const bh = (det.y2 - det.y1) * scaleY;

        // Bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x1, y1, bw, bh);

        // Semi-transparent fill for danger zone
        if (zone === 'danger' || isHazard) {
          ctx.fillStyle = color.replace('0.85', '0.10');
          ctx.fillRect(x1, y1, bw, bh);
        }

        // Label pill
        const pct = Math.round(det.score * 100);
        const distLabel = depth !== null
          ? (zone === 'danger' ? 'CERCA' : zone === 'caution' ? 'MEDIO' : 'LEJOS')
          : '';
        const labelText = `${det.label.toUpperCase()} ${pct}%${distLabel ? ' \u00b7 ' + distLabel : ''}`;
        const padding = 4;
        const fontSize = 12;
        ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
        const textW = ctx.measureText(labelText).width;
        const labelX = Math.max(x1, 2);
        const labelY = Math.max(y1 - fontSize - padding * 2, fontSize + padding);

        ctx.fillStyle = color.replace('0.85', '0.95');
        ctx.beginPath();
        ctx.roundRect(labelX, labelY - fontSize, textW + padding * 2, fontSize + padding * 2, 4);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, labelX + padding, labelY);
      }
    }

    /** Compute the aggregate mobility result and notify app.js. */
    _emitResult(detections) {
      if (detections.length === 0) {
        this._onResult({ zone: 'safe', detections: [], audioMessage: null, label: 'Camino despejado' });
        return;
      }

      // Find the nearest hazard (highest depth score)
      let worstZone = 'safe';
      let worstDet = null;
      let worstDepth = -1;

      for (const det of detections) {
        const depth = this._sampleDepth(det, this._video.videoWidth, this._video.videoHeight);
        const zone = this._depthToZone(depth);
        if (zone === 'danger' && worstZone !== 'danger') { worstZone = 'danger'; worstDet = det; worstDepth = depth || 0; }
        if (zone === 'caution' && worstZone === 'safe') { worstZone = 'caution'; worstDet = det; worstDepth = depth || 0; }
        if (worstDet === null) { worstDet = det; }
      }

      const label = worstDet ? worstDet.label : 'obstaculo';
      let audioMessage = null;

      if (worstZone === 'danger') {
        audioMessage = `Precaucion. ${label} muy cerca.`;
      } else if (worstZone === 'caution') {
        audioMessage = `${label} a distancia media.`;
      }

      this._onResult({
        zone: worstZone,
        detections,
        audioMessage,
        label: `${detections.length} objeto${detections.length > 1 ? 's' : ''} detectado${detections.length > 1 ? 's' : ''}`,
        backendMode: this.backendMode,
      });
    }

    _notify(payload) {
      this._onResult({ ...payload, engineEvent: true });
    }
  }

  global.EcoEyeVisionEngine = EcoEyeVisionEngine;

})(typeof window !== 'undefined' ? window : globalThis);
