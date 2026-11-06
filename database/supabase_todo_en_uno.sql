-- IRONCART · instalación completa (generado por scripts/build-knowledge-seed.mjs)
-- Pégalo en Supabase → SQL Editor → Run. Es idempotente: se puede ejecutar de nuevo.

-- >>>>>>>>>>>>>>>>>>>> 001_schema.sql
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


-- >>>>>>>>>>>>>>>>>>>> 002_functions.sql
-- =====================================================================
-- IRONCART · Funciones RPC (capa de datos del backend)
-- ---------------------------------------------------------------------
-- Todas las funciones públicas siguen la firma  api_<nombre>(p jsonb) returns jsonb
-- y se invocan desde las Netlify Functions vía PostgREST:
--   POST {SUPABASE_URL}/rest/v1/rpc/api_<nombre>   body: {"p": {...}}
-- Son SECURITY DEFINER, con search_path fijo, consultas parametrizadas
-- (sin SQL dinámico con datos del usuario) y solo ejecutables por service_role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- Construye un tsquery con semántica OR y prefijos a partir de texto libre.
create or replace function public.f_or_tsquery(q text)
returns tsquery language sql immutable
set search_path = public, extensions
as $$
  select case when count(*) = 0 then null
              else string_agg(quote_literal(lex) || case when length(lex) >= 4 then ':*' else '' end, ' | ')::tsquery end
  from unnest(tsvector_to_array(to_tsvector('spanish', public.f_unaccent(lower(coalesce(q, '')))))) as lex
$$;

-- Vista de producto enriquecida (solo uso interno de las funciones).
create or replace view public.v_producto with (security_invoker = true) as
select p.id, p.slug, p.nombre, p.descripcion, p.presentacion, p.sabor, p.porciones,
       p.precio, p.precio_anterior, p.stock, p.estado_disponibilidad, p.imagen, p.color,
       p.destacado, p.beneficios, p.creado_en,
       m.slug as marca_slug, m.nombre as marca,
       c.slug as categoria_slug, c.nombre as categoria,
       ( setweight(to_tsvector('spanish', public.f_unaccent(lower(p.nombre))), 'A')
      || setweight(to_tsvector('spanish', public.f_unaccent(lower(m.nombre || ' ' || c.nombre || ' ' || p.presentacion || ' ' || coalesce(p.sabor, '')))), 'B')
      || setweight(to_tsvector('spanish', public.f_unaccent(lower(p.descripcion))), 'C') ) as tsv,
       public.f_unaccent(lower(p.nombre || ' ' || m.nombre)) as nombre_norm
from public.producto p
join public.marca m on m.id = p.marca_id
join public.categoria c on c.id = p.categoria_id
where p.activo;
revoke all on public.v_producto from anon, authenticated;

create or replace function public._producto_json(v public.v_producto)
returns jsonb language sql immutable as $$
  select to_jsonb(v) - 'tsv' - 'nombre_norm'
$$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create or replace function public.api_catalogo(p jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_q     text    := nullif(trim(p->>'q'), '');
  v_cat   text    := nullif(p->>'categoria', '');
  v_marca text    := nullif(p->>'marca', '');
  v_orden text    := coalesce(nullif(p->>'orden', ''), 'relevancia');
  v_disp  boolean := coalesce((p->>'solo_disponibles')::boolean, false);
  v_dest  boolean := coalesce((p->>'destacados')::boolean, false);
  v_lim   int     := least(greatest(coalesce((p->>'limite')::int, 24), 1), 60);
  v_off   int     := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_tsq   tsquery := public.f_or_tsquery(v_q);
  v_qn    text    := public.f_unaccent(lower(coalesce(v_q, '')));
  v_res   jsonb;
begin
  with base as (
    select v.*,
           case when v_q is null then 0
                else coalesce(ts_rank_cd(v.tsv, v_tsq), 0) + similarity(v.nombre_norm, v_qn) end as score
    from public.v_producto v
    where (v_cat is null or v.categoria_slug = v_cat)
      and (v_marca is null or v.marca_slug = v_marca)
      and (not v_disp or v.stock > 0)
      and (not v_dest or v.destacado)
      and (v_q is null
           or (v_tsq is not null and v.tsv @@ v_tsq)
           or v.nombre_norm % v_qn
           or v.nombre_norm like '%' || v_qn || '%')
  ),
  ordenado as (
    select b.*, row_number() over (
      order by
        case when v_orden = 'precio_asc'  then b.precio end asc,
        case when v_orden = 'precio_desc' then b.precio end desc,
        case when v_orden = 'nombre'      then b.nombre end asc,
        case when v_orden = 'nuevos'      then b.creado_en end desc,
        b.score desc, b.destacado desc, b.stock > 0 desc, b.id
    ) as rn
    from base b
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'items', coalesce((
      select jsonb_agg((to_jsonb(o) - 'tsv' - 'nombre_norm' - 'rn' - 'score') order by o.rn)
      from ordenado o where o.rn > v_off and o.rn <= v_off + v_lim), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

create or replace function public.api_producto(p jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v public.v_producto; v_rel jsonb;
begin
  select * into v from public.v_producto where slug = p->>'slug';
  if not found then return null; end if;
  select coalesce(jsonb_agg(public._producto_json(r) order by r.destacado desc, r.id), '[]'::jsonb) into v_rel
  from (select * from public.v_producto
        where categoria_slug = v.categoria_slug and id <> v.id
        order by destacado desc, id limit 4) r;
  return public._producto_json(v) || jsonb_build_object('relacionados', v_rel);
end $$;

create or replace function public.api_categorias(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', c.slug, 'nombre', c.nombre, 'descripcion', c.descripcion,
           'productos', (select count(*) from public.producto x where x.categoria_id = c.id and x.activo))
         order by c.orden), '[]'::jsonb)
  from public.categoria c
$$;

create or replace function public.api_marcas(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', m.slug, 'nombre', m.nombre,
           'productos', (select count(*) from public.producto x where x.marca_id = m.id and x.activo))
         order by m.nombre), '[]'::jsonb)
  from public.marca m
$$;

-- Búsqueda para Spot (Ruta 1). Devuelve candidatos con puntaje de relevancia.
create or replace function public.api_buscar_productos_chat(p jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_q    text := nullif(trim(p->>'q'), '');
  v_lim  int  := least(greatest(coalesce((p->>'limite')::int, 5), 1), 8);
  v_cat  text := nullif(p->>'categoria', '');
  v_ids  int[];
  v_tsq  tsquery := public.f_or_tsquery(v_q);
  v_qn   text := public.f_unaccent(lower(coalesce(v_q, '')));
  v_res  jsonb;
begin
  if jsonb_typeof(p->'ids') = 'array' then
    select array_agg(x::int) into v_ids from jsonb_array_elements_text(p->'ids') x;
    select coalesce(jsonb_agg(public._producto_json(v) || jsonb_build_object('score', 1)), '[]'::jsonb) into v_res
    from public.v_producto v where v.id = any(v_ids);
    return v_res;
  end if;
  if v_q is null and v_cat is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(j order by s desc), '[]'::jsonb) into v_res
  from (
    select (to_jsonb(v) - 'tsv' - 'nombre_norm' - 's') || jsonb_build_object('score', round(s::numeric, 4)) as j, s
    from (
      select v.*, (coalesce(ts_rank_cd(v.tsv, v_tsq), 0) * 2
                   + word_similarity(v_qn, v.nombre_norm)
                   + similarity(v.nombre_norm, v_qn)) as s
      from public.v_producto v
      where (v_cat is null or v.categoria_slug = v_cat)
        and (v_q is null or (v_tsq is not null and v.tsv @@ v_tsq) or v_qn <% v.nombre_norm)
    ) v
    order by s desc
    limit v_lim
  ) t;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- Carrito
-- ---------------------------------------------------------------------
create or replace function public._carrito_fusionar(p_origen uuid, p_destino uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  insert into public.detalle_carrito (carrito_id, producto_id, cantidad)
  select p_destino, d.producto_id, least(d.cantidad, 20)
  from public.detalle_carrito d
  join public.carrito c on c.id = d.carrito_id and c.usuario_id is null and c.estado = 'activo'
  where d.carrito_id = p_origen
  on conflict (carrito_id, producto_id)
  do update set cantidad = least(public.detalle_carrito.cantidad + excluded.cantidad, 20);
  update public.carrito set estado = 'abandonado', actualizado_en = now()
  where id = p_origen and usuario_id is null;
end $$;

-- Devuelve el carrito activo válido para el actor (invitado o usuario).
-- Un invitado nunca puede acceder a un carrito que pertenece a un usuario.
create or replace function public._carrito_resolver(p_carrito uuid, p_usuario uuid, p_crear boolean)
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v uuid;
begin
  if p_usuario is not null then
    select id into v from public.carrito
    where usuario_id = p_usuario and estado = 'activo' order by actualizado_en desc limit 1;
    if v is not null then
      if p_carrito is not null and p_carrito <> v then
        perform public._carrito_fusionar(p_carrito, v);
      end if;
      return v;
    end if;
    if p_carrito is not null then
      update public.carrito set usuario_id = p_usuario, actualizado_en = now()
      where id = p_carrito and usuario_id is null and estado = 'activo'
      returning id into v;
      if v is not null then return v; end if;
    end if;
    if p_crear then insert into public.carrito (usuario_id) values (p_usuario) returning id into v; end if;
    return v;
  end if;

  if p_carrito is not null then
    select id into v from public.carrito where id = p_carrito and usuario_id is null and estado = 'activo';
    if v is not null then return v; end if;
  end if;
  if p_crear then insert into public.carrito default values returning id into v; end if;
  return v;
end $$;

create or replace function public._carrito_json(p_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_items jsonb; v_sub numeric(10,2); v_cant int; v_envio numeric(10,2);
begin
  if p_id is null then
    return jsonb_build_object('id', null, 'items', '[]'::jsonb, 'cantidad_total', 0,
                              'subtotal', 0, 'envio', 0, 'total', 0, 'envio_gratis_desde', 75);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', d.producto_id, 'cantidad', d.cantidad,
           'subtotal', round(v.precio * d.cantidad, 2),
           'stock_suficiente', v.stock >= d.cantidad,
           'producto', public._producto_json(v)) order by d.agregado_en), '[]'::jsonb),
         coalesce(sum(round(v.precio * d.cantidad, 2)), 0),
         coalesce(sum(d.cantidad), 0)
    into v_items, v_sub, v_cant
  from public.detalle_carrito d
  join public.v_producto v on v.id = d.producto_id
  where d.carrito_id = p_id;
  v_envio := case when v_cant = 0 or v_sub >= 75 then 0 else 5.99 end;
  return jsonb_build_object('id', p_id, 'items', v_items, 'cantidad_total', v_cant,
                            'subtotal', v_sub, 'envio', v_envio, 'total', v_sub + v_envio,
                            'envio_gratis_desde', 75);
end $$;

create or replace function public.api_carrito_obtener(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v uuid := public._carrito_resolver((p->>'carrito_id')::uuid, (p->>'usuario_id')::uuid, false);
begin
  return public._carrito_json(v);
end $$;

-- Agrega (suma) o fija la cantidad de un producto. modo: 'sumar' | 'fijar'
create or replace function public.api_carrito_guardar_item(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_modo   text := coalesce(p->>'modo', 'sumar');
  v_prod   int  := (p->>'producto_id')::int;
  v_cant   int  := (p->>'cantidad')::int;
  v_stock  int;
  v_actual int;
  v_nueva  int;
  v_cart   uuid;
begin
  if v_cant is null or v_cant < 0 or v_cant > 20 then
    return jsonb_build_object('ok', false, 'error', 'cantidad_invalida');
  end if;
  select stock into v_stock from public.producto where id = v_prod and activo;
  if not found then return jsonb_build_object('ok', false, 'error', 'producto_no_encontrado'); end if;

  v_cart := public._carrito_resolver((p->>'carrito_id')::uuid, (p->>'usuario_id')::uuid, true);
  select cantidad into v_actual from public.detalle_carrito where carrito_id = v_cart and producto_id = v_prod;
  v_nueva := case when v_modo = 'fijar' then v_cant else coalesce(v_actual, 0) + v_cant end;

  if v_nueva <= 0 then
    delete from public.detalle_carrito where carrito_id = v_cart and producto_id = v_prod;
  else
    if v_nueva > 20 then
      return jsonb_build_object('ok', false, 'error', 'limite_por_producto', 'maximo', 20, 'carrito', public._carrito_json(v_cart));
    end if;
    if v_nueva > v_stock then
      return jsonb_build_object('ok', false, 'error', 'stock_insuficiente', 'disponible', v_stock, 'carrito', public._carrito_json(v_cart));
    end if;
    insert into public.detalle_carrito (carrito_id, producto_id, cantidad) values (v_cart, v_prod, v_nueva)
    on conflict (carrito_id, producto_id) do update set cantidad = excluded.cantidad;
  end if;
  update public.carrito set actualizado_en = now() where id = v_cart;
  return jsonb_build_object('ok', true, 'carrito', public._carrito_json(v_cart));
end $$;

create or replace function public.api_carrito_vaciar(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v uuid := public._carrito_resolver((p->>'carrito_id')::uuid, (p->>'usuario_id')::uuid, false);
begin
  if v is not null then delete from public.detalle_carrito where carrito_id = v; end if;
  return jsonb_build_object('ok', true, 'carrito', public._carrito_json(v));
end $$;

-- ---------------------------------------------------------------------
-- Checkout de demostración (transaccional, con bloqueo de inventario)
-- ---------------------------------------------------------------------
create or replace function public.api_checkout(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user   uuid := (p->>'usuario_id')::uuid;
  v_cart   uuid;
  v_falt   jsonb;
  v_sub    numeric(10,2);
  v_envio  numeric(10,2);
  v_ped    public.pedido;
  v_n      int;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'no_autenticado'); end if;
  v_cart := public._carrito_resolver((p->>'carrito_id')::uuid, v_user, false);
  if v_cart is null then return jsonb_build_object('ok', false, 'error', 'carrito_vacio'); end if;

  select count(*) into v_n from public.detalle_carrito where carrito_id = v_cart;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'carrito_vacio'); end if;

  -- Bloquea las filas de producto para evitar sobreventa concurrente.
  perform 1 from public.producto
  where id in (select producto_id from public.detalle_carrito where carrito_id = v_cart)
  order by id for update;

  select jsonb_agg(jsonb_build_object('producto_id', pr.id, 'nombre', pr.nombre,
                                      'solicitado', d.cantidad, 'disponible', pr.stock))
    into v_falt
  from public.detalle_carrito d join public.producto pr on pr.id = d.producto_id
  where d.carrito_id = v_cart and (pr.stock < d.cantidad or not pr.activo);
  if v_falt is not null then
    return jsonb_build_object('ok', false, 'error', 'stock_insuficiente', 'productos', v_falt);
  end if;

  select sum(round(pr.precio * d.cantidad, 2)) into v_sub
  from public.detalle_carrito d join public.producto pr on pr.id = d.producto_id
  where d.carrito_id = v_cart;
  v_envio := case when v_sub >= 75 then 0 else 5.99 end;

  insert into public.pedido (usuario_id, subtotal, envio, total, metodo_pago,
                             nombre_envio, direccion, ciudad, telefono)
  values (v_user, v_sub, v_envio, v_sub + v_envio, p->>'metodo_pago',
          p->'envio'->>'nombre', p->'envio'->>'direccion', p->'envio'->>'ciudad',
          nullif(p->'envio'->>'telefono', ''))
  returning * into v_ped;

  insert into public.detalle_pedido (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal)
  select v_ped.id, pr.id, pr.nombre, pr.precio, d.cantidad, round(pr.precio * d.cantidad, 2)
  from public.detalle_carrito d join public.producto pr on pr.id = d.producto_id
  where d.carrito_id = v_cart;

  update public.producto pr set stock = pr.stock - d.cantidad
  from public.detalle_carrito d
  where d.carrito_id = v_cart and d.producto_id = pr.id;

  update public.carrito set estado = 'convertido', actualizado_en = now() where id = v_cart;

  return jsonb_build_object('ok', true, 'pedido',
           public.api_pedido_detalle(jsonb_build_object('usuario_id', v_user, 'numero', v_ped.numero)));
end $$;

-- ---------------------------------------------------------------------
-- Pedidos (siempre filtrados por el usuario autenticado)
-- ---------------------------------------------------------------------
create or replace function public.api_pedido_detalle(p jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'numero', pe.numero, 'estado', pe.estado, 'subtotal', pe.subtotal, 'envio', pe.envio,
    'total', pe.total, 'metodo_pago', pe.metodo_pago, 'creado_en', pe.creado_en,
    'actualizado_en', pe.actualizado_en,
    'envio_a', jsonb_build_object('nombre', pe.nombre_envio, 'direccion', pe.direccion, 'ciudad', pe.ciudad),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'producto_id', d.producto_id, 'nombre', d.nombre_producto, 'cantidad', d.cantidad,
                'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal,
                'slug', pr.slug, 'imagen', pr.imagen, 'color', pr.color) order by d.id), '[]'::jsonb)
              from public.detalle_pedido d join public.producto pr on pr.id = d.producto_id
              where d.pedido_id = pe.id))
  from public.pedido pe
  where pe.numero = (p->>'numero')::int
    and pe.usuario_id = (p->>'usuario_id')::uuid
$$;

create or replace function public.api_pedidos_usuario(p jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(public.api_pedido_detalle(jsonb_build_object('usuario_id', pe.usuario_id, 'numero', pe.numero))
                            order by pe.creado_en desc), '[]'::jsonb)
  from public.pedido pe
  where pe.usuario_id = (p->>'usuario_id')::uuid
$$;

-- ---------------------------------------------------------------------
-- Autenticación (bcrypt + sesiones con token opaco hasheado)
-- ---------------------------------------------------------------------
create or replace function public._usuario_json(u public.usuario)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol)
$$;

create or replace function public.api_registro(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare u public.usuario;
begin
  if exists (select 1 from public.usuario where lower(email) = lower(p->>'email')) then
    return jsonb_build_object('ok', false, 'error', 'email_existente');
  end if;
  insert into public.usuario (nombre, email, password_hash)
  values (p->>'nombre', lower(p->>'email'), extensions.crypt(p->>'password', extensions.gen_salt('bf', 10)))
  returning * into u;
  return jsonb_build_object('ok', true, 'usuario', public._usuario_json(u));
end $$;

create or replace function public.api_login(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare u public.usuario; v_ok boolean;
begin
  select * into u from public.usuario where lower(email) = lower(p->>'email');
  if not found then
    -- Trabajo equivalente para no revelar por tiempo si el email existe.
    perform extensions.crypt(coalesce(p->>'password', ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'error', 'credenciales_invalidas');
  end if;
  v_ok := u.password_hash = extensions.crypt(p->>'password', u.password_hash);
  if not v_ok then return jsonb_build_object('ok', false, 'error', 'credenciales_invalidas'); end if;

  delete from public.sesion where usuario_id = u.id and expira_en < now();
  insert into public.sesion (usuario_id, token_hash, expira_en)
  values (u.id, p->>'token_hash', now() + make_interval(hours => coalesce((p->>'ttl_horas')::int, 168)));
  return jsonb_build_object('ok', true, 'usuario', public._usuario_json(u));
end $$;

create or replace function public.api_sesion_usuario(p jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select public._usuario_json(u)
  from public.sesion s join public.usuario u on u.id = s.usuario_id
  where s.token_hash = p->>'token_hash' and s.expira_en > now()
$$;

create or replace function public.api_sesion_cerrar(p jsonb)
returns jsonb language sql security definer
set search_path = public, extensions
as $$
  with d as (delete from public.sesion where token_hash = p->>'token_hash' returning 1)
  select jsonb_build_object('ok', true, 'cerradas', (select count(*) from d))
$$;

-- ---------------------------------------------------------------------
-- Spot: conversación, historial y base de conocimiento
-- ---------------------------------------------------------------------
-- Obtiene (o crea) la conversación y devuelve los últimos N mensajes.
-- Una conversación de un usuario no puede ser continuada por otro actor.
create or replace function public.api_chat_contexto(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_conv  uuid := (p->>'conversacion_id')::uuid;
  v_user  uuid := (p->>'usuario_id')::uuid;
  v_lim   int  := least(greatest(coalesce((p->>'limite')::int, 10), 0), 40);
  v_owner uuid;
  v_found boolean := false;
begin
  if v_conv is not null then
    select usuario_id, true into v_owner, v_found from public.conversacion where id = v_conv;
  end if;
  if not coalesce(v_found, false) or (v_owner is not null and v_owner is distinct from v_user) then
    insert into public.conversacion (usuario_id) values (v_user) returning id into v_conv;
  elsif v_owner is null and v_user is not null then
    update public.conversacion set usuario_id = v_user where id = v_conv;
  end if;

  return jsonb_build_object(
    'conversacion_id', v_conv,
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object(
                   'rol', m.rol, 'contenido', m.contenido, 'intent', m.intent_detectado,
                   'ruta', m.ruta, 'metadatos', m.metadatos, 'creado_en', m.creado_en) order by m.id), '[]'::jsonb)
                 from (select * from public.mensaje where conversacion_id = v_conv
                       order by id desc limit v_lim) m));
end $$;

create or replace function public.api_chat_guardar(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_conv uuid := (p->>'conversacion_id')::uuid;
begin
  insert into public.mensaje (conversacion_id, rol, contenido, intent_detectado, ruta, confianza, fallback, metadatos)
  select v_conv, m->>'rol', left(m->>'contenido', 8000), m->>'intent', m->>'ruta',
         nullif(m->>'confianza', '')::numeric, coalesce((m->>'fallback')::boolean, false),
         coalesce(m->'metadatos', '{}'::jsonb)
  from jsonb_array_elements(p->'mensajes') m;
  update public.conversacion set ultimo_mensaje_en = now() where id = v_conv;
  return jsonb_build_object('ok', true);
end $$;

-- Recuperación textual (Ruta 2) con FTS en español, sin tildes y semántica OR.
-- "cobertura" = fracción de términos de la consulta presentes en el documento;
-- se usa para decidir si la base documental tiene información suficiente.
create or replace function public.api_conocimiento_buscar_texto(p jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_tsq tsquery := public.f_or_tsquery(p->>'q');
  v_lex text[] := tsvector_to_array(to_tsvector('spanish', public.f_unaccent(lower(coalesce(p->>'q', '')))));
  v_lim int := least(greatest(coalesce((p->>'limite')::int, 4), 1), 8);
  v_res jsonb;
begin
  if v_tsq is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(j order by s desc), '[]'::jsonb) into v_res from (
    select jsonb_build_object('id', d.id, 'slug', d.slug, 'titulo', d.titulo, 'categoria', d.categoria,
                              'contenido', d.contenido, 'fuente', d.fuente, 'actualizado', d.actualizado,
                              'score', round(r.rank::numeric, 4), 'cobertura', round(r.cob::numeric, 3)) as j,
           r.rank * (0.25 + r.cob) as s
    from public.documento_conocimiento d
    cross join lateral (
      select ts_rank_cd(d.tsv, v_tsq, 1) as rank,
             (select count(*)::float from unnest(v_lex) l
               where d.tsv @@ (quote_literal(l) || case when length(l) >= 4 then ':*' else '' end)::tsquery)
             / greatest(cardinality(v_lex), 1) as cob
    ) r
    where d.tsv @@ v_tsq
    order by s desc
    limit v_lim) t;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- Operación
-- ---------------------------------------------------------------------
-- Ventana fija compartida en BD (funciona entre instancias serverless).
create or replace function public.api_rate_limit(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_vent int := greatest(coalesce((p->>'ventana_seg')::int, 60), 1);
  v_lim  int := greatest(coalesce((p->>'limite')::int, 10), 1);
  v_ini  timestamptz := to_timestamp(floor(extract(epoch from now()) / v_vent) * v_vent);
  v_c    int;
begin
  insert into public.rate_limit (clave, ventana_inicio, conteo) values (p->>'clave', v_ini, 1)
  on conflict (clave, ventana_inicio) do update set conteo = public.rate_limit.conteo + 1
  returning conteo into v_c;
  if random() < 0.02 then
    delete from public.rate_limit where ventana_inicio < now() - interval '1 day';
  end if;
  return jsonb_build_object('permitido', v_c <= v_lim, 'conteo', v_c, 'restante', greatest(v_lim - v_c, 0),
                            'reinicia_en', ceil(extract(epoch from (v_ini + make_interval(secs => v_vent) - now()))));
end $$;

create or replace function public.api_contacto(p jsonb)
returns jsonb language sql security definer
set search_path = public, extensions
as $$
  with i as (
    insert into public.contacto_mensaje (nombre, email, asunto, mensaje)
    values (p->>'nombre', p->>'email', p->>'asunto', p->>'mensaje') returning id)
  select jsonb_build_object('ok', true, 'id', (select id from i))
$$;

create or replace function public.api_salud(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'productos', (select count(*) from public.producto where activo),
    'documentos', (select count(*) from public.documento_conocimiento),
    'pgvector', exists (select 1 from pg_extension where extname = 'vector'))
$$;

-- ---------------------------------------------------------------------
-- Permisos: solo service_role (servidor) puede ejecutar la API de datos.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'api\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>> 004_seed_catalog.sql
-- =====================================================================
-- IRONCART · Datos de DEMOSTRACIÓN
-- Productos, precios e inventario son FICTICIOS, creados para un proyecto
-- académico. No representan el inventario ni los precios de ninguna tienda
-- real ni ofertas de los fabricantes mencionados. Las marcas pertenecen a sus
-- respectivos dueños y se usan solo como referencia de catálogo de ejemplo.
-- Script idempotente: se puede volver a ejecutar para restablecer el catálogo.
-- =====================================================================

insert into public.categoria (slug, nombre, descripcion, orden) values
 ('proteinas',   'Proteínas',   'Whey, aislados, caseína y mezclas para alcanzar tu aporte diario de proteína.', 1),
 ('creatinas',   'Creatinas',   'Monohidrato de creatina, el suplemento con mayor respaldo científico para fuerza y potencia.', 2),
 ('pre-entrenos','Pre-entrenos','Fórmulas con cafeína y otros ingredientes para llegar con energía a tu sesión.', 3),
 ('vitaminas',   'Vitaminas',   'Multivitamínicos, vitamina D, omega-3 y minerales para complementar tu alimentación.', 4),
 ('aminoacidos', 'Aminoácidos', 'BCAA, EAA, glutamina y beta-alanina para tus entrenamientos.', 5),
 ('accesorios',  'Accesorios',  'Shakers, cinturones, straps y guantes para entrenar mejor.', 6)
on conflict (slug) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

insert into public.marca (slug, nombre, pais) values
 ('optimum-nutrition','Optimum Nutrition','EE. UU.'),
 ('rule-1','Rule 1','EE. UU.'),
 ('muscletech','MuscleTech','Canadá'),
 ('dymatize','Dymatize','EE. UU.'),
 ('bsn','BSN','EE. UU.'),
 ('cellucor','Cellucor','EE. UU.'),
 ('myprotein','Myprotein','Reino Unido'),
 ('ghost','Ghost','EE. UU.'),
 ('nutrex','Nutrex','EE. UU.'),
 ('now-foods','NOW Foods','EE. UU.'),
 ('scivation','Scivation','EE. UU.'),
 ('universal-nutrition','Universal Nutrition','EE. UU.'),
 ('blenderbottle','BlenderBottle','EE. UU.'),
 ('harbinger','Harbinger','EE. UU.')
on conflict (slug) do update set nombre = excluded.nombre, pais = excluded.pais;

with d (slug, nombre, marca, categoria, descripcion, presentacion, sabor, porciones, precio, precio_anterior, stock, imagen, color, destacado, beneficios) as (values
 -- PROTEÍNAS
 ('gold-standard-whey-5lb','Gold Standard 100% Whey','optimum-nutrition','proteinas',
  'Mezcla de proteína de suero (aislado, concentrado y péptidos) con alrededor de 24 g de proteína por porción. Se disuelve fácilmente con agua o leche y es una de las proteínas más conocidas del mercado.',
  '5 lb (2.27 kg)','Doble chocolate',74,62.99,69.99,3,'tub','#E3B341',true,
  array['24 g de proteína por porción','Mezcla de aislado y concentrado','Fácil de mezclar']),
 ('gold-standard-whey-2lb','Gold Standard 100% Whey','optimum-nutrition','proteinas',
  'La misma fórmula de suero en presentación de 2 libras, ideal para probar sabores o para quienes entrenan con menor frecuencia.',
  '2 lb (907 g)','Vainilla',29,32.99,null,14,'tub','#E3B341',false,
  array['24 g de proteína por porción','Presentación compacta']),
 ('rule1-whey-blend-5lb','R1 Whey Blend','rule-1','proteinas',
  'Mezcla de aislado y concentrado de suero sin rellenos añadidos, con unos 24 g de proteína por porción y perfil de sabor intenso.',
  '5 lb (2.27 kg)','Chocolate fudge',76,54.99,null,9,'tub','#D7263D',false,
  array['Sin rellenos añadidos','Aislado + concentrado']),
 ('rule1-protein-isolate-5lb','R1 Protein (aislado)','rule-1','proteinas',
  'Proteína basada en aislado e hidrolizado de suero, baja en grasa y carbohidratos. Pensada para quienes buscan una proteína más "limpia".',
  '5 lb (2.27 kg)','Vainilla cremosa',76,64.99,72.99,6,'tub','#D7263D',false,
  array['Aislado + hidrolizado','Baja en grasa y azúcar']),
 ('iso100-5lb','ISO100 Hidrolizada','dymatize','proteinas',
  'Aislado de suero hidrolizado de rápida absorción con unos 25 g de proteína por porción. Opción popular para quienes tienen sensibilidad a la lactosa leve, ya que el aislado contiene muy poca.',
  '5 lb (2.27 kg)','Chocolate gourmet',71,79.99,null,8,'tub','#2B6CB0',true,
  array['25 g de proteína por porción','Aislado hidrolizado','Muy baja en lactosa']),
 ('elite-whey-5lb','Elite 100% Whey','dymatize','proteinas',
  'Mezcla de suero con buena relación precio-proteína, pensada para el consumo diario después de entrenar.',
  '5 lb (2.27 kg)','Chocolate intenso',68,57.99,null,0,'tub','#2B6CB0',false,
  array['Buena relación precio-proteína']),
 ('nitro-tech-4lb','Nitro-Tech Whey','muscletech','proteinas',
  'Proteína de suero con aislado como fuente principal y creatina añadida en la fórmula según el fabricante.',
  '4 lb (1.81 kg)','Chocolate con leche',40,49.99,null,11,'tub','#E53E3E',false,
  array['Aislado como fuente principal','Fórmula con creatina']),
 ('syntha-6-5lb','Syntha-6','bsn','proteinas',
  'Mezcla de proteínas de liberación sostenida (suero, caseína y huevo) con textura cremosa tipo malteada.',
  '5 lb (2.27 kg)','Malteada de chocolate',48,52.99,null,7,'tub','#1A1A1A',false,
  array['Mezcla de varias proteínas','Textura cremosa']),
 ('gold-standard-casein-4lb','Gold Standard 100% Caseína','optimum-nutrition','proteinas',
  'Caseína micelar de digestión lenta, con unos 24 g de proteína por porción. Suele usarse antes de dormir o en periodos largos sin comer.',
  '4 lb (1.81 kg)','Chocolate supremo',53,54.99,null,5,'tub','#5A3E2B',false,
  array['Digestión lenta','24 g de proteína por porción']),
 ('impact-whey-1kg','Impact Whey Protein','myprotein','proteinas',
  'Concentrado de suero de buena calidad a precio accesible, con unos 21 g de proteína por porción.',
  '2.2 lb (1 kg)','Chocolate natural',40,29.99,34.99,22,'bag','#00A3E0',false,
  array['Precio accesible','21 g de proteína por porción']),
 ('serious-mass-6lb','Serious Mass (ganador de peso)','optimum-nutrition','proteinas',
  'Ganador de peso alto en calorías y carbohidratos para quienes tienen dificultad para cubrir su requerimiento energético con comida.',
  '6 lb (2.72 kg)','Chocolate',8,45.99,null,10,'tub','#7A1F2B',false,
  array['Alto en calorías','Carbohidratos + proteína']),

 -- CREATINAS
 ('on-creatine-300g','Micronized Creatine Powder','optimum-nutrition','creatinas',
  'Monohidrato de creatina micronizado, sin sabor, 5 g por porción. Se mezcla con agua, jugo o tu batido de proteína.',
  '300 g','Sin sabor',60,24.99,null,25,'jar','#E3B341',true,
  array['Monohidrato 100 %','Micronizada','Sin sabor']),
 ('on-creatine-600g','Micronized Creatine Powder','optimum-nutrition','creatinas',
  'La misma creatina micronizada en presentación grande para 120 porciones.',
  '600 g','Sin sabor',120,39.99,44.99,12,'jar','#E3B341',false,
  array['Monohidrato 100 %','Mejor precio por porción']),
 ('platinum-creatine-400g','Platinum 100% Creatine','muscletech','creatinas',
  'Monohidrato de creatina micronizado de grado farmacéutico según el fabricante, sin sabor.',
  '400 g','Sin sabor',80,22.99,null,18,'jar','#E53E3E',false,
  array['Monohidrato micronizado','80 porciones']),
 ('dymatize-creatine-500g','Creatine Micronized','dymatize','creatinas',
  'Creatina monohidratada micronizada de fácil disolución, 5 g por porción.',
  '500 g','Sin sabor',100,27.99,null,4,'jar','#2B6CB0',false,
  array['100 porciones','Fácil disolución']),
 ('rule1-creatine-375g','R1 Creatine','rule-1','creatinas',
  'Monohidrato de creatina micronizado sin rellenos, 5 g por porción.',
  '375 g','Sin sabor',75,25.99,null,15,'jar','#D7263D',false,
  array['Sin rellenos','5 g por porción']),
 ('myprotein-creatine-500g','Creatina Monohidrato','myprotein','creatinas',
  'Creatina monohidrato en polvo sin sabor con excelente relación precio-porción.',
  '500 g','Sin sabor',100,21.99,null,30,'bag','#00A3E0',false,
  array['Relación precio-porción','Sin sabor']),

 -- PRE-ENTRENOS
 ('c4-original-30','C4 Original Pre-Workout','cellucor','pre-entrenos',
  'Pre-entreno clásico con cafeína, beta-alanina y citrulina. Contiene estimulantes: revisa la etiqueta y tu tolerancia a la cafeína.',
  '30 porciones (195 g)','Ponche de frutas',30,29.99,null,16,'can','#F56565',true,
  array['Con cafeína','Beta-alanina','Citrulina']),
 ('gold-standard-pre-300g','Gold Standard Pre-Workout','optimum-nutrition','pre-entrenos',
  'Pre-entreno con cafeína, creatina y beta-alanina. Contiene estimulantes.',
  '30 porciones (300 g)','Frambuesa azul',30,34.99,null,6,'can','#3182CE',false,
  array['Con creatina','Con cafeína']),
 ('ghost-legend-25','Legend Pre-Workout','ghost','pre-entrenos',
  'Pre-entreno con ingredientes etiquetados de forma transparente. Contiene cafeína.',
  '25 porciones','Frambuesa azul',25,44.99,null,3,'can','#A0AEC0',false,
  array['Etiqueta transparente','Con cafeína']),
 ('outlift-20','Outlift Pre-Workout','nutrex','pre-entrenos',
  'Pre-entreno de alta concentración por porción. Contiene estimulantes; no recomendado para personas sensibles a la cafeína.',
  '20 porciones','Miami vice',20,39.99,null,9,'can','#ED8936',false,
  array['Alta concentración','Con cafeína']),
 ('vapor-x5-30','Vapor X5 Next Gen','muscletech','pre-entrenos',
  'Pre-entreno con cafeína y beta-alanina en formato de 30 porciones.',
  '30 porciones','Frutas tropicales',30,32.99,null,0,'can','#E53E3E',false,
  array['Con cafeína','Beta-alanina']),
 ('rule1-pre-train-30','R1 Pre-Train','rule-1','pre-entrenos',
  'Pre-entreno con cafeína, citrulina y beta-alanina en dosis por porción visibles en la etiqueta.',
  '30 porciones','Limonada de mora',30,27.99,null,12,'can','#D7263D',false,
  array['Citrulina','Con cafeína']),

 -- VITAMINAS
 ('opti-men-90','Opti-Men Multivitamínico','optimum-nutrition','vitaminas',
  'Multivitamínico para hombres activos con vitaminas, minerales y extractos vegetales. No sustituye una alimentación variada.',
  '90 tabletas','—',30,24.99,null,20,'bottle','#2F855A',true,
  array['Vitaminas y minerales','30 días (3 tabletas)']),
 ('opti-women-60','Opti-Women Multivitamínico','optimum-nutrition','vitaminas',
  'Multivitamínico para mujeres activas con hierro, calcio y ácido fólico.',
  '60 cápsulas','—',30,19.99,null,14,'bottle','#B83280',false,
  array['Con hierro y ácido fólico','30 porciones']),
 ('now-vitamin-d3-5000','Vitamina D3 5000 UI','now-foods','vitaminas',
  'Vitamina D3 (colecalciferol) en cápsulas blandas. Consulta con un profesional antes de usar dosis altas de vitamina D.',
  '120 cápsulas blandas','—',120,12.99,null,35,'caps','#D69E2E',false,
  array['Cápsulas blandas','120 unidades']),
 ('now-omega3-200','Omega-3 1000 mg','now-foods','vitaminas',
  'Aceite de pescado con EPA y DHA en cápsulas blandas.',
  '200 cápsulas blandas','—',100,19.99,null,4,'caps','#3182CE',false,
  array['EPA + DHA','200 cápsulas']),
 ('now-magnesio-120','Citrato de Magnesio','now-foods','vitaminas',
  'Magnesio en forma de citrato en tabletas.',
  '120 tabletas','—',40,14.99,null,18,'bottle','#4A5568',false,
  array['Forma citrato','120 tabletas']),
 ('animal-pak-44','Animal Pak','universal-nutrition','vitaminas',
  'Paquetes diarios con multivitamínico y minerales pensados para atletas de fuerza.',
  '44 paquetes','—',44,39.99,null,7,'can','#1A1A1A',false,
  array['Paquetes diarios']),

 -- AMINOÁCIDOS
 ('xtend-bcaa-30','Xtend Original BCAA','scivation','aminoacidos',
  'BCAA en proporción 2:1:1 con electrolitos, sin azúcar. Se toma durante el entrenamiento como bebida de sorbo.',
  '30 porciones','Mango',30,29.99,null,13,'can','#38B2AC',true,
  array['BCAA 2:1:1','Con electrolitos','Sin azúcar']),
 ('on-bcaa-5000','BCAA 5000 Powder','optimum-nutrition','aminoacidos',
  'Aminoácidos de cadena ramificada en polvo, 5 g por porción.',
  '345 g','Ponche de frutas',60,26.99,null,10,'jar','#E3B341',false,
  array['5 g de BCAA por porción']),
 ('amino-energy-30','Essential Amino Energy','optimum-nutrition','aminoacidos',
  'Aminoácidos con una pequeña dosis de cafeína de fuentes naturales. Contiene cafeína.',
  '30 porciones (270 g)','Frambuesa azul',30,27.99,null,19,'can','#3182CE',false,
  array['Aminoácidos + cafeína']),
 ('myprotein-glutamina-1kg','L-Glutamina','myprotein','aminoacidos',
  'L-glutamina en polvo sin sabor.',
  '1 kg','Sin sabor',200,26.99,null,8,'bag','#00A3E0',false,
  array['Sin sabor','200 porciones']),
 ('now-beta-alanina-500g','Beta-Alanina en polvo','now-foods','aminoacidos',
  'Beta-alanina pura en polvo. Puede producir una sensación de hormigueo (parestesia) transitoria e inofensiva.',
  '500 g','Sin sabor',250,19.99,null,0,'jar','#4A5568',false,
  array['Polvo puro']),
 ('xtend-eaa-40','Xtend EAA','scivation','aminoacidos',
  'Los 9 aminoácidos esenciales con electrolitos, sin azúcar.',
  '40 porciones','Limonada',40,34.99,null,5,'can','#38B2AC',false,
  array['9 aminoácidos esenciales','Con electrolitos']),

 -- ACCESORIOS
 ('blenderbottle-classic-28oz','Shaker Classic 28 oz','blenderbottle','accesorios',
  'Shaker con bola mezcladora de acero inoxidable, tapa a prueba de fugas y marcas de medida.',
  '28 oz (828 ml)','Negro',null,9.99,null,40,'shaker','#C6FF3D',false,
  array['Bola mezcladora','A prueba de fugas']),
 ('blenderbottle-pro32','Shaker Pro32','blenderbottle','accesorios',
  'Shaker de mayor capacidad con boca ancha y asa de transporte.',
  '32 oz (946 ml)','Gris carbón',null,14.99,null,15,'shaker','#FF6B1A',true,
  array['Boca ancha','Mayor capacidad']),
 ('harbinger-cinturon-4in','Cinturón de levantamiento 4"','harbinger','accesorios',
  'Cinturón de cuero acolchado de 4 pulgadas para levantamientos pesados.',
  'Talla M (76–91 cm)','—',null,34.99,null,6,'belt','#C6FF3D',false,
  array['Acolchado','Hebilla doble']),
 ('harbinger-straps','Straps de levantamiento','harbinger','accesorios',
  'Correas de algodón acolchadas para mejorar el agarre en peso muerto y remos.',
  'Talla única (par)','—',null,12.99,null,22,'strap','#FF6B1A',false,
  array['Algodón acolchado','Par']),
 ('harbinger-guantes-pro','Guantes Pro Wristwrap','harbinger','accesorios',
  'Guantes de entrenamiento con muñequera integrada y palma acolchada.',
  'Talla M (par)','—',null,24.99,null,10,'glove','#C6FF3D',false,
  array['Muñequera integrada','Palma acolchada'])
)
insert into public.producto (slug, nombre, marca_id, categoria_id, descripcion, presentacion, sabor, porciones,
                             precio, precio_anterior, stock, imagen, color, destacado, beneficios)
select d.slug, d.nombre, m.id, c.id, d.descripcion, d.presentacion, nullif(d.sabor, '—'), d.porciones,
       d.precio, d.precio_anterior, d.stock, d.imagen, d.color, d.destacado, d.beneficios
from d join public.marca m on m.slug = d.marca join public.categoria c on c.slug = d.categoria
on conflict (slug) do update set
  nombre = excluded.nombre, marca_id = excluded.marca_id, categoria_id = excluded.categoria_id,
  descripcion = excluded.descripcion, presentacion = excluded.presentacion, sabor = excluded.sabor,
  porciones = excluded.porciones, precio = excluded.precio, precio_anterior = excluded.precio_anterior,
  stock = excluded.stock, imagen = excluded.imagen, color = excluded.color,
  destacado = excluded.destacado, beneficios = excluded.beneficios, activo = true;

-- ---------------------------------------------------------------------
-- Cuenta y pedido de demostración (para TC-04). Credenciales públicas de demo:
--   email: demo@ironcart.dev   contraseña: IronCart2026!
-- ---------------------------------------------------------------------
insert into public.usuario (nombre, email, password_hash)
values ('Cliente Demo', 'demo@ironcart.dev', extensions.crypt('IronCart2026!', extensions.gen_salt('bf', 10)))
on conflict do nothing;

do $$
declare v_user uuid; v_ped uuid;
begin
  select id into v_user from public.usuario where email = 'demo@ironcart.dev';
  if not exists (select 1 from public.pedido where numero = 12345) then
    insert into public.pedido (numero, usuario_id, estado, subtotal, envio, total, metodo_pago,
                               nombre_envio, direccion, ciudad, telefono, creado_en, actualizado_en)
    values (12345, v_user, 'enviado', 87.98, 0, 87.98, 'tarjeta_demo',
            'Cliente Demo', 'Calle de ejemplo 123', 'Managua', null, now() - interval '3 days', now() - interval '1 day')
    returning id into v_ped;
    insert into public.detalle_pedido (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal)
    select v_ped, p.id, p.nombre, p.precio, x.cant, p.precio * x.cant
    from (values ('gold-standard-whey-5lb', 1), ('on-creatine-300g', 1)) as x(slug, cant)
    join public.producto p on p.slug = x.slug;
  end if;
end $$;


-- >>>>>>>>>>>>>>>>>>>> 005_seed_knowledge.sql
-- =====================================================================
-- IRONCART · Base de conocimiento para RAG (GENERADO, no editar a mano)
-- Fuente: database/knowledge/**/*.md  ->  node scripts/build-knowledge-seed.mjs
-- 33 fragmentos. Contenido educativo parafraseado de fuentes públicas
-- citadas en la columna "fuente"; políticas de autoría propia (tienda de demo).
-- =====================================================================
insert into public.documento_conocimiento (slug, categoria, titulo, contenido, claves, fuente, autor, actualizado) values
  ('calentamiento', 'gimnasio_nutricion', 'Calentamiento antes de entrenar', 'Un buen calentamiento eleva la temperatura corporal y prepara músculos y articulaciones. Una estructura sencilla: 5 a 10 minutos de actividad cardiovascular suave, movilidad dinámica de las articulaciones que vas a trabajar y series de aproximación con poco peso del primer ejercicio.
El estiramiento estático prolongado justo antes de levantar cargas pesadas no suele ser necesario; se puede dejar para el final de la sesión.
Si sientes dolor agudo durante el ejercicio, detente. Spot no puede evaluar lesiones: consulta a un profesional de salud.', 'calentar estirar movilidad', 'Equipo IronCart (contenido educativo general)', 'Equipo IronCart', '2026-11-01'),
  ('hidratacion', 'gimnasio_nutricion', 'Hidratación y entrenamiento', 'Incluso una deshidratación leve puede disminuir el rendimiento físico y la concentración. Una forma práctica de vigilar la hidratación es observar el color de la orina: un tono amarillo pálido suele indicar buena hidratación.
En sesiones largas o con mucho calor, además de agua se pierden electrolitos como el sodio a través del sudor. Las bebidas con electrolitos pueden ser útiles en esos casos.
Bebe agua a lo largo del día, no solo durante el entrenamiento. Si usas creatina, mantener una buena hidratación también es una práctica recomendable.', 'agua beber sed sudor electrolitos deshidratacion', 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance (Fact Sheet for Health Professionals). https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/', 'Equipo IronCart', '2026-11-01'),
  ('momento-de-la-proteina', 'gimnasio_nutricion', '¿Cuándo tomar la proteína?', 'Durante años se habló de una "ventana anabólica" muy corta después de entrenar. La evidencia actual indica que esa ventana es más amplia de lo que se creía y que lo más importante es el total de proteína del día y su distribución en varias comidas.
Tomar un batido después de entrenar es práctico y está bien, pero también funciona en el desayuno o entre comidas. La caseína, por su digestión lenta, se usa con frecuencia antes de dormir.
En resumen: prioriza la constancia y el total diario; el momento exacto es un detalle secundario.', 'cuando antes despues ventana anabolica batido', 'Jäger, R. et al. (2017). International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 14, 20. https://doi.org/10.1186/s12970-017-0177-8', 'Equipo IronCart', '2026-11-01'),
  ('principiantes', 'gimnasio_nutricion', 'Si estás empezando: por dónde comenzar', 'Si eres nuevo en el gimnasio, lo que más impacto tiene en tus resultados es entrenar de forma constante, comer suficiente proteína y energía y dormir bien. Los suplementos vienen después.
Si decides usar suplementos, los más estudiados y versátiles suelen ser la proteína en polvo, como forma práctica de completar la proteína diaria, y el monohidrato de creatina. Los pre-entrenos son opcionales y contienen estimulantes.
Empieza con productos sencillos, lee las etiquetas y evita combinar muchos productos a la vez. Si tienes alguna condición de salud o tomas medicamentos, habla primero con tu médico o nutricionista. Spot puede ayudarte a comparar productos del catálogo y explicar diferencias generales.', 'empezar nuevo principiante gimnasio gym primero', 'Equipo IronCart (contenido educativo general)', 'Equipo IronCart', '2026-11-01'),
  ('principios-hipertrofia', 'gimnasio_nutricion', 'Principios básicos para ganar masa muscular', 'Para ganar masa muscular (hipertrofia) se combinan tres elementos: entrenamiento de fuerza con sobrecarga progresiva, suficiente proteína y energía en la dieta, y descanso adecuado.
La sobrecarga progresiva significa aumentar gradualmente el estímulo: más peso, más repeticiones, más series o mejor técnica con el tiempo. Trabajar cada grupo muscular aproximadamente dos veces por semana es una pauta común.
La técnica correcta es prioritaria para evitar lesiones. Si eres principiante, considera la guía de un entrenador certificado. Los suplementos como la proteína o la creatina pueden ayudar, pero el progreso depende principalmente del entrenamiento, la alimentación y la constancia.', 'musculo masa ganar series repeticiones rutina sobrecarga fuerza', 'Equipo IronCart (contenido educativo general)', 'Equipo IronCart', '2026-11-01'),
  ('proteina-diaria-referencias', 'gimnasio_nutricion', 'Proteína diaria: referencias generales para personas activas', 'La International Society of Sports Nutrition indica que, para la mayoría de las personas que hacen ejercicio, un consumo total de proteína de aproximadamente 1.4 a 2.0 g por kilogramo de peso corporal al día es suficiente para construir y mantener masa muscular. También sugiere repartirla en varias comidas a lo largo del día.
Estas cifras son referencias generales de la literatura científica, no una recomendación individual. La necesidad real depende de la edad, el tipo de entrenamiento, el objetivo y el estado de salud. Las personas con enfermedad renal u otras condiciones deben definir su consumo de proteína con un médico o nutricionista.
Lo ideal es cubrir la mayor parte con alimentos (carnes, huevo, lácteos, legumbres) y usar los suplementos como complemento práctico.', 'cuanta proteina necesito gramos kilogramo peso dia', 'Jäger, R. et al. (2017). International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 14, 20. https://doi.org/10.1186/s12970-017-0177-8', 'Equipo IronCart', '2026-11-01'),
  ('recuperacion-sueno', 'gimnasio_nutricion', 'Recuperación: sueño y descanso', 'El músculo no crece durante el entrenamiento, sino durante la recuperación. El sueño es uno de los pilares: dormir pocas horas de forma habitual se asocia con peor rendimiento, más fatiga y peor control del apetito. La mayoría de los adultos necesita al menos 7 horas por noche.
También es importante programar días de descanso o de menor intensidad, variar los grupos musculares trabajados y escuchar las señales de fatiga persistente.
Ningún suplemento compensa la falta de sueño o una alimentación deficiente. Si tienes dolor persistente o una lesión, consulta a un profesional de salud o fisioterapeuta.', 'dormir descanso descansar recuperar fatiga', 'Equipo IronCart (contenido educativo general)', 'Equipo IronCart', '2026-11-01'),
  ('suplementos-no-sustituyen-dieta', 'gimnasio_nutricion', 'Los suplementos no sustituyen una buena alimentación', 'Los suplementos deportivos son, como su nombre lo indica, un complemento. La base del rendimiento y la composición corporal es una alimentación suficiente y variada, el entrenamiento bien planificado y el descanso.
La Oficina de Suplementos Dietéticos de los NIH recuerda que los suplementos no pasan por la misma aprobación previa que los medicamentos y que su calidad puede variar; por eso conviene elegir marcas reconocidas y, cuando existan, productos verificados por terceros.
Ningún suplemento cura, trata ni previene enfermedades. Si tienes una condición médica, estás embarazada o tomas medicamentos, consulta a un profesional antes de usar cualquier suplemento.', 'comida alimentacion dieta reemplazar sustituir', 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance (Fact Sheet for Health Professionals). https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/', 'Equipo IronCart', '2026-11-01'),
  ('devoluciones', 'politicas', 'Cambios, devoluciones y garantía', 'Aceptamos devoluciones dentro de los 30 días posteriores a la entrega cuando el producto está cerrado, sellado y en su empaque original. Por razones de higiene y seguridad no aceptamos devoluciones de suplementos abiertos, salvo que el producto llegue dañado, vencido o sea distinto al solicitado.
Si recibiste un producto dañado o incorrecto, escríbenos en un máximo de 7 días con tu número de pedido y una foto; lo reponemos o reembolsamos sin costo.
Los accesorios (shakers, cinturones, straps, guantes) tienen garantía de 30 días contra defectos de fabricación.', 'devolver devolucion cambio cambiar reembolso garantia danado roto abierto vencido', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('envios', 'politicas', 'Política de envíos', 'Costo de envío: 5.99 USD por pedido. El envío es gratis en pedidos con subtotal de 75 USD o más.
Tiempos estimados (demostración): de 1 a 2 días hábiles en Managua y de 2 a 5 días hábiles en el resto de Nicaragua. Por ahora no realizamos envíos internacionales.
Cuando un pedido pasa a estado "enviado" puedes ver el cambio en "Mis pedidos" o preguntarle a Spot con tu número de pedido.
Recuerda que IronCart es una tienda de demostración: los envíos son simulados.', 'enviar envio entrega delivery domicilio llegar tarda costo gratis departamento ciudad', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('horarios-contacto', 'politicas', 'Horarios de atención y contacto', 'Spot, el asistente virtual, está disponible las 24 horas, todos los días.
Atención del equipo humano (demostración): lunes a viernes de 8:00 a 18:00 y sábados de 9:00 a 13:00, hora de Nicaragua. Domingos y feriados sin atención humana.
Puedes contactarnos mediante el formulario de la página de Contacto o por el correo de demostración soporte@ironcart.dev. Respondemos en un máximo de 24 horas hábiles.', 'horario abren cierran atienden domingo sabado telefono correo email llamar contacto whatsapp humano persona', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('metodos-de-pago', 'politicas', 'Métodos de pago', 'En el checkout de demostración de IronCart puedes elegir entre tres métodos simulados: tarjeta (demo), transferencia bancaria (demo) y pago contra entrega (demo).
Como se trata de un proyecto académico, ninguno de estos métodos realiza cobros reales y la tienda nunca solicita números de tarjeta, cuentas bancarias ni otros datos financieros. Al confirmar, el pedido se registra con el método elegido únicamente con fines de demostración.
En una versión comercial se integraría una pasarela de pagos certificada.', 'pagar pago tarjeta efectivo transferencia contra entrega paypal visa', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('politica-salud', 'politicas', 'Política de salud y uso responsable de suplementos', 'La información de IronCart y de Spot es general y educativa. No sustituye la consulta con un médico, nutricionista u otro profesional de salud.
Spot no diagnostica enfermedades, no prescribe tratamientos, no recomienda dosis personalizadas y no afirma que un suplemento cure o trate enfermedades. Si una persona menciona una condición de salud (por ejemplo, problemas renales, cardíacos, diabetes o embarazo), medicamentos, o solicita una dosis personalizada, Spot le recomendará consultar a un profesional.
Los suplementos no están destinados a menores de edad salvo indicación profesional. Lee siempre la etiqueta y las advertencias del fabricante.', 'medico salud enfermedad dosis responsabilidad', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('privacidad', 'politicas', 'Privacidad y protección de datos', 'IronCart recopila solo los datos mínimos necesarios: nombre, correo y contraseña cifrada para la cuenta, y nombre, dirección, ciudad y teléfono opcional para el envío de un pedido. No pedimos ni guardamos datos bancarios.
Las conversaciones con Spot se guardan para mantener el contexto y mejorar el servicio; no compartas datos sensibles en el chat. Para limitar abusos se usa un identificador derivado de forma irreversible de tu dirección IP, no la IP en texto plano.
Los pedidos solo son visibles para la cuenta que los realizó.', 'datos personales privacidad informacion seguridad', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('almacenamiento-caducidad', 'preguntas_frecuentes', 'Almacenamiento y fecha de caducidad de suplementos', 'Guarda los suplementos en un lugar fresco y seco, lejos de la luz directa del sol y de la humedad, con el envase bien cerrado. No los guardes en el baño ni dentro del auto, donde la temperatura cambia mucho.
Usa la cuchara medidora seca para evitar que el polvo se apelmace. Respeta la fecha de caducidad o de consumo preferente impresa en el envase y desecha el producto si cambia de olor, color o textura.
Mantén todos los suplementos fuera del alcance de los niños.', 'guardar vence vencimiento caducidad conservar', 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance (Fact Sheet for Health Professionals). https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/', 'Equipo IronCart', '2026-11-01'),
  ('como-comprar', 'preguntas_frecuentes', '¿Cómo comprar en IronCart?', 'Comprar en IronCart es sencillo: 1) explora el catálogo o usa el buscador; 2) entra a la ficha del producto para ver precio, presentación y disponibilidad; 3) pulsa "Agregar al carrito"; 4) en el carrito puedes cambiar cantidades o eliminar productos; 5) pulsa "Ir al checkout", inicia sesión o crea tu cuenta, completa los datos de envío y elige un método de pago de demostración; 6) confirma el pedido.
Antes de confirmar, el sistema valida que haya existencias suficientes de cada producto. Al confirmar se genera un número de pedido y el inventario se actualiza.
Importante: IronCart es una tienda de demostración académica. El checkout es una simulación; no se realizan cobros reales ni se solicitan datos bancarios.', 'comprar compra pedido checkout carrito pasos agregar', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('cuenta-registro', 'preguntas_frecuentes', 'Cuenta de usuario y registro', 'Puedes navegar y agregar productos al carrito sin cuenta. Para confirmar un pedido y consultar tu historial necesitas registrarte con tu nombre, correo y una contraseña de al menos 8 caracteres.
Al iniciar sesión, los productos que agregaste como invitado se conservan en tu carrito. Tu contraseña se almacena cifrada (bcrypt) y la sesión se guarda en una cookie segura.
Para probar la tienda puedes usar la cuenta de demostración indicada en la página de inicio de sesión.', 'registrarse registro cuenta contrasena iniciar sesion login', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('estado-pedidos', 'preguntas_frecuentes', 'Estados de un pedido y cómo consultarlo', 'Un pedido en IronCart pasa por estos estados: confirmado (se registró correctamente), preparando (se está empacando), enviado (va en camino), entregado y, en su caso, cancelado.
Puedes consultar tus pedidos en la sección "Mis pedidos" después de iniciar sesión, o preguntarle a Spot indicando el número de pedido. Por seguridad, Spot solo muestra información de pedidos que pertenecen a la cuenta con la sesión iniciada; nunca revela pedidos de otras personas.
Si no encuentras un pedido, verifica que hayas iniciado sesión con la misma cuenta con la que compraste.', 'rastrear seguimiento estado pedido orden enviado entregado', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('sobre-spot', 'preguntas_frecuentes', '¿Qué puede hacer Spot?', 'Spot es el asistente virtual de IronCart, impulsado por inteligencia artificial (Claude, de Anthropic). Puede buscar productos del catálogo, consultar precios y existencias reales en la base de datos, comparar productos, explicar diferencias entre tipos de suplementos, responder preguntas sobre envíos, pagos y políticas, orientarte en el proceso de compra y consultar el estado de tus pedidos si iniciaste sesión.
Spot no es médico ni nutricionista: no diagnostica, no prescribe tratamientos ni recomienda dosis personalizadas. Si mencionas una condición de salud o medicamentos, te recomendará consultar a un profesional.
Spot conserva el contexto de los últimos mensajes de la conversación y puedes reiniciarla cuando quieras.', 'spot asistente chatbot robot ayuda', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('tienda-demostracion', 'preguntas_frecuentes', 'IronCart es una tienda de demostración', 'IronCart es un proyecto académico. Los productos, precios, existencias y pedidos que ves son datos ficticios de demostración: no representan el inventario ni los precios de una tienda real ni ofertas de los fabricantes. Las marcas mencionadas pertenecen a sus respectivos dueños y se usan únicamente como ejemplo de catálogo.
Ningún pedido genera cobros ni envíos reales. Puedes probar libremente todo el flujo de compra.', 'real reales originales autenticos ficticio prueba demostracion precios', 'Política interna de IronCart (tienda de demostración, contenido de autoría propia)', 'Equipo IronCart', '2026-11-01'),
  ('bcaa-vs-eaa', 'productos', 'BCAA vs. EAA: diferencias', 'Los aminoácidos esenciales (EAA) son nueve aminoácidos que el cuerpo no puede fabricar y debe obtener de la dieta. Los aminoácidos de cadena ramificada (BCAA: leucina, isoleucina y valina) son tres de esos nueve.
Los BCAA son populares para tomar durante el entrenamiento, pero por sí solos no aportan todos los aminoácidos necesarios para construir proteína muscular. Los EAA contienen los nueve, por lo que son un perfil más completo.
Si ya consumes suficiente proteína de calidad en tu alimentación o con un batido de proteína, el beneficio adicional de los BCAA o EAA suele ser pequeño. Pueden ser útiles como bebida de sorbo durante sesiones largas o por preferencia de sabor. En IronCart tenemos Xtend Original BCAA y Xtend EAA, entre otros.', 'aminoacidos ramificados esenciales leucina', 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance (Fact Sheet for Health Professionals). https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/', 'Equipo IronCart', '2026-11-01'),
  ('cafeina-precauciones', 'productos', 'Cafeína: información general y precauciones', 'La FDA de Estados Unidos indica que para la mayoría de los adultos sanos hasta unos 400 mg de cafeína al día no se asocian generalmente con efectos negativos peligrosos, aunque la sensibilidad varía mucho entre personas. Esta cifra total incluye café, té, refrescos, bebidas energéticas y pre-entrenos.
Los efectos de un exceso pueden incluir insomnio, nerviosismo, ansiedad, aceleración del ritmo cardíaco, malestar estomacal y dolor de cabeza. Los productos concentrados en polvo o con mucha cafeína por porción requieren especial cuidado.
Las personas embarazadas, menores de edad, con condiciones cardíacas o que toman ciertos medicamentos deben consultar a un profesional. Spot no calcula dosis de cafeína personalizadas.', 'cafe estimulante nervios insomnio miligramos', 'U.S. Food and Drug Administration (2024). Spilling the Beans: How Much Caffeine is Too Much? https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much', 'Equipo IronCart', '2026-11-01'),
  ('como-leer-etiqueta', 'productos', 'Cómo leer la etiqueta de un suplemento', 'Antes de comprar un suplemento revisa: el tamaño de la porción y cuántas porciones trae el envase; la cantidad de cada ingrediente activo por porción (por ejemplo, gramos de proteína o miligramos de cafeína); si la fórmula usa "mezclas patentadas" que no detallan cantidades; los alérgenos (leche, soya, huevo, gluten); los azúcares y calorías; y las advertencias del fabricante.
Para comparar precios, divide el precio entre el número de porciones: así obtienes el costo por porción. En proteínas también puedes calcular el costo por gramo de proteína.
Busca sellos de verificación por terceros cuando estén disponibles. Y recuerda que las indicaciones de uso de la etiqueta son generales; si tienes una condición de salud, consulta a un profesional.', 'etiqueta porcion ingredientes alergenos costo', 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance (Fact Sheet for Health Professionals). https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/', 'Equipo IronCart', '2026-11-01'),
  ('creatina-mitos', 'productos', 'Mitos frecuentes sobre la creatina', '"La creatina es un esteroide": falso. Es un compuesto natural presente en los alimentos y en el cuerpo, sin relación con las hormonas esteroideas.
"Hace que retengas líquido y te veas hinchado": la creatina aumenta el agua dentro del músculo, lo que puede reflejarse en un pequeño aumento de peso en las primeras semanas. No es lo mismo que retención de líquidos bajo la piel.
"Hay que hacer fase de carga obligatoriamente": no. La fase de carga satura los músculos más rápido, pero tomar una porción diaria constante también los satura en algunas semanas.
"Hay que tomarla en un momento exacto": la constancia diaria importa más que el momento del día.
"Hay que descansar de la creatina cada cierto tiempo": no hay evidencia de que los ciclos sean necesarios en personas sanas.', 'esteroide retencion liquido hinchazon carga ciclos descanso', 'Kreider, R. B. et al. (2017). International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. JISSN, 14, 18. https://doi.org/10.1186/s12970-017-0173-z', 'Equipo IronCart', '2026-11-01'),
  ('creatina-que-es', 'productos', '¿Qué es la creatina y para qué sirve?', 'La creatina es un compuesto que el cuerpo produce de forma natural y que también se obtiene de alimentos como la carne y el pescado. Se almacena principalmente en los músculos como fosfocreatina, que ayuda a regenerar energía (ATP) durante esfuerzos cortos e intensos, como levantar pesas o hacer sprints.
Según la International Society of Sports Nutrition, el monohidrato de creatina es el suplemento ergogénico nutricional con más evidencia para mejorar la capacidad de realizar ejercicio de alta intensidad y aumentar la masa magra cuando se combina con entrenamiento.
La forma más estudiada es el monohidrato de creatina; otras formas más caras no han demostrado ser superiores. La versión "micronizada" es monohidrato con partículas más finas que se disuelven mejor.
Las etiquetas de los productos suelen indicar porciones de 3 a 5 g. Si tienes una condición de salud o tomas medicamentos, consulta a un profesional antes de usarla.', 'monohidrato micronizada fuerza potencia sirve beneficios', 'Kreider, R. B. et al. (2017). International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. JISSN, 14, 18. https://doi.org/10.1186/s12970-017-0173-z', 'Equipo IronCart', '2026-11-01'),
  ('creatina-seguridad-general', 'productos', 'Creatina: seguridad general y precauciones', 'La International Society of Sports Nutrition concluye que el uso de monohidrato de creatina a corto y largo plazo, en las cantidades estudiadas, es seguro y bien tolerado en personas sanas. Los estudios en personas sanas no han mostrado daño renal o hepático atribuible a la creatina.
La creatina puede elevar ligeramente la creatinina en sangre, un marcador que los médicos usan para evaluar la función renal; esto no significa necesariamente daño, pero es importante informarlo al médico si te hacen análisis.
Precaución importante: estas conclusiones se refieren a personas sanas. Quien tiene una enfermedad renal, otra condición de salud, está embarazada o toma medicamentos debe consultar a su médico o nutricionista antes de usar creatina o cualquier suplemento. Spot no puede evaluar casos individuales ni recomendar dosis personalizadas.', 'segura seguro riesgos efectos secundarios rinon renal', 'Kreider, R. B. et al. (2017). International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. JISSN, 14, 18. https://doi.org/10.1186/s12970-017-0173-z', 'Equipo IronCart', '2026-11-01'),
  ('glutamina-beta-alanina', 'productos', 'Glutamina y beta-alanina', 'La glutamina es el aminoácido más abundante del cuerpo. Aunque es popular en el gimnasio, la evidencia de que mejore el rendimiento o la ganancia muscular en personas sanas y bien alimentadas es limitada.
La beta-alanina aumenta los niveles de carnosina en el músculo, que ayuda a amortiguar la acidez durante esfuerzos intensos de aproximadamente uno a cuatro minutos. La postura de la International Society of Sports Nutrition indica que puede mejorar el rendimiento en ese tipo de esfuerzos. Su efecto secundario más conocido es la parestesia: un hormigueo en la piel, transitorio e inofensivo, que algunas personas perciben como molesto.
Como con cualquier suplemento, consulta a un profesional si tienes una condición de salud.', 'hormigueo comezon picazon parestesia carnosina', 'Trexler, E. T. et al. (2015). International Society of Sports Nutrition position stand: Beta-Alanine. JISSN, 12, 30. https://doi.org/10.1186/s12970-015-0090-y', 'Equipo IronCart', '2026-11-01'),
  ('multivitaminicos', 'productos', 'Multivitamínicos: qué esperar', 'Los multivitamínicos combinan varias vitaminas y minerales. Según la Oficina de Suplementos Dietéticos de los NIH, pueden ayudar a cubrir carencias en personas que no obtienen suficientes nutrientes de su alimentación, pero no sustituyen una dieta variada y no hay evidencia sólida de que prevengan enfermedades crónicas en personas bien alimentadas.
Al elegir uno, revisa que las cantidades no sean excesivas, especialmente si ya tomas otros suplementos o alimentos fortificados, para no sumar más de lo necesario de vitaminas como la A, la D o el hierro.
Las personas embarazadas, con condiciones médicas o que toman medicamentos (por ejemplo, anticoagulantes) deben consultar a su médico antes de usar multivitamínicos. En IronCart tenemos Opti-Men, Opti-Women y Animal Pak.', 'vitaminas minerales multivitaminico', 'NIH Office of Dietary Supplements. Multivitamin/mineral Supplements – Fact Sheet for Consumers. https://ods.od.nih.gov/factsheets/MVMS-Consumer/', 'Equipo IronCart', '2026-11-01'),
  ('pre-entrenos-que-contienen', 'productos', 'Pre-entrenos: qué contienen y cómo elegir', 'Los pre-entrenos son mezclas que se toman antes de entrenar. El ingrediente principal suele ser la cafeína, que puede mejorar el estado de alerta, la percepción del esfuerzo y el rendimiento. Otros ingredientes comunes son la beta-alanina (que puede causar un hormigueo inofensivo en la piel), la citrulina o arginina (relacionadas con el flujo sanguíneo) y, en algunos casos, creatina.
Para elegir, revisa la etiqueta: cuánta cafeína aporta cada porción, si la fórmula muestra las cantidades de cada ingrediente (etiqueta transparente) o si usa "mezclas patentadas" que no las detallan.
Si eres sensible a la cafeína, tomas otros estimulantes o tienes alguna condición cardiovascular, de presión arterial, ansiedad o estás embarazada, consulta con un profesional de salud antes de usar un pre-entreno. Evítalo cerca de la hora de dormir.', 'preentreno pre-workout energia estimulante', 'Guest, N. S. et al. (2021). International Society of Sports Nutrition position stand: caffeine and exercise performance. JISSN, 18, 1. https://doi.org/10.1186/s12970-020-00383-4', 'Equipo IronCart', '2026-11-01'),
  ('proteina-whey-vs-caseina', 'productos', 'Diferencia entre proteína whey (suero) y caseína', 'La proteína whey (suero de leche) y la caseína provienen de la leche, pero se digieren a velocidades distintas. El suero se digiere y absorbe rápido: eleva los aminoácidos en sangre en poco tiempo y por eso suele tomarse después de entrenar o en cualquier momento del día en que se busque una fuente práctica de proteína. También es rico en leucina, un aminoácido relacionado con el inicio de la síntesis de proteína muscular.
La caseína forma una especie de gel en el estómago y libera sus aminoácidos de forma más lenta y sostenida durante varias horas. Por eso se usa con frecuencia antes de dormir o cuando pasarán muchas horas sin comer.
Ambas son proteínas completas y de alta calidad. Según la postura de la International Society of Sports Nutrition, lo más importante es cubrir el total de proteína del día; el tipo y el momento son factores secundarios. En IronCart encontrarás whey (Gold Standard 100% Whey, ISO100, Nitro-Tech) y caseína (Gold Standard 100% Caseína).', 'suero lenta rapida absorcion digestion noche dormir', 'Jäger, R. et al. (2017). International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 14, 20. https://doi.org/10.1186/s12970-017-0177-8', 'Equipo IronCart', '2026-11-01'),
  ('proteinas-vegetales-mezclas-ganadores', 'productos', 'Proteínas vegetales, mezclas y ganadores de peso', 'Además del suero y la caseína existen proteínas de origen vegetal (guisante, arroz, soya), útiles para personas veganas o que evitan los lácteos. Suelen combinarse entre sí para mejorar su perfil de aminoácidos.
Las mezclas de liberación sostenida, como Syntha-6, combinan suero, caseína y otras fuentes para ofrecer una absorción intermedia y una textura más cremosa.
Los ganadores de peso (por ejemplo, Serious Mass) no son simplemente proteína: aportan muchas calorías, principalmente de carbohidratos. Están pensados para personas que tienen dificultad para cubrir su requerimiento energético solo con comida. Si el objetivo no es aumentar de peso, una proteína convencional suele ser más adecuada.
En todos los casos, el suplemento complementa la alimentación; no la reemplaza.', 'vegana vegano vegetal soya guisante gainer ganador masa calorias', 'Jäger, R. et al. (2017). International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 14, 20. https://doi.org/10.1186/s12970-017-0177-8', 'Equipo IronCart', '2026-11-01'),
  ('tipos-de-proteina-whey', 'productos', 'Tipos de whey: concentrado, aislado e hidrolizado', 'La proteína de suero se comercializa principalmente en tres formas. El concentrado de suero contiene aproximadamente entre 70 % y 80 % de proteína y conserva algo de grasa y lactosa; suele ser la opción más económica y con buen sabor.
El aislado de suero pasa por un filtrado adicional y alcanza alrededor de 90 % de proteína, con muy poca grasa y lactosa. Es una opción frecuente para quienes buscan menos carbohidratos o toleran mal pequeñas cantidades de lactosa.
El hidrolizado está parcialmente "predigerido": sus proteínas se dividen en péptidos más pequeños, lo que puede acelerar ligeramente la absorción. Suele ser la opción más cara.
Muchas marcas venden mezclas (blends) de concentrado y aislado para equilibrar precio, sabor y contenido de proteína. Para la mayoría de las personas, cualquiera de las tres formas sirve para completar la proteína diaria; la elección depende del presupuesto, la tolerancia digestiva y el gusto.', 'isolate hidrolizada aislada concentrada lactosa blend', 'Jäger, R. et al. (2017). International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 14, 20. https://doi.org/10.1186/s12970-017-0177-8', 'Equipo IronCart', '2026-11-01'),
  ('vitamina-d-omega-3', 'productos', 'Vitamina D y omega-3: información general', 'La vitamina D ayuda al cuerpo a absorber el calcio y participa en la salud ósea y muscular. Se obtiene con la exposición al sol, algunos alimentos y suplementos. Tomar cantidades muy altas durante mucho tiempo puede ser perjudicial, por eso conviene medir los niveles y decidir la cantidad con un profesional.
Los ácidos grasos omega-3 EPA y DHA se encuentran sobre todo en pescados grasos. Los suplementos de aceite de pescado son una forma de consumirlos si la dieta aporta poco pescado. Pueden interactuar con medicamentos anticoagulantes, por lo que quien los use debe consultar al médico.
IronCart ofrece Vitamina D3 y Omega-3 de NOW Foods. Spot no recomienda cantidades personalizadas de estos suplementos.', 'sol huesos pescado aceite epa dha', 'NIH Office of Dietary Supplements. Vitamin D – Fact Sheet for Consumers. https://ods.od.nih.gov/factsheets/VitaminD-Consumer/ | NIH Office of Dietary Supplements. Omega-3 Fatty Acids – Fact Sheet for Consumers. https://ods.od.nih.gov/factsheets/Omega3FattyAcids-Consumer/', 'Equipo IronCart', '2026-11-01')
on conflict (slug) do update set
  categoria = excluded.categoria, titulo = excluded.titulo, contenido = excluded.contenido, claves = excluded.claves,
  fuente = excluded.fuente, autor = excluded.autor, actualizado = excluded.actualizado;

-- Si 003_pgvector.sql está aplicado, los documentos modificados deben re-vectorizarse:
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'documento_conocimiento' and column_name = 'embedding_modelo') then
    execute 'update public.documento_conocimiento set embedding_modelo = null where embedding_modelo is not null and slug in (' ||
            (select string_agg(quote_literal(s), ',') from unnest(array['calentamiento','hidratacion','momento-de-la-proteina','principiantes','principios-hipertrofia','proteina-diaria-referencias','recuperacion-sueno','suplementos-no-sustituyen-dieta','devoluciones','envios','horarios-contacto','metodos-de-pago','politica-salud','privacidad','almacenamiento-caducidad','como-comprar','cuenta-registro','estado-pedidos','sobre-spot','tienda-demostracion','bcaa-vs-eaa','cafeina-precauciones','como-leer-etiqueta','creatina-mitos','creatina-que-es','creatina-seguridad-general','glutamina-beta-alanina','multivitaminicos','pre-entrenos-que-contienen','proteina-whey-vs-caseina','proteinas-vegetales-mezclas-ganadores','tipos-de-proteina-whey','vitamina-d-omega-3']) s) || ')';
  end if;
end $$;
