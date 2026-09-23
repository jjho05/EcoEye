# Guia de Trabajo en Equipo y Puesta en Marcha Multi-Dispositivo — EcoEye

Documento tecnico integral para el equipo de desarrollo de **EcoEye (HackaTec Regional 2026 — Categoria 5: Software Inteligente)**. Contiene las instrucciones exactas, configuracion de entorno, credenciales de acceso, comandos de ejecucion y estandares de trabajo para clonar, ejecutar y colaborar desde cualquier equipo (macOS, Linux o Windows).

---

## 1. Ficha Tecnica del Proyecto y Enlaces Clave

* **Nombre del Proyecto**: EcoEye — Asistencia Visual y Monitoreo del Hogar
* **Repositorio Oficial en GitHub**: [https://github.com/jjho05/EcoEye.git](https://github.com/jjho05/EcoEye.git)
* **Rama Principal**: `main`
* **Aplicacion en Produccion (Vercel)**: [https://ecoeye-gilt.vercel.app/](https://ecoeye-gilt.vercel.app/)
* **Base de Datos Centralizada (Cloud)**: Neon Serverless PostgreSQL 18.6 (Region AWS us-east-2)
* **Pila Tecnologica**:
  * **Backend**: Python 3.11, FastAPI, Pydantic v2, Uvicorn, Cryptography (AES-256-GCM), Pytest.
  * **Almacenamiento Local**: SQLite3 con Write-Ahead Logging (WAL) y PRAGMA journal_mode = TRUNCATE (compatible con Serverless Lambda/Vercel en `/tmp`).
  * **Almacenamiento Cloud**: PostgreSQL (Neon Cloud) con transacciones ACID e indices B-Tree.
  * **Frontend**: HTML5 Semantico, Vanilla CSS (Variables, Flexbox, CSS Grid avanzado, animaciones fluidas), Vanilla JavaScript ES6+, WebRTC MediaDevices (camara en vivo), Web Speech API (TTS en espanol es-MX), Web Audio API (sintesis de tonos acusticos), Navigator Vibration API.

---

## 2. Requisitos Previos del Sistema

Antes de iniciar en un nuevo dispositivo, verificar que se cuente con las siguientes herramientas instaladas:

1. **Python**: Version 3.10 o superior (recomendado Python 3.11).
   * Verificar en terminal: `python3 --version` o `python --version`
2. **Git**: Version 2.30 o superior.
   * Verificar en terminal: `git --version`
3. **Node.js y npm** (Opcional, unicamente si se desea desplegar directamente via Vercel CLI):
   * Node.js 18+.

---

## 3. Instalacion y Configuracion Paso a Paso en un Nuevo Dispositivo

### Paso 1: Clonar el Repositorio de GitHub

Abrir la terminal en el directorio de trabajo preferido y ejecutar:

```bash
git clone https://github.com/jjho05/EcoEye.git
cd EcoEye
```

### Paso 2: Crear y Activar el Entorno Virtual de Python

#### En macOS y Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### En Windows (PowerShell):
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

#### En Windows (Simbolo del sistema / CMD):
```cmd
python -m venv .venv
.\.venv\Scripts\activate.bat
```

### Paso 3: Instalar las Dependencias del Proyecto

Con el entorno virtual activo, instalar el paquete en modo editable y sus dependencias:

```bash
pip install --upgrade pip
pip install -e .
pip install pytest httpx
```

*Nota: Tambien se puede utilizar el archivo de requerimientos directo:*
```bash
pip install -r requirements.txt
```

### Paso 4: Configurar el Archivo de Variables de Entorno (`.env`)

Crear un archivo llamado `.env` en la raiz del proyecto (`EcoEye/.env`) con la configuracion del sistema y la conexion activa a Neon PostgreSQL:

```ini
# EcoEye - Entorno de Configuracion
ECOEYE_ENV=development
ECOEYE_DEBUG=true

# Base de Datos Remota (Neon Serverless PostgreSQL en AWS us-east-2)
ECOEYE_DATABASE_URL=postgresql://EcoBase_owner:npg_r0bZBMLD9slk@ep-round-math-b5qvhgnu-pooler.c-7.us-east-2.aws.neon.tech/EcoBase?sslmode=require&channel_binding=require
DATABASE_URL=postgresql://EcoBase_owner:npg_r0bZBMLD9slk@ep-round-math-b5qvhgnu-pooler.c-7.us-east-2.aws.neon.tech/EcoBase?sslmode=require&channel_binding=require

# Seguridad Criptografica (Clave de cifrado simetrico AES-256-GCM)
ECOEYE_SECRET_KEY=ecoeye-hackatec-regional-2026-master-key-secure-vault
ECOEYE_SALT=ecoeye-salt-32bytes-secure-fixed01

# Almacenamiento Local Offline-First (SQLite WAL)
ECOEYE_DB_PATH=ecoeye_local.db

# Configuracion de Sensores y Umbrales
ECOEYE_CSI_SAMPLE_RATE_HZ=100
ECOEYE_CSI_NUM_SUBCARRIERS=64
ECOEYE_CSI_FALL_THRESHOLD_VARIANCE=2.8
ECOEYE_CSI_INACTIVITY_WINDOW_SEC=4.0

# Telemetria de Glucosa (Normativa 20-500 mg/dL)
ECOEYE_GLUCOSE_MIN_ALERT_MGDL=70.0
ECOEYE_GLUCOSE_MAX_ALERT_MGDL=180.0

# Gateway de Sincronizacion
ECOEYE_CLOUD_GATEWAY_URL=http://127.0.0.1:8000/api/v1/sync/telemetry
ECOEYE_DEVICE_ID=ecoeye-edge-001
ECOEYE_API_HOST=0.0.0.0
ECOEYE_API_PORT=8000
```

---

## 4. Matriz de Credenciales y Cuentas de Acceso (RBAC)

Al abrir la aplicacion (tanto en local como en Vercel), la compuerta de autenticacion exigira iniciar sesion. El sistema cuenta con tres roles preconfigurados y soporte para ingreso con credenciales directas o seleccion de perfil de un solo clic:

| Perfil / Nombre Visible | Usuario | Contrasena | Rol RBAC | Alcance y Permisos Funcionales |
| :--- | :--- | :--- | :--- | :--- |
| **Jesus Olvera** | `cuidador` *(o `jesus.olvera`)* | `familiar2026!` *(o `ecoeye2026!`)* | `caregiver` | Monitoreo del hogar, alertas de caidas, despacho de emergencias por WhatsApp, vision asistiva y sonar ToF. |
| **Dra. Carmen Santos** | `medico` | `clinica2026!` | `clinician` | Consulta de glucemia, metricas ADA (Time-in-Range %), revision de historial y expedientes clinicos forenses. |
| **Ing. Administrador** | `admin` | `ecoeye2026!` | `admin` | Calibracion de parametros tecnicos, umbrales de radar CSI, inspeccion de sincronizacion y auditoria. |

*Nota: En la pantalla de login, basta con hacer clic en el boton **"INGRESAR"** de cualquiera de las tarjetas de perfil para autenticarse automaticamente con token JWT de sesion.*

---

## 5. Comandos de Ejecucion Local

### Iniciar el Servidor de Desarrollo FastAPI
Para iniciar el servidor con recarga automatica de codigo ante cualquier cambio:

```bash
python3 -m uvicorn ecoeye.server.api:app --host 127.0.0.1 --port 8000 --reload
```

### URLs de Acceso Local
Una vez iniciado el servidor, abrir el navegador en:
* **Panel de Control (Dashboard)**: `http://127.0.0.1:8000/`
* **Documentacion Interactiva OpenAPI (Swagger)**: `http://127.0.0.1:8000/docs`
* **Verificacion de Salud y Base de Datos**: `http://127.0.0.1:8000/health`
* **Metricas y Telemetria en Vivo**: `http://127.0.0.1:8000/api/v1/stats`

---

## 6. Ejecucion de Pruebas Automatizadas

Antes de subir cambios a Git, es obligatorio ejecutar la suite de pruebas completa para garantizar que ninguna funcionalidad se haya roto:

```bash
python3 -m pytest tests/ -v
```

### Cobertura de las Pruebas (43 tests pasando al 100%):
1. `tests/test_auth_and_config.py`: Autenticacion RBAC, generacion de tokens, renovacion, revocacion y actualizacion de configuracion.
2. `tests/test_caregivers_and_dispatch.py`: Registro CRUD de cuidadores en base de datos, persistencia de obstaculos y generacion de enlace de despacho WhatsApp.
3. `tests/test_dashboard_integration.py`: Entrega de activos estaticos, rutas SPA, integridad del modal de login y widgets del panel.
4. `tests/test_end_to_end_capabilities.py`: Ingesta clinica cifrada de glucosa, protocolo de caida CSI, inferencia de vision con imagen base64 y verificacion de cero elementos de demostracion estaticos.
5. `tests/test_postgres_integration.py`: Conexion y operaciones CRUD contra Neon PostgreSQL en AWS us-east-2.
6. `tests/test_security.py`: Cifrado y descifrado autenticado AES-256-GCM con PBKDF2 (100k rondas), deteccion de alteraciones de ciphertext y firmas HMAC-SHA256.
7. `tests/test_storage.py`: Inicializacion de SQLite local, persistencia con WAL y gestion de cola de sincronizacion idempotente.
8. `tests/test_vision_features.py`: Clasificacion de billetes Banxico, procesamiento OCR con debouncing y endpoints REST de vision.

---

## 7. Estructura y Mapeo del Codigo Fuente

```
EcoEye/
├── api/
│   └── index.py               # Entrada Serverless ASGI de Vercel (enruta a FastAPI)
├── ecoeye/
│   ├── config.py              # Ajustes Pydantic Settings y resolucion de rutas
│   ├── core/
│   │   ├── events.py          # Bus asincrono pub/sub desacoplado
│   │   ├── models.py          # Modelos de dominio Pydantic (Alertas, Glucosa, Obstaculos)
│   │   └── security.py        # Motor criptografico AES-256-GCM, PBKDF2 y SHA-256
│   ├── dashboard/             # Codigo fuente del Frontend (SPA)
│   │   ├── css/               # tokens.css, layout.css, components.css, animations.css
│   │   ├── js/
│   │   │   ├── api.js         # Cliente HTTP con soporte de token Authorization Bearer
│   │   │   └── app.js         # Controlador principal, HUD WebRTC, audio, modales y login
│   │   ├── assets/            # Logotipos SVG, favicon e iconografia
│   │   └── index.html         # Documento SPA con compuerta de login y 5 vistas
│   ├── sensing/
│   │   ├── glucose_ble/       # Parser GATT IEEE-11073 para glucometros BLE
│   │   ├── vision/            # Clasificador de billetes Banxico, OCR y HUD
│   │   └── wifi_csi/          # Detector perimetral de caidas por varianza CSI y ventana de quietud
│   ├── server/
│   │   ├── api.py             # Rutas FastAPI (auth, cuidadores, telemetria, dispatch, obstaculos)
│   │   └── auth.py            # Gestor RBAC, hashing PBKDF2 y sesiones
│   └── storage/
│       ├── database.py        # Esquema SQLite local con indices y tablas cifradas
│       ├── postgres.py        # Driver Neon Serverless PostgreSQL (pooling y reconexion)
│       └── repository.py      # Repositorio unificado con cifrado transparente
├── public/                    # Directorio sincronizado para entrega estatica en Vercel
├── tests/                     # 8 archivos de pruebas automatizadas unitarias y de integracion
├── .env.example               # Plantilla de variables de entorno
├── pyproject.toml             # Metadatos del paquete y configuracion de build
├── requirements.txt           # Dependencias de Python fijadas
└── vercel.json                # Reescrituras y headers de seguridad para despliegue en Vercel
```

---

## 8. Reglas de Trabajo en Equipo y Buenas Practicas

Para mantener la calidad y consistencia tecnica del proyecto, todo el equipo debe seguir estas reglas:

### Regla 1: CERO Emojis en Todo el Repositorio
* **Estricto e innegociable**: No incluir emojis en codigo fuente (Python, JS, CSS, HTML), mensajes de commit de Git, comentarios de codigo ni archivos Markdown de documentacion.
* Se utilizan iconos vectoriales SVG limpios y terminologia tecnica formal.

### Regla 2: Sincronizacion Obligatoria de Frontend (`public/`)
* Vercel sirve los archivos estaticos directamente desde el directorio `public/`.
* Siempre que se realice cualquier modificacion en `ecoeye/dashboard/`, se debe ejecutar el comando de sincronizacion antes de hacer commit:
  ```bash
  cp -r ecoeye/dashboard/* public/
  ```
* Se puede verificar que ambas carpetas esten 100% identicas con:
  ```bash
  diff -r ecoeye/dashboard public
  ```

### Regla 3: Flujo de Versionado en Git
1. Antes de iniciar una nueva tarea:
   ```bash
   git pull origin main
   ```
2. Realizar cambios y validar con pruebas:
   ```bash
   python3 -m pytest tests/
   ```
3. Agregar cambios y comitear con mensaje semantico y claro (sin emojis):
   ```bash
   git add -A
   git commit -m "feat: descripcion concisa del cambio tecnico"
   ```
4. Subir a GitHub:
   ```bash
   git push origin main
   ```

### Regla 4: Despliegues a Vercel
* Cada push a la rama `main` en GitHub dispara una compilacion y despliegue automatico en Vercel.
* Si se requiere forzar el despliegue de produccion desde la terminal:
  ```bash
  npx -y vercel --prod --yes
  ```

---

## 9. Preguntas Frecuentes y Solucion de Problemas

### 1. "No se puede abrir la base de datos SQLite en Vercel"
* **Causa**: En entornos Serverless (AWS Lambda / Vercel), todo el sistema de archivos es estrictamente de solo lectura, excepto el directorio `/tmp`.
* **Solucion**: `api/index.py` y `ecoeye/config.py` detectan automaticamente si se esta ejecutando en Vercel y reasignan la ruta de la base de datos a `/tmp/ecoeye_local.db` con `PRAGMA journal_mode = TRUNCATE`.

### 2. "Hice cambios en el frontend pero no se reflejan en el navegador"
* **Causa**: El navegador tiene en memoria cache los archivos `.js` o `.css` viejos.
* **Solucion**:
  1. Verificar que hayas sincronizado con `cp -r ecoeye/dashboard/* public/`.
  2. Hacer un refresco forzado en el navegador (`Ctrl + Shift + R` en Windows/Linux o `Cmd + Shift + R` en Mac).
  3. Si es necesario, incrementar el parametro de version en `index.html` (ej. `?v=2.4.0`).

### 3. "Error: ModuleNotFoundError: No module named 'ecoeye' al correr pytest"
* **Causa**: Python no tiene la raiz del proyecto en su `PYTHONPATH`.
* **Solucion**: Ejecutar las pruebas siempre usando el modulo de Python:
  ```bash
  python3 -m pytest tests/ -v
  ```

---

*Documento elaborado para el equipo de desarrollo de EcoEye. Mantener actualizado ante cualquier cambio arquitectonico.*
