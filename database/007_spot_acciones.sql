-- =====================================================================
-- IRONCART · Gestión del catálogo por conversación con Spot (solo admin)
-- ---------------------------------------------------------------------
-- Flujo: Claude PROPONE operaciones -> api_admin_preparar_accion las valida y
-- guarda como "pendiente" con una vista previa -> el administrador pulsa
-- Confirmar -> api_admin_confirmar_accion las aplica en UNA transacción y
-- registra cada cambio en auditoria_cambio. Claude nunca escribe directamente.
-- El backend comprueba el rol admin antes de llamar a estas funciones.
-- =====================================================================

create table if not exists public.accion_admin (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references public.usuario(id) on delete cascade,
  conversacion_id uuid references public.conversacion(id) on delete set null,
  operaciones     jsonb not null,
  resumen         jsonb not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','aplicada','cancelada','fallida')),
  resultado       jsonb,
  creado_en       timestamptz not null default now(),
  expira_en       timestamptz not null default now() + interval '15 minutes',
  resuelta_en     timestamptz
);
create index if not exists accion_admin_usuario_idx on public.accion_admin (usuario_id, creado_en desc);

create table if not exists public.auditoria_cambio (
  id          bigserial primary key,
  usuario_id  uuid references public.usuario(id) on delete set null,
  accion_id   uuid references public.accion_admin(id) on delete set null,
  origen      text not null check (origen in ('spot','panel')),
  entidad     text not null,           -- producto | pedido
  entidad_ref text not null,           -- slug del producto o número de pedido
  operacion   text not null,           -- crear | actualizar | eliminar | desactivar | estado_pedido
  antes       jsonb,
  despues     jsonb,
  creado_en   timestamptz not null default now()
);
create index if not exists auditoria_fecha_idx on public.auditoria_cambio (creado_en desc);

alter table public.accion_admin enable row level security;
alter table public.auditoria_cambio enable row level security;
revoke all on public.accion_admin from anon, authenticated;
revoke all on public.auditoria_cambio from anon, authenticated;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public._slugify(t text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(public.f_unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public._producto_admin_json(p_id int)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('id', pr.id, 'slug', pr.slug, 'nombre', pr.nombre, 'marca', m.nombre, 'categoria', c.slug,
         'descripcion', pr.descripcion, 'presentacion', pr.presentacion, 'sabor', pr.sabor, 'porciones', pr.porciones,
         'precio', pr.precio, 'precio_anterior', pr.precio_anterior, 'stock', pr.stock, 'activo', pr.activo,
         'destacado', pr.destacado, 'imagen', pr.imagen, 'color', pr.color, 'beneficios', to_jsonb(pr.beneficios))
  from producto pr join marca m on m.id = pr.marca_id join categoria c on c.id = pr.categoria_id
  where pr.id = p_id
$$;

-- Valida un objeto de datos de producto. parcial=true para actualizaciones.
-- Devuelve el texto del error o null si es válido.
create or replace function public._admin_validar_datos(d jsonb, parcial boolean)
returns text language plpgsql stable
set search_path = public, extensions
as $$
declare k text;
begin
  for k in select jsonb_object_keys(d) loop
    if k not in ('nombre','marca','categoria','descripcion','presentacion','sabor','porciones','precio',
                 'precio_anterior','stock','activo','destacado','imagen','color','beneficios') then
      return format('campo no permitido: %s', k);
    end if;
  end loop;
  if not parcial then
    foreach k in array array['nombre','marca','categoria','descripcion','presentacion','precio','stock'] loop
      if not d ? k or d->>k is null then return format('falta el campo obligatorio "%s"', k); end if;
    end loop;
  end if;
  if d ? 'nombre' and (char_length(d->>'nombre') not between 2 and 120) then return 'el nombre debe tener entre 2 y 120 caracteres'; end if;
  if d ? 'marca' and (char_length(d->>'marca') not between 2 and 60) then return 'la marca debe tener entre 2 y 60 caracteres'; end if;
  if d ? 'descripcion' and (char_length(d->>'descripcion') not between 10 and 1000) then return 'la descripción debe tener entre 10 y 1000 caracteres'; end if;
  if d ? 'presentacion' and (char_length(d->>'presentacion') not between 1 and 80) then return 'la presentación debe tener entre 1 y 80 caracteres'; end if;
  if d ? 'sabor' and d->>'sabor' is not null and char_length(d->>'sabor') > 60 then return 'el sabor es demasiado largo'; end if;
  if d ? 'categoria' and not exists (select 1 from categoria where slug = d->>'categoria' or lower(nombre) = lower(d->>'categoria')) then
    return format('la categoría "%s" no existe (usa: %s)', d->>'categoria', (select string_agg(slug, ', ' order by orden) from categoria));
  end if;
  if d ? 'precio' and (jsonb_typeof(d->'precio') <> 'number' or (d->>'precio')::numeric <= 0 or (d->>'precio')::numeric > 10000) then
    return 'el precio debe ser un número entre 0.01 y 10000';
  end if;
  if d ? 'precio_anterior' and d->'precio_anterior' <> 'null'::jsonb and (jsonb_typeof(d->'precio_anterior') <> 'number' or (d->>'precio_anterior')::numeric <= 0) then
    return 'el precio anterior debe ser un número positivo o null';
  end if;
  if d ? 'stock' and (jsonb_typeof(d->'stock') <> 'number' or (d->>'stock')::numeric <> floor((d->>'stock')::numeric) or (d->>'stock')::int not between 0 and 100000) then
    return 'el stock debe ser un entero entre 0 y 100000';
  end if;
  if d ? 'porciones' and d->'porciones' <> 'null'::jsonb and (jsonb_typeof(d->'porciones') <> 'number' or (d->>'porciones')::int not between 1 and 10000) then
    return 'las porciones deben ser un entero entre 1 y 10000 o null';
  end if;
  if d ? 'activo' and jsonb_typeof(d->'activo') <> 'boolean' then return '"activo" debe ser true o false'; end if;
  if d ? 'destacado' and jsonb_typeof(d->'destacado') <> 'boolean' then return '"destacado" debe ser true o false'; end if;
  if d ? 'imagen' and d->>'imagen' not in ('tub','jar','bag','can','bottle','caps','shaker','belt','strap','glove')
     and d->>'imagen' !~ '^https://[^\s"<>]+$' then
    return 'imagen debe ser tub, jar, bag, can, bottle, caps, shaker, belt, strap, glove o una URL https';
  end if;
  if d ? 'color' and d->>'color' !~ '^#[0-9a-fA-F]{6}$' then return 'el color debe tener formato #RRGGBB'; end if;
  if d ? 'beneficios' and (jsonb_typeof(d->'beneficios') <> 'array' or jsonb_array_length(d->'beneficios') > 5) then
    return 'beneficios debe ser una lista de hasta 5 textos';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Preparar (validar + vista previa + guardar como pendiente)
-- ---------------------------------------------------------------------
create or replace function public.api_admin_preparar_accion(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_ops     jsonb := p->'operaciones';
  v_op      jsonb;
  v_i       int := 0;
  v_err     jsonb := '[]'::jsonb;
  v_res     jsonb := '[]'::jsonb;
  v_norm    jsonb := '[]'::jsonb;
  v_actual  jsonb;
  v_nuevo   jsonb;
  v_e       text;
  v_id      uuid;
  v_pid     int;
  v_cambios jsonb;
  k         text;
begin
  if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) = 0 then
    return jsonb_build_object('ok', false, 'errores', jsonb_build_array(jsonb_build_object('indice', 0, 'error', 'no hay operaciones')));
  end if;
  if jsonb_array_length(v_ops) > 20 then
    return jsonb_build_object('ok', false, 'errores', jsonb_build_array(jsonb_build_object('indice', 0, 'error', 'máximo 20 operaciones por solicitud')));
  end if;

  for v_op in select * from jsonb_array_elements(v_ops) loop
    v_i := v_i + 1;
    v_e := null;
    case v_op->>'tipo'
      when 'crear' then
        v_e := public._admin_validar_datos(coalesce(v_op->'datos', '{}'::jsonb), false);
        if v_e is null and exists (select 1 from producto where slug = public._slugify((v_op->'datos'->>'nombre') || '-' || (v_op->'datos'->>'presentacion'))) then
          v_e := 'ya existe un producto con ese nombre y presentación';
        end if;
        if v_e is null and (v_op->'datos' ? 'precio_anterior') and v_op->'datos'->'precio_anterior' <> 'null'::jsonb
           and (v_op->'datos'->>'precio_anterior')::numeric <= (v_op->'datos'->>'precio')::numeric then
          v_e := 'el precio anterior debe ser mayor que el precio';
        end if;
        if v_e is null then
          v_res := v_res || jsonb_build_object('tipo', 'crear', 'producto', (v_op->'datos'->>'nombre') || ' (' || (v_op->'datos'->>'presentacion') || ')',
                                               'antes', null, 'despues', v_op->'datos');
          v_norm := v_norm || jsonb_build_object('tipo', 'crear', 'datos', v_op->'datos');
        end if;

      when 'actualizar' then
        v_pid := (v_op->>'producto_id')::int;
        v_actual := public._producto_admin_json(v_pid);
        v_cambios := coalesce(v_op->'cambios', '{}'::jsonb);
        if v_actual is null then v_e := format('el producto %s no existe', v_op->>'producto_id');
        elsif v_cambios = '{}'::jsonb then v_e := 'no hay cambios';
        else v_e := public._admin_validar_datos(v_cambios, true);
        end if;
        if v_e is null then
          v_nuevo := v_actual || v_cambios;
          if v_nuevo->'precio_anterior' <> 'null'::jsonb and v_nuevo->>'precio_anterior' is not null
             and (v_nuevo->>'precio_anterior')::numeric <= (v_nuevo->>'precio')::numeric then
            v_e := format('el precio anterior (%s) debe ser mayor que el precio (%s)', v_nuevo->>'precio_anterior', v_nuevo->>'precio');
          end if;
        end if;
        if v_e is null then
          -- vista previa solo con los campos que cambian
          v_res := v_res || jsonb_build_object('tipo', 'actualizar', 'producto', (v_actual->>'nombre') || ' (' || (v_actual->>'presentacion') || ')',
            'antes', (select coalesce(jsonb_object_agg(key, v_actual->key), '{}'::jsonb) from jsonb_object_keys(v_cambios) key),
            'despues', v_cambios);
          v_norm := v_norm || jsonb_build_object('tipo', 'actualizar', 'producto_id', v_pid, 'cambios', v_cambios);
        end if;

      when 'eliminar' then
        v_pid := (v_op->>'producto_id')::int;
        v_actual := public._producto_admin_json(v_pid);
        if v_actual is null then v_e := format('el producto %s no existe', v_op->>'producto_id');
        else
          v_res := v_res || jsonb_build_object('tipo', 'eliminar', 'producto', (v_actual->>'nombre') || ' (' || (v_actual->>'presentacion') || ')',
            'antes', v_actual, 'despues', null,
            'nota', case when exists (select 1 from detalle_pedido where producto_id = v_pid)
                         then 'Tiene pedidos registrados: se desactivará (deja de verse en la tienda) en lugar de borrarse, para conservar el historial.'
                         else 'Se borrará definitivamente y se quitará de los carritos.' end);
          v_norm := v_norm || jsonb_build_object('tipo', 'eliminar', 'producto_id', v_pid);
        end if;

      when 'estado_pedido' then
        if not exists (select 1 from pedido where numero = (v_op->>'numero')::int) then
          v_e := format('el pedido %s no existe', v_op->>'numero');
        elsif v_op->>'estado' not in ('confirmado','preparando','enviado','entregado','cancelado') then
          v_e := 'estado inválido (confirmado, preparando, enviado, entregado o cancelado)';
        else
          v_res := v_res || jsonb_build_object('tipo', 'estado_pedido', 'producto', 'Pedido #' || (v_op->>'numero'),
            'antes', jsonb_build_object('estado', (select estado from pedido where numero = (v_op->>'numero')::int)),
            'despues', jsonb_build_object('estado', v_op->>'estado'));
          v_norm := v_norm || jsonb_build_object('tipo', 'estado_pedido', 'numero', (v_op->>'numero')::int, 'estado', v_op->>'estado');
        end if;

      else
        v_e := format('tipo de operación desconocido: %s', coalesce(v_op->>'tipo', 'null'));
    end case;
    if v_e is not null then v_err := v_err || jsonb_build_object('indice', v_i, 'error', v_e); end if;
  end loop;

  if jsonb_array_length(v_err) > 0 then return jsonb_build_object('ok', false, 'errores', v_err); end if;

  -- Solo una acción pendiente por usuario: las anteriores se cancelan.
  update accion_admin set estado = 'cancelada', resuelta_en = now()
  where usuario_id = (p->>'usuario_id')::uuid and estado = 'pendiente';

  insert into accion_admin (usuario_id, conversacion_id, operaciones, resumen)
  values ((p->>'usuario_id')::uuid, (p->>'conversacion_id')::uuid, v_norm, v_res)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'resumen', v_res, 'expira_en_min', 15);
end $$;

-- ---------------------------------------------------------------------
-- Confirmar (aplica todo o nada) / cancelar
-- ---------------------------------------------------------------------
create or replace function public.api_admin_confirmar_accion(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  a        accion_admin;
  v_op     jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_antes  jsonb;
  v_desp   jsonb;
  v_pid    int;
  v_marca  int;
  v_cat    int;
  v_slug   text;
  d        jsonb;
  v_user   uuid := (p->>'usuario_id')::uuid;
begin
  select * into a from accion_admin where id = (p->>'id')::uuid and usuario_id = v_user for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrada'); end if;
  if a.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'error', 'ya_resuelta', 'estado', a.estado); end if;
  if a.expira_en < now() then
    update accion_admin set estado = 'cancelada', resuelta_en = now(), resultado = '{"motivo":"expirada"}' where id = a.id;
    return jsonb_build_object('ok', false, 'error', 'expirada');
  end if;

  begin
    for v_op in select * from jsonb_array_elements(a.operaciones) loop
      case v_op->>'tipo'
        when 'crear' then
          d := v_op->'datos';
          select id into v_marca from marca where lower(nombre) = lower(d->>'marca');
          if v_marca is null then
            insert into marca (slug, nombre) values (public._slugify(d->>'marca'), d->>'marca')
            on conflict (slug) do update set nombre = marca.nombre returning id into v_marca;
          end if;
          select id into v_cat from categoria where slug = d->>'categoria' or lower(nombre) = lower(d->>'categoria') limit 1;
          v_slug := public._slugify((d->>'nombre') || '-' || (d->>'presentacion'));
          insert into producto (slug, nombre, marca_id, categoria_id, descripcion, presentacion, sabor, porciones, precio,
                                precio_anterior, stock, imagen, color, destacado, activo, beneficios)
          values (v_slug, d->>'nombre', v_marca, v_cat, d->>'descripcion', d->>'presentacion', nullif(d->>'sabor', ''),
                  nullif(d->>'porciones', '')::int, (d->>'precio')::numeric, nullif(d->>'precio_anterior', '')::numeric,
                  (d->>'stock')::int,
                  coalesce(d->>'imagen', case (select slug from categoria where id = v_cat)
                    when 'creatinas' then 'jar' when 'pre-entrenos' then 'can' when 'vitaminas' then 'bottle'
                    when 'aminoacidos' then 'can' when 'accesorios' then 'shaker' else 'tub' end),
                  coalesce(d->>'color', '#FF5B14'), coalesce((d->>'destacado')::boolean, false), coalesce((d->>'activo')::boolean, true),
                  coalesce(array(select jsonb_array_elements_text(d->'beneficios')), '{}'))
          returning id into v_pid;
          v_desp := public._producto_admin_json(v_pid);
          insert into auditoria_cambio (usuario_id, accion_id, origen, entidad, entidad_ref, operacion, antes, despues)
          values (v_user, a.id, 'spot', 'producto', v_slug, 'crear', null, v_desp);
          v_res := v_res || jsonb_build_object('tipo', 'crear', 'producto', v_desp);

        when 'actualizar' then
          v_pid := (v_op->>'producto_id')::int;
          d := v_op->'cambios';
          v_antes := public._producto_admin_json(v_pid);
          if d ? 'marca' then
            select id into v_marca from marca where lower(nombre) = lower(d->>'marca');
            if v_marca is null then
              insert into marca (slug, nombre) values (public._slugify(d->>'marca'), d->>'marca')
              on conflict (slug) do update set nombre = marca.nombre returning id into v_marca;
            end if;
          end if;
          if d ? 'categoria' then
            select id into v_cat from categoria where slug = d->>'categoria' or lower(nombre) = lower(d->>'categoria') limit 1;
          end if;
          update producto set
            nombre          = coalesce(d->>'nombre', nombre),
            descripcion     = coalesce(d->>'descripcion', descripcion),
            presentacion    = coalesce(d->>'presentacion', presentacion),
            sabor           = case when d ? 'sabor' then nullif(d->>'sabor', '') else sabor end,
            porciones       = case when d ? 'porciones' then nullif(d->>'porciones', '')::int else porciones end,
            precio          = coalesce((d->>'precio')::numeric, precio),
            precio_anterior = case when d ? 'precio_anterior' then nullif(d->>'precio_anterior', '')::numeric else precio_anterior end,
            stock           = coalesce((d->>'stock')::int, stock),
            activo          = coalesce((d->>'activo')::boolean, activo),
            destacado       = coalesce((d->>'destacado')::boolean, destacado),
            imagen          = coalesce(d->>'imagen', imagen),
            color           = coalesce(d->>'color', color),
            beneficios      = case when d ? 'beneficios' then array(select jsonb_array_elements_text(d->'beneficios')) else beneficios end,
            marca_id        = case when d ? 'marca' then v_marca else marca_id end,
            categoria_id    = case when d ? 'categoria' then v_cat else categoria_id end
          where id = v_pid;
          v_desp := public._producto_admin_json(v_pid);
          insert into auditoria_cambio (usuario_id, accion_id, origen, entidad, entidad_ref, operacion, antes, despues)
          values (v_user, a.id, 'spot', 'producto', v_antes->>'slug', 'actualizar',
                  (select jsonb_object_agg(key, v_antes->key) from jsonb_object_keys(d) key),
                  (select jsonb_object_agg(key, v_desp->key) from jsonb_object_keys(d) key));
          v_res := v_res || jsonb_build_object('tipo', 'actualizar', 'producto', v_desp);

        when 'eliminar' then
          v_pid := (v_op->>'producto_id')::int;
          v_antes := public._producto_admin_json(v_pid);
          delete from detalle_carrito where producto_id = v_pid;
          if exists (select 1 from detalle_pedido where producto_id = v_pid) then
            update producto set activo = false, destacado = false where id = v_pid;
            insert into auditoria_cambio (usuario_id, accion_id, origen, entidad, entidad_ref, operacion, antes, despues)
            values (v_user, a.id, 'spot', 'producto', v_antes->>'slug', 'desactivar', v_antes, public._producto_admin_json(v_pid));
            v_res := v_res || jsonb_build_object('tipo', 'desactivar', 'producto', v_antes->>'nombre', 'motivo', 'tiene pedidos');
          else
            delete from producto where id = v_pid;
            insert into auditoria_cambio (usuario_id, accion_id, origen, entidad, entidad_ref, operacion, antes, despues)
            values (v_user, a.id, 'spot', 'producto', v_antes->>'slug', 'eliminar', v_antes, null);
            v_res := v_res || jsonb_build_object('tipo', 'eliminar', 'producto', v_antes->>'nombre');
          end if;

        when 'estado_pedido' then
          v_antes := jsonb_build_object('estado', (select estado from pedido where numero = (v_op->>'numero')::int));
          update pedido set estado = v_op->>'estado', actualizado_en = now() where numero = (v_op->>'numero')::int;
          insert into auditoria_cambio (usuario_id, accion_id, origen, entidad, entidad_ref, operacion, antes, despues)
          values (v_user, a.id, 'spot', 'pedido', v_op->>'numero', 'estado_pedido', v_antes, jsonb_build_object('estado', v_op->>'estado'));
          v_res := v_res || jsonb_build_object('tipo', 'estado_pedido', 'numero', (v_op->>'numero')::int, 'estado', v_op->>'estado');
      end case;
    end loop;
  exception when others then
    -- Todo o nada: el bloque se revierte y la acción queda marcada como fallida.
    update accion_admin set estado = 'fallida', resuelta_en = now(), resultado = jsonb_build_object('error', sqlerrm) where id = a.id;
    return jsonb_build_object('ok', false, 'error', 'fallo_al_aplicar', 'detalle', sqlerrm);
  end;

  update accion_admin set estado = 'aplicada', resuelta_en = now(), resultado = v_res where id = a.id;
  return jsonb_build_object('ok', true, 'resultado', v_res);
end $$;

create or replace function public.api_admin_cancelar_accion(p jsonb)
returns jsonb language sql security definer
set search_path = public, extensions
as $$
  with u as (
    update accion_admin set estado = 'cancelada', resuelta_en = now()
    where id = (p->>'id')::uuid and usuario_id = (p->>'usuario_id')::uuid and estado = 'pendiente' returning 1)
  select jsonb_build_object('ok', (select count(*) from u) = 1)
$$;

-- Búsqueda para el administrador (incluye inactivos y todos los campos editables).
create or replace function public.api_admin_buscar_productos(p jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(public._producto_admin_json(x.id) || jsonb_build_object('vendidos', x.vendidos) order by x.s desc, x.id), '[]'::jsonb)
  from (
    select pr.id,
           (select coalesce(sum(cantidad), 0) from detalle_pedido d where d.producto_id = pr.id) as vendidos,
           case when nullif(trim(p->>'q'), '') is null then 0
                else similarity(public.f_unaccent(lower(pr.nombre || ' ' || m.nombre || ' ' || pr.presentacion)), public.f_unaccent(lower(p->>'q')))
                   + word_similarity(public.f_unaccent(lower(p->>'q')), public.f_unaccent(lower(pr.nombre || ' ' || m.nombre || ' ' || pr.presentacion || ' ' || c.nombre))) end as s
    from producto pr join marca m on m.id = pr.marca_id join categoria c on c.id = pr.categoria_id
    where (nullif(p->>'categoria', '') is null or c.slug = p->>'categoria')
      and (p->>'stock_max' is null or pr.stock <= (p->>'stock_max')::int)
      and (nullif(trim(p->>'q'), '') is null
           or public.f_unaccent(lower(p->>'q')) <% public.f_unaccent(lower(pr.nombre || ' ' || m.nombre || ' ' || pr.presentacion || ' ' || c.nombre))
           or public.f_unaccent(lower(pr.nombre || ' ' || m.nombre || ' ' || c.nombre)) like '%' || public.f_unaccent(lower(trim(p->>'q'))) || '%')
    order by s desc, pr.id
    limit least(coalesce((p->>'limite')::int, 15), 40)
  ) x
$$;

create or replace function public.api_admin_auditoria(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'creado_en', a.creado_en, 'origen', a.origen, 'entidad', a.entidad, 'entidad_ref', a.entidad_ref,
           'operacion', a.operacion, 'antes', a.antes, 'despues', a.despues, 'usuario', u.email) order by a.id desc), '[]'::jsonb)
  from (select * from auditoria_cambio order by id desc limit 200) a
  left join usuario u on u.id = a.usuario_id
$$;

-- Los cambios hechos desde el panel también quedan auditados.
create or replace function public.api_admin_registrar_auditoria(p jsonb)
returns jsonb language sql security definer
set search_path = public, extensions
as $$
  insert into auditoria_cambio (usuario_id, origen, entidad, entidad_ref, operacion, antes, despues)
  values ((p->>'usuario_id')::uuid, 'panel', p->>'entidad', p->>'entidad_ref', p->>'operacion', p->'antes', p->'despues');
  select jsonb_build_object('ok', true);
$$;

do $$
declare f text;
begin
  foreach f in array array['api_admin_preparar_accion(jsonb)','api_admin_confirmar_accion(jsonb)','api_admin_cancelar_accion(jsonb)',
                           'api_admin_buscar_productos(jsonb)','api_admin_auditoria(jsonb)','api_admin_registrar_auditoria(jsonb)',
                           '_producto_admin_json(integer)','_admin_validar_datos(jsonb,boolean)','_slugify(text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría también para los cambios hechos desde el panel (redefine 006)
-- ---------------------------------------------------------------------
create or replace function public.api_admin_producto_actualizar(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id int := (p->>'id')::int;
  v_precio numeric(10,2);
  v_ant numeric(10,2);
  v_antes jsonb := public._producto_admin_json((p->>'id')::int);
  v_desp jsonb;
begin
  if v_antes is null then return jsonb_build_object('ok', false, 'error', 'producto_no_encontrado'); end if;
  select coalesce((p->>'precio')::numeric, precio),
         case when p ? 'precio_anterior' then (p->>'precio_anterior')::numeric else precio_anterior end
    into v_precio, v_ant
  from producto where id = v_id;
  if v_ant is not null and v_ant <= v_precio then
    return jsonb_build_object('ok', false, 'error', 'precio_anterior_invalido');
  end if;
  update producto set
    precio = v_precio, precio_anterior = v_ant,
    stock = coalesce((p->>'stock')::int, stock),
    activo = coalesce((p->>'activo')::boolean, activo),
    destacado = coalesce((p->>'destacado')::boolean, destacado)
  where id = v_id;
  v_desp := public._producto_admin_json(v_id);
  insert into auditoria_cambio (usuario_id, origen, entidad, entidad_ref, operacion, antes, despues)
  select (p->>'usuario_id')::uuid, 'panel', 'producto', v_antes->>'slug', 'actualizar',
         jsonb_object_agg(k, v_antes->k), jsonb_object_agg(k, v_desp->k)
  from unnest(array['precio','precio_anterior','stock','activo','destacado']) k
  where p ? k and v_antes->k is distinct from v_desp->k
  having count(*) > 0;
  return jsonb_build_object('ok', true, 'producto',
    (select e from jsonb_array_elements(public.api_admin_productos('{}')) e where (e->>'id')::int = v_id));
end $$;

create or replace function public.api_admin_pedido_estado(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_user uuid; v_antes text;
begin
  select estado into v_antes from pedido where numero = (p->>'numero')::int;
  update pedido set estado = p->>'estado', actualizado_en = now()
  where numero = (p->>'numero')::int
  returning usuario_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'pedido_no_encontrado'); end if;
  if v_antes is distinct from p->>'estado' then
    insert into auditoria_cambio (usuario_id, origen, entidad, entidad_ref, operacion, antes, despues)
    values ((p->>'admin_id')::uuid, 'panel', 'pedido', p->>'numero', 'estado_pedido',
            jsonb_build_object('estado', v_antes), jsonb_build_object('estado', p->>'estado'));
  end if;
  return jsonb_build_object('ok', true, 'pedido',
    public.api_pedido_detalle(jsonb_build_object('usuario_id', v_user, 'numero', (p->>'numero')::int)));
end $$;

revoke all on function public.api_admin_producto_actualizar(jsonb) from public, anon, authenticated;
grant execute on function public.api_admin_producto_actualizar(jsonb) to service_role;
revoke all on function public.api_admin_pedido_estado(jsonb) from public, anon, authenticated;
grant execute on function public.api_admin_pedido_estado(jsonb) to service_role;
