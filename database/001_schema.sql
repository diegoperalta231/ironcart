-- =====================================================================
-- IRONCART · Esquema físico (PostgreSQL 15+ / Supabase)
-- ---------------------------------------------------------------------
-- Ejecutar en el SQL Editor de Supabase (o con psql) en este orden:
--   001_schema.sql      -> tablas, índices, RLS
--   002_functions.sql   -> funciones RPC (API de datos del backend)
--   003_pgvector.sql    -> (opcional) búsqueda vectorial con pgvector
--   004_seed_catalog.sql, 005_seed_knowledge.sql -> datos de demostración
--
-- Modelo de seguridad:
--   * RLS habilitado en TODAS las tablas y SIN políticas para anon/authenticated:
--     el navegador no puede leer ni escribir directamente ninguna tabla.
--   * El único acceso es a través de funciones SECURITY DEFINER (api_*) que
--     solo puede ejecutar el rol service_role, usado exclusivamente por las
--     Netlify Functions (servidor). Ver 002_functions.sql.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent() no es IMMUTABLE; este envoltorio sí lo es (diccionario fijo),
-- lo que permite usarlo en columnas generadas e índices.
create or replace function public.f_unaccent(t text)
returns text language sql immutable parallel safe strict
set search_path = public, extensions
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, t) $$;

-- ---------------------------------------------------------------------
-- Usuarios y sesiones (autenticación propia con bcrypt vía pgcrypto)
-- ---------------------------------------------------------------------
create table if not exists public.usuario (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (char_length(nombre) between 2 and 80),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash text not null,
  rol           text not null default 'cliente' check (rol in ('cliente','admin')),
  creado_en     timestamptz not null default now()
);
create unique index if not exists usuario_email_uk on public.usuario (lower(email));

create table if not exists public.sesion (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuario(id) on delete cascade,
  token_hash  text not null unique,           -- SHA-256 del token; el token en claro solo vive en la cookie HttpOnly
  expira_en   timestamptz not null,
  creado_en   timestamptz not null default now()
);
create index if not exists sesion_usuario_idx on public.sesion (usuario_id);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table if not exists public.categoria (
  id          serial primary key,
  slug        text not null unique,
  nombre      text not null,
  descripcion text not null default '',
  orden       int  not null default 0
);

create table if not exists public.marca (
  id      serial primary key,
  slug    text not null unique,
  nombre  text not null,
  pais    text
);

create table if not exists public.producto (
  id              serial primary key,
  slug            text not null unique,
  nombre          text not null,
  marca_id        int  not null references public.marca(id),
  categoria_id    int  not null references public.categoria(id),
  descripcion     text not null,
  presentacion    text not null,             -- p. ej. "5 lb (2.27 kg)"
  sabor           text,
  porciones       int,
  precio          numeric(10,2) not null check (precio > 0),
  precio_anterior numeric(10,2) check (precio_anterior is null or precio_anterior > precio),
  stock           int not null default 0 check (stock >= 0),
  imagen          text not null default 'tub',  -- clave de ilustración (tub|jar|bottle|can|shaker|strap|caps) o URL
  color           text not null default '#C6FF3D',
  destacado       boolean not null default false,
  activo          boolean not null default true,
  beneficios      text[] not null default '{}',
  creado_en       timestamptz not null default now(),
  estado_disponibilidad text generated always as (
    case when stock = 0 then 'agotado' when stock <= 5 then 'pocas_unidades' else 'disponible' end
  ) stored
);
create index if not exists producto_categoria_idx on public.producto (categoria_id);
create index if not exists producto_marca_idx on public.producto (marca_id);
create index if not exists producto_nombre_trgm on public.producto using gin (public.f_unaccent(lower(nombre)) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Carrito
-- ---------------------------------------------------------------------
create table if not exists public.carrito (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references public.usuario(id) on delete cascade,
  estado         text not null default 'activo' check (estado in ('activo','convertido','abandonado')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists carrito_usuario_idx on public.carrito (usuario_id) where estado = 'activo';

create table if not exists public.detalle_carrito (
  id          serial primary key,
  carrito_id  uuid not null references public.carrito(id) on delete cascade,
  producto_id int  not null references public.producto(id),
  cantidad    int  not null check (cantidad between 1 and 20),
  agregado_en timestamptz not null default now(),
  unique (carrito_id, producto_id)
);

-- ---------------------------------------------------------------------
-- Pedidos (checkout de demostración; no hay pagos reales)
-- ---------------------------------------------------------------------
create sequence if not exists public.pedido_numero_seq start 20001;

create table if not exists public.pedido (
  id              uuid primary key default gen_random_uuid(),
  numero          int  not null unique default nextval('public.pedido_numero_seq'),
  usuario_id      uuid not null references public.usuario(id) on delete cascade,
  estado          text not null default 'confirmado'
                  check (estado in ('confirmado','preparando','enviado','entregado','cancelado')),
  subtotal        numeric(10,2) not null,
  envio           numeric(10,2) not null,
  total           numeric(10,2) not null,
  metodo_pago     text not null check (metodo_pago in ('tarjeta_demo','transferencia_demo','contra_entrega_demo')),
  -- Minimización de datos: solo lo indispensable para "enviar" un pedido de demostración.
  nombre_envio    text not null,
  direccion       text not null,
  ciudad          text not null,
  telefono        text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create index if not exists pedido_usuario_idx on public.pedido (usuario_id, creado_en desc);

create table if not exists public.detalle_pedido (
  id              serial primary key,
  pedido_id       uuid not null references public.pedido(id) on delete cascade,
  producto_id     int  not null references public.producto(id),
  nombre_producto text not null,          -- instantánea al momento de la compra
  precio_unitario numeric(10,2) not null,
  cantidad        int not null check (cantidad > 0),
  subtotal        numeric(10,2) not null
);

-- ---------------------------------------------------------------------
-- Chatbot Spot
-- ---------------------------------------------------------------------
create table if not exists public.conversacion (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid references public.usuario(id) on delete set null,
  creado_en         timestamptz not null default now(),
  ultimo_mensaje_en timestamptz not null default now()
);

create table if not exists public.mensaje (
  id               bigserial primary key,
  conversacion_id  uuid not null references public.conversacion(id) on delete cascade,
  rol              text not null check (rol in ('user','assistant')),
  contenido        text not null,
  intent_detectado text,
  ruta             text,
  confianza        numeric(4,3),
  fallback         boolean not null default false,
  metadatos        jsonb not null default '{}'::jsonb,
  creado_en        timestamptz not null default now()
);
create index if not exists mensaje_conv_idx on public.mensaje (conversacion_id, id desc);

-- Base de conocimiento para RAG (fragmentos curados de 100-300 palabras)
create table if not exists public.documento_conocimiento (
  id            serial primary key,
  slug          text not null unique,
  categoria     text not null check (categoria in ('productos','preguntas_frecuentes','gimnasio_nutricion','politicas')),
  titulo        text not null,
  contenido     text not null,
  claves        text not null default '',   -- sinónimos/palabras clave curadas (peso A en la búsqueda)
  fuente        text not null,
  autor         text not null,
  actualizado   date not null,
  tsv           tsvector generated always as (
                  setweight(to_tsvector('spanish', public.f_unaccent(lower(titulo || ' ' || claves))), 'A') ||
                  setweight(to_tsvector('spanish', public.f_unaccent(lower(contenido))), 'B')
                ) stored
);
create index if not exists documento_tsv_idx on public.documento_conocimiento using gin (tsv);

-- ---------------------------------------------------------------------
-- Operación: rate limiting compartido entre instancias serverless y contacto
-- ---------------------------------------------------------------------
create table if not exists public.rate_limit (
  clave          text not null,
  ventana_inicio timestamptz not null,
  conteo         int not null default 0,
  primary key (clave, ventana_inicio)
);

create table if not exists public.contacto_mensaje (
  id        serial primary key,
  nombre    text not null,
  email     text not null,
  asunto    text not null,
  mensaje   text not null,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS: denegar por defecto. Ninguna política para anon/authenticated.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['usuario','sesion','categoria','marca','producto','carrito','detalle_carrito',
                           'pedido','detalle_pedido','conversacion','mensaje','documento_conocimiento',
                           'rate_limit','contacto_mensaje']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
