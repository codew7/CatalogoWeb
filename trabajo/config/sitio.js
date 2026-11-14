// =====================================================================
//  CONFIGURACIÓN GENERAL DEL SITIO
//  Textos y datos que podés cambiar sin tocar el resto del código.
//  Los PUESTOS también se pueden editar desde el panel de administración:
//  si cargás puestos ahí, tienen prioridad sobre los de este archivo.
// =====================================================================

export const SITIO = {
  empresa: "HomePoint",

  presentacion: "Buscamos personas responsables para sumarse a nuestro equipo en Caseros y Munro.",

  // Puestos por defecto (se usan si todavía no cargaste puestos en el panel).
  // - titulo: lo que ve el postulante.
  // - descripcion: texto corto de la tarjeta.
  // - frase: cómo se nombra en la pregunta de experiencia
  //   ("¿Tenés experiencia trabajando en ...?").
  // - sucursales: dónde se busca. Si no se pone, se toman las dos.
  //   Ejemplo solo Munro: sucursales: { Caseros: false, Munro: true }
  puestos: [
    {
      id: "deposito",
      titulo: "Depósito, reposición, carga y descarga de mercadería",
      descripcion: "Recepción y control de mercadería, armado de pedidos, reposición y orden del depósito.",
      frase: "depósito, reposición, carga y descarga de mercadería",
      activo: true
    },
    {
      id: "ventas",
      titulo: "Ventas y atención al público",
      descripcion: "Atención de clientes en el salón, asesoramiento, ventas y cobro.",
      frase: "ventas y atención al público",
      activo: true,
      completo: true   // true = se muestra con el sello rojo "COMPLETA" y no se puede elegir
    }
  ],

  // Sucursales: la dirección se usa en las invitaciones a entrevista.
  sucursales: {
    Caseros: "Av. San Martín 2724, Caseros",
    Munro: "Vélez Sársfield 4127, Munro"
  },

  // Sugerencias para el campo "Localidad" (se puede escribir otra).
  localidades: [
    "Caseros", "Ciudad Jardín Lomas del Palomar", "El Palomar", "Martín Coronado",
    "Villa Bosch", "Santos Lugares", "Sáenz Peña", "Villa Raffo", "Ciudadela",
    "José Ingenieros", "Loma Hermosa", "Pablo Podestá", "Churruca", "Once de Septiembre",
    "Remedios de Escalada (3 de Febrero)", "Villa Lynch", "San Martín", "Villa Ballester",
    "Billinghurst", "José León Suárez", "San Andrés", "Hurlingham", "William C. Morris",
    "Ramos Mejía", "Haedo", "Morón", "Villa Devoto", "Villa del Parque", "Villa Pueyrredón",
    "Munro", "Florida", "Florida Oeste", "Carapachay", "Villa Martelli", "Olivos",
    "Vicente López", "La Lucila", "Villa Adelina", "Boulogne", "Martínez", "San Isidro",
    "Saavedra", "Núñez", "Villa Urquiza"
  ],

  // Preguntas frecuentes de la página de inicio.
  faq: [
    {
      pregunta: "¿Qué tareas incluye el puesto?",
      respuesta: "Depende del puesto. En depósito: recepción y control de mercadería, carga y descarga, armado de pedidos, reposición y mantener el orden. En la entrevista te contamos todo en detalle."
    },
    {
      pregunta: "¿Cuál es el horario?",
      respuesta: "Se buscan jornadas completas. El horario exacto depende del puesto y la sucursal, y te lo confirmamos en la entrevista. En el formulario podés indicar tu disponibilidad."
    },
    {
      pregunta: "¿Cómo me entero si quedé?",
      respuesta: "Revisamos cada postulación. Si tu perfil avanza, te escribimos por WhatsApp para coordinar una entrevista."
    }
  ]
};
