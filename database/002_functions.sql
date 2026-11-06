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
