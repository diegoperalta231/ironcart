-- =====================================================================
-- IRONCART · Panel de administración (funciones RPC solo para el backend)
-- El backend verifica que la sesión pertenezca a un usuario con rol 'admin'
-- antes de llamar a cualquiera de estas funciones.
--
-- Crear o promover una cuenta administradora (NO publicar la contraseña):
--   insert into public.usuario (nombre, email, password_hash, rol)
--   values ('Administrador', 'admin@tu-dominio', extensions.crypt('CONTRASEÑA', extensions.gen_salt('bf', 10)), 'admin');
--   -- o bien: update public.usuario set rol = 'admin' where email = 'correo@existente';
-- =====================================================================

create or replace function public.api_admin_resumen(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'tienda', jsonb_build_object(
      'productos_activos', (select count(*) from producto where activo),
      'productos_inactivos', (select count(*) from producto where not activo),
      'agotados', (select count(*) from producto where activo and stock = 0),
      'pocas_unidades', (select count(*) from producto where activo and stock between 1 and 5),
      'usuarios', (select count(*) from usuario),
      'pedidos', (select count(*) from pedido),
      'ventas_total', (select coalesce(sum(total), 0) from pedido where estado <> 'cancelado'),
      'pedidos_por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb)
                             from (select estado, count(*) n from pedido group by estado) x),
      'mensajes_contacto', (select count(*) from contacto_mensaje)),
    'spot', jsonb_build_object(
      'conversaciones', (select count(*) from conversacion),
      'mensajes_usuario', (select count(*) from mensaje where rol = 'user'),
      'por_ruta', (select coalesce(jsonb_agg(jsonb_build_object('ruta', ruta, 'n', n) order by n desc), '[]'::jsonb)
                   from (select ruta, count(*) n from mensaje where rol = 'user' and ruta is not null group by ruta) x),
      'medicas_interceptadas', (select count(*) from mensaje where rol = 'user' and ruta = 'seguridad_medica'),
      'inyecciones_detectadas', (select count(*) from mensaje
                                 where rol = 'user' and jsonb_array_length(coalesce(metadatos->'seguridad'->'inyeccion', '[]'::jsonb)) > 0),
      'respuestas_claude', (select count(*) from mensaje where rol = 'assistant' and metadatos->>'generador' = 'claude'),
      'respuestas_contingencia', (select count(*) from mensaje where rol = 'assistant' and metadatos->>'generador' = 'plantilla_contingencia'),
      'latencia_media_ms', (select round(avg((metadatos->>'latencia_ms')::numeric)) from mensaje
                            where rol = 'assistant' and metadatos ? 'latencia_ms'),
      'latencia_p95_ms', (select round(percentile_cont(0.95) within group (order by (metadatos->>'latencia_ms')::numeric))
                          from mensaje where rol = 'assistant' and metadatos ? 'latencia_ms'),
      'confianza_media', (select round(avg(confianza), 3) from mensaje where rol = 'user' and confianza is not null),
      'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d::date, 'n', coalesce(n, 0)) order by d), '[]'::jsonb)
                  from generate_series(current_date - 13, current_date, interval '1 day') d
                  left join (select creado_en::date dia, count(*) n from mensaje where rol = 'user' group by 1) m on m.dia = d::date))
  )
$$;

create or replace function public.api_admin_productos(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'slug', pr.slug, 'nombre', pr.nombre, 'marca', m.nombre, 'categoria', c.nombre,
           'categoria_slug', c.slug, 'presentacion', pr.presentacion, 'precio', pr.precio,
           'precio_anterior', pr.precio_anterior, 'stock', pr.stock, 'activo', pr.activo,
           'destacado', pr.destacado, 'imagen', pr.imagen, 'color', pr.color,
           'vendidos', (select coalesce(sum(d.cantidad), 0) from detalle_pedido d where d.producto_id = pr.id))
         order by c.orden, pr.nombre, pr.presentacion), '[]'::jsonb)
  from producto pr join marca m on m.id = pr.marca_id join categoria c on c.id = pr.categoria_id
$$;

create or replace function public.api_admin_producto_actualizar(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id int := (p->>'id')::int;
  v_precio numeric(10,2);
  v_ant numeric(10,2);
begin
  if not exists (select 1 from producto where id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'producto_no_encontrado');
  end if;
  select coalesce((p->>'precio')::numeric, precio),
         case when p ? 'precio_anterior' then (p->>'precio_anterior')::numeric else precio_anterior end
    into v_precio, v_ant
  from producto where id = v_id;
  if v_ant is not null and v_ant <= v_precio then
    return jsonb_build_object('ok', false, 'error', 'precio_anterior_invalido');
  end if;
  update producto set
    precio = v_precio,
    precio_anterior = v_ant,
    stock = coalesce((p->>'stock')::int, stock),
    activo = coalesce((p->>'activo')::boolean, activo),
    destacado = coalesce((p->>'destacado')::boolean, destacado)
  where id = v_id;
  return jsonb_build_object('ok', true, 'producto',
    (select e from jsonb_array_elements(public.api_admin_productos('{}')) e where (e->>'id')::int = v_id));
end $$;

create or replace function public.api_admin_pedidos(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(public.api_pedido_detalle(jsonb_build_object('usuario_id', pe.usuario_id, 'numero', pe.numero))
                            || jsonb_build_object('cliente', jsonb_build_object('nombre', u.nombre, 'email', u.email))
                            order by pe.creado_en desc), '[]'::jsonb)
  from pedido pe join usuario u on u.id = pe.usuario_id
  where nullif(p->>'estado', '') is null or pe.estado = p->>'estado'
$$;

create or replace function public.api_admin_pedido_estado(p jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_user uuid;
begin
  update pedido set estado = p->>'estado', actualizado_en = now()
  where numero = (p->>'numero')::int
  returning usuario_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'pedido_no_encontrado'); end if;
  return jsonb_build_object('ok', true, 'pedido',
    public.api_pedido_detalle(jsonb_build_object('usuario_id', v_user, 'numero', (p->>'numero')::int)));
end $$;

create or replace function public.api_admin_contactos(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.creado_en desc), '[]'::jsonb)
  from (select * from contacto_mensaje order by creado_en desc limit 200) c
$$;

-- Turnos de Spot: mensaje del usuario + respuesta, con ruta, intención y metadatos.
create or replace function public.api_admin_conversaciones(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(t order by (t->>'creado_en') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', u.id, 'conversacion_id', u.conversacion_id, 'creado_en', u.creado_en,
      'mensaje', u.contenido, 'intent', u.intent_detectado, 'ruta', u.ruta, 'confianza', u.confianza,
      'fallback', u.fallback, 'seguridad', u.metadatos->'seguridad',
      'respuesta', a.contenido, 'generador', a.metadatos->>'generador', 'latencia_ms', a.metadatos->'latencia_ms',
      'fuentes', a.metadatos->'fuentes', 'con_sesion', cv.usuario_id is not null) as t
    from mensaje u
    join conversacion cv on cv.id = u.conversacion_id
    left join lateral (select * from mensaje a where a.conversacion_id = u.conversacion_id and a.id > u.id
                       and a.rol = 'assistant' order by a.id limit 1) a on true
    where u.rol = 'user' and (nullif(p->>'ruta', '') is null or u.ruta = p->>'ruta')
    order by u.id desc
    limit least(coalesce((p->>'limite')::int, 100), 300)
  ) x
$$;

do $$
declare f text;
begin
  foreach f in array array['api_admin_resumen(jsonb)','api_admin_productos(jsonb)','api_admin_producto_actualizar(jsonb)',
                           'api_admin_pedidos(jsonb)','api_admin_pedido_estado(jsonb)','api_admin_contactos(jsonb)',
                           'api_admin_conversaciones(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
