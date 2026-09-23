-- ================================================================
-- EcoEye — Base de datos remota (PostgreSQL / Supabase)
-- ================================================================
-- Capa de Persistencia Remota y Sincronización Edge-to-Cloud.
-- 
-- Cumple con:
--   - Arquitectura Offline-first (Idempotencia en UUIDs desde SQLite)
--   - Alertas del ecosistema (Caídas CSI, Visión artificial, Estado)
--   - Telemetría de nodos (Batería, latencia, conectividad)
--   - Row Level Security (RLS) estricto (Dueños y Cuidadores)
--   - Índices GIN para búsqueda ultra rápida en payloads JSONB
-- ================================================================

-- ----------------------------------------------------------------
-- 0. Extensiones
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- 1. Tipos Enumerados (Optimizados para el Ecosistema)
-- ----------------------------------------------------------------
CREATE TYPE public.device_type AS ENUM (
    'wifi_csi_node', 
    'camera_device', 
    'wearable_hub', 
    'other'
);

CREATE TYPE public.device_status AS ENUM (
    'activo', 
    'inactivo', 
    'offline', 
    'mantenimiento'
);

CREATE TYPE public.alert_type AS ENUM (
    'caida_detectada',
    'obstaculo_inminente',
    'dispositivo_offline',
    'bateria_baja',
    'anomalia_sistema',
    'prueba_sistema'
);

CREATE TYPE public.alert_severity AS ENUM (
    'info', 
    'advertencia', 
    'critica'
);

CREATE TYPE public.alert_status AS ENUM (
    'activa', 
    'reconocida', 
    'falsa_alarma', 
    'resuelta'
);

CREATE TYPE public.caregiver_status AS ENUM (
    'pendiente', 
    'activo', 
    'revocado'
);

-- ----------------------------------------------------------------
-- 2. Perfiles de Usuario (Extiende auth.users de Supabase)
-- ----------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    locale TEXT NOT NULL DEFAULT 'es-MX',
    timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Perfil principal del usuario de EcoEye. Autogestionado vía Triggers de Supabase Auth.';

-- ----------------------------------------------------------------
-- 3. Nodos y Sensores del Ecosistema (Edge Devices)
-- ----------------------------------------------------------------
CREATE TABLE public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mac_address TEXT UNIQUE,
    device_name TEXT NOT NULL,
    device_type public.device_type NOT NULL,
    firmware_version TEXT,
    status public.device_status NOT NULL DEFAULT 'activo',
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_user ON public.devices(user_id);

-- ----------------------------------------------------------------
-- 4. Motor de Alertas (Sincronización Idempotente desde SQLite)
-- ----------------------------------------------------------------
CREATE TABLE public.alerts (
    id UUID PRIMARY KEY, -- Viene generado desde SQLite (alert_id) para evitar duplicados en reintentos
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    alert_type public.alert_type NOT NULL,
    severity public.alert_severity NOT NULL DEFAULT 'advertencia',
    status public.alert_status NOT NULL DEFAULT 'activa',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Contiene métricas de inferencia (mAP, CSI confidence)
    occurred_at TIMESTAMPTZ NOT NULL, -- Timestamp original del evento sin conexión
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Índices de alto rendimiento para series de tiempo y JSONB
CREATE INDEX idx_alerts_user_time ON public.alerts (user_id, occurred_at DESC);
CREATE INDEX idx_alerts_active ON public.alerts (user_id) WHERE status = 'activa';
CREATE INDEX idx_alerts_payload_gin ON public.alerts USING GIN (payload_json); -- Búsqueda ultra rápida dentro del JSON

COMMENT ON TABLE public.alerts IS 'Eventos críticos sincronizados desde el Edge (Offline-First). El UUID asegura idempotencia.';

-- ----------------------------------------------------------------
-- 5. Telemetría de Nodos (Heartbeats y Estado de Salud)
-- ----------------------------------------------------------------
CREATE TABLE public.device_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    battery_level NUMERIC(5,2) CHECK (battery_level >= 0 AND battery_level <= 100),
    cpu_temp NUMERIC(5,2),
    uptime_seconds BIGINT,
    network_latency_ms INT,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- BRIN Index es ideal para tablas de series de tiempo masivas (telemetría)
CREATE INDEX idx_telemetry_time ON public.device_telemetry USING BRIN (recorded_at);

-- ----------------------------------------------------------------
-- 6. Red de Cuidadores (Caregivers)
-- ----------------------------------------------------------------
CREATE TABLE public.caregivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    caregiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    relationship TEXT,
    status public.caregiver_status NOT NULL DEFAULT 'pendiente',
    notify_falls BOOLEAN NOT NULL DEFAULT TRUE,
    notify_system_errors BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, caregiver_id)
);

CREATE INDEX idx_caregivers_patient ON public.caregivers (patient_id);
CREATE INDEX idx_caregivers_caregiver ON public.caregivers (caregiver_id);

-- ================================================================
-- 7. FUNCIONES Y TRIGGERS (Automatización Backend)
-- ================================================================

-- 7.1 Auto-update timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7.2 Creación automática de perfil al registrarse en Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario EcoEye'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7.3 Helper: Verificar si es cuidador activo
CREATE OR REPLACE FUNCTION public.is_active_caregiver(patient UUID) RETURNS BOOLEAN STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.caregivers c
        WHERE c.patient_id = patient 
          AND c.caregiver_id = auth.uid() 
          AND c.status = 'activo'
    );
$$ LANGUAGE sql;

-- ================================================================
-- 8. ROW LEVEL SECURITY (RLS) DE GRADO MILITAR
-- ================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caregivers ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "perfil: leer propio o paciente asignado" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_active_caregiver(id));
CREATE POLICY "perfil: actualizar el propio" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Devices
CREATE POLICY "dispositivos: dueño gestiona todo" ON public.devices FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "dispositivos: cuidador consulta" ON public.devices FOR SELECT USING (public.is_active_caregiver(user_id));

-- Alerts (Inserción Edge-to-Cloud)
CREATE POLICY "alertas: nodos insertan (upsert)" ON public.alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "alertas: leer propias o de paciente" ON public.alerts FOR SELECT USING (auth.uid() = user_id OR public.is_active_caregiver(user_id));
CREATE POLICY "alertas: reconocer (update)" ON public.alerts FOR UPDATE USING (auth.uid() = user_id OR public.is_active_caregiver(user_id));

-- Caregivers
CREATE POLICY "cuidadores: dueño administra" ON public.caregivers FOR ALL USING (auth.uid() = patient_id);
CREATE POLICY "cuidadores: ver asignaciones propias" ON public.caregivers FOR SELECT USING (auth.uid() = caregiver_id);

-- ================================================================
-- Fin del esquema remoto — EcoEye
-- ================================================================
