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
