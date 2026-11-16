"use strict";
// ===================================================================
// Motor de CompraVenta para el iPhone.
// Hace en el propio teléfono lo mismo que recoger.py + analizar.py y responde a la
// interfaz (app.js) igual que el servidor de Windows (app.py). Todo se guarda en el iPhone.
// Los criterios vienen de config.json, exportado desde config.py.
// ===================================================================
(function () {
  const API = "https://api.wallapop.com/api/v3";
  const H = { "X-DeviceOS": "0", Accept: "application/json" };
  const SIMULTANEAS = 3;        // búsquedas a la vez (el móvil no puede esperar 30 minutos)
  const PAUSA_MS = 400;         // pausa entre peticiones de cada búsqueda
  const CACHE_HORAS = 20;
  const HISTORIAL_DIAS = 30;
  const DEFECTO = {};           // config.json tal cual
  let C = {};                   // config + ajustes del usuario

  // ---------------------------------------------------------------- almacenamiento
  const K = (n) => "cv_" + n;
  const leer = (n, def) => { try { const v = localStorage.getItem(K(n)); return v === null ? def : JSON.parse(v); } catch { return def; } };
  const guardar = (n, v) => {
    try { localStorage.setItem(K(n), JSON.stringify(v)); }
    catch (e) { throw new Error("No queda espacio en el iPhone para guardar los datos de la app (" + e.name + ")."); }
  };

  async function cargarConfig() {
    const r = await fetch("config.json", { cache: "no-cache" });
    Object.assign(DEFECTO, await r.json());
    aplicarAjustes();
  }
  function aplicarAjustes() {
    C = JSON.parse(JSON.stringify(DEFECTO));
    const aj = leer("ajustes", {});
    for (const k of DEFECTO.EDITABLES) if (k in aj) C[k] = aj[k];
    if (aj.PAGINAS) C.PAGINAS = aj.PAGINAS;
  }
  const listo = cargarConfig();

  // ---------------------------------------------------------------- utilidades
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const rx = (s, f = "i") => new RegExp(s, f);
  function km(lat1, lon1, lat2, lon2) {
    const rad = (x) => (x * Math.PI) / 180, p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }
  // round() de Python: los ,5 exactos van al número par (para dar los mismos resultados que el PC)
  function redondear(x) {
    const f = Math.floor(x);
    if (Math.abs(x - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  const r1 = (x) => redondear(x * 10) / 10;
  const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  // statistics.quantiles(n=4, method="exclusive") de Python
  function cuartiles(xs) {
    const d = [...xs].sort((a, b) => a - b), ld = d.length, m = ld + 1, n = 4, res = [];
    for (let i = 1; i < n; i++) {
      let j = Math.floor((i * m) / n);
      j = j < 1 ? 1 : j > ld - 1 ? ld - 1 : j;
      const delta = i * m - j * n;
      res.push((d[j - 1] * (n - delta) + d[j] * delta) / n);
    }
    return res;
  }
  function sinAtipicos(p) {
    if (p.length < 8) return p;
    const q = cuartiles(p), iqr = q[2] - q[0];
    return p.filter((x) => q[0] - 1.5 * iqr <= x && x <= q[2] + 1.5 * iqr);
  }
  function mediaRecortada(xs, frac = 0.1) {
    let s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length * frac);
    const t = s.slice(k, s.length - k); s = t.length ? t : s;
    return s.reduce((a, b) => a + b, 0) / s.length;
  }
  const hoyISO = () => new Date().toISOString();

  async function pedir(url, intentos = 3) {
    for (let i = 0; i < intentos; i++) {
      try {
        const r = await fetch(url, { headers: H, cache: "no-store" });
        if (r.ok) return await r.json();
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return { __error: r.status };
      } catch (e) { /* red: reintento */ }
      await dormir(2000 * (i + 1));
    }
    return null;
  }

  // ---------------------------------------------------------------- qué se busca (config.py)
  const CATEGORIAS = [
    ["movil", /iphone|galaxy|samsung|xiaomi\s*(redmi|\d)|redmi|pixel|oppo|oneplus|huawei|motorola|m[oó]vil|smartphone/],
    ["consola", /ps[45]\b|playstation|xbox|nintendo|switch|steam\s*deck|consola/],
    ["patinete", /patinete|scooter|ninebot|segway/],
    ["zapatilla", /zapatilla|nike|jordan|adidas|new\s*balance|yeezy|dunk|samba|converse|vans\b|asics/],
    ["videojuego", /\bjuego\b|videojuego/],
  ];
  const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "para", "en", "a", "un", "una", "o"]);
  const VOCALES = { a: "[aáàä]", e: "[eéèë]", i: "[iíìï]", o: "[oóòö]", u: "[uúùü]", n: "[nñ]" };
  const normal = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean).join(" ");
  const quitaConsola = (t) => (t.startsWith("consola ") ? t.slice(8) : t);
  function terminos() {
    const vistos = new Set(), out = [];
    for (let t of String(C.BUSQUEDA_TEXTO || "").split(/[,;\n]+/)) {
      t = t.split(/\s+/).filter(Boolean).join(" ");
      if (t && !vistos.has(normal(t))) { vistos.add(normal(t)); out.push(t); }
    }
    return out.slice(0, 20);
  }
  function modeloConocido(termino) {
    const n = normal(termino), cand = new Set([n, quitaConsola(n)]);
    for (const [g, d] of Object.entries(C.GRUPOS))
      if ([normal(g), normal(d.q), quitaConsola(normal(d.q))].some((x) => cand.has(x))) return g;
    return null;
  }
  function regexPalabras(termino) {
    let palabras = normal(termino).split(" ").filter((p) => !VACIAS.has(p));
    if (!palabras.length) palabras = normal(termino).split(" ");
    return palabras.map((p) => {
      const cuerpo = [...p].map((c) => VOCALES[c] || c.replace(/[.*+?^${}()|[\]\\\-]/g, "\\$&")).join("");
      return "(?=.*(?:^|[^a-z0-9áéíóúüñàèìòùäëïö])" + cuerpo + (/\d$/.test(p) ? "(?!\\d)" : "") + ")";
    }).join("");
  }
  function grupoPersonal(termino) {
    const g = modeloConocido(termino);
    if (g) return [g, C.GRUPOS[g]];
    const cat = (CATEGORIAS.find(([, re]) => re.test(normal(termino))) || ["otro"])[0];
    const primera = regexPalabras(normal(termino).split(" ")[0]).slice("(?=.*(?:^|[^a-z0-9áéíóúüñàèìòùäëïö])".length, -1);
    return [termino, { cat, q: normal(termino), inc: regexPalabras(termino),
      exc: "\\bbusco\\b|\\bcompro\\b|cambio por|compatible|\\bpara\\s+(?:el\\s+|la\\s+|tu\\s+)?" + primera,
      personal: true, minimo: C.PRECIO_MIN_PERSONAL }];
  }
  let cachePers = { texto: null, grupos: null };
  function gruposPersonales() {
    if (cachePers.texto !== C.BUSQUEDA_TEXTO) cachePers = { texto: C.BUSQUEDA_TEXTO, grupos: Object.fromEntries(terminos().map(grupoPersonal)) };
    return cachePers.grupos;
  }
  const top5 = () => ({ top: C.TOP5_DEFECTO || [], fecha: null, origen: "por defecto" });
  function gruposActivos() {
    if (C.BUSQUEDA_MODO === "personal") return gruposPersonales();
    const out = {};
    for (const t of top5().top) for (const g of t.modelos) if (C.GRUPOS[g]) out[g] = C.GRUPOS[g];
    return out;
  }
  const gruposClasificacion = () => (C.BUSQUEDA_MODO === "personal" ? gruposPersonales() : C.GRUPOS);
  const grupo = (n) => C.GRUPOS[n] || gruposPersonales()[n] || grupoPersonal(n)[1];

  // ---------------------------------------------------------------- tarea en curso
  const T = { activa: false, cancelar: false, fase: "", texto: "", fraccion: 0, inicio: null, fin: null, error: null, log: [] };
  function progreso(fase, ini, peso) {
    return (texto, frac) => {
      T.fase = fase; T.texto = texto; T.fraccion = ini + peso * frac;
      T.log.push(new Date().toLocaleTimeString("es-ES") + "  " + texto);
      if (T.log.length > 200) T.log.shift();
    };
  }
  class Cancelado extends Error {}
  let bloqueo = null;  // mantener la pantalla encendida durante la búsqueda
  async function pantallaEncendida(si) {
    try {
      if (si && "wakeLock" in navigator) bloqueo = await navigator.wakeLock.request("screen");
      else if (!si && bloqueo) { await bloqueo.release(); bloqueo = null; }
    } catch { /* no soportado */ }
  }

  // ---------------------------------------------------------------- recogida (recoger.py)
  async function buscar(q, paginas, radio, orden) {
    const p = new URLSearchParams({ keywords: q, latitude: C.LAT, longitude: C.LON, source: "search_box" });
    if (radio) p.set("distance_in_km", radio);
    if (orden) p.set("order_by", orden);
    let url = `${API}/search?${p}`, out = [];
    for (let i = 0; i < paginas; i++) {
      if (T.cancelar) throw new Cancelado();
      const d = await pedir(url);
      T.consultas = (T.consultas || 0) + 1;
      if (!d || d.__error) { T.fallos = (T.fallos || 0) + 1; break; }
      const items = d?.data?.section?.payload?.items || [];
      out = out.concat(items);
      const sig = d?.meta?.next_page;
      if (!sig || !items.length) break;
      url = `${API}/search?next_page=${encodeURIComponent(sig)}`;
      await dormir(PAUSA_MS);
    }
    return out;
  }
  function limpiar(it, grupo, ambito) {
    const loc = it.location || {}, ship = it.shipping || {}, imgs = it.images || [];
    return {
      id: it.id, grupo, ambito, titulo: it.title || "", descripcion: (it.description || "").slice(0, 1500),
      precio: it.price?.amount ?? null, reservado: !!it.reserved?.flag, ciudad: loc.city || "",
      km: loc.latitude != null ? r1(km(C.LAT, C.LON, loc.latitude, loc.longitude)) : null,
      envio: !!(ship.item_is_shippable && ship.user_allows_shipping),
      url: "https://es.wallapop.com/item/" + (it.web_slug || ""), creado: it.created_at || 0,
      foto: imgs[0]?.urls?.medium || null,
    };
  }
  async function recoger(prog) {
    const grupos = Object.entries(gruposActivos());
    if (!grupos.length) throw new Error("No hay nada que buscar. En Inicio elige «Top 5» o escribe lo que quieres buscar.");
    T.consultas = 0; T.fallos = 0;
    const pag = +C.PAGINAS || 2, todos = new Map();
    let hechos = 0, cola = [...grupos];
    async function trabajador() {
      while (cola.length) {
        const [grupo, g] = cola.shift();
        const busq = [
          ["local", await buscar(g.q, pag, C.RADIO_LOCAL_KM, "closest")],
          ["local", await buscar(g.q, pag, C.RADIO_LOCAL_KM, "newest")],
          ["nacional", await buscar(g.q, pag, null, "newest")],
          ["nacional", await buscar(g.q, Math.min(2, pag), null, null)],
        ];
        let n = 0;
        for (const [ambito, items] of busq) for (const it of items) { n++; if (!todos.has(it.id)) todos.set(it.id, limpiar(it, grupo, ambito)); }
        hechos++;
        prog(`${grupo}: ${n} resultados (total ${todos.size})`, hechos / grupos.length);
      }
    }
    await Promise.all(Array.from({ length: SIMULTANEAS }, trabajador));
    if (T.consultas && T.fallos > T.consultas / 2)
      throw new Error(`Han fallado ${T.fallos} de ${T.consultas} consultas. Comprueba la conexión a Internet. Se conservan los resultados anteriores.`);
    if (!todos.size) throw new Error("No se ha encontrado ningún anuncio para lo que buscas. Revisa cómo lo has escrito (prueba con menos palabras o el nombre del modelo).");
    return [...todos.values()];
  }

  // ---------------------------------------------------------------- análisis (analizar.py)
  let RX = null;
  function regex() {
    const clave = C.BUSQUEDA_MODO + "|" + C.BUSQUEDA_TEXTO;
    if (RX && RX.clave === clave) return RX;
    RX = {
      clave,
      replica: /r[eé]plica|\brep\b|1:1|\baaa\b|no (es )?original|imitaci|fake|tipo nike|tipo jordan/i,
      acc: rx(C.ACCESORIOS),
      bat: /(?:bater[ií]a|salud|condici[oó]n|capacidad|\bbh\b|\bbat\b)[^\d\n]{0,30}(\d{2,3})\s*%|(\d{2,3})\s*%\s*(?:de\s*)?(?:salud|bater|capacidad|bh\b)/i,
      estados: Object.fromEntries(Object.entries(C.ESTADO_REGEX).map(([k, v]) => [k, rx(v)])),
      grupos: Object.fromEntries(Object.entries(gruposClasificacion()).map(([g, d]) => [g, { inc: rx(d.inc), exc: rx(d.exc), personal: !!d.personal }])),
    };
    return RX;
  }
  function bateria(a) {
    const m = regex().bat.exec(`${a.titulo}\n${a.descripcion}`);
    if (!m) return null;
    const v = parseInt(m[1] || m[2], 10);
    return v >= 50 && v <= 100 ? v : null;
  }
  function estadoTexto(a) {
    const t = `${a.titulo}\n${a.descripcion}`;
    for (const k of ["bloqueado", "piezas", "pantalla_rota", "trasera_rota", "otro_dano", "nuevo"]) if (regex().estados[k].test(t)) return k;
    return "usado";
  }
  function clasificar(a) {
    const t = a.titulo.toLowerCase();
    const G = regex().grupos;
    const hits = Object.entries(G).filter(([, r]) => r.inc.test(t) && !r.exc.test(t)).map(([g]) => g);
    if (hits.length <= 1) return hits[0] || null;
    // varias búsquedas propias encajan: gana la más concreta (como analizar.py)
    const delCatalogo = hits.filter((g) => !G[g].personal);
    if (delCatalogo.length === 1) return delCatalogo[0];
    if (!delCatalogo.length) {
      const palabras = (g) => normal(g).split(" ").length;
      hits.sort((x, y) => palabras(y) - palabras(x));
      if (palabras(hits[0]) > palabras(hits[1])) return hits[0];
    }
    return null;
  }
  function valido(a) {
    if (a.precio == null || a.reservado) return false;
    const g = clasificar(a);
    if (!g) return false;
    a.grupo = g;
    const def = grupo(g), cat = def.cat;
    if (a.precio < (def.minimo ?? C.PRECIO_MIN[cat])) return false;
    if (cat !== "videojuego" && regex().acc.test(a.titulo)) return false;
    if (regex().replica.test(`${a.titulo} ${a.descripcion}`)) return false;
    return true;
  }
  function calcular(a, r, cond) {
    let reparacion = 0, aEstado;
    const notas = [];
    if (a.estado === "trasera_rota") {
      const rt = C.REPARACION_TRASERA[a.grupo];
      if (!rt) return null;
      reparacion += rt; notas.push(`trasera ${rt} €`); aEstado = "usado";
    } else aEstado = a.estado;
    const bat = a.bateria;
    let factorBat = 1;
    if (r.categoria === "movil" && bat != null) {
      if (bat < C.BATERIA_MIN) {
        const cb = a.grupo.toLowerCase().startsWith("iphone") ? C.BATERIA_IPHONE : C.BATERIA_SAMSUNG;
        reparacion += cb; notas.push(`batería ${bat} % → cambio ${cb} €`);
      } else if (bat < 85) { factorBat = C.BATERIA_FACTOR_80_85; notas.push(`batería ${bat} %`); }
    }
    a.notas = notas.join(", ");
    let factor;
    if (aEstado === "pantalla_rota") {
      if (r.categoria !== "movil") return null;
      const rp = C.REPARACION_PANTALLA[a.grupo] || {};
      const vals = [rp.taller, rp.oficial].filter((x) => x);
      if (!vals.length) return null;
      const rpant = Math.min(...vals);
      reparacion += rpant; a.notas = [`pantalla ${rpant} €`, ...notas].join(", "); factor = 1;
    } else {
      factor = cond ? (cond in C.FACTOR_ESTADO ? C.FACTOR_ESTADO[cond] : 1) : 1;
      if (factor === null) return null;
      if (a.estado === "trasera_rota") factor = 1;
    }
    const base = aEstado === "nuevo" && r.mediana_nuevo && (cond == null || cond === "new") ? r.mediana_nuevo : r.mediana_usado;
    const venta = base * C.DESCUENTO_REVENTA * factor * factorBat;
    const envio = a.local ? 0 : C.COSTE_ENVIO, coste = a.precio + reparacion + envio, ben = venta - coste;
    return [ben, ben / coste, coste, venta, reparacion];
  }
  function pasa(ben, pct, local, h = 1) {
    return local ? ben >= C.MARGEN_MIN_LOCAL * h && pct >= C.MARGEN_MIN_PCT_LOCAL * h
      : ben >= C.MARGEN_MIN_ENVIO * h && pct >= C.MARGEN_MIN_PCT_ENVIO * h;
  }
  async function detalle(id, cache) {
    const c = cache[id];
    if (c && !c.error && Date.now() / 1000 - (c.ts || 0) < CACHE_HORAS * 3600) return c;
    const d = await pedir(`${API}/items/${encodeURIComponent(id)}`, 2);
    await dormir(PAUSA_MS);
    if (d === null) return { error: "red" };
    if (d.__error) return (cache[id] = { error: String(d.__error), ts: Date.now() / 1000 });
    const ta = d.type_attributes || {};
    return (cache[id] = {
      condicion: ta.condition?.value || null,
      modelo: ta.model?.text || d.characteristics?.text || null,
      caracteristicas: d.characteristics?.text || null,
      pais: d.location?.country_code || null,
      conversaciones: d.counters?.conversations ?? null,
      reservado: typeof d.reserved === "object" ? !!d.reserved?.flag : !!d.reserved,
      ts: Date.now() / 1000,
    });
  }
  const modeloFicha = (d) => (!d.modelo || d.modelo === d.caracteristicas ? null : d.modelo);

  async function analizar(anuncios, prog) {
    regex();
    let validos = anuncios.filter(valido);
    // republicados: mismo título, precio y ciudad -> el más antiguo
    const vistos = new Set(), unicos = [];
    for (const a of [...validos].sort((x, y) => (x.creado || 0) - (y.creado || 0))) {
      const k = [a.titulo.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").trim(), a.precio, a.ciudad].join("|");
      if (!vistos.has(k)) { vistos.add(k); unicos.push(a); }
    }
    const republicados = validos.length - unicos.length;
    validos = unicos;
    for (const a of validos) { a.estado = estadoTexto(a); a.local = a.km != null && a.km <= C.RADIO_LOCAL_KM; a.bateria = bateria(a); }

    // historial
    const H0 = leer("historial", { ultima: null, anuncios: {} }), hist = H0.anuncios, ultima = H0.ultima, ahora = hoyISO();
    for (const a of validos) {
      const h = hist[a.id];
      if (!h) { hist[a.id] = { p: ahora, u: ahora, precio: a.precio }; continue; }
      if (a.precio < h.precio) h.ant = h.precio; else if (a.precio > h.precio) delete h.ant;
      h.precio = a.precio; h.u = ahora;
    }

    // referencias
    const ref = {};
    for (const [g, d] of Object.entries(gruposClasificacion())) {
      const usados = sinAtipicos(validos.filter((a) => a.grupo === g && a.estado === "usado").map((a) => a.precio));
      const nuevos = sinAtipicos(validos.filter((a) => a.grupo === g && a.estado === "nuevo").map((a) => a.precio));
      if (usados.length < 10) continue;
      const med = mediana(usados), q = cuartiles(usados), venta = med * C.DESCUENTO_REVENTA;
      ref[g] = {
        categoria: d.cat, n_usado: usados.length, media_usado: redondear(mediaRecortada(usados)),
        mediana_usado: redondear(med), p25_usado: redondear(q[0]), p75_usado: redondear(q[2]),
        n_nuevo: nuevos.length, mediana_nuevo: nuevos.length >= 5 ? redondear(mediana(nuevos)) : null,
        precio_reventa: redondear(venta),
        compra_max_local: redondear(Math.min(venta - C.MARGEN_MIN_LOCAL, venta / (1 + C.MARGEN_MIN_PCT_LOCAL))),
      };
    }
    if (!Object.keys(ref).length) throw new Error("No hay suficientes anuncios para calcular precios de referencia. Activa más modelos o sube las páginas.");

    // preselección
    const pre = []; let sospechosos = 0;
    for (const a of validos) {
      const r = ref[a.grupo];
      if (!r || ["bloqueado", "piezas", "otro_dano"].includes(a.estado)) continue;
      if (!a.local && !a.envio) continue;
      if ((["usado", "nuevo"].includes(a.estado) && a.precio < 0.4 * r.mediana_usado) ||
          (a.estado === "nuevo" && r.mediana_nuevo && a.precio < 0.5 * r.mediana_nuevo)) { sospechosos++; continue; }
      const c = calcular(a, r);
      if (c && pasa(c[0], c[1], a.local, 0.8)) pre.push(a);
    }

    // verificación con la ficha
    const cache = leer("detalles", {}), descartes = {};
    let ops = [];
    for (let i = 0; i < pre.length; i++) {
      if (T.cancelar) throw new Cancelado();
      const a = pre[i];
      prog(`Comprobando ficha ${i + 1}/${pre.length}: ${a.titulo.slice(0, 40)}`, (i + 1) / Math.max(pre.length, 1));
      const d = await detalle(a.id, cache), G = regex().grupos[a.grupo];
      let motivo = null, c = null;
      if (d.error === "red") motivo = "no se pudo comprobar la ficha (red)";
      else if (d.error || d.reservado) motivo = "vendido, reservado o borrado";
      else if (d.pais && d.pais !== "ES") motivo = "fuera de España";
      else if (modeloFicha(d) && !(G.inc.test(modeloFicha(d)) && !G.exc.test(modeloFicha(d)))) motivo = "modelo real";
      else if (/\bgame\b|rpg|juego|\bvr/i.test(d.caracteristicas || "") && grupo(a.grupo).cat === "consola") motivo = "no es una consola";
      if (!motivo) {
        c = calcular(a, ref[a.grupo], d.condicion);
        if (!c) motivo = `estado ${d.condicion}`;
        else if (!pasa(c[0], c[1], a.local)) motivo = "margen insuficiente tras verificar estado";
      }
      if (motivo) { descartes[motivo] = (descartes[motivo] || 0) + 1; continue; }
      const [ben, pct, coste, venta, rep] = c, h = hist[a.id];
      ops.push({
        id: a.id, categoria: ref[a.grupo].categoria, grupo: a.grupo, titulo: a.titulo, estado: a.estado,
        condicion: d.condicion, bateria: a.bateria, notas: a.notas || "", detalle: d.caracteristicas,
        precio: a.precio, reparacion: rep, envio: a.local ? 0 : C.COSTE_ENVIO, coste_total: redondear(coste),
        precio_reventa: redondear(venta), beneficio: redondear(ben), margen_pct: redondear(pct * 100),
        km: a.km, ciudad: a.ciudad, local: a.local, conversaciones: d.conversaciones, url: a.url,
        alerta: (d.conversaciones || 0) > 300 ? "⚠️" : "", nuevo: !!ultima && h.p > ultima,
        precio_anterior: h.ant || null, visto_desde: h.p.slice(0, 10), descripcion: a.descripcion, foto: a.foto,
        envio_disponible: a.envio, reventa_base: ref[a.grupo].mediana_usado,
      });
    }
    // limpieza de caché e historial
    const lim = Date.now() / 1000 - 7 * 86400;
    for (const k of Object.keys(cache)) if ((cache[k].ts || 0) < lim) delete cache[k];
    guardar("detalles", cache);
    const limH = Date.now() - HISTORIAL_DIAS * 86400e3;
    for (const k of Object.keys(hist)) if (Date.parse(hist[k].u) < limH) delete hist[k];

    // revisión manual
    const rev = leer("revision", {}), excl = [];
    for (const o of ops) {
      o.clave = o.url.split("-").pop();
      const r = rev[o.clave];
      o.revisado = !!r;
      o.revision = r ? r.nota : "⏳ Pendiente de revisar fotos";
      if (r && r.excluir) excl.push(o);
    }
    ops = ops.filter((o) => !excl.includes(o));
    descartes["revisión manual de fotos"] = excl.length;
    ops.sort((a, b) => (b.local - a.local) || (b.nuevo - a.nuevo) || (b.beneficio - a.beneficio));
    const rotas = validos.filter((x) => x.estado === "pantalla_rota" && grupo(x.grupo).cat === "movil").length;

    const resumen = {
      fecha: ahora, ejecucion_anterior: ultima, anuncios: anuncios.length, validos: validos.length, republicados,
      preseleccion: pre.length, oportunidades: ops.length, locales: ops.filter((o) => o.local).length,
      nuevas: ops.filter((o) => o.nuevo).length, pendientes: ops.filter((o) => !o.revisado).length, sospechosos,
      descartes, moviles_pantalla_rota: rotas,
    };
    guardar("historial", { ultima: ahora, anuncios: hist });
    guardar("oportunidades", ops);
    guardar("descartados", excl);
    guardar("referencias", ref);
    guardar("resumen", resumen);
    const historico = leer("historico", []);
    historico.push({ fecha: ahora, oportunidades: ops.length, nuevas: resumen.nuevas, beneficio: ops.reduce((s, o) => s + o.beneficio, 0) });
    guardar("historico", historico.slice(-90));
    return resumen;
  }

  async function lanzar(soloAnalizar) {
    if (T.activa) throw new Error("Ya hay una búsqueda en marcha");
    if (soloAnalizar) throw new Error("En el iPhone no se guardan todos los anuncios descargados. Pulsa «Buscar ofertas ahora».");
    Object.assign(T, { activa: true, cancelar: false, error: null, inicio: hoyISO(), fin: null, fraccion: 0, log: [], fase: "Preparando", texto: "" });
    pantallaEncendida(true);
    (async () => {
      try {
        await listo;
        const anuncios = await recoger(progreso("Descargando anuncios", 0, 0.8));
        await analizar(anuncios, progreso("Analizando y comprobando fichas", 0.8, 0.2));
        Object.assign(T, { fase: "Terminado", texto: "Búsqueda completada", fraccion: 1 });
      } catch (e) {
        if (e instanceof Cancelado) Object.assign(T, { fase: "Cancelado", error: "Búsqueda cancelada. Se conservan los resultados anteriores." });
        else Object.assign(T, { fase: "Error", error: e.message || String(e) });
      } finally {
        T.activa = false; T.fin = hoyISO(); pantallaEncendida(false);
      }
    })();
  }
  document.addEventListener("visibilitychange", () => {
    if (T.activa && document.visibilityState === "hidden")
      T.log.push("⚠️ Has salido de la app: la búsqueda se pausa hasta que vuelvas.");
    if (T.activa && document.visibilityState === "visible") pantallaEncendida(true);
  });

  // ---------------------------------------------------------------- API para la interfaz
  const minutos = () => {
    const n = Object.keys(gruposActivos()).length, p = +C.PAGINAS || 2;
    return Math.max(1, redondear((n * (3 * p + Math.min(2, p)) * 1.2) / SIMULTANEAS / 60));
  };
  const OPS_CAMPOS = ["id", "articulo", "categoria", "estado", "fecha_compra", "precio_compra", "gastos", "fecha_venta", "precio_venta", "comision", "url", "notas"];
  const NUMERICOS = ["LAT", "LON", "RADIO_LOCAL_KM", "PAGINAS", "MARGEN_MIN_LOCAL", "MARGEN_MIN_PCT_LOCAL", "MARGEN_MIN_ENVIO",
    "MARGEN_MIN_PCT_ENVIO", "COSTE_ENVIO", "DESCUENTO_REVENTA", "BATERIA_IPHONE", "BATERIA_SAMSUNG", "BATERIA_MIN"];

  const rutas = {
    "/api/estado": () => ({
      version: DEFECTO.VERSION, local: true, tarea: { ...T, log: T.log.slice(-12) }, resumen: leer("resumen", null),
      ubicacion: C.UBICACION_NOMBRE, radio: C.RADIO_LOCAL_KM, carpeta: "este iPhone (almacenamiento de la app)",
      programacion: { disponible: false, activa: false, motivo: "en el iPhone la búsqueda se hace con la app abierta. Ábrela, pulsa «Buscar ofertas» y deja la pantalla encendida unos minutos" },
      minutos_estimados: minutos(),
    }),
    "/api/oportunidades": () => ({ oportunidades: leer("oportunidades", []), descartados: leer("descartados", []) }),
    "/api/referencias": () => Object.entries(leer("referencias", {})).map(([grupo, r]) => ({ grupo, ...r })),
    "/api/ficha": async (q) => {
      const d = await pedir(`${API}/items/${encodeURIComponent(q.id)}`, 2);
      if (!d) throw new Error("No hay conexión con Wallapop");
      if (d.__error) return { disponible: false, error: `El anuncio ya no está disponible (${d.__error})` };
      const tx = (v) => (v && typeof v === "object" ? v.original || v.translated : v);
      const ta = d.type_attributes || {}, pr = d.price || {};
      return {
        disponible: true, titulo: tx(d.title), descripcion: tx(d.description),
        precio: typeof pr.cash === "object" ? pr.cash.amount : pr.amount,
        condicion_clave: ta.condition?.value, condicion: ta.condition?.text,
        fotos: (d.images || []).map((im) => im.urls?.big || im.urls?.medium),
        caracteristicas: d.characteristics?.text, visitas: d.counters?.views, favoritos: d.counters?.favorites,
        conversaciones: d.counters?.conversations, reservado: typeof d.reserved === "object" ? !!d.reserved?.flag : !!d.reserved,
        ciudad: d.location?.city,
      };
    },
    "/api/ajustes": () => ({
      ajustes: Object.fromEntries(DEFECTO.EDITABLES.map((k) => [k, C[k]])),
      defecto: Object.fromEntries(DEFECTO.EDITABLES.map((k) => [k, DEFECTO[k]])),
    }),
    "POST /api/ajustes": (b) => {
      const nuevos = {};
      for (const [k, v0] of Object.entries(b.ajustes || {})) {
        if (!DEFECTO.EDITABLES.includes(k)) continue;
        let v = v0;
        if (NUMERICOS.includes(k)) { v = Number(v); if (isNaN(v)) throw new Error(`El valor de ${k} no es un número`); if (k === "RADIO_LOCAL_KM" || k === "PAGINAS") v = redondear(v); }
        nuevos[k] = v;
      }
      if ("PAGINAS" in nuevos && !(nuevos.PAGINAS >= 1 && nuevos.PAGINAS <= 10)) throw new Error("Las páginas por búsqueda deben estar entre 1 y 10");
      if ("RADIO_LOCAL_KM" in nuevos && !(nuevos.RADIO_LOCAL_KM >= 1 && nuevos.RADIO_LOCAL_KM <= 200)) throw new Error("El radio debe estar entre 1 y 200 km");
      guardar("ajustes", { ...leer("ajustes", {}), ...nuevos });
      aplicarAjustes(); RX = null;
      return rutas["/api/ajustes"]();
    },
    "/api/busqueda": () => {
      const ref = leer("referencias", {}), t = top5();
      return {
        modo: C.BUSQUEDA_MODO, texto: C.BUSQUEDA_TEXTO,
        terminos: terminos().map((x) => ({ texto: x, modelo: modeloConocido(x), categoria: grupoPersonal(x)[1].cat })),
        top5: t.top.map((a) => ({ articulo: a.articulo, motivos: a.motivos || [], puntuacion: a.puntuacion,
          modelos: a.modelos.map((g) => ({ nombre: g, compra_max: ref[g]?.compra_max_local ?? null, rotacion: (a.rotaciones || {})[g] ?? null })) })),
        top5_fecha: t.fecha, top5_origen: t.origen, activos: Object.keys(gruposActivos()), catalogo: Object.keys(C.GRUPOS), minutos: minutos(),
        alias: Object.fromEntries(Object.entries(C.GRUPOS).flatMap(([g, d]) => [normal(g), normal(d.q), quitaConsola(normal(d.q))].map((k) => [k, g]))),
      };
    },
    "POST /api/busqueda": (b) => {
      if (!["top5", "personal"].includes(b.modo)) throw new Error("Elige «Top 5» o «Lo que yo escriba»");
      if (b.modo === "personal" && !String(b.texto || "").split(/[,;\n]+/).some((t) => t.trim()))
        throw new Error("Escribe al menos un artículo (por ejemplo: iPhone 13 Pro, PS5 Slim)");
      guardar("ajustes", { ...leer("ajustes", {}), BUSQUEDA_MODO: b.modo, BUSQUEDA_TEXTO: String(b.texto || "").slice(0, 2000) });
      aplicarAjustes(); RX = null;
      return rutas["/api/busqueda"]();
    },
    "POST /api/restablecer": () => { guardar("ajustes", {}); aplicarAjustes(); RX = null; return rutas["/api/ajustes"](); },
    "POST /api/buscar": async (b) => { await lanzar(!!b.solo_analizar); return { ...T }; },
    "POST /api/cancelar": () => { T.cancelar = true; return { ok: true }; },
    "POST /api/revision": (b) => {
      const clave = String(b.clave || ""); if (!clave) throw new Error("Falta el anuncio");
      const rev = leer("revision", {});
      let nota, revisado;
      if (b.borrar) { delete rev[clave]; nota = "⏳ Pendiente de revisar fotos"; revisado = false; }
      else {
        const excluir = !!b.excluir;
        nota = (b.nota || "").trim() || (excluir ? "Descartado al revisar" : "Revisado: correcto");
        rev[clave] = { excluir, nota, fecha: hoyISO().slice(0, 10) }; revisado = true;
      }
      guardar("revision", rev);
      const todos = [...leer("oportunidades", []), ...leer("descartados", [])];
      for (const o of todos) if (o.clave === clave) { o.revision = nota; o.revisado = revisado; }
      const fuera = (o) => rev[o.clave]?.excluir;
      guardar("oportunidades", todos.filter((o) => !fuera(o)));
      guardar("descartados", todos.filter(fuera));
      return { ok: true };
    },
    "POST /api/geocodificar": async (b) => {
      const t = (b.texto || "").trim(); if (!t) throw new Error("Escribe una población");
      const r = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ q: t, format: "json", limit: 5, countrycodes: "es" }))
        .catch(() => null);
      if (!r || !r.ok) throw new Error("No se pudo buscar la población. Puedes escribir latitud y longitud a mano.");
      return (await r.json()).map((x) => ({ nombre: x.display_name, lat: +x.lat, lon: +x.lon }));
    },
    "POST /api/calcular": (b) => {
      const ref = leer("referencias", {}), r = ref[b.grupo];
      if (!r) throw new Error("No hay precio de referencia para ese modelo todavía. Haz una búsqueda primero.");
      const a = { grupo: b.grupo, precio: +b.precio || 0, estado: b.estado || "usado", local: b.local !== false,
        bateria: String(b.bateria || "").trim() ? parseInt(b.bateria, 10) : null };
      if (a.precio <= 0) throw new Error("Escribe el precio del anuncio");
      const c = calcular(a, r, b.condicion || null);
      if (!c) return { ok: false, motivo: "No se puede calcular: falta el coste de reparación para este modelo o el estado indica que no merece la pena («lo ha dado todo»)." };
      const [ben, pct, coste, venta, rep] = c, extra = coste - a.precio;
      const maximo = (a.local ? Math.min(venta - C.MARGEN_MIN_LOCAL, venta / (1 + C.MARGEN_MIN_PCT_LOCAL))
        : Math.min(venta - C.MARGEN_MIN_ENVIO, venta / (1 + C.MARGEN_MIN_PCT_ENVIO))) - extra;
      return { ok: true, beneficio: redondear(ben), margen: redondear(pct * 100), coste: redondear(coste), reventa: redondear(venta),
        reparacion: rep, notas: a.notas || "", cumple: pasa(ben, pct, a.local), precio_max: redondear(maximo),
        mediana: r.mediana_usado, p25: r.p25_usado, p75: r.p75_usado, n: r.n_usado };
    },
    "/api/operaciones": () => leer("operaciones", []),
    "POST /api/operaciones": (b) => {
      let ops = leer("operaciones", []);
      if (b.accion === "borrar") ops = ops.filter((o) => o.id !== b.id);
      else {
        const op = Object.fromEntries(OPS_CAMPOS.map((k) => [k, (b.op || {})[k] ?? null]));
        if (!String(op.articulo || "").trim()) throw new Error("Escribe qué artículo es");
        for (const k of ["precio_compra", "gastos", "precio_venta", "comision"]) op[k] = String(op[k] ?? "").trim() ? +op[k] : null;
        if (!op.id) { op.id = Math.random().toString(16).slice(2, 12); ops.push(op); }
        else ops = ops.map((o) => (o.id === op.id ? op : o));
      }
      guardar("operaciones", ops);
      return ops;
    },
    "POST /api/programar": () => { throw new Error("En el iPhone no se puede programar la búsqueda: hazla con la app abierta."); },
    "POST /api/salir": () => ({ ok: true }),
  };

  // ---------------------------------------------------------------- copias y exportaciones
  function compartirArchivo(nombre, texto, tipo) {
    const archivo = new File([texto], nombre, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) return navigator.share({ files: [archivo], title: nombre });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(archivo); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    return Promise.resolve();
  }
  function csvOperaciones() {
    const num = (x) => (x == null || x === "" ? "" : String(x).replace(".", ","));
    const filas = [["Artículo", "Categoría", "Estado", "Fecha compra", "Precio compra", "Gastos", "Fecha venta", "Precio venta", "Comisión", "Beneficio", "Enlace", "Notas"]];
    for (const o of leer("operaciones", [])) {
      const ben = o.precio_venta == null ? "" : o.precio_venta - (o.precio_compra || 0) - (o.gastos || 0) - (o.comision || 0);
      filas.push([o.articulo, o.categoria, o.estado, o.fecha_compra, num(o.precio_compra), num(o.gastos), o.fecha_venta, num(o.precio_venta), num(o.comision), num(ben), o.url, o.notas]);
    }
    return "﻿" + filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  }
  const CLAVES_COPIA = ["ajustes", "revision", "operaciones", "historial", "oportunidades", "descartados", "referencias", "resumen", "historico"];
  function exportarCopia() {
    const datos = { app: "CompraVenta", version: DEFECTO.VERSION, fecha: hoyISO() };
    for (const k of CLAVES_COPIA) datos[k] = leer(k, null);
    return compartirArchivo(`CompraVenta-copia-${hoyISO().slice(0, 10)}.json`, JSON.stringify(datos), "application/json");
  }
  async function importarCopia(file) {
    const d = JSON.parse(await file.text());
    if (d.app !== "CompraVenta") throw new Error("Ese archivo no es una copia de CompraVenta");
    for (const k of CLAVES_COPIA) if (d[k] != null) guardar(k, d[k]);
    aplicarAjustes(); RX = null;
  }

  window.MOTOR = {
    async api(ruta, cuerpo) {
      await listo;
      const u = new URL(ruta, location.href), clave = (cuerpo === undefined ? "" : "POST ") + u.pathname;
      const fn = rutas[clave];
      if (!fn) throw new Error("Función no disponible en el iPhone");
      return fn(cuerpo === undefined ? Object.fromEntries(u.searchParams) : cuerpo);
    },
    exportarOperaciones: () => compartirArchivo("mis_operaciones.csv", csvOperaciones(), "text/csv"),
    exportarCopia, importarCopia,
    _interno: { gruposClasificacion, redondear, cuartiles, mediana, sinAtipicos, calcular, valido, estadoTexto, bateria, clasificar, config: () => C },
  };
})();
