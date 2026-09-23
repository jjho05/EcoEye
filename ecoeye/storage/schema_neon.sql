-- ================================================================
-- EcoEye — Base de Datos Cloud para Neon Serverless PostgreSQL
-- ================================================================
-- Capa de Persistencia Remota, Telemetría y Sincronización Edge-to-Cloud.
-- Optimizado 100% para Neon.tech (PostgreSQL Serverless).
-- ================================================================

-- ----------------------------------------------------------------
-- 0. Extensiones
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- 1. Esquema y Tabla de Autenticación (Compatibilidad Neon / Supabase)
-- ----------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Función helper para auth.uid() en entornos PostgreSQL estándar (Neon)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
    SELECT NULL::UUID;
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------
-- 2. Tipos Enumerados (Optimizados para el Ecosistema)
-- ----------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE public.device_type AS ENUM (
        'wifi_csi_node', 
        'camera_device', 
        'wearable_hub', 
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.device_status AS ENUM (
        'activo', 
        'inactivo', 
        'offline', 
        'mantenimiento'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.alert_type AS ENUM (
        'caida_detectada',
        'obstaculo_inminente',
        'dispositivo_offline',
        'bateria_baja',
        'anomalia_sistema',
        'prueba_sistema'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.alert_severity AS ENUM (
        'info', 
        'advertencia', 
        'critica'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.alert_status AS ENUM (
        'activa', 
        'reconocida', 
        'falsa_alarma', 
        'resuelta'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.caregiver_status AS ENUM (
        'pendiente', 
        'activo', 
        'revocado'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------
-- 3. Perfiles de Usuario (Extiende auth.users)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'paciente',
    locale TEXT NOT NULL DEFAULT 'es-MX',
    timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Perfil de usuario/paciente sincronizado con EcoEye.';

-- ----------------------------------------------------------------
-- 4. Nodos y Sensores del Ecosistema (Edge Devices)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devices (
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

CREATE INDEX IF NOT EXISTS idx_devices_user ON public.devices(user_id);

-- ----------------------------------------------------------------
-- 5. Motor de Alertas (Sincronización Idempotente desde SQLite Edge)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY, -- Viene generado desde SQLite (alert_id) para evitar duplicados en reintentos
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    alert_type public.alert_type NOT NULL,
    severity public.alert_severity NOT NULL DEFAULT 'advertencia',
    status public.alert_status NOT NULL DEFAULT 'activa',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Contiene métricas de inferencia (CSI variance, mAP, etc.)
    occurred_at TIMESTAMPTZ NOT NULL, -- Timestamp original del evento en el Edge
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_time ON public.alerts (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON public.alerts (user_id) WHERE status = 'activa';
CREATE INDEX IF NOT EXISTS idx_alerts_payload_gin ON public.alerts USING GIN (payload_json);

COMMENT ON TABLE public.alerts IS 'Eventos críticos sincronizados desde el Edge (Offline-First). El UUID asegura idempotencia.';

-- ----------------------------------------------------------------
-- 6. Telemetría de Nodos (Heartbeats, Batería, Latencia, Sensores)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    battery_level NUMERIC(5,2) CHECK (battery_level >= 0 AND battery_level <= 100),
    cpu_temp NUMERIC(5,2),
    uptime_seconds BIGINT,
    network_latency_ms INT,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_time ON public.device_telemetry (recorded_at DESC);

-- ----------------------------------------------------------------
-- 7. Red de Cuidadores (Caregivers y Red Asistencial)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.caregivers (
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

CREATE INDEX IF NOT EXISTS idx_caregivers_patient ON public.caregivers (patient_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_caregiver ON public.caregivers (caregiver_id);

-- ----------------------------------------------------------------
-- 8. Automatización Backend (Funciones y Triggers)
-- ----------------------------------------------------------------

-- 8.1 Auto-update timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated 
BEFORE UPDATE ON public.profiles 
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_devices_updated ON public.devices;
CREATE TRIGGER trg_devices_updated 
BEFORE UPDATE ON public.devices 
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8.2 Creación automática de perfil al registrarse en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (
        NEW.id, 
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario EcoEye'),
        COALESCE(NEW.raw_user_meta_data->>'role', 'paciente')
    )
    ON CONFLICT (id) DO UPDATE 
    SET full_name = EXCLUDED.full_name,
        role = EXCLUDED.role;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created 
AFTER INSERT ON auth.users 
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8.3 Helper para verificar cuidadores activos
CREATE OR REPLACE FUNCTION public.is_active_caregiver(patient UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.caregivers c
        WHERE c.patient_id = patient 
          AND c.caregiver_id = auth.uid() 
          AND c.status = 'activo'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------
-- 9. Datos Iniciales de Demostración (Seed Data)
-- ----------------------------------------------------------------
DO $$
DECLARE
    demo_user_id UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    demo_device_id UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
BEGIN
    -- 1. Insertar usuario en auth.users
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
        demo_user_id, 
        'paciente.demo@ecoeye.lat', 
        '{"full_name": "Paciente Demostración EcoEye", "role": "paciente"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    -- 2. Asegurar perfil
    INSERT INTO public.profiles (id, full_name, phone, role)
    VALUES (
        demo_user_id, 
        'Paciente Demostración EcoEye', 
        '+52 55 1234 5678', 
        'paciente'
    )
    ON CONFLICT (id) DO NOTHING;

    -- 3. Dispositivo Wearable Edge
    INSERT INTO public.devices (id, user_id, mac_address, device_name, device_type, status, last_heartbeat)
    VALUES (
        demo_device_id, 
        demo_user_id, 
        'ecoeye-edge-001', 
        'EcoEye Edge Wearable Hub 001', 
        'wearable_hub'::public.device_type, 
        'activo'::public.device_status, 
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
END $$;
