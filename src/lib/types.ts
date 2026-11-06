export interface Producto {
  id: number;
  slug: string;
  nombre: string;
  marca: string;
  marca_slug?: string;
  categoria: string;
  categoria_slug: string;
  descripcion?: string;
  presentacion: string;
  sabor: string | null;
  porciones: number | null;
  precio: number;
  precio_anterior: number | null;
  stock: number;
  estado_disponibilidad: 'disponible' | 'pocas_unidades' | 'agotado' | string;
  imagen: string;
  color: string;
  destacado?: boolean;
  beneficios?: string[];
  relacionados?: Producto[];
}

export interface Categoria { slug: string; nombre: string; descripcion: string; productos: number }
export interface Marca { slug: string; nombre: string; productos: number }

export interface ItemCarrito { producto_id: number; cantidad: number; subtotal: number; stock_suficiente: boolean; producto: Producto }
export interface Carrito {
  id: string | null; items: ItemCarrito[]; cantidad_total: number;
  subtotal: number; envio: number; total: number; envio_gratis_desde: number;
}

export interface Usuario { id: string; nombre: string; email: string; rol: string }

export interface Pedido {
  numero: number; estado: string; subtotal: number; envio: number; total: number; metodo_pago: string;
  creado_en: string; actualizado_en: string;
  envio_a: { nombre: string; direccion: string; ciudad: string };
  items: Array<{ producto_id: number; nombre: string; cantidad: number; precio_unitario: number; subtotal: number; slug: string; imagen: string; color: string }>;
}

export interface SpotRespuesta {
  conversacion_id: string;
  respuesta: string;
  productos: Producto[];
  fuentes: Array<{ titulo: string; slug: string; categoria: string }>;
  meta: { intent: string; confianza: number; ruta: string; fallback: boolean; generador: string; motivo_contingencia?: string; rag_modo?: string };
}
