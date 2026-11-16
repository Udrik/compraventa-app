"use strict";
// ===================================================================
// Utilidades
// ===================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n, dec = 0) => (n === null || n === undefined || n === "" || isNaN(n)) ? "—" :
  Number(n).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
const fecha = (iso) => iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "—";
const CATS = { movil: "📱 Móviles", consola: "🎮 Consolas", videojuego: "💿 Videojuegos", zapatilla: "👟 Zapatillas", patinete: "🛴 Patinetes", otro: "⌚ Otros" };
const COND = { new: "Nuevo", as_good_as_new: "Como nuevo", good: "Buen estado", fair: "Aceptable", has_given_it_all: "Lo ha dado todo", in_box: "En su caja", un_opened: "Sin abrir" };
const ESTADO_TXT = { pantalla_rota: "Pantalla rota", trasera_rota: "Trasera rota", nuevo: "Nuevo", usado: "Usado" };

const MOVIL = !!window.MOTOR;  // app del iPhone: el motor funciona dentro del propio teléfono
async function api(ruta, cuerpo) {
  if (MOVIL) return window.MOTOR.api(ruta, cuerpo);
  const opts = cuerpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) };
  const r = await fetch(ruta, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
let toastT;
function toast(msg, ms = 3000) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("oculto");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("oculto"), ms);
}
function error(e) { toast("⚠️ " + (e.message || e), 6000); }
function abrirModal(html) { $("#modal-cuerpo").innerHTML = html; $("#modal").classList.remove("oculto"); document.body.style.overflow = "hidden"; }
function cerrarModal() { $("#modal").classList.add("oculto"); document.body.style.overflow = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.hasAttribute("data-cerrar")) cerrarModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarModal(); });

// ===================================================================
// Pestañas
// ===================================================================
function irA(tab) {
  $$("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
  $$(".tab").forEach((s) => s.classList.toggle("activa", s.id === "tab-" + tab));
  window.scrollTo(0, 0);
  ({ inicio: cargarInicio, ofertas: cargarOfertas, vigilante: cargarVigilante, precios: cargarPrecios, calc: cargarCalc, ops: cargarOps, ajustes: cargarAjustes }[tab] || (() => {}))();
}
$$("#pestanas button").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tab)));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) irA(b.dataset.ir); });
if (MOVIL) {
  $("#tab-btn-vigilante").classList.add("oculto");  // el vigilante funciona en el programa de Windows
  $("#btn-salir").classList.add("oculto");
  $("#btn-reanalizar").classList.add("oculto");
  const exp = $('a[href="/api/exportar_operaciones"]');
  exp.addEventListener("click", (e) => { e.preventDefault(); window.MOTOR.exportarOperaciones().catch(() => {}); });
  exp.textContent = "⬇ Exportar (CSV)";
  $("#btn-carpeta").textContent = "💾 Guardar copia de seguridad";
  $("#btn-carpeta").insertAdjacentHTML("afterend", ` <label class="boton sec">📂 Restaurar copia<input type="file" id="f-copia" accept=".json,application/json" hidden></label>
    <p class="sub mt">Tus datos se guardan solo en este iPhone. Guarda una copia de vez en cuando (por ejemplo en Archivos o iCloud Drive): si borras la app de la pantalla de inicio o los datos de Safari, se pierden.</p>`);
  $("#f-copia").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm("¿Restaurar esta copia? Sustituye los datos actuales de la app.")) return;
    try { await window.MOTOR.importarCopia(f); toast("Copia restaurada ✅"); cargarAjustes(); cargarDatos(); } catch (err) { error(err); }
    e.target.value = "";
  });
}
$("#btn-salir").addEventListener("click", async () => {
  if (!confirm("¿Cerrar CompraVenta? Si hay una búsqueda en marcha se detendrá.")) return;
  await api("/api/salir", {}).catch(() => {});
  document.body.innerHTML = "<main><div class='vacio'><h2>CompraVenta se ha cerrado</h2><p>Ya puedes cerrar esta ventana.</p></div></main>";
});

// ===================================================================
// Estado / Inicio
// ===================================================================
let ESTADO = null, OPS = [], DESC = [], REF = [];
let sondeo = null;

async function refrescarEstado() {
  try { ESTADO = await api("/api/estado"); } catch { return; }
  const t = ESTADO.tarea;
  $("#txt-ubicacion").textContent = `📍 ${ESTADO.ubicacion} · radio ${ESTADO.radio} km`;
  $("#txt-estimado").textContent = `Descarga los anuncios de todos los modelos activos, calcula precios de referencia y comprueba cada candidato. Tarda unos ${ESTADO.minutos_estimados} minutos; ${MOVIL ? "deja la app abierta y la pantalla encendida mientras busca." : "puedes seguir usando el programa mientras tanto."}`;
  $("#txt-version").textContent = `CompraVenta ${ESTADO.version} · datos en ${ESTADO.carpeta}`;
  $("#progreso").classList.toggle("oculto", !t.activa);
  $("#btn-buscar").disabled = t.activa; $("#btn-reanalizar").disabled = t.activa;
  $("#btn-cancelar").classList.toggle("oculto", !t.activa);
  $("#btn-buscar").textContent = t.activa ? "⏳ Buscando…" : "🔍 Buscar ofertas ahora";
  if (t.activa) {
    $("#prog-relleno").style.width = (t.fraccion * 100).toFixed(1) + "%";
    $("#prog-fase").textContent = `${t.fase} · ${Math.round(t.fraccion * 100)} %`;
    $("#prog-detalle").textContent = t.texto || "";
    $("#prog-log").textContent = t.log.join("\n");
  }
  const av = $("#aviso-tarea");
  if (!t.activa && t.error) { av.className = "aviso mal"; av.textContent = t.error; }
  else if (!t.activa && t.fase === "Terminado" && t.fin && t.aviso) { av.className = "aviso"; av.textContent = `⚠️ Búsqueda terminada (${fecha(t.fin)}), pero con fallos: ${t.aviso}`; }
  else if (!t.activa && t.fase === "Terminado" && t.fin) { av.className = "aviso ok"; av.textContent = `✅ Búsqueda terminada (${fecha(t.fin)}).`; }
  else av.className = "aviso oculto";
  // al terminar una tarea, recargar datos
  if (refrescarEstado.antes && !t.activa) { cargarDatos().then(() => { pintarInicio(); if ($("#tab-ofertas").classList.contains("activa")) pintarOfertas(); }); }
  refrescarEstado.antes = t.activa;
  clearTimeout(sondeo); sondeo = setTimeout(refrescarEstado, t.activa ? 1500 : 15000);
}

async function cargarDatos() {
  try { const d = await api("/api/oportunidades"); OPS = d.oportunidades; DESC = d.descartados; } catch (e) { error(e); }
  const nuevas = OPS.filter((o) => o.nuevo).length, pend = OPS.filter((o) => !o.revisado).length;
  const b = $("#badge-ofertas"); b.textContent = nuevas || pend; b.classList.toggle("oculto", !(nuevas || pend));
  b.title = `${nuevas} nuevas, ${pend} por revisar`;
}

async function cargarInicio() { await refrescarEstado(); await cargarDatos(); pintarInicio(); cargarBusqueda(); }

let QB = null, qbEditando = false;
async function cargarBusqueda() {
  try { QB = await api("/api/busqueda"); } catch (e) { return error(e); }
  if (!qbEditando) {
    $$("input[name=qb-modo]").forEach((r) => { r.checked = r.value === QB.modo; });
    $("#qb-texto").value = QB.texto || "";
    const sel = $("#qb-catalogo");
    if (sel.options.length <= 1) sel.insertAdjacentHTML("beforeend", QB.catalogo.map((g) => `<option>${esc(g)}</option>`).join(""));
  }
  pintarBusqueda();
}
function modoElegido() { return ($("input[name=qb-modo]:checked") || {}).value || QB?.modo || "top5"; }
function pintarBusqueda() {
  const modo = modoElegido();
  $("#qb-top5").classList.toggle("oculto", modo !== "top5");
  $("#qb-personal").classList.toggle("oculto", modo !== "personal");
  $$(".opcion").forEach((l) => l.classList.toggle("elegida", l.querySelector("input").checked));
  const t = QB.top5;
  $("#qb-top5").innerHTML = !t.length ? `<p class="aviso">Todavía no hay top 5 calculado.</p>` : `<ol class="top5">${t.map((a) => `
      <li><b>${esc(a.articulo)}</b>${a.motivos?.length ? ` <span class="sub">— ${esc(a.motivos.join(", "))}</span>` : ""}
        <div class="chips">${a.modelos.map((m) => `<span class="chip" title="${m.rotacion != null ? Math.round(m.rotacion * 100) + " % vendido o reservado en ~4 días" : ""}">${esc(m.nombre)}${m.compra_max > 0 ? ` <small>≤ ${m.compra_max} €</small>` : ""}</span>`).join("")}</div></li>`).join("")}</ol>
    <p class="sub">${QB.top5_origen === "calculado" ? `Calculado en este equipo el ${fecha(QB.top5_fecha)}.` : "Top 5 de la investigación inicial con datos de Wallapop."}
      Se basa en lo que se vende más rápido, el interés de los compradores, los anuncios nuevos al día, el margen y las gangas encontradas.
      ${MOVIL ? "" : `<button class="enlace" id="btn-top5">🔄 Recalcular con datos de hoy (≈ 45 min)</button>`}</p>`;
  $("#btn-top5")?.addEventListener("click", async () => {
    if (!confirm("Recalcular el top 5 busca TODO el catálogo (42 modelos) y mide qué se vende antes. Tarda unos 45 minutos. ¿Empezar?")) return;
    try { await api("/api/top5", {}); refrescarEstado(); toast("Recalculando el top 5…"); } catch (e) { error(e); }
  });
  pintarTerminos();
  $("#qb-estado").textContent = modo === "top5" ? `Se buscarán ${QB.top5.reduce((s, a) => s + a.modelos.length, 0)} modelos.` : "";
}
function pintarTerminos() {
  const lista = $("#qb-texto").value.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const norm = (t) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean).join(" ");
  const buscar = (t) => { const n = norm(t); return QB.alias[n] || QB.alias[n.startsWith("consola ") ? n.slice(8) : n]; };
  $("#qb-terminos").innerHTML = lista.length ? `<div class="chips">${lista.map((x) => {
    const real = QB.terminos.find((t) => t.texto.toLowerCase() === x.toLowerCase());
    const modelo = real ? real.modelo : buscar(x);
    return `<span class="chip" title="${modelo ? "Modelo del catálogo: usa sus filtros y costes de reparación" : "Búsqueda genérica: todos los anuncios que contengan estas palabras"}">${modelo ? "✓ " + esc(modelo) : "🔎 " + esc(x)}</span>`;
  }).join("")}</div><p class="sub">${lista.length} búsquedas. ✓ = modelo del catálogo · 🔎 = búsqueda genérica.</p>` : "";
}
$$("input[name=qb-modo]").forEach((r) => r.addEventListener("change", () => { qbEditando = true; pintarBusqueda(); }));
$("#qb-texto").addEventListener("input", () => { qbEditando = true; pintarTerminos(); });
$("#qb-catalogo").addEventListener("change", (e) => {
  if (!e.target.value) return;
  const t = $("#qb-texto");
  t.value = (t.value.trim() ? t.value.trim().replace(/[,;]$/, "") + ", " : "") + e.target.value;
  e.target.value = ""; qbEditando = true; pintarTerminos();
});
$("#btn-qb-guardar").addEventListener("click", async () => {
  try {
    QB = await api("/api/busqueda", { modo: modoElegido(), texto: $("#qb-texto").value });
    qbEditando = false; pintarBusqueda(); refrescarEstado();
    toast(QB.modo === "top5" ? "Buscarás los 5 artículos más rentables ✅" : `Buscarás: ${QB.terminos.map((t) => t.modelo || t.texto).join(", ")} ✅`);
  } catch (e) { error(e); }
});

function pintarInicio() {
  const r = ESTADO?.resumen;
  const hora = new Date().getHours();
  $("#tab-inicio h1").textContent = (hora < 14 ? "Buenos días" : hora < 21 ? "Buenas tardes" : "Buenas noches") + " 👋";
  const benTotal = OPS.reduce((s, o) => s + (o.beneficio || 0), 0);
  $("#kpis").innerHTML = !r ? `<div class="vacio">Todavía no has hecho ninguna búsqueda. Pulsa <b>🔍 Buscar ofertas ahora</b>.</div>` : `
    <div class="kpi verde"><div class="v">${OPS.length}</div><div class="e">oportunidades activas</div></div>
    <div class="kpi"><div class="v">${OPS.filter((o) => o.nuevo).length}</div><div class="e">🆕 nuevas desde la búsqueda anterior</div></div>
    <div class="kpi"><div class="v">${OPS.filter((o) => o.local).length}</div><div class="e">📍 en tu zona</div></div>
    <div class="kpi ${OPS.some((o) => !o.revisado) ? "rojo" : ""}"><div class="v">${OPS.filter((o) => !o.revisado).length}</div><div class="e">⏳ por revisar fotos</div></div>
    <div class="kpi verde"><div class="v">${eur(benTotal)}</div><div class="e">beneficio potencial total</div></div>
    <div class="kpi"><div class="v" style="font-size:17px">${fecha(r.fecha)}</div><div class="e">última búsqueda · ${r.anuncios.toLocaleString("es-ES")} anuncios analizados</div></div>`;
  const top = [...OPS].sort((a, b) => b.beneficio - a.beneficio).slice(0, 6);
  $("#top").innerHTML = top.length ? top.map((o) => `
    <div class="top-item" data-id="${esc(o.id)}">
      <img src="${esc(o.foto || "icono.svg")}" alt="" loading="lazy" onerror="this.src='icono.svg'">
      <div class="t"><b>${o.nuevo ? "🆕 " : ""}${esc(o.titulo)}</b><span class="sub">${eur(o.precio)} · ${o.local ? "📍 " + esc(o.ciudad) + " (" + Math.round(o.km) + " km)" : "📦 envío"}</span></div>
      <span class="pos">${o.beneficio >= 0 ? "+" : ""}${eur(o.beneficio)}</span>
    </div>`).join("") : `<p class="sub">Sin oportunidades por ahora.</p>`;
  $$("#top .top-item").forEach((el) => el.addEventListener("click", () => detalle(OPS.find((o) => o.id === el.dataset.id))));
  pintarProgramacion();
}

function pintarProgramacion() {
  const p = ESTADO?.programacion || {};
  const cont = $("#prog-diaria");
  if (!p.disponible) { cont.innerHTML = `<p class="aviso">No disponible: ${esc(p.motivo || "solo funciona en Windows")}.</p>`; return; }
  cont.innerHTML = p.activa
    ? `<p class="aviso ok">✅ Activada. ${p.proxima ? "Próxima búsqueda: <b>" + esc(p.proxima) + "</b>" : ""}</p>
       <button class="sec" id="btn-desprog">Desactivar</button>`
    : `<div class="en-linea"><label>Hora<input type="time" id="hora-prog" value="08:00"></label><button id="btn-prog">Activar búsqueda diaria</button></div>
       <p class="sub">El ordenador tiene que estar encendido a esa hora.</p>`;
  $("#btn-prog")?.addEventListener("click", async () => {
    try { ESTADO.programacion = await api("/api/programar", { hora: $("#hora-prog").value }); toast("Búsqueda diaria activada"); pintarProgramacion(); } catch (e) { error(e); }
  });
  $("#btn-desprog")?.addEventListener("click", async () => {
    try { ESTADO.programacion = await api("/api/programar", { desactivar: true }); toast("Búsqueda diaria desactivada"); pintarProgramacion(); } catch (e) { error(e); }
  });
}

$("#btn-buscar").addEventListener("click", async () => {
  try { await api("/api/buscar", {}); refrescarEstado(); toast("Búsqueda iniciada. Puedes seguir usando el programa."); } catch (e) { error(e); }
});
$("#btn-reanalizar").addEventListener("click", async () => {
  try { await api("/api/buscar", { solo_analizar: true }); refrescarEstado(); toast("Recalculando con los anuncios ya descargados…"); } catch (e) { error(e); }
});
$("#btn-cancelar").addEventListener("click", async () => { await api("/api/cancelar", {}); toast("Cancelando…"); });

// ===================================================================
// Oportunidades
// ===================================================================
let vistaOfertas = "activas";
$$("#vista-ofertas button").forEach((b) => b.addEventListener("click", () => {
  vistaOfertas = b.dataset.v; $$("#vista-ofertas button").forEach((x) => x.classList.toggle("activa", x === b)); pintarOfertas();
}));
["#f-texto", "#f-cat", "#f-orden", "#f-local", "#f-nuevas", "#f-pend", "#f-ben"].forEach((s) => $(s).addEventListener("input", pintarOfertas));

async function cargarOfertas() {
  await cargarDatos();
  const cats = [...new Set([...OPS, ...DESC].map((o) => o.categoria))];
  const sel = $("#f-cat"), actual = sel.value;
  sel.innerHTML = `<option value="">Todas las categorías</option>` + cats.map((c) => `<option value="${c}">${CATS[c] || c}</option>`).join("");
  sel.value = actual;
  pintarOfertas();
}

function pintarOfertas() {
  const lista = vistaOfertas === "activas" ? OPS : DESC;
  const txt = $("#f-texto").value.trim().toLowerCase(), cat = $("#f-cat").value, ben = +$("#f-ben").value;
  $("#f-ben-v").textContent = ben + " €";
  let l = lista.filter((o) =>
    (!txt || `${o.titulo} ${o.grupo} ${o.ciudad}`.toLowerCase().includes(txt)) && (!cat || o.categoria === cat) &&
    (!$("#f-local").checked || o.local) && (!$("#f-nuevas").checked || o.nuevo) && (!$("#f-pend").checked || !o.revisado) &&
    o.beneficio >= ben);
  const orden = $("#f-orden").value;
  const f = { beneficio: (a, b) => b.beneficio - a.beneficio, margen: (a, b) => b.margen_pct - a.margen_pct, precio: (a, b) => a.precio - b.precio,
    km: (a, b) => (a.km ?? 9999) - (b.km ?? 9999), nuevo: (a, b) => (b.nuevo - a.nuevo) || (b.beneficio - a.beneficio) }[orden];
  l.sort(f);
  $("#txt-ofertas").textContent = vistaOfertas === "activas"
    ? `${l.length} de ${OPS.length} oportunidades · ${OPS.filter((o) => o.nuevo).length} nuevas · ${OPS.filter((o) => !o.revisado).length} por revisar`
    : `${l.length} anuncios que descartaste al revisarlos. Puedes recuperarlos desde su ficha.`;
  $("#lista-ofertas").innerHTML = l.length ? l.map(carta).join("") :
    `<div class="vacio">${lista.length ? "Ningún anuncio cumple los filtros." : vistaOfertas === "activas" ? "No hay oportunidades. Haz una búsqueda desde Inicio." : "No has descartado nada."}</div>`;
  $$("#lista-ofertas .carta").forEach((el) => el.addEventListener("click", () => detalle(lista.find((o) => o.id === el.dataset.id))));
}

function etiquetas(o) {
  let h = "";
  if (o.nuevo) h += `<span class="et nuevo">🆕 Nuevo</span>`;
  if (o.precio_anterior) h += `<span class="et baja">📉 antes ${eur(o.precio_anterior)}</span>`;
  if (o.alerta) h += `<span class="et alerta">⚠️ Posible cebo</span>`;
  if (!o.revisado) h += `<span class="et pend">⏳ Revisar fotos</span>`;
  h += `<span class="et">${o.local ? "📍 " + Math.round(o.km) + " km" : "📦 Envío"}</span>`;
  return h;
}
function textoEstado(o) {
  return ESTADO_TXT[o.estado] === "Usado" || o.estado === "usado" ? (COND[o.condicion] || "Usado") : (ESTADO_TXT[o.estado] || o.estado);
}
function carta(o) {
  return `<div class="carta" data-id="${esc(o.id)}">
    <div class="foto"><img src="${esc(o.foto || "icono.svg")}" alt="" loading="lazy" onerror="this.src='icono.svg'">
      <div class="etiquetas">${etiquetas(o)}</div><div class="ben">${o.beneficio >= 0 ? "+" : ""}${eur(o.beneficio)} · ${o.margen_pct} %</div></div>
    <div class="cuerpo">
      <span class="cat">${CATS[o.categoria] || o.categoria} · ${esc(o.grupo)}</span>
      <div class="tit">${esc(o.titulo)}</div>
      <div><span class="precio">${eur(o.precio)}</span> <span class="meta">→ reventa ${eur(o.precio_reventa)}</span></div>
      <div class="meta">${esc(textoEstado(o))}${o.notas ? " · " + esc(o.notas) : ""}</div>
      <div class="meta">${esc(o.ciudad || "")} · ${o.conversaciones ?? "?"} conversaciones · visto desde ${esc(o.visto_desde || "")}</div>
      <div class="rev">${esc(o.revision || "")}</div>
    </div></div>`;
}

const CHECKLIST = {
  movil: ["Pide una captura de Ajustes → Batería → Salud", "Comprueba que no tiene iCloud / cuenta Google (que lo restablezca delante de ti)", "Marca *#06# y compara el IMEI con la caja o la factura",
    "Prueba Face ID / huella, cámaras, altavoz, micrófono y carga", "Mira si hay avisos de «pieza desconocida» en Ajustes → General → Información"],
  consola: ["Que la encienda y cargue un juego delante de ti", "Prueba el lector de discos (si lo tiene) y todos los mandos", "Comprueba que no hace ruido excesivo ni se apaga", "Pide la caja o la factura si la tiene"],
  patinete: ["Pregunta los km y la antigüedad de la batería", "Prueba frenos, luces y acelerador", "Súbelo por una cuesta para ver si la batería aguanta", "Comprueba que el número de serie no está borrado"],
  zapatilla: ["Pide fotos de la etiqueta interior y de la caja", "Compara costuras y logos con fotos oficiales", "Desconfía de precios muy bajos en modelos de moda"],
  videojuego: ["Comprueba que el disco no está rayado", "Que sea la versión PAL / España"],
  otro: ["Comprueba que funciona y que no está bloqueado con la cuenta del dueño", "Pide la factura si la tiene", "Revisa la salud de la batería si tiene"],
};

async function detalle(o) {
  if (!o) return;
  const oferta = Math.max(5, Math.floor((o.precio * 0.9) / 5) * 5);
  const pregunta = o.categoria === "movil" ? " ¿Me podrías decir la salud de la batería y si tiene algún golpe o reparación?"
    : o.categoria === "patinete" ? " ¿Cuántos km tiene y cuánto aguanta la batería?" : " ¿Funciona todo correctamente?";
  const mensaje = `Hola, me interesa tu ${o.titulo}. ¿Sigue disponible?${pregunta} Si está todo bien te ofrezco ${oferta} € y ${o.local ? "lo recojo en persona cuando te vaya bien" : "lo compro con envío por Wallapop"}. ¡Gracias!`;
  const descartado = DESC.some((d) => d.id === o.id);
  abrirModal(`
    <div class="det">
      <div>
        <div class="galeria"><img class="principal" id="g-principal" src="${esc(o.foto || "icono.svg")}" alt=""><div class="miniaturas" id="g-minis"><span class="sub">Cargando fotos…</span></div></div>
        <h3 class="mt">Descripción del vendedor</h3>
        <div class="desc" id="d-desc">${esc(o.descripcion || "")}</div>
        <p class="sub mt" id="d-ficha"></p>
      </div>
      <div>
        <span class="cat">${CATS[o.categoria] || ""} · ${esc(o.grupo)}</span>
        <h2 style="margin-top:6px">${esc(o.titulo)}</h2>
        <div class="etiquetas" style="position:static;margin-bottom:8px">${etiquetas(o)}</div>
        <table class="desglose">
          <tr><td>Precio del anuncio</td><td>${eur(o.precio)}</td></tr>
          ${o.reparacion ? `<tr><td>Reparaciones (${esc(o.notas)})</td><td>+ ${eur(o.reparacion)}</td></tr>` : ""}
          ${o.envio ? `<tr><td>Envío estimado</td><td>+ ${eur(o.envio)}</td></tr>` : ""}
          <tr><td><b>Coste total</b></td><td>${eur(o.coste_total)}</td></tr>
          <tr><td>Precio típico (mediana de ${esc(o.grupo)} usados)</td><td>${eur(o.reventa_base)}</td></tr>
          <tr><td>Reventa estimada (para vender rápido, según estado)</td><td>${eur(o.precio_reventa)}</td></tr>
          <tr class="total"><td>Beneficio</td><td class="pos">${o.beneficio >= 0 ? "+" : ""}${eur(o.beneficio)} (${o.margen_pct} %)</td></tr>
        </table>
        <p class="sub">Estado: <b>${esc(textoEstado(o))}</b>${o.bateria ? ` · batería ${o.bateria} %` : ""} · ${o.local ? `📍 ${esc(o.ciudad)}, a ${Math.round(o.km)} km` : `📦 envío desde ${esc(o.ciudad)}`} · ${o.conversaciones ?? "?"} conversaciones</p>
        <div class="acciones">
          <a class="boton" href="${esc(o.url)}" target="_blank" rel="noopener">Abrir en Wallapop ↗</a>
          <button class="sec" id="b-copiar">📋 Copiar mensaje al vendedor</button>
          <button class="sec" id="b-op">📦 Añadir a mis operaciones</button>
        </div>
        <label class="sub" style="display:block">Mensaje sugerido (puedes editarlo):</label>
        <textarea id="t-mensaje">${esc(mensaje)}</textarea>
        <div class="tarjeta mt" style="background:#fafafa">
          <h3>🔎 Tu revisión</h3>
          <p class="sub">${o.revisado ? "Revisión actual: <b>" + esc(o.revision) + "</b>" : "Mira las fotos y la descripción. ¿Hay golpes, fisuras, fotos de catálogo o algo raro?"}</p>
          <textarea id="t-nota" placeholder="Nota (opcional): p. ej. «fotos reales, sin golpes» o «fisura en la esquina»"></textarea>
          <div class="acciones">
            ${descartado ? `<button id="b-recuperar">↩ Recuperar (quitar descarte)</button>` : `
            <button id="b-ok">✅ Revisado: está bien</button>
            <button class="peligro" id="b-descartar">❌ Descartar</button>
            <select id="s-motivo" style="width:auto">
              <option value="">Motivo…</option><option>Daño no declarado en las fotos</option><option>Solo fotos de catálogo o de la caja</option>
              <option>Posible estafa o réplica</option><option>Modelo distinto al anunciado</option><option>Ya vendido o reservado</option><option>No me interesa</option>
            </select>`}
            ${o.revisado && !descartado ? `<button class="enlace" id="b-deshacer">Deshacer revisión</button>` : ""}
          </div>
        </div>
        <h3 class="mt">✅ Antes de pagar</h3>
        <ul class="check">${(CHECKLIST[o.categoria] || CHECKLIST.otro).map((c) => `<li>${esc(c)}</li>`).join("")}<li>Paga dentro de Wallapop o en mano al recogerlo. Nunca por adelantado fuera de la app.</li></ul>
      </div>
    </div>`);
  $("#b-copiar").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#t-mensaje").value); toast("Mensaje copiado. Pégalo en el chat de Wallapop."); } catch { $("#t-mensaje").select(); toast("Selecciona el texto y cópialo con Ctrl+C"); } });
  $("#b-op").addEventListener("click", () => { cerrarModal(); irA("ops"); formOperacion({ articulo: o.titulo, categoria: CATS[o.categoria] || o.categoria, estado: "En stock",
    fecha_compra: new Date().toISOString().slice(0, 10), precio_compra: o.precio, gastos: (o.reparacion || 0) + (o.envio || 0), url: o.url,
    notas: `Reventa estimada ${o.precio_reventa} €` }); });
  const revisar = async (cuerpo, msg) => { try { await api("/api/revision", { clave: o.clave, ...cuerpo }); toast(msg); cerrarModal(); await cargarDatos(); pintarOfertas(); pintarInicio(); if ($("#tab-vigilante").classList.contains("activa")) cargarVigilante(); } catch (e) { error(e); } };
  $("#b-ok")?.addEventListener("click", () => revisar({ excluir: false, nota: $("#t-nota").value || "Revisado: fotos correctas" }, "Marcado como revisado ✅"));
  $("#b-descartar")?.addEventListener("click", () => {
    const motivo = [$("#s-motivo").value, $("#t-nota").value].filter(Boolean).join(". ");
    revisar({ excluir: true, nota: motivo || "Descartado al revisar" }, "Descartado. Lo verás en «Descartadas».");
  });
  $("#b-recuperar")?.addEventListener("click", () => revisar({ borrar: true }, "Recuperado: vuelve a estar pendiente de revisar"));
  $("#b-deshacer")?.addEventListener("click", () => revisar({ borrar: true }, "Revisión deshecha"));
  // fotos y datos actualizados de la ficha
  try {
    const f = await api("/api/ficha?id=" + encodeURIComponent(o.id));
    if (!f.disponible) { $("#g-minis").innerHTML = `<p class="aviso mal">${esc(f.error)}</p>`; return; }
    const fotos = f.fotos.filter(Boolean);
    if (fotos.length) $("#g-principal").src = fotos[0];
    $("#g-minis").innerHTML = fotos.map((u, i) => `<img src="${esc(u)}" class="${i ? "" : "sel"}" alt="">`).join("") || "<span class='sub'>Sin fotos</span>";
    $$("#g-minis img").forEach((im) => im.addEventListener("click", () => { $("#g-principal").src = im.src; $$("#g-minis img").forEach((x) => x.classList.toggle("sel", x === im)); }));
    if (f.descripcion) $("#d-desc").textContent = f.descripcion;
    $("#d-ficha").innerHTML = `Ficha actual: <b>${f.precio != null ? eur(f.precio) : ""}</b> · ${esc(COND[f.condicion_clave] || f.condicion || "estado no indicado")} · ${f.visitas ?? "?"} visitas · ${f.favoritos ?? "?"} favoritos · ${f.conversaciones ?? "?"} conversaciones${f.reservado ? " · <b class='neg'>RESERVADO</b>" : ""}`
      + (f.precio != null && f.precio !== o.precio ? `<br><b class="neg">⚠️ El precio ha cambiado desde la búsqueda (${eur(o.precio)} → ${eur(f.precio)}). Revisa el cálculo en la Calculadora.</b>` : "");
  } catch (e) { $("#g-minis").innerHTML = `<p class="aviso mal">No se pudieron cargar las fotos: ${esc(e.message)}</p>`; }
}

// ===================================================================
// Precios de referencia
// ===================================================================
let ordenPrecios = { campo: "categoria", asc: true };
$("#p-texto").addEventListener("input", pintarPrecios);
async function cargarPrecios() { try { REF = await api("/api/referencias"); } catch (e) { error(e); } pintarPrecios(); }
function pintarPrecios() {
  const txt = $("#p-texto").value.toLowerCase();
  const cols = [["categoria", "Categoría"], ["grupo", "Modelo"], ["n_usado", "Anuncios"], ["media_usado", "Media"], ["mediana_usado", "Mediana"],
    ["p25_usado", "Rango típico"], ["mediana_nuevo", "Nuevo"], ["precio_reventa", "Reventa"], ["compra_max_local", "Compra máx."]];
  const l = REF.filter((r) => !txt || r.grupo.toLowerCase().includes(txt)).sort((a, b) => {
    const x = a[ordenPrecios.campo], y = b[ordenPrecios.campo];
    return (typeof x === "string" ? x.localeCompare(y) : (x ?? -1) - (y ?? -1)) * (ordenPrecios.asc ? 1 : -1);
  });
  $("#tabla-precios").innerHTML = !REF.length ? `<tr><td class="vacio">Haz una búsqueda para calcular los precios.</td></tr>` :
    `<thead><tr>${cols.map(([c, t]) => `<th data-c="${c}" class="${c === "grupo" || c === "categoria" ? "" : "num"}">${t}${ordenPrecios.campo === c ? (ordenPrecios.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
    <tbody>${l.map((r) => `<tr class="click" data-g="${esc(r.grupo)}"><td><span class="cat">${CATS[r.categoria] || r.categoria}</span></td><td><b>${esc(r.grupo)}</b></td>
      <td class="num">${r.n_usado}</td><td class="num">${eur(r.media_usado)}</td><td class="num">${eur(r.mediana_usado)}</td>
      <td class="num">${eur(r.p25_usado)} – ${eur(r.p75_usado)}</td><td class="num">${r.mediana_nuevo ? eur(r.mediana_nuevo) : "—"}</td>
      <td class="num">${eur(r.precio_reventa)}</td><td class="num">${r.compra_max_local > 0 ? `<b class="pos">${eur(r.compra_max_local)}</b>` : `<span class="sub">no rentable</span>`}</td></tr>`).join("")}</tbody>`;
  $$("#tabla-precios th").forEach((th) => th.addEventListener("click", () => {
    ordenPrecios = { campo: th.dataset.c, asc: ordenPrecios.campo === th.dataset.c ? !ordenPrecios.asc : true }; pintarPrecios();
  }));
  $$("#tabla-precios tr.click").forEach((tr) => tr.addEventListener("click", () => { irA("calc"); setTimeout(() => { $("#c-grupo").value = tr.dataset.g; $("#form-calc [name=precio]").focus(); }, 50); }));
}

// ===================================================================
// Calculadora
// ===================================================================
async function cargarCalc() {
  if (!REF.length) { try { REF = await api("/api/referencias"); } catch {} }
  const sel = $("#c-grupo"), actual = sel.value;
  const porCat = {};
  REF.forEach((r) => (porCat[r.categoria] ||= []).push(r.grupo));
  sel.innerHTML = Object.entries(porCat).map(([c, gs]) => `<optgroup label="${CATS[c] || c}">${gs.sort().map((g) => `<option>${esc(g)}</option>`).join("")}</optgroup>`).join("")
    || `<option value="">Haz una búsqueda primero</option>`;
  if (actual) sel.value = actual;
}
$("#form-calc").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target), cuerpo = Object.fromEntries(fd.entries());
  cuerpo.local = fd.get("local") === "on";
  const res = $("#res-calc");
  try {
    const r = await api("/api/calcular", cuerpo);
    if (!r.ok) { res.innerHTML = `<div class="veredicto mal">${esc(r.motivo)}</div>`; return; }
    const clase = r.cumple ? "ok" : r.beneficio > 0 ? "medio" : "mal";
    const txt = r.cumple ? "✅ Buena compra: cumple tu criterio" : r.beneficio > 0 ? "⚠️ Gana algo, pero no llega a tu mínimo" : "❌ No compensa: perderías dinero";
    res.innerHTML = `<div class="veredicto ${clase}">${txt}</div>
      <table class="desglose">
        <tr><td>Precio del anuncio</td><td>${eur(+cuerpo.precio)}</td></tr>
        ${r.reparacion ? `<tr><td>Reparaciones (${esc(r.notas)})</td><td>+ ${eur(r.reparacion)}</td></tr>` : ""}
        ${!cuerpo.local ? `<tr><td>Envío estimado</td><td>+ ${eur(r.coste - cuerpo.precio - r.reparacion)}</td></tr>` : ""}
        <tr><td><b>Coste total</b></td><td>${eur(r.coste)}</td></tr>
        <tr><td>Reventa estimada</td><td>${eur(r.reventa)}</td></tr>
        <tr class="total"><td>Beneficio</td><td class="${r.beneficio >= 0 ? "pos" : "neg"}">${r.beneficio >= 0 ? "+" : ""}${eur(r.beneficio)} (${r.margen} %)</td></tr>
      </table>
      <p><b>Precio máximo que deberías pagar: ${r.precio_max > 0 ? eur(r.precio_max) : "ninguno (no sale rentable)"}</b></p>
      <p class="sub">Basado en ${r.n} anuncios de ${esc(cuerpo.grupo)} usados: mediana ${eur(r.mediana)}, la mitad entre ${eur(r.p25)} y ${eur(r.p75)}.</p>`;
  } catch (err) { res.innerHTML = `<div class="veredicto mal">${esc(err.message)}</div>`; }
});

// ===================================================================
// Mis operaciones
// ===================================================================
let OPERS = [], filtroOps = "";
$$("#filtro-ops button").forEach((b) => b.addEventListener("click", () => { filtroOps = b.dataset.v; $$("#filtro-ops button").forEach((x) => x.classList.toggle("activa", x === b)); pintarOps(); }));
$("#btn-nueva-op").addEventListener("click", () => formOperacion({ estado: "En stock", fecha_compra: new Date().toISOString().slice(0, 10) }));
const benOp = (o) => o.precio_venta == null ? null : o.precio_venta - (o.precio_compra || 0) - (o.gastos || 0) - (o.comision || 0);
async function cargarOps() { try { OPERS = await api("/api/operaciones"); } catch (e) { error(e); } pintarOps(); }
function pintarOps() {
  const vend = OPERS.filter((o) => o.estado === "Vendido"), stock = OPERS.filter((o) => o.estado !== "Vendido");
  const invertido = OPERS.reduce((s, o) => s + (o.precio_compra || 0) + (o.gastos || 0), 0);
  const ganado = vend.reduce((s, o) => s + (benOp(o) || 0), 0);
  const costeVend = vend.reduce((s, o) => s + (o.precio_compra || 0) + (o.gastos || 0) + (o.comision || 0), 0);
  const enStock = stock.reduce((s, o) => s + (o.precio_compra || 0) + (o.gastos || 0), 0);
  $("#kpis-ops").innerHTML = `
    <div class="kpi"><div class="v">${OPERS.length}</div><div class="e">operaciones</div></div>
    <div class="kpi"><div class="v">${eur(invertido)}</div><div class="e">invertido en total (compras + gastos)</div></div>
    <div class="kpi"><div class="v">${eur(enStock)}</div><div class="e">dinero en stock (${stock.length} artículos)</div></div>
    <div class="kpi ${ganado >= 0 ? "verde" : "rojo"}"><div class="v">${eur(ganado)}</div><div class="e">beneficio de lo vendido (${vend.length})</div></div>
    <div class="kpi"><div class="v">${costeVend ? Math.round((ganado / costeVend) * 100) : 0} %</div><div class="e">rentabilidad media de lo vendido</div></div>`;
  const l = OPERS.filter((o) => !filtroOps || o.estado === filtroOps).sort((a, b) => (b.fecha_compra || "").localeCompare(a.fecha_compra || ""));
  $("#tabla-ops").innerHTML = !l.length ? `<tr><td class="vacio">Aún no hay operaciones. Añádelas con «＋ Nueva operación» o desde la ficha de una oportunidad.</td></tr>` :
    `<thead><tr><th>Artículo</th><th>Estado</th><th>Compra</th><th class="num">Precio compra</th><th class="num">Gastos</th><th>Venta</th><th class="num">Precio venta</th><th class="num">Beneficio</th><th>Días</th><th></th></tr></thead>
    <tbody>${l.map((o) => { const b = benOp(o); const dias = o.fecha_compra ? Math.round(((o.fecha_venta ? new Date(o.fecha_venta) : new Date()) - new Date(o.fecha_compra)) / 864e5) : "";
      return `<tr class="click" data-id="${o.id}"><td><b>${esc(o.articulo)}</b><br><span class="sub">${esc(o.categoria || "")}</span></td>
      <td><span class="estado-op ${esc((o.estado || "").split(" ")[0])}">${esc(o.estado)}</span></td><td>${esc(o.fecha_compra || "")}</td>
      <td class="num">${eur(o.precio_compra)}</td><td class="num">${eur(o.gastos)}</td><td>${esc(o.fecha_venta || "")}</td><td class="num">${eur(o.precio_venta)}</td>
      <td class="num">${b == null ? "—" : `<span class="${b >= 0 ? "pos" : "neg"}">${b >= 0 ? "+" : ""}${eur(b)}</span>`}</td><td>${dias}</td>
      <td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">anuncio ↗</a>` : ""}</td></tr>`; }).join("")}</tbody>`;
  $$("#tabla-ops tr.click").forEach((tr) => tr.addEventListener("click", () => formOperacion(OPERS.find((o) => o.id === tr.dataset.id))));
}
function formOperacion(o) {
  const v = (k) => esc(o[k] ?? "");
  const estados = ["En stock", "En reparación", "A la venta", "Vendido"];
  abrirModal(`<h2>${o.id ? "Editar operación" : "Nueva operación"}</h2>
    <form id="form-op" class="formulario" style="max-width:720px">
      <label>Artículo<input name="articulo" value="${v("articulo")}" required placeholder="Ej. iPhone 13 Pro 128 GB gris"></label>
      <div class="en-linea"><label>Categoría<input name="categoria" value="${v("categoria")}" placeholder="Móvil, consola…"></label>
        <label>Estado<select name="estado">${estados.map((e) => `<option ${o.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select></label></div>
      <div class="en-linea"><label>Fecha de compra<input type="date" name="fecha_compra" value="${v("fecha_compra")}"></label>
        <label>Precio de compra (€)<input type="number" step="0.01" name="precio_compra" value="${v("precio_compra")}"></label>
        <label>Gastos: reparación, envío… (€)<input type="number" step="0.01" name="gastos" value="${v("gastos")}"></label></div>
      <div class="en-linea"><label>Fecha de venta<input type="date" name="fecha_venta" value="${v("fecha_venta")}"></label>
        <label>Precio de venta (€)<input type="number" step="0.01" name="precio_venta" value="${v("precio_venta")}"></label>
        <label>Comisiones de venta (€)<input type="number" step="0.01" name="comision" value="${v("comision")}"></label></div>
      <label>Enlace del anuncio<input name="url" value="${v("url")}"></label>
      <label>Notas<textarea name="notas">${v("notas")}</textarea></label>
      <div class="acciones"><button type="submit">💾 Guardar</button>${o.id ? `<button type="button" class="peligro" id="b-borrar-op">Borrar</button>` : ""}<button type="button" class="sec" data-cerrar>Cancelar</button></div>
    </form>`);
  $("#form-op").addEventListener("submit", async (e) => {
    e.preventDefault();
    const op = Object.fromEntries(new FormData(e.target).entries()); op.id = o.id;
    if (op.precio_venta && op.estado !== "Vendido" && confirm("Has puesto precio de venta. ¿Marcar como vendido?")) op.estado = "Vendido";
    if (op.estado === "Vendido" && !op.fecha_venta) op.fecha_venta = new Date().toISOString().slice(0, 10);
    try { OPERS = await api("/api/operaciones", { accion: "guardar", op }); cerrarModal(); pintarOps(); toast("Operación guardada"); } catch (err) { error(err); }
  });
  $("#b-borrar-op")?.addEventListener("click", async () => {
    if (!confirm("¿Borrar esta operación?")) return;
    try { OPERS = await api("/api/operaciones", { accion: "borrar", id: o.id }); cerrarModal(); pintarOps(); toast("Operación borrada"); } catch (err) { error(err); }
  });
}

// ===================================================================
// Ajustes
// ===================================================================
let AJ = null;
async function cargarAjustes() {
  try { AJ = await api("/api/ajustes"); } catch (e) { return error(e); }
  pintarAjustes();
}
function pintarAjustes() {
  const a = AJ.ajustes;
  $("#aj-pueblo").value = a.UBICACION_NOMBRE || "";
  $$("[id^=aj-]").forEach((inp) => {
    const k = inp.id.slice(3); if (!(k in a) || typeof a[k] === "object") return;
    inp.value = inp.dataset.pct ? Math.round(a[k] * 100) : a[k];
  });
  actualizarTiempo();
  $("#txt-carpeta").textContent = "Tus datos (anuncios, revisiones, operaciones) se guardan en: " + (ESTADO?.carpeta || "");
  const modelos = Object.keys(a.REPARACION_PANTALLA);
  const todos = [...new Set([...modelos, ...Object.keys(a.REPARACION_TRASERA)])];
  $("#tabla-rep").innerHTML = `<thead><tr><th>Modelo</th><th>Pantalla taller</th><th>Pantalla oficial</th><th>Trasera</th></tr></thead><tbody>` +
    todos.map((m) => { const p = a.REPARACION_PANTALLA[m] || {}; return `<tr><td>${esc(m)}</td>
      <td><input type="number" data-m="${esc(m)}" data-t="taller" value="${p.taller ?? ""}"></td>
      <td><input type="number" data-m="${esc(m)}" data-t="oficial" value="${p.oficial ?? ""}"></td>
      <td><input type="number" data-m="${esc(m)}" data-t="trasera" value="${a.REPARACION_TRASERA[m] ?? ""}"></td></tr>`; }).join("") + "</tbody>";
}
async function actualizarTiempo() {
  const pag = +$("#aj-PAGINAS").value || (MOVIL ? 2 : 5);
  if (!QB) { try { QB = await api("/api/busqueda"); } catch { return; } }
  const n = QB.activos.length;
  $("#aj-tiempo").textContent = `Con lo que buscas ahora (${n} búsquedas), cada búsqueda completa tardará unos ${Math.max(1, Math.round((n * (3 * pag + Math.min(2, pag)) * (MOVIL ? 0.4 : 2.6)) / 60))} minutos.`;
}
$("#aj-PAGINAS").addEventListener("input", actualizarTiempo);
$("#btn-guardar-aj").addEventListener("click", async () => {
  const nuevos = { UBICACION_NOMBRE: $("#aj-pueblo").value.trim() || "Mi zona" };
  $$("[id^=aj-]").forEach((inp) => { const k = inp.id.slice(3); if (k in AJ.ajustes && typeof AJ.ajustes[k] !== "object" && inp.value !== "") nuevos[k] = inp.dataset.pct ? +inp.value / 100 : +inp.value; });
  const pant = {}, tras = {};
  $$("#tabla-rep input").forEach((i) => {
    const m = i.dataset.m, v = i.value === "" ? null : +i.value;
    if (i.dataset.t === "trasera") { if (v) tras[m] = v; } else { (pant[m] ||= { taller: null, oficial: null })[i.dataset.t] = v; }
  });
  nuevos.REPARACION_PANTALLA = pant; nuevos.REPARACION_TRASERA = tras;
  try { AJ = await api("/api/ajustes", { ajustes: nuevos }); pintarAjustes(); refrescarEstado(); toast("Ajustes guardados ✅"); } catch (e) { error(e); }
});
$("#btn-restablecer").addEventListener("click", async () => {
  if (!confirm("¿Volver a los valores originales? Se perderán tus cambios de ajustes (no tus operaciones ni revisiones).")) return;
  try { AJ = await api("/api/restablecer", {}); pintarAjustes(); toast("Ajustes restablecidos"); } catch (e) { error(e); }
});
$("#btn-geo").addEventListener("click", async () => {
  try {
    const res = await api("/api/geocodificar", { texto: $("#aj-pueblo").value });
    $("#geo-res").innerHTML = res.length ? res.map((r, i) => `<button type="button" class="enlace" data-i="${i}">📍 ${esc(r.nombre)}</button>`).join("<br>") : "<p class='sub'>No se encontró. Prueba con «Población, provincia».</p>";
    $$("#geo-res button").forEach((b) => b.addEventListener("click", () => { const r = res[b.dataset.i];
      $("#aj-LAT").value = r.lat.toFixed(4); $("#aj-LON").value = r.lon.toFixed(4); $("#aj-pueblo").value = r.nombre.split(",")[0]; $("#geo-res").innerHTML = "<p class='sub'>Ubicación elegida. Pulsa «Guardar ajustes».</p>"; }));
  } catch (e) { error(e); }
});
$("#btn-carpeta").addEventListener("click", async () => {
  if (MOVIL) { try { await window.MOTOR.exportarCopia(); } catch (e) { if (e.name !== "AbortError") error(e); } return; }
  try { await api("/api/abrir_carpeta", {}); } catch (e) { toast(e.message, 8000); }
});

// ===================================================================
// Vigilante
// ===================================================================
let VIG = null, sondeoVig = null, vigEditando = false;
async function cargarVigilante() {
  if (MOVIL) return;
  try { VIG = await api("/api/vigilante"); } catch (e) { return error(e); }
  pintarVigilante();
  clearTimeout(sondeoVig);
  if ($("#tab-vigilante").classList.contains("activa")) sondeoVig = setTimeout(refrescarVigilante, 5000);
}
async function refrescarVigilante() {
  if (!$("#tab-vigilante").classList.contains("activa")) return;
  try { VIG = await api("/api/vigilante"); pintarEstadoVig(); pintarAvisos(); } catch {}
  sondeoVig = setTimeout(refrescarVigilante, 5000);
}
function pintarVigilante() { pintarEstadoVig(); pintarTelegram(); if (!vigEditando) pintarConfigVig(); pintarAvisos(); }
function pintarEstadoVig() {
  const e = VIG.estado, tg = VIG.telegram;
  const avisoTg = tg.conectado ? "" : `<p class="aviso">Telegram no está conectado: los avisos solo se verán aquí. Conéctalo abajo.</p>`;
  $("#vig-estado").innerHTML = `
    <div class="en-linea" style="align-items:center">
      <div><h2 style="margin:0">${e.activo ? "🟢 Vigilando" : "⚪ Parado"}</h2>
        <p class="sub" style="margin:4px 0 0">${e.activo ? `Desde ${fecha(e.inicio)} · ${e.vueltas} vueltas · ${e.nuevos} anuncios nuevos analizados · ${e.avisos} avisos` : "Pulsa «Empezar a vigilar»."}</p></div>
      <div style="flex:0 0 auto">${e.activo ? `<button class="sec" id="btn-vig-parar">⏹ Parar</button>` : `<button class="grande" id="btn-vig-iniciar">▶ Empezar a vigilar</button>`}</div>
    </div>
    ${e.activo && e.proxima ? `<p class="sub mt">Última vuelta: ${e.ultima ? fecha(e.ultima) : "en curso…"} · próxima: ${fecha(e.proxima)}</p>` : ""}
    ${e.error ? `<p class="aviso mal">${esc(e.error)}</p>` : ""}
    ${!VIG.hay_referencias ? `<p class="aviso">Antes de vigilar haz una <b>búsqueda completa</b> en Inicio: el vigilante usa sus precios de referencia. Repítela cada pocos días para que estén al día (o activa la búsqueda diaria automática).</p>` : ""}
    ${avisoTg}
    <details class="mt"><summary>Ver actividad</summary><pre>${esc(e.log.join("\n") || "Sin actividad todavía")}</pre></details>`;
  $("#btn-vig-iniciar")?.addEventListener("click", async () => {
    try { VIG = await api("/api/vigilante", { accion: "iniciar" }); toast("Vigilante en marcha 🟢"); pintarEstadoVig(); } catch (er) { error(er); } });
  $("#btn-vig-parar")?.addEventListener("click", async () => {
    try { VIG = await api("/api/vigilante", { accion: "parar" }); toast("Vigilante parado"); pintarEstadoVig(); } catch (er) { error(er); } });
  const b = $("#badge-vig"); b.classList.toggle("oculto", !e.activo); b.textContent = "ON"; b.style.background = "var(--ok)";
}
function pintarTelegram() {
  const tg = VIG.telegram;
  $("#tg-estado").innerHTML = tg.conectado
    ? `<p class="aviso ok">✅ Conectado con <b>@${esc(tg.bot)}</b>${tg.nombre ? " (chat de " + esc(tg.nombre) + ")" : ""}. Los avisos te llegarán ahí.</p>
       <div class="acciones"><button class="sec" id="btn-tg-probar">Enviar mensaje de prueba</button><button class="enlace" id="btn-tg-desc">Desconectar</button></div>`
    : tg.token ? `<p class="aviso">Bot <b>@${esc(tg.bot)}</b> guardado. Falta el último paso: abre el bot en Telegram, pulsa <b>Iniciar</b> y luego «Conectar con mi Telegram».</p>` : "";
  $("#tg-pasos").classList.toggle("oculto", tg.conectado);
  $("#btn-tg-probar")?.addEventListener("click", async () => { try { await api("/api/telegram", { accion: "probar" }); toast("Mensaje enviado. Míralo en Telegram 📲"); } catch (e) { error(e); } });
  $("#btn-tg-desc")?.addEventListener("click", async () => {
    if (!confirm("¿Desconectar Telegram? Tendrás que volver a pegar el token.")) return;
    try { VIG.telegram = await api("/api/telegram", { accion: "desconectar" }); pintarTelegram(); pintarEstadoVig(); } catch (e) { error(e); } });
}
$("#btn-tg-token").addEventListener("click", async () => {
  try { VIG.telegram = await api("/api/telegram", { accion: "token", token: $("#tg-token").value }); $("#tg-token").value = ""; toast(`Bot @${VIG.telegram.bot} guardado ✅`); pintarTelegram(); } catch (e) { error(e); }
});
$("#btn-tg-conectar").addEventListener("click", async () => {
  try { VIG.telegram = await api("/api/telegram", { accion: "conectar" }); toast("¡Conectado! Te he enviado un mensaje a Telegram ✅"); pintarTelegram(); pintarEstadoVig(); } catch (e) { error(e); }
});
function pintarConfigVig() {
  $("#vig-intervalo").value = String(VIG.intervalo);
  if (!$("#vig-intervalo").value) $("#vig-intervalo").value = "180";
  $("#vig-envios").checked = VIG.envios; $("#vig-auto").checked = VIG.auto; $("#vig-windows").checked = VIG.con_windows;
  $("#lbl-vig-windows").classList.toggle("oculto", !VIG.windows);
  const modo = VIG.modo === "personal" ? "lo que has escrito" : "los 5 artículos más rentables";
  $("#vig-modelos").innerHTML = !VIG.modelos.length ? `<p class="aviso">No hay nada que vigilar. Elige qué buscar en Inicio.</p>` :
    `<p class="sub">Ahora vigila <b>${modo}</b>:</p><div class="chips">${VIG.modelos.map((m) => `<span class="chip ${m.vigilado ? "" : "apagado"}"
      title="${m.vigilado ? (m.compra_max > 0 ? "Compra máx. " + m.compra_max + " €" : "No suele salir rentable") : "Sin precio de referencia: haz una búsqueda completa"}">${esc(m.nombre)}${m.vigilado ? (m.compra_max > 0 ? ` <small>≤ ${m.compra_max} €</small>` : " <small>(no rentable)</small>") : " <small>⚠️ sin precio</small>"}</span>`).join("")}</div>
    ${VIG.modelos.some((m) => !m.vigilado) ? `<p class="aviso">Los marcados con ⚠️ no se vigilan hasta que hagas una búsqueda completa: el vigilante necesita su precio de referencia.</p>` : ""}`;
  carga();
}
function carga() {
  const n = VIG.modelos.filter((m) => m.vigilado).length * ($("#vig-envios").checked ? 2 : 1), seg = +$("#vig-intervalo").value;
  $("#vig-carga").textContent = `≈ ${(n * 60 / seg).toFixed(1)} consultas por minuto a Wallapop`;
}
["#vig-intervalo", "#vig-envios", "#vig-auto"].forEach((s) => $(s).addEventListener("change", () => { vigEditando = true; carga(); }));
$("#vig-windows").addEventListener("change", async (e) => {
  try { VIG = await api("/api/vigilante", { accion: "inicio_windows", activar: e.target.checked });
    toast(e.target.checked ? "El vigilante arrancará al encender el ordenador ✅" : "Ya no arrancará al encender el ordenador"); } catch (er) { error(er); e.target.checked = !e.target.checked; }
});
$("#btn-vig-guardar").addEventListener("click", async () => {
  try {
    await api("/api/ajustes", { ajustes: { VIGILANTE_INTERVALO: +$("#vig-intervalo").value, VIGILANTE_ENVIOS: $("#vig-envios").checked,
      VIGILANTE_AUTO: $("#vig-auto").checked } });
    vigEditando = false; toast("Guardado. Se aplica en la próxima vuelta ✅"); cargarVigilante();
  } catch (e) { error(e); }
});
function pintarAvisos() {
  const l = VIG.avisos;
  $("#vig-avisos-txt").textContent = l.length ? `${l.length} avisos. Los ⏳ tienen las fotos sin revisar: míralas antes de escribir.` : "";
  $("#vig-avisos").innerHTML = l.length ? l.map((o) => carta(o).replace('<div class="cuerpo">',
    `<div class="cuerpo"><span class="meta">🔔 Aviso ${esc(fecha(o.aviso))}${o.telegram ? " · enviado a Telegram" : ""}</span>`)).join("")
    : `<div class="vacio">Todavía no hay avisos. Cuando el vigilante encuentre una ganga recién publicada aparecerá aquí y en Telegram.</div>`;
  $$("#vig-avisos .carta").forEach((el) => el.addEventListener("click", () => detalle(l.find((o) => o.id === el.dataset.id))));
}
$("#btn-vig-borrar").addEventListener("click", async () => {
  if (!confirm("¿Borrar la lista de avisos? (No afecta a lo que ya te llegó por Telegram.)")) return;
  try { VIG = await api("/api/vigilante", { accion: "borrar_avisos" }); pintarAvisos(); } catch (e) { error(e); }
});

// ===================================================================
// Arranque
// ===================================================================
cargarInicio();
