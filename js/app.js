// =======================================================
// SISTEMA DE BINGO - APP.JS (Conectado a Backend)
// =======================================================
const API_URL = `http://${location.hostname}:5500/api`;
let currentUser = null;

// Map of previously approved winners: key = carton code (string) => { ronda, usuario }
let _ganadoresAprobadosMap = new Map();

function applyDisabledWinnersToRenderedCartones() {
  try {
    document.querySelectorAll('.bingo-card').forEach(card => {
      const header = card.querySelector('.carton-number');
      if (!header) return;
      const match = header.textContent.match(/(\d{1,3})/);
      const code = match ? String(Number(match[1])).padStart(3, '0') : null;
      if (!code) return;
      if (_ganadoresAprobadosMap.has(String(code))) {
        const info = _ganadoresAprobadosMap.get(String(code));
        // Visual: sombrear y deshabilitar interacciones
        header.classList.remove('bg-yellow-600');
        header.classList.add('bg-gray-500');
        header.textContent = `Cartón ganador (Ronda ${info.ronda || '—'})`;
        card.classList.add('carton-disabled', 'opacity-60');
        card.style.pointerEvents = 'none';
        const bingoBtn = card.querySelector('button');
        if (bingoBtn) { bingoBtn.disabled = true; bingoBtn.classList.add('opacity-50', 'cursor-not-allowed'); }
        // marcar celdas visualmente
        card.querySelectorAll('td').forEach(td => {
          td.classList.remove('cursor-pointer', 'hover:bg-yellow-200', 'hover:scale-105');
          td.classList.add('bg-gray-200', 'text-gray-500');
        });
      }
    });
  } catch (err) { console.warn('applyDisabledWinnersToRenderedCartones error:', err); }
}

// Speech: seleccionar voz femenina alegre y reproducir ping antes de leer el número
let _preferredSpeechVoice = null;
function populateSpeechVoices() {
  try {
    const choose = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return;

      // Preferir voces en español y que parezcan femeninas y alegres
      const femaleNameRegex = /\b(Maria|María|Sofia|Sofía|Lucia|Lucía|Helena|Laura|Isabella|Isabel|Marta|Ana|Andrea|Sonia|Monica|Mónica|Carla|Catalina|Carmen|Luciana|Valeria|Alejandra)\b/i;
      const cheerfulRegex = /\b(happy|alegr|joy|cheer|bright|wave|neural|wavenet|google)\b/i;

      // 1) voces 'es' con nombre femenino y que parezcan naturales/Google WaveNet
      let v = voices.find(vo => /^es\b/i.test(vo.lang) && femaleNameRegex.test(vo.name) && cheerfulRegex.test(vo.name));
      // 2) voces 'es' con nombre femenino
      if (!v) v = voices.find(vo => /^es\b/i.test(vo.lang) && femaleNameRegex.test(vo.name));
      // 3) voces 'es' con indicadores de calidad (Google/WaveNet/Neural)
      if (!v) v = voices.find(vo => /^es\b/i.test(vo.lang) && cheerfulRegex.test(vo.name));
      // 4) cualquier voz 'es'
      if (!v) v = voices.find(vo => /^es\b/i.test(vo.lang));
      // 5) voz femenina general
      if (!v) v = voices.find(vo => femaleNameRegex.test(vo.name));
      // 6) voice with cheerful keywords
      if (!v) v = voices.find(vo => cheerfulRegex.test(vo.name));
      // 7) último recurso: la primera disponible
      if (!v && voices.length) v = voices[0];

      _preferredSpeechVoice = v || null;
      if (_preferredSpeechVoice) console.log('TTS voice selected:', _preferredSpeechVoice.name, _preferredSpeechVoice.lang);
    };

    choose();
    window.speechSynthesis.onvoiceschanged = choose;
  } catch (err) {
    console.warn('populateSpeechVoices error:', err);
  }
}

// Reproducir un ping corto con Web Audio API
function playPing({ frequency = 960, durationMs = 120, type = 'sine' } = {}) {
  return new Promise((resolve) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return resolve();
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.value = 0.0001; // evitar click
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
      osc.start(now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (durationMs / 1000));
      setTimeout(() => {
        try { osc.stop(); } catch(e){}
        try { ctx.close(); } catch(e){}
        resolve();
      }, durationMs + 20);
    } catch (err) {
      console.warn('playPing error:', err);
      resolve();
    }
  });
}

// Hablar el número o texto: acepta número, texto o payload { text, rate, pitch, ping }
async function speakNumber(input, opts = {}) {
  try {
    if (!('speechSynthesis' in window)) return;

    let text = '';
    let rate = opts.rate ?? 1.05;
    let pitch = opts.pitch ?? 1.35;
    const ping = typeof opts.ping === 'boolean' ? opts.ping : true;

    if (typeof input === 'number' || (/^\d+$/.test(String(input)))) {
      const num = Number(input);
      const letra = typeof getBingoLetter === 'function' ? getBingoLetter(num) : '';
      text = `${letra ? `¡${letra} ${num}!` : `¡${num}!`}`.replace(/\x01\x01/, '');
    } else if (typeof input === 'string') {
      text = input;
    } else if (input && input.text) {
      text = input.text;
      rate = input.rate ?? rate;
      pitch = input.pitch ?? pitch;
    } else {
      text = String(input);
    }

    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1.0;
    if (_preferredSpeechVoice) {
      u.voice = _preferredSpeechVoice;
      if (_preferredSpeechVoice.lang) u.lang = _preferredSpeechVoice.lang;
    }

    if (ping) {
      try { await playPing({ frequency: 960, durationMs: 120 }); } catch (e) { /* ignore */ }
    }

    try { window.speechSynthesis.cancel(); } catch (e) {}
    window.speechSynthesis.speak(u);
  } catch (err) {
    console.warn('speakNumber error:', err);
  }
}

// Mapa para evitar mostrar el mismo mensaje de "X se unió" varias veces
const recentJoinShown = new Map();

function markJoinShown(id, ttl = 8000) {
  if (!id) return;
  recentJoinShown.set(id, true);
  setTimeout(() => recentJoinShown.delete(id), ttl);
}

function showTemporaryGlobalMessage(text, ttl = 6000) {
  const marquee = document.getElementById('rank-marquee');
  if (!marquee) return;
  const prev = marquee.innerHTML;
  marquee.textContent = text;
  // Restaurar ticker/valor previo pasados ttl ms
  setTimeout(() => {
    try { renderRankTicker(); } catch (e) { marquee.innerHTML = prev; }
  }, ttl);
}

// =========================
// AUTH
// =========================
async function registrarUsuario(nombre, cedula, telefono, password, genero, f_nacimiento) {
  const res = await fetch(`${API_URL}/usuarios/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, cedula, telefono, password, genero, f_nacimiento })
  });
  return res.json();
}

async function loginUsuario(cedula, password) {
  try {
    const res = await fetch(`${API_URL}/usuarios/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cedula, password })
    });

    console.log("Login response (raw):", res);

    const data = await res.json();
    console.log("Parsed login data:", data);

    // ✅ Caso 1: Si el backend devuelve directamente los datos del usuario
    if (data && data.id && data.nombre) {
      // Guardamos los datos del usuario en localStorage
      localStorage.setItem("usuario", JSON.stringify(data)); 
      console.log("💾 Usuario guardado en localStorage:", data);

      // Llamamos a una función para actualizar el estado de la barra de navegación
      aplicarPermisos();
      return { success: true, usuario: data };
    }

    // ❌ Si no se recibe una respuesta correcta, mostrar un error
    alert("❌ Error al iniciar sesión: respuesta inesperada del servidor");
    console.error("Respuesta inesperada:", data);
    return null;
  } catch (err) {
    console.error("❌ Error en loginUsuario:", err);
    alert("No se pudo conectar con el servidor");
    return null;
  }
}

// -------------------------
// Wrapper seguro para login
// Inserta esto justo después de la función loginUsuario (antes de usar loginUsuario)
// -------------------------

(function wrapLogin() {
  const originalLogin = window.loginUsuario;

  window.loginUsuario = async function (...args) {
    let result = null;

    if (typeof originalLogin === "function") {
      // Llamar la implementación existente
      result = await originalLogin.apply(this, args);
    } else {
      // Fallback: si por alguna razón no existe, hacemos la petición directamente
      try {
        const [cedula, password] = args;
        const res = await fetch(`${API_URL}/usuarios/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cedula, password }),
        });
        result = res.ok ? await res.json() : null;
      } catch (err) {
        result = null;
      }
    }

    // Si el login devolvió usuario, actualizar currentUser, localStorage y UI
    if (result && (result.user || result.usuario || result.id || result.nombre)) {
      currentUser = result.user || result.usuario || result;
      try { localStorage.setItem("usuario", JSON.stringify(currentUser)); } catch (e) {}
      // MARCAR ONLINE (insertado)
      try { await markLoggedIn(currentUser.id); } catch (e) { console.warn("markLoggedIn error:", e); }

      // Notificar al servidor vía WebSocket para broadcast a otros clientes
      try {
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
          const ts = Date.now();
          const payload = {
            type: "usuario_unido",
            usuario_id: currentUser.id,
            nombre: currentUser.nombre || currentUser.name || null,
            ts
          };
          // mostrar localmente al que se loguea: Bienvenido
          const joinId = `${payload.usuario_id}:${payload.ts}`;
          markJoinShown(joinId); // evita duplicado al recibir el rebroadcast
          showTemporaryGlobalMessage(`Bienvenido, ${payload.nombre || "Jugador"}!`);
          // enviar al servidor (que debe rebroadcast a todos)
          window.socket.send(JSON.stringify(payload));
        }
      } catch (e) { console.warn("ws send usuario_unido falló:", e); }

      try { setUserStatusBar(currentUser); } catch (e) {}
      try { renderRankTicker(); } catch (e) {}
    } else {
      // En caso de fallo asegúrate de limpiar currentUser
      // (no sobreescribe si el resultado es un objeto válido)
    }

    return result;
  };
})();

// 🔐 Aplicar permisos según el rol del usuario logueado
async function aplicarPermisos() {
  try {
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    const usuario_id = usuario ? usuario.id : null;

    if (!usuario_id) {
      console.warn("⚠️ No se encontró un usuario logueado.");
      return;
    }

    //console.log("🧩 Aplicando permisos para usuario ID:", usuario_id);

    // 1️⃣ Obtener el rol del usuario
    const rolRes = await fetch(`${API_URL}/permisos/usuarios/${usuario_id}/rol`);
    if (!rolRes.ok) throw new Error("No se pudo obtener el rol del usuario");
    const { rol_id, rol_nombre } = await rolRes.json();
    //console.log("👤 Rol detectado:", rol_nombre);

    // 2️⃣ Obtener los permisos del rol
    const permRes = await fetch(`${API_URL}/permisos/rol/${rol_id}`);
    if (!permRes.ok) throw new Error("No se pudieron obtener los permisos del rol");
    const permisos = await permRes.json();
    //console.log("🔑 Permisos del rol:", permisos);

    // 🔧 Pestañas
    const ocultarPestaña = (tabName) => {
      const tabButton = document.querySelector(`.tab-button[data-tab='${tabName}']`);
      const tabContent = document.getElementById(`tab-${tabName}`);
      if (tabButton) tabButton.classList.add("hidden");
      if (tabContent) tabContent.classList.add("hidden");
    };

      if (!permisos.includes("ver_configuracion")) {
        ocultarPestaña("configuracion");
      }

      if (!permisos.includes("ver_cartones")) {
        ocultarPestaña("cartones");
      }

      if (!permisos.includes("ver_Perfil")) {
        ocultarPestaña("user-profile");
      }

      if (!permisos.includes("ver_Programar_rondas")) {
        ocultarPestaña("rondas-programadas");
      }

      if (!permisos.includes("ver_Calculo")) {
        ocultarPestaña("calculo");
      }

      if (!permisos.includes("ver_pestaña_admin")) {
        ocultarPestaña("admin-panel");
      }

      if (!permisos.includes("ver_user_panel")) {
        ocultarPestaña("user-panel");
      }

      if (!permisos.includes("ver_comprobante")) {
        ocultarPestaña("vouchers");
      }

    const ocultarPestañaInterna = (selector) => {
      const boton = document.querySelector(`.config-tab-btn[data-target='${selector}']`);
      const contenido = document.querySelector(selector);
      if (boton) boton.classList.add("hidden");
      if (contenido) contenido.classList.add("hidden");
    };

      const pestañasInternas = [
        { permiso: "ver_config_whatsapp", selector: "#config-whatsapp" },
        { permiso: "ver_config_telegram", selector: "#config-Telegram" },
        { permiso: "ver_config_juego", selector: "#config-juego" },
        { permiso: "ver_config_permisos", selector: "#config-permisos" },
      ];

      let visibles = 0;

      pestañasInternas.forEach(({ permiso, selector }) => {
        if (!permisos.includes(permiso)) {
          ocultarPestañaInterna(selector);
        } else {
          visibles++;
        }
      });

      // 🔒 Si ninguna pestaña interna está visible, ocultar la pestaña principal de configuración
      if (visibles === 0) {
        ocultarPestaña("configuracion"); // Usa tu función existente
      }


    // 🔧 Botones
    if (!permisos.includes("subir_comprobante")) {
      const btn = document.getElementById("btnSubirComprobante");
      if (btn) {
        btn.disabled = true;
        btn.classList.add("opacity-50", "cursor-not-allowed");
      }
    }

    // 🔧 Paneles
    if (!permisos.includes("botonCartones")) {
      const panelProgreso = document.getElementById("botonCartones");
      if (panelProgreso) {
        panelProgreso.classList.add("hidden");
      }
    }  

    if (!permisos.includes("Ver_progreso_funciones")) {
      const panelProgreso = document.getElementById("Progreso");
      if (panelProgreso) {
        panelProgreso.classList.add("hidden");
      }
    }  
      
    //console.log("✅ Permisos aplicados correctamente al usuario:", rol_nombre);

    // Iniciar verificación automática si el usuario es admin/moderador
    try { startAutoVerifyIfAdmin(); } catch (e) { /* no-op */ }

  } catch (err) {
    console.error("❌ Error aplicando permisos:", err);
  }
}

// =========================
async function crearCarton(usuario_id, ronda_id, numeros) {
  const res = await fetch(`${API_URL}/cartones`, {
    
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario_id, ronda_id, numeros })
  });
  return res.json();
}

async function obtenerCartonesPorUsuario(usuario_id) {
  const res = await fetch(`${API_URL}/cartones?usuario_id=${usuario_id}`);
  return res.json();
}

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const user = JSON.parse(localStorage.getItem("usuario"));

  const nombre = document.getElementById("profile-nombres").value.trim();
  const cedula = document.getElementById("profile-cedula").value.trim();
  const telefono = document.getElementById("profile-telefono").value.trim();
  const genero = document.getElementById("profile-genero").value.trim();
  const f_nacimiento = document.getElementById("profile-fnac").value.trim(); // 👈 nuevo

  if (!nombre || !cedula || !telefono || !genero || !f_nacimiento) {
    alert("⚠️ Todos los campos son obligatorios.");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/usuarios/update/${user.cedula}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, cedula, telefono, genero, f_nacimiento })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    localStorage.setItem("usuario", JSON.stringify(data));

    alert("✅ Datos guardados correctamente.");
  } catch (err) {
    console.error("❌ Error al guardar perfil:", err.message);
    alert("Error al guardar los datos. Ver consola.");
  }
});


// =========================
// UI HELPERS
// =========================

// showGameScreen: detailed async implementation exists later; keep that as canonical implementation.

function showMessage(elementId, message, isError = false) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.className = `mt-4 p-4 rounded-lg text-sm text-center font-medium w-full max-w-md ${isError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`;
  element.classList.remove('hidden');
}

// simple escape
function escapeHtml(str){ return String(str || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// --------- Players list (left sidebar) ---------

// renderPlayersList: muestra los usuarios que se le pasen (no actualiza el contador)
function renderPlayersList(players = []) {
  const container = document.getElementById('dashboard-players-list');
  if (!container) return;
  container.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `<div class="font-semibold text-gray-100">${escapeHtml(p.nombre)}</div>`;
    container.appendChild(div);
  });
}

// Obtener y renderizar la lista de usuarios logueados (usa backend)
async function refreshOnlinePlayersList() {
  try {
    const res = await fetch(`${API_URL}/usuarios_logueados/list`);
    if (!res.ok) {
      renderPlayersList([]);
      updatePlayersCount(0);
      return;
    }

    const json = await res.json();
    const rows = Array.isArray(json.rows) ? json.rows : [];

    // rows = [{ usuario_id, nombre }]
    renderPlayersList(
      rows.map(r => ({
        nombre: r.nombre || r.nombre_completo || `Usuario ${r.usuario_id}`
      }))
    );

    updatePlayersCount(rows.length);

  } catch (err) {
    console.warn("refreshOnlinePlayersList error:", err);
    renderPlayersList([]);
    updatePlayersCount(0);
  }
}

// Marcar usuario online/offline (unified implementation)
async function markLoggedIn(usuarioId) {
  if (!usuarioId) return;
  try {
    await fetch(`${API_URL}/usuarios_logueados/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: usuarioId, user_agent: navigator.userAgent })
    });
    // refrescar contador y lista visible
    refreshPlayersCount();
    refreshOnlinePlayersList();
  } catch (e) { console.warn("markLoggedIn error:", e); }
}

async function markLoggedOut(usuarioId) {
  if (!usuarioId) return;
  try {
    await fetch(`${API_URL}/usuarios_logueados/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: usuarioId })
    });
    refreshPlayersCount();
    refreshOnlinePlayersList();

    // If user was an admin/mod we may have an auto-verify running — stop it
    try { stopAutoVerify(); } catch (e) {}
  } catch (e) { console.warn("markLoggedOut error:", e); }
} 


// =======================================================
// 🔢 CONTADOR INDIVIDUAL (si el servidor lo ofrece)
// =======================================================
function updatePlayersCount(count) {
  const el = document.getElementById('players-count');
  if (el) el.textContent = String(count);
}

function updateRanking(items = []) {
  // items = [{ nombre:'Ana', rondas: 3, estado:'Jugando', ganador:false }, ...]
  const marquee = document.getElementById('rank-marquee');
  if (!marquee) return;
  if (!items.length) {
    marquee.innerHTML = `<span class="text-gray-400">No hay datos de ranking</span>`;
    return;
  }
  // Construir línea separada por bullets
  const html = items.map(it => {
    const pct = it.pct !== undefined ? `${it.pct}%` : '';
    return `<span class="inline-block px-4">🏆 ${escapeHtml(it.nombre)} • Rondas: ${it.rondas || 0} ${pct} <span class="text-yellow-300">| ${it.estado||''}</span></span>`;
  }).join(' • ');
  marquee.innerHTML = `<span class="animate-marquee">${html}</span>`;
}

// =======================================================
// 🔄 REFRESCO DESDE ENDPOINT count
// =======================================================
async function refreshPlayersCount() {
  try {
    const res = await fetch(`${API_URL}/usuarios_logueados/count`);
    const json = await res.json();
    updatePlayersCount(json.count ?? 0);
  } catch (err) {
    console.warn("refreshPlayersCount error:", err);
  }
}

// markLoggedIn/markLoggedOut: unified implementation is defined above to avoid duplicates.

// Heartbeat periódico mientras la pestaña esté abierta (mantener presencia en DB)
setInterval(() => {
  try {
    const u = JSON.parse(localStorage.getItem("usuario"));
    if (u?.id) {
      fetch(`${API_URL}/usuarios_logueados/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_id: u.id, user_agent: navigator.userAgent })
      }).catch(()=>{});
    }
  } catch (e) {}
}, 30000);

// --------- Auth modal behavior ---------
const btnOpenLogin = document.getElementById('btn-open-login');
const authModal = document.getElementById('auth-modal');
const authOverlay = document.getElementById('auth-modal-overlay');
const authClose = document.getElementById('auth-modal-close');
const showRegister = document.getElementById('show-register');
const showLogin = document.getElementById('show-login');

function openAuthModal() {
  authModal.classList.remove('hidden');
  authOverlay.classList.remove('hidden');
}
function closeAuthModal() {
  authModal.classList.add('hidden');
  authOverlay.classList.add('hidden');
  // reset to login view
  document.getElementById('auth-login').classList.add('hidden');
  document.getElementById('auth-register').classList.add('hidden');
}

if (btnOpenLogin) btnOpenLogin.addEventListener('click', openAuthModal);
if (authClose) authClose.addEventListener('click', closeAuthModal);
if (authOverlay) authOverlay.addEventListener('click', closeAuthModal);
if (showRegister) showRegister.addEventListener('click', () => {
  document.getElementById('auth-login').classList.add('hidden');
  document.getElementById('auth-register').classList.remove('hidden');
});
if (showLogin) showLogin.addEventListener('click', () => {
  document.getElementById('auth-login').classList.remove('hidden');
  document.getElementById('auth-register').classList.add('hidden');
});

// Simple handlers for submit (wire to your endpoints)
document.getElementById('login-submit')?.addEventListener('click', async () => {
  const ced = document.getElementById('login-cedula').value.trim();
  const pass = document.getElementById('login-password').value;
  if (!ced || !pass) return alert('Complete cédula y contraseña');
  try {
    const r = await fetch(`${API_URL}/usuarios/login`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ cedula: ced, password: pass })
    });
    const data = await r.json();
    console.log("Parsed login data:", data);

    if (data && data.id && data.nombre) {
      // Guardamos los datos del usuario en localStorage
      localStorage.setItem("usuario", JSON.stringify(data));
      console.log("💾 Usuario guardado en localStorage:", data);

      // Marcar usuario como online en backend
      try { await markLoggedIn(data.id); } catch (e) { console.warn("markLoggedIn falló:", e); }

      // Llamamos a una función para actualizar el estado de la barra de navegación
      aplicarPermisos();
      return { success: true, usuario: data };
    }

    // ❌ Si no se recibe una respuesta correcta, mostrar un error
    alert("❌ Error al iniciar sesión: respuesta inesperada del servidor");
    console.error("Respuesta inesperada:", data);
    return null;
  } catch (err) {
    console.error("❌ Error en loginUsuario:", err);
    alert("No se pudo conectar con el servidor");
    return null;
  }
});

document.getElementById('register-submit')?.addEventListener('click', async () => {
  const nombre = document.getElementById('reg-nombre').value.trim();
  const cedula = document.getElementById('reg-cedula').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!nombre||!cedula||!telefono||!password) return alert('Complete todos los campos');
  try {
    const r = await fetch(`${API_URL}/usuarios/register`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ nombre, cedula, telefono, password })
    });
    const data = await r.json();
    if (!r.ok) return alert(data.error || 'Error al registrar');
    closeAuthModal();
    alert('Registro exitoso. Por favor inicie sesión.');
  } catch(err){ console.error(err); alert('Error de conexión'); }
});

// Auth modal handlers are attached using addEventListener above to avoid duplicate handlers and ensure consistent behavior across the app.

// =======================================================
//  🔌 Esperar a que el WebSocket esté listo antes de enviar eventos
// =======================================================
function waitForWS() {
  return new Promise(resolve => {
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
      return resolve();
    }
    const interval = setInterval(() => {
      if (window.socket?.readyState === WebSocket.OPEN) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

// =======================================================
//  🔐 LOGIN — CORREGIDO Y GARANTIZADO PARA PRESENCIA EN TIEMPO REAL
// =======================================================
document.getElementById("login-button").addEventListener("click", async () => {
  const cedula = document.getElementById("login-cedula").value.trim();
  const password = document.getElementById("login-password").value.trim();

  const data = await loginUsuario(cedula, password);

  if (data && data.success && data.usuario) {

    // -------------------------------
    // 1️⃣ Guardar usuario e iniciar sesión en backend
    // -------------------------------
    const usuario = data.usuario;
    currentUser = usuario;

    try { localStorage.setItem("usuario", JSON.stringify(usuario)); } catch (e) {}
    try { await markLoggedIn(usuario.id); } catch (e) {
      console.warn("markLoggedIn falló:", e);
    }

    // -------------------------------
    // 2️⃣ Iniciar correctamente el WebSocket
    // -------------------------------
    await initWebSocket();  // Garantizamos conexión
    await waitForWS();      // Esperamos a que esté OPEN

    // -------------------------------
    // 3️⃣ Enviar evento WS de "usuario_unido"
    // -------------------------------
    try {
      const ts = Date.now();
      const joinId = `${usuario.id}:${ts}`;
      markJoinShown(joinId);

      // Mensaje local (solo para el usuario)
      showTemporaryGlobalMessage(`Bienvenido, ${usuario.nombre || "Jugador"}!`);
      const statusMsg = document.getElementById("status-msg");
      if (statusMsg) {
          statusMsg.textContent = `Jugador: ${usuario.nombre}`;
      }

      // Notificar a TODOS los jugadores en tiempo real
      window.socket.send(JSON.stringify({
        type: "usuario_unido",
        usuario_id: usuario.id,
        nombre: usuario.nombre,
        ts: Date.now()
      }));

    } catch (e) {
      console.warn("Error enviando usuario_unido via WS:", e);
    }

    // -------------------------------
    // 4️⃣ Refrescar inmediatamente la UI local
    // -------------------------------
    refreshOnlinePlayersList();
    refreshPlayersCount();
    loadRankingAndPlayers();

    // -------------------------------
    // 5️⃣ Mostrar pantalla del juego
    // -------------------------------
    console.log("✅ Inicio de sesión exitoso, mostrando pantalla del juego...");

    if (typeof showScreen === "function" && typeof gameScreen !== "undefined") {
      showScreen(gameScreen);

      const sampleCard = document.getElementById("sample-bingo-card");
      if (sampleCard) sampleCard.classList.add("hidden");

      document.getElementById("sidebarMenu").classList.remove("hidden");
      document.getElementById("btn-open-login").classList.add("hidden");
      document.getElementById("logout-button").classList.remove("hidden");
      document.getElementById("user-menu-button").classList.remove("hidden");
      document.getElementById("auth-modal-overlay").classList.add("hidden");
      document.getElementById("auth-modal").classList.add("hidden");
    }

  } else {
    alert("❌ Credenciales inválidas o error en el inicio de sesión.");
  }
});


document.getElementById("register-button").addEventListener("click", async () => {
  const nombre = document.getElementById("reg-name").value.trim();
  const cedula = document.getElementById("reg-cedula").value.trim();
  const telefono = document.getElementById("reg-phone").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  const genero = document.getElementById("reg-genero").value.trim();
  const f_nacimiento = document.getElementById("reg-fnac").value.trim();

  if (!nombre || !cedula || !telefono || !password || !genero || !f_nacimiento) {
    alert("⚠️ Todos los campos son obligatorios.");
    return;
  }

  const data = await registrarUsuario(nombre, cedula, telefono, password, genero, f_nacimiento);

  if (data.id) {
    showMessage("auth-message-box", "Registro exitoso. Ahora puedes iniciar sesión.");
    document.getElementById("show-login-button").click();
  } else {
    showMessage("auth-message-box", data.error || "Error en registro", true);
  }
});

// =========================
// EVENTOS DE NAVEGACIÓN
// =========================

// Mostrar formulario de registro
document.getElementById("show-register-button").addEventListener("click", () => {
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.remove("hidden");
});

// Mostrar formulario de login
document.getElementById("show-login-button").addEventListener("click", () => {
  document.getElementById("register-form").classList.add("hidden");
  document.getElementById("login-form").classList.remove("hidden");
});

// =======================================================
// NAVEGACIÓN DE PANTALLAS Y PESTAÑAS
// =======================================================

const gameScreen = document.getElementById("game-screen");
const liveBoardScreen = document.getElementById("live-bingo-board-screen");

function showScreen(screen) {
  // Ocultar todas
  [gameScreen, liveBoardScreen].forEach(s => {
    if (s) s.classList.add("hidden");
  });
  // Mostrar solo la elegida
  if (screen) screen.classList.remove("hidden");
}

// ✅ Abrir pestaña "Tablero" al iniciar sesión
document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden")); 
document.getElementById("tab-user-panel").classList.remove("hidden");

// Resetear estilos botones
document.querySelectorAll(".tab-button").forEach(b => {
  b.classList.remove("bg-blue-700", "text-white");
  b.classList.add("bg-gray-200", "text-gray-800");
});

// Marcar el botón "Tablero" como activo
const tableroBtn = document.querySelector('[data-tab="user-panel"]');
tableroBtn.classList.remove("bg-gray-200", "text-gray-800");
tableroBtn.classList.add("bg-blue-700", "text-white");

document.getElementById("show-live-bingo-button")?.addEventListener("click", () => {
  const sampleCard = document.getElementById("sample-bingo-card");
  if (sampleCard) sampleCard.classList.add("hidden");
  showScreen(liveBoardScreen);
});

document.getElementById("back-from-live-board")?.addEventListener("click", () => {
  const sampleCard = document.getElementById("sample-bingo-card");
  if (sampleCard) sampleCard.classList.remove("hidden");
  const livebingo = document.getElementById("show-live-bingo-button");
  if (livebingo) livebingo.classList.add("hidden");
});

// Después de login exitoso → pasa al game-screen
async function showGameScreen() {
  showScreen(gameScreen);
  const user = JSON.parse(localStorage.getItem("usuario"));
  if (user) {
    document.getElementById("user-name-display").textContent = user.nombre;
    document.getElementById("user-id-display").textContent = user.id;
    document.getElementById("profile-cedula").value = user.cedula || "";
    document.getElementById("profile-nombres").value = user.nombre || "";
    document.getElementById("profile-telefono").value = user.telefono || "";
    document.getElementById("profile-fnac").value = user.f_nacimiento || "";
    document.getElementById("profile-genero").value = user.genero || "";
  }

  // 🔥 cargar rondas aquí también
  await renderRondasProgramadas();
}

// =======================================================
// 🔴 CERRAR SESIÓN COMPLETAMENTE (CORREGIDO)
// =======================================================
document.getElementById("logout-button")?.addEventListener("click", async () => {

  if (!confirm("¿Seguro que deseas cerrar sesión?")) return;

  console.log("👋 Cerrando sesión...");

  const usuario = JSON.parse(localStorage.getItem("usuario")) || currentUser;
  const uid = usuario?.id;

  try {
    // Marcar offline en backend primero
    if (uid) {
      await markLoggedOut(uid);
    }

    // Esperar conexión WS antes de enviar evento
    await waitForWS();

    // Avisar a todos los clientes via WebSocket
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
      window.socket.send(JSON.stringify({
        type: "usuario_salio",
        usuario_id: uid,
        nombre: usuario?.nombre
      }));
    }
    const statusMsg = document.getElementById("status-msg");
    if (statusMsg) {
        statusMsg.textContent = "Jugador: —";
    }


  } catch (err) {
    console.warn("Error al cerrar sesión (backend/WS):", err);
  }

  // =======================================================
  // 🧹 LIMPIEZA LOCAL
  // =======================================================
  try {
    localStorage.removeItem("usuario");
    localStorage.removeItem("bingoDB");
    localStorage.removeItem("globalStats");
  } catch (e) {}

  currentUser = null;

  // =======================================================
  // 🔄 ACTUALIZAR UI INMEDIATAMENTE
  // =======================================================
  refreshOnlinePlayersList();
  refreshPlayersCount();
  loadRankingAndPlayers();

  // Reset visual
  document.getElementById("sidebarMenu").classList.add("hidden");
  document.getElementById("btn-open-login").classList.remove("hidden");
  document.getElementById("logout-button").classList.add("hidden");
  document.getElementById("user-menu-button").classList.add("hidden");
  document.getElementById("game-screen").classList.add("hidden");

  const sampleCard = document.getElementById("sample-bingo-card");
  if (sampleCard) sampleCard.classList.remove("hidden");

  console.log("✅ Sesión cerrada correctamente.");
});


// =======================================================
// SISTEMA DE PESTAÑAS EN GAME-SCREEN
// =======================================================

document.querySelectorAll(".tab-button").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;

    // Ocultar todas las pestañas
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

    // Mostrar solo la clickeada
    document.getElementById(`tab-${tabId}`).classList.remove("hidden");

    // Resetear estilos de botones
    document.querySelectorAll(".tab-button").forEach(b => {
      b.classList.remove("bg-blue-700", "text-white");
      b.classList.add("bg-gray-200", "text-gray-800");
    });

    // Marcar activo al actual
    btn.classList.remove("bg-gray-200", "text-gray-800");
    btn.classList.add("bg-blue-700", "text-white");
  });
});

// Mostrar por defecto el tablero
document.getElementById("tab-user-panel")?.classList.remove("hidden");

// =======================================================
// TABLEROS DE BINGO (Jugador y Admin)
// =======================================================

// Renderizar ambos tableros al cargar
renderBoard("board");        // Tablero general de jugadores
renderBoard("admin-board");  // Tablero del admin
renderBoard("board-live");   // Tablero en vivo

// Genera las columnas B, I, N, G, O con sus números
function renderBoard(boardIdPrefix) {
  const ranges = {
    B: [1, 15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75]
  };

  for (const letter in ranges) {
    const [start, end] = ranges[letter];
    const col = document.getElementById(`${boardIdPrefix}-col-${letter}`);
    if (!col) continue;
    col.innerHTML = ""; // limpiar por si acaso
    for (let num = start; num <= end; num++) {
      const cell = document.createElement("div");
      cell.textContent = num;
      cell.className = "bingo-board-cell w-10 h-10 flex items-center justify-center border rounded-lg m-1 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-600";
      cell.id = `${boardIdPrefix}-${letter}${num}`;
      col.appendChild(cell);
    }
  }
}

// Función para renderizar los códigos de cartones
function renderCartones(codes) {
  const container = document.getElementById("cards-display");
  const countSpan = document.getElementById("cartones-count");

  container.innerHTML = ""; // limpiar

  if (!codes.length) {
    container.innerHTML = `<p class="text-gray-400 col-span-full text-center">No hay cartones disponibles</p>`;
    countSpan.textContent = "0";
    return;
  }

  // Mostrar cartones
  codes.forEach(code => {
    const div = document.createElement("div");
    div.className = "bg-green-500 text-white font-bold text-center p-4 rounded-lg shadow-md hover:bg-green-400 transition-all cursor-pointer";
    div.textContent = String(code).padStart(3, '0');

    // marcar atributo para identificar el cartón y permitir selección/desmarcado
    div.dataset.carton = String(code);

    container.appendChild(div);
  });

  // ✅ Mostrar cantidad
  if (currentUser?.rol_nombre === "admin") {
    // admin ve cartones que NO están públicos
    countSpan.textContent = `${codes.length}`;
  } else {
    // usuario normal solo ve los públicos
    countSpan.textContent = codes.length;
  }
}

document.getElementById("view-cards-btn").addEventListener("click", verCartones);
// Evento para botón "Ver"
// 🔥 Función completa y corregida: verCartones()
async function verCartones() {
  const container = document.getElementById("cards-display");
  if (container) container.innerHTML = "Cargando...";

  try {
    // 1️⃣ Obtener usuario desde localStorage
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    const usuario_id = usuario ? usuario.id : null;

    if (!usuario_id) {
      console.warn("⚠️ No se encontró un usuario logueado.");
      if (container) container.innerHTML = `<p class="text-gray-300">Debes iniciar sesión para ver los cartones.</p>`;
      return;
    }

    // 2️⃣ Obtener el rol REAL del usuario desde tu API
    const rolRes = await fetch(`${API_URL}/permisos/usuarios/${usuario_id}/rol`);
    if (!rolRes.ok) throw new Error("No se pudo obtener el rol del usuario");

    const { rol_id, rol_nombre } = await rolRes.json();
    // console.log("🔎 Rol detectado:", rol_nombre, "(ID:", rol_id, ")");

    // 3️⃣ Determinar si es jugador
    const esJugador = rol_id === 3 || rol_nombre?.toLowerCase() === "jugador";

    let res;

    // 4️⃣ Jugador → solo ve cartones públicos
    if (esJugador) {
      res = await fetch(`${API_URL}/cartones/publicos`);
    } else {
      // 5️⃣ Admin/otros roles → usa el modo seleccionado
      const mode = document.getElementById("view-mode")?.value || "public";

      if (mode === "admin") {
        res = await fetch(`${API_URL}/cartones/inventario`);
      } else {
        res = await fetch(`${API_URL}/cartones/publicos`);
      }
    }

    // 6️⃣ Validar respuesta del servidor
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("verCartones: respuesta no OK", res.status, txt);
      if (container)
        container.innerHTML = `<p class="text-red-400">Error cargando cartones (${res.status})</p>`;
      return;
    }

    // 7️⃣ Leer respuesta como texto (evita fallos si no es JSON válido)
    const text = await res.text();
    if (!text) {
      if (container) container.innerHTML = `<p class="text-gray-400">No hay cartones disponibles.</p>`;
      const cartCountEl = document.getElementById("cartones-count");
      if (cartCountEl) cartCountEl.textContent = "0";
      return;
    }

    // 8️⃣ Intentar parsear JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // fallback: si es texto plano con códigos
      const codesFromText = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (codesFromText.length) {
        renderCartones(codesFromText);
        return;
      }

      console.warn("verCartones: respuesta no JSON", e, text);
      if (container)
        container.innerHTML = `<p class="text-gray-400">No hay cartones disponibles.</p>`;
      return;
    }

    // 9️⃣ Normalizar formatos de respuesta
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data.cartones)) list = data.cartones;
    else if (Array.isArray(data.rows)) list = data.rows;
    else if (Array.isArray(data.data)) list = data.data;
    else if (data.codigo !== undefined) list = [data];
    else {
      console.warn("verCartones: formato inesperado de datos", data);
      if (container)
        container.innerHTML = `<p class="text-gray-400">No hay cartones disponibles.</p>`;
      return;
    }

    // 🔟 Extraer códigos reales
    const codes = list.map(c =>
      typeof c === "object"
        ? (c.codigo ?? c.numero ?? c.id ?? c)
        : c
    );

    // 1️⃣1️⃣ Render final
    renderCartones(codes);

  } catch (err) {
    console.error("❌ Error al cargar cartones:", err);
    if (container)
      container.innerHTML = `<p class="text-red-400">Error al cargar cartones. Revisa la consola.</p>`;
  }
}


// =======================================================
// 🧮 CÁLCULOS Y PROYECCIONES
// =======================================================
const calcBtn = document.getElementById("calc-btn");
const generateProjectionBtn = document.getElementById("generate-projection-btn");

// 🧮 Cálculo principal
calcBtn.addEventListener("click", () => {
  const cantidad = parseInt(document.getElementById("calc-cartones").value);
  const precio = parseFloat(document.getElementById("calc-precio").value);
  const numRondas = parseInt(document.getElementById("calc-partidas").value);

  if (
    !cantidad || isNaN(cantidad) || parseFloat(cantidad) <= 0 ||
    !precio || isNaN(precio) || parseFloat(precio) <= 0 ||
    !numRondas || isNaN(numRondas) || parseInt(numRondas) <= 0
  ) {
    alert("Por favor ingresa valores válidos.");
    return;
  }

  const total = cantidad * precio;
  const resultadosDiv = document.getElementById("calc-resultados");
  const totalSpan = document.getElementById("calc-total");
  const premiosDiv = document.getElementById("calc-premios");
  const gananciaSpan = document.getElementById("calc-ganancia");
  const gananciaPctSpan = document.getElementById("calc-ganancia-pct");

  premiosDiv.innerHTML = "";

  // 🔁 Generar tarjetas por ronda
  for (let i = 1; i <= numRondas; i++) {
    const div = document.createElement("div");
    div.className = "bg-gray-900 p-4 rounded-lg shadow text-center";

    div.innerHTML = `
      <p class="text-yellow-400 font-bold">Ronda ${i}</p>

      <label class="block text-gray-300 mb-1 font-semibold">Premio Primer Lugar:</label>
      <input id="premio-primer-${i}" type="number" value="0" min="0"
        class="w-full p-2 rounded-lg text-black text-center font-bold mb-2">

      <p class="text-green-400 premio-primer">Primer lugar: 0 Bs.</p>

      <div class="mt-3">
        <label class="inline-flex items-center space-x-2 text-gray-300">
          <input id="check-segundos-${i}" type="checkbox" class="check-segundos">
          <span>Incluir segundo lugar</span>
        </label>
      </div>

      <div id="segundos-panel-${i}" class="hidden mt-2">
        <label class="block text-gray-300 mb-1 font-semibold">Porcentaje respecto al primer lugar:</label>
        <input id="porcentaje-segundo-${i}" type="number" value="0" min="0" max="100"
          class="w-full p-2 rounded-lg text-black text-center font-bold mb-2">

        <label class="block text-gray-300 mb-1 font-semibold">Cantidad de ganadores (2.º lugar):</label>
        <input id="segundos-${i}" type="number" value="0" min="0"
          class="w-full p-2 rounded-lg text-black text-center font-bold mb-2">
      </div>

      <p class="text-purple-400 premio-segundo">Segundo lugar (cada uno): 0Bs.</p>
    `;

    premiosDiv.appendChild(div);

    // 🔁 Eventos dinámicos por ronda
    const premioPrimerInput = div.querySelector(`#premio-primer-${i}`);
    const checkSegundos = div.querySelector(`#check-segundos-${i}`);
    const segundosPanel = div.querySelector(`#segundos-panel-${i}`);
    const porcentajeSegundoInput = div.querySelector(`#porcentaje-segundo-${i}`);
    const segundosCount = div.querySelector(`#segundos-${i}`);
    const premioPrimerP = div.querySelector(".premio-primer");
    const premioSegundoP = div.querySelector(".premio-segundo");

    const recalcularRonda = () => {
      const premioPrimer = parseFloat(premioPrimerInput.value);
      const incluirSegundos = checkSegundos.checked;
      const porcentajeSegundo = incluirSegundos ? (parseFloat(porcentajeSegundoInput.value)) : 0;
      const cantidadSegundos = incluirSegundos ? (parseInt(segundosCount.value)) : 0;

      const premioSegundoTotal = (premioPrimer * porcentajeSegundo) / 100;
      const premioSegundoCadaUno = (cantidadSegundos > 0) ? premioSegundoTotal / cantidadSegundos : 0;

      premioPrimerP.textContent = `Primer lugar: ${premioPrimer.toFixed(2)} Bs.`;
      premioSegundoP.textContent = (incluirSegundos && cantidadSegundos > 0)
        ? `Segundo lugar (cada uno): ${premioSegundoCadaUno.toFixed(2)} Bs.`
        : `Segundo lugar (cada uno): 0 Bs.`;

      div.dataset.premioPrimer = premioPrimer;
      div.dataset.premioSegundo = premioSegundoTotal;

      recalcularGlobal();
    };

    premioPrimerInput.addEventListener("input", recalcularRonda);
    porcentajeSegundoInput.addEventListener("input", recalcularRonda);
    segundosCount.addEventListener("input", recalcularRonda);

    checkSegundos.addEventListener("change", () => {
      segundosPanel.classList.toggle("hidden", !checkSegundos.checked);
      if (!checkSegundos.checked) {
        segundosCount.value = 0;
        porcentajeSegundoInput.value = 0;
      }
      recalcularRonda();
    });

    recalcularRonda();
  }

  function recalcularGlobal() {
    let totalPremios = 0;
    document.querySelectorAll("#calc-premios > div").forEach(div => {
      const primer = parseFloat(div.dataset.premioPrimer) || 0;
      const segundo = parseFloat(div.dataset.premioSegundo) || 0;
      totalPremios += primer + segundo;
    });

    const ganancia = total - totalPremios;

    totalSpan.textContent = `${total.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} Bs.`;

    gananciaSpan.textContent = `${ganancia.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} Bs.`;

    gananciaPctSpan.textContent = `${((ganancia / total) * 100).toLocaleString('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })}%`;
  }

  resultadosDiv.classList.remove("hidden");
});

// 💾 Guardar proyección
generateProjectionBtn.addEventListener("click", async () => {
  const cantidad = parseInt(document.getElementById("calc-cartones").value) || 0;
  const precio = parseFloat(document.getElementById("calc-precio").value) || 0;
  const numRondas = parseInt(document.getElementById("calc-partidas").value) || 0;
  const total = cantidad * precio;

  // Extraer detalles de las rondas
  const rondas = Array.from(document.querySelectorAll("#calc-premios > div")).map((div, index) => {
    const premio_primer = parseFloat(div.querySelector(`#premio-primer-${index + 1}`)?.value) || 0;
    const porcentaje_segundo = parseFloat(div.querySelector(`#porcentaje-segundo-${index + 1}`)?.value) || 0;
    const ganadores_segundo = parseInt(div.querySelector(`#segundos-${index + 1}`)?.value) || 0;

    return {
      ronda: index + 1,
      premio_primer,
      porcentaje_segundo,
      ganadores_segundo,
    };
  });

  try {
    const res = await fetch(`${API_URL}/proyecciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cantidad_cartones: cantidad,
        precio_carton: precio,
        numero_rondas: numRondas,
        total_recaudado: total,
        rondas
      }),
    });

    const data = await res.json();
    if (data.success) {
      alert("✅ Proyección guardada correctamente");
      cargarProyecciones();
    } else {
      alert("⚠️ No se pudo guardar la proyección.");
    }
  } catch (err) {
    console.error("❌ Error guardando proyección:", err);
  }
});

async function cargarProyecciones() {
  try {
    //console.log("🔍 Intentando cargar proyecciones...");
    const res = await fetch(`${API_URL}/proyecciones`);
    const text = await res.text();
    //console.log("Respuesta raw:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("❌ No es JSON válido:", err, text);
      return;
    }

    if (!data.success) {
      console.error("❌ Éxito no es true:", data);
      return;
    }

    const proyecciones = data.data;
    //console.log("📊 Datos de proyecciones:", proyecciones);

    const list = document.getElementById("projection-list");
    list.innerHTML = "";

    if (!Array.isArray(proyecciones) || proyecciones.length === 0) {
      console.log("ℹ No hay proyecciones para mostrar");
      list.innerHTML = "<li class='text-gray-500'>No hay proyecciones guardadas aún.</li>";
      return;
    }

    proyecciones.forEach((p) => {
      const li = document.createElement("li");
      li.classList.add(
        "bg-white", "text-black", "rounded-lg", "p-2",
        "hover:bg-gray-200", "transition", "cursor-pointer"
      );

      // Extraer las rondas desde el campo JSONB correcto
      const detallesRondas = p.detalles?.rondas || [];

      li.innerHTML = `
        <div class="flex justify-between items-center">
          <span class="projection-title">
            👤 <b>${p.usuario_nombre || "Desconocido"}</b> —
            <b>${p.cantidad_cartones}</b> cartones — 
            <b>${p.numero_rondas}</b> rondas —
            💰 Total: <b>${Number(p.total_recaudado).toFixed(2)} Bs.</b> —
            📈 Ganancia: <b class="text-green-600">${Number(p.ganancia).toFixed(2)} Bs.</b> (${p.ganancia_pct}%)
          </span>
          <div class="space-x-2">
            <button data-id="${p.id}" class="restore-projection bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-md">🌀 Restaurar</button>
            <button data-id="${p.id}" class="programar-rondas-btn bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-md">📅 Programar</button>
            <button data-id="${p.id}" class="delete-projection bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-md">🗑</button>
          </div>
        </div>
        <div class="details hidden mt-2 text-gray-700 bg-gray-100 rounded p-2 text-sm transition-all duration-300 ease-in-out overflow-hidden">
          <p><b>Fecha:</b> ${new Date(p.created_at).toLocaleString()}</p>
          <p><b>Precio cartón:</b> ${Number(p.precio_carton).toFixed(2)} Bs.</p>
          <hr class="my-2 border-gray-300">
          <b>Rondas:</b>
          ${
            detallesRondas.length === 0
              ? `<p class="text-gray-500 text-sm mt-1">No hay detalles de rondas disponibles.</p>`
              : `
                <table class="w-full text-sm text-left border-t mt-1">
                  <thead class="bg-gray-200 dark:bg-gray-700">
                    <tr>
                      <th class="px-2 py-1">#</th>
                      <th class="px-2 py-1">1er Premio</th>
                      <th class="px-2 py-1">% 2do</th>
                      <th class="px-2 py-1">Total 2do</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${detallesRondas
                      .map(
                        (r, i) => `
                          <tr class="border-b dark:border-gray-600">
                            <td class="px-2 py-1">${i + 1}</td>
                            <td class="px-2 py-1">${r.premio_primer} Bs.</td>
                            <td class="px-2 py-1">${r.porcentaje_segundo || 0}%</td>
                            <td class="px-2 py-1">${((r.premio_primer * (r.porcentaje_segundo || 0)) / 100).toFixed(2)} Bs.</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              `
          }
        </div>
      `;

      const details = li.querySelector(".details");

      // 🔁 Al hacer click en cualquier parte del li (excepto botones), se despliega
      li.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;

        document.querySelectorAll(".details").forEach((d) => {
          if (d !== details) d.classList.add("hidden");
        });

        details.classList.toggle("hidden");
      });

      // 🗑 Eliminar proyección
      li.querySelector(".delete-projection").addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        console.log("🗑 Eliminando proyección id:", id);
        await fetch(`${API_URL}/proyecciones/${id}`, { method: "DELETE" });
        cargarProyecciones();
      });

      // 🌀 Restaurar proyección
      li.querySelector(".restore-projection").addEventListener("click", (e) => {
        e.stopPropagation();
        console.log("🌀 Restaurar proyección:", p);
        restaurarProyeccion(p);
      });

      list.appendChild(li);
    });
  } catch (err) {
    console.error("❌ Error cargando proyecciones:", err);
  }
}

function restaurarProyeccion(proyeccion) {
  const calcTab = document.getElementById("tab-calculo");
  const resultadosDiv = document.getElementById("calc-resultados");

  // Rellenar campos principales
  document.getElementById("calc-cartones").value = proyeccion.cantidad_cartones;
  document.getElementById("calc-precio").value = proyeccion.precio_carton;
  document.getElementById("calc-partidas").value = proyeccion.numero_rondas;
  
  // Simula click en Calcular para reconstruir las rondas
  document.getElementById("calc-btn").click();

  // Verificar que 'proyeccion.detalles.rondas' sea un array
  if (Array.isArray(proyeccion.detalles?.rondas) && proyeccion.detalles.rondas.length > 0) {
    // Esperar a que los elementos de las rondas se generen
    setTimeout(() => {
      proyeccion.detalles.rondas.forEach((r, i) => {
        const idx = i + 1;

        const premioPrimerInput = document.getElementById(`premio-primer-${idx}`);
        const checkSegundos = document.getElementById(`check-segundos-${idx}`);
        const porcentajeSegundoInput = document.getElementById(`porcentaje-segundo-${idx}`);
        const segundosInput = document.getElementById(`segundos-${idx}`);

        // ✅ Asignar valor de premio primer lugar (si existe en la proyección)
        if (premioPrimerInput) {
          premioPrimerInput.value = r.premio_primer != null ? String(r.premio_primer) : "";
          premioPrimerInput.dispatchEvent(new Event("input"));
        }

        // ✅ Si hay ganadores de segundo lugar
        if (r.ganadores_segundo && r.ganadores_segundo > 0) {
          checkSegundos.checked = true;
          document.getElementById(`segundos-panel-${idx}`).classList.remove("hidden");

          // Asignar porcentaje segundo lugar
          if (porcentajeSegundoInput)
            porcentajeSegundoInput.value = r.porcentaje_segundo != null ? String(r.porcentaje_segundo) : "";

          // Asignar cantidad de segundos lugares
          if (segundosInput)
            segundosInput.value = r.ganadores_segundo != null ? String(r.ganadores_segundo) : "";

          porcentajeSegundoInput?.dispatchEvent(new Event("input"));
          segundosInput?.dispatchEvent(new Event("input"));
        } else {
          // Si no hay ganadores de segundo lugar, ocultar panel
          if (checkSegundos) {
            checkSegundos.checked = false;
            document.getElementById(`segundos-panel-${idx}`).classList.add("hidden");
          }
        }

        // Refrescar visibilidad
        checkSegundos?.dispatchEvent(new Event("change"));
      });

      // ✨ Animación visual
      resultadosDiv.classList.add("animate-pulse");
      setTimeout(() => resultadosDiv.classList.remove("animate-pulse"), 1200);

      // 📜 Desplazar hacia la pestaña de cálculo
      calcTab.scrollIntoView({ behavior: "smooth", block: "start" });

    }, 400);
  } else {
    console.error("❌ 'rondas' no está definido o no es un array dentro de detalles");
    alert("Error al restaurar proyección: no se encontraron rondas válidas.");
  }
}

document.addEventListener("click", async (e) => {
  if (e.target && e.target.classList.contains("programar-rondas-btn")) {
    const btn = e.target;
    const li = btn.closest("li");

    if (!li) {
      alert("❌ No se encontró el contenedor de la proyección.");
      return;
    }

    // Buscar la sección de detalles de la proyección
    const detallesDiv = li.querySelector(".details");
    if (!detallesDiv) {
      alert("⚠️ No se encontró la sección de detalles de esta proyección.");
      return;
    }

    // Buscar la tabla con las rondas dentro del detalle
    const tabla = detallesDiv.querySelector("table tbody");
    if (!tabla) {
      alert("⚠️ Esta proyección no tiene detalles de rondas disponibles.");
      return;
    }

    // Extraer los datos de cada ronda desde las filas de la tabla
    const filas = tabla.querySelectorAll("tr");
    const premios = [];

    filas.forEach((fila) => {
      const celdas = fila.querySelectorAll("td");
      // Segunda columna → monto del primer premio
      const premio = parseFloat(
        celdas[1]?.textContent.replace("$", "").trim()
      ) || 0;

      premios.push(premio);
    });

    const cantidadRondas = premios.length;

    if (cantidadRondas <= 0) {
      alert("⚠️ No se detectaron rondas para programar.");
      return;
    }

    // Obtener usuario desde localStorage
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    const usuarioId = usuario ? usuario.id : null;

    if (!usuarioId) {
      alert("⚠️ No estás logueado. Inicia sesión primero.");
      return;
    }

    // Desactivar el botón mientras se procesa
    btn.disabled = true;
    btn.innerText = "⏳ Programando...";

    try {
      // Enviar los datos al backend
      const res = await fetch(`${API_URL}/rondas_programadas/generar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cantidad: cantidadRondas, // cantidad de rondas
          premios: premios,         // montos de premios
          usuario_id: usuarioId     // usuario logueado
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al generar rondas");

      alert("✅ Rondas programadas correctamente.");
      cargarGrupos();

    } catch (err) {
      console.error("❌ Error al programar rondas:", err);
      alert("Error al programar rondas: " + err.message);
    } finally {
      // Restaurar el estado del botón
      btn.disabled = false;
      btn.innerHTML = "📅 Programar";
    }
  }
});

// ============================
// CANTAR NÚMEROS
// ============================
let currentRoundId = null;
let calledNumbers = [];
const boardPrefixes = ["admin-board", "board", "board-live"];

function getBingoLetter(num) {
  if (num <= 15) return "B";
  if (num <= 30) return "I";
  if (num <= 45) return "N";
  if (num <= 60) return "G";
  return "O";
}

// Marca el número en los 3 tableros
function markNumberInBoards(num) {
  const letter = getBingoLetter(num);
  boardPrefixes.forEach(prefix => {
    const cell = document.getElementById(`${prefix}-${letter}${num}`);
    if (cell) {
      cell.classList.add("bg-yellow-400", "text-black", "font-bold");
    }
  });
}

// Escoge aleatorio entre los no cantados
function pickRandomFromRemaining() {
  const all = Array.from({ length: 75 }, (_, i) => i + 1);
  const remaining = all.filter(n => !calledNumbers.includes(n));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

document.getElementById("admin-call-number").addEventListener("click", async () => {
  if (!currentUser || currentUser.rol_nombre !== "admin") {
    alert("Solo el admin puede cantar números");
    return;
  }

  if (!currentRoundId) {
    alert("⚠️ No hay rondas activas. Debes aperturar una ronda primero.");
    return;
  }

  const numero = pickRandomFromRemaining();
  if (!numero) {
    alert("Todos los números ya fueron cantados");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/numeros/${currentRoundId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero })
    });

    if (!res.ok) throw new Error("Error al guardar número en backend");

    const data = await res.json();
    console.log("✅ Número guardado en backend:", data);

    // 🔥 Actualizar en frontend

    if (calledNumbers[calledNumbers.length - 1] !== numero) {
      calledNumbers.push(numero);
      markNumberInBoards(numero);
      updateLastPrevUi();
      await sendMessageToGroup(`🎱 ${numero}`);
    }

  } catch (err) {
    console.error("❌ Error al cantar número:", err);
    alert("Error al guardar el número. Ver consola.");
  }
});

// Actualiza último y penúltimo en UI
function updateLastPrevUi() {
  const last = calledNumbers[calledNumbers.length - 1];
  const prev = calledNumbers[calledNumbers.length - 2];

  const lastStr = last ? `${getBingoLetter(last)}${last}` : "--";
  const prevStr = prev ? `${getBingoLetter(prev)}${prev}` : "--";

  // Admin
  document.getElementById("last-number-admin").textContent = lastStr;
  document.getElementById("prev-number-admin").textContent = prevStr;

  // Live
  document.getElementById("last-number-board-live").textContent = lastStr;
  document.getElementById("prev-number-board-live").textContent = prevStr;

  // Tablero principal
  document.getElementById("last-number-board").textContent = lastStr;
  document.getElementById("prev-number-board").textContent = prevStr;

  // Enviar por WebSocket a los jugadores
  if (window.socket && socket.readyState === WebSocket.OPEN) {
    const payload = {
      type: "numbers_update",
      data: { last: lastStr, prev: prevStr },
    };
    socket.send(JSON.stringify(payload));
  }
}

// Cache para búsqueda rápida en Apartados
let _cartonesApartadosCache = [];

async function cargarCartonesApartados() {
  try {
    const res = await fetch(`${API_URL}/cartones/apartados`);
    const data = await res.json();

    _cartonesApartadosCache = Array.isArray(data) ? data : [];
    renderCartonesApartados(_cartonesApartadosCache);

    // Iniciar listener de búsqueda si no existe
    const search = document.getElementById('apartados-search');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim().toLowerCase();
        if (!q) return renderCartonesApartados(_cartonesApartadosCache);
        const filtered = _cartonesApartadosCache.filter(c => {
          return String(c.numero).includes(q) || String(c.cedula || '').toLowerCase().includes(q) || String(c.nombre || '').toLowerCase().includes(q);
        });
        renderCartonesApartados(filtered);
      });
    }

  } catch (err) {
    console.error("❌ Error al cargar cartones apartados:", err);
  }
}

function renderCartonesApartados(data = []) {
  try {
    const tbody = document.getElementById("cartones-apartados-body");
    tbody.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-gray-400 py-2">No hay cartones apartados.</td></tr>`;
      return;
    }

    data.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-2 text-center">${String(c.numero).padStart(3, '0')}</td>
        <td class="px-4 py-2 text-center">${c.cedula || "—"}</td>
        <td class="px-4 py-2 text-center">${c.nombre || "—"}</td>
        <td class="px-4 py-2 text-center">${c.telefono || "—"}</td>
        <td class="px-4 py-2 text-center">
          ${c.comprobante
            ? `<span class="text-green-600 font-semibold cursor-pointer" id="view-comprobante-${c.numero}">✅ Subido</span>`
            : '<span class="text-red-500">❌ No subido</span>'}
        </td>
        <td class="px-4 py-2 text-center">
          <select data-numero="${c.numero}" class="estado-select bg-gray-700 text-white px-0 py-1 rounded">
            <option value="aprobado" ${c.aprobado ? "selected" : ""}>Aprobar</option>
            <option value="espera" ${!c.aprobado ? "selected" : ""}>En espera</option>
            <option value="retirar">Retirar</option>
            <option value="eliminar-comprobante">Eliminar Comprobante</option>
          </select>
        </td>
      `;
      tbody.appendChild(tr);

      // 🎯 Agregar evento para abrir el comprobante en modal
      if (c.comprobante) {
        document.getElementById(`view-comprobante-${c.numero}`).addEventListener("click", async () => {
          try {
            const res = await fetch(`${API_URL}/vouchers/${c.numero}`);
            const data = await res.json();

            if (data.success) {
              const imageUrl = data.comprobanteUrl;

              // Eliminar cualquier modal previo si existe
              const existingModal = document.getElementById("comprobante-modal");
              if (existingModal) existingModal.remove();

              // Crear el modal
              const modal = document.createElement("div");
              modal.id = "comprobante-modal";
              modal.className = "fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50 transition-opacity duration-300";
              modal.innerHTML = `
                <div class="bg-white p-4 rounded-lg shadow-lg relative transform scale-100 transition-transform duration-300">
                  <img src="${imageUrl}" alt="Comprobante" id="comprobante-image" class="max-w-full max-h-[80vh] object-contain rounded-md">
                  <button id="close-modal-btn" class="absolute top-2 right-2 text-gray-500 hover:text-gray-800 font-semibold text-lg">❌</button>
                </div>
              `;
              document.body.appendChild(modal);

              // Espera un pequeño tiempo para animación suave
              setTimeout(() => {
                modal.classList.add("opacity-100");
              }, 10);

              // Cerrar al hacer clic en botón o fuera del modal
              const closeModal = () => {
                modal.classList.remove("opacity-100");
                modal.classList.add("opacity-0");
                setTimeout(() => modal.remove(), 300); // Animación de salida
              };

              document.getElementById("close-modal-btn").addEventListener("click", closeModal);

              modal.addEventListener("click", (e) => {
                if (e.target === modal) closeModal(); // Click fuera del contenido
              });

            } else {
              alert("❌ Error al obtener el comprobante.");
            }
          } catch (err) {
            console.error("❌ Error al abrir el comprobante:", err);
            alert("❌ No se pudo cargar el comprobante.");
          }
        });

      }
    });

    // 🎯 Manejo de cambio de estado
    document.querySelectorAll(".estado-select").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        const numero = e.target.dataset.numero;
        const valor = e.target.value;

        // 🧩 1️⃣ Retirar cartón
        if (valor === "retirar") {
          const confirmacion = confirm(`¿Seguro que deseas eliminar el cartón ${numero}?`);
          if (!confirmacion) return;

          const delRes = await fetch(`${API_URL}/cartones/${numero}`, { method: "DELETE" });

          if (delRes.ok) {
            alert(`🗑️ Cartón ${numero} retirado correctamente.`);
            cargarCartonesApartados();
            cargarCartonesUsuario();
            cargarCartonesUsuarioPanel();
            verCartones();
          } else {
            alert("❌ Error al eliminar el cartón.");
          }
          return;
        }

        // 🧩 2️⃣ Eliminar comprobante
        if (valor === "eliminar-comprobante") {
          const confirmacion = confirm(`¿Seguro que deseas eliminar el comprobante del cartón ${numero}?`);
          if (!confirmacion) return;

          try {
            const delRes = await fetch(`${API_URL}/vouchers/eliminar-comprobante/${numero}`, { method: "DELETE" });
            const resData = await delRes.json();

            if (resData.success) {
              alert(`🧾 Comprobante del cartón ${numero} eliminado correctamente.`);
              cargarCartonesApartados();
              cargarCartonesUsuario();
              cargarCartonesUsuarioPanel();
              verCartones();
              cargarCartonesApartados();
            } else {
              alert(`❌ ${resData.error || "No se pudo eliminar el comprobante."}`);
            }
          } catch (err) {
            console.error("❌ Error eliminando comprobante:", err);
            alert("❌ Error interno al eliminar el comprobante.");
          }
          return;
        }

        // 🧩 3️⃣ Cambio de estado normal
        const aprobado = valor === "aprobado";
        const putRes = await fetch(`${API_URL}/cartones/${numero}/estado`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aprobado })
        });

        if (putRes.ok) {
          //alert(`✅ Estado actualizado a ${valor.toUpperCase()} para el cartón ${numero}.`);
          cargarCartonesApartados();
          cargarCartonesUsuario();
          cargarCartonesUsuarioPanel();
          verCartones();
        } else {
          alert("❌ Error al actualizar el estado.");
        }
      });
    });

    cargarCartonesUsuario();
    cargarCartonesUsuarioPanel();
    

  } catch (err) {
    console.error("❌ Error al cargar cartones apartados:", err);
  }
}

document.getElementById('open-rounds-btn').addEventListener('click', async () => {
  const cantidadRondas = parseInt(document.getElementById('calc-partidas').value) || 0;
  if (cantidadRondas <= 0) {
    alert("⚠️ Ingresa una cantidad válida de rondas antes de generar.");
    return;
  }

  // Tomamos los premios de los inputs
  const premios = [];
  for (let i = 1; i <= cantidadRondas; i++) {
    const input = document.getElementById(`premio-primer-${i}`);
    premios.push(parseFloat(input?.value || 0));
  }

  // Recuperamos el ID del usuario desde localStorage
  const usuario = JSON.parse(localStorage.getItem("usuario"));
  const usuarioId = usuario ? usuario.id : null;  // Si el usuario está logueado, tomamos el id

  if (!usuarioId) {
    alert("⚠️ No estás logueado. Inicia sesión primero.");
    return;
  }

  try {
    console.log("Generando rondas...");
    const res = await fetch(`${API_URL}/rondas_programadas/generar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cantidad: cantidadRondas, premios, usuario_id: usuarioId })  // Pasamos el usuario_id
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al generar rondas");

    alert("✅ Rondas generadas correctamente.");
    cargarGrupos();
  } catch (err) {
    console.error("❌ Error al programar rondas:", err);
    alert("Error al programar rondas: " + err.message);
  }
});

async function actualizarFechaGrupo(grupo_id, nuevaFecha) {
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/actualizar_fecha_grupo/${grupo_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha: nuevaFecha })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {

  }
}

async function actualizarHoraRonda(id, nuevaHora) {
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/actualizar_hora/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hora: nuevaHora })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

  } catch (err) {
    alert("❌ Error al actualizar hora: " + err.message);
  }
}

async function cargarGrupos() {
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/grupos`);
    const grupos = await res.json();

    const contenedor = document.getElementById("lista-grupos");
    contenedor.innerHTML = "";

    if (grupos.length === 0) {
      contenedor.innerHTML = `<p class="text-gray-800 dark:text-gray-200">No hay rondas programadas.</p>`;
      return;
    }

    grupos.forEach(grupo => {
      const grupoDiv = document.createElement("div");
      grupoDiv.className = "border border-gray-300 dark:border-gray-700 rounded-lg shadow bg-gray-50 dark:bg-gray-800 mb-4";

      const header = document.createElement("div");
      header.className = "flex justify-between items-center bg-gray-200 dark:bg-gray-700 p-3 rounded-t-lg text-gray-900 dark:text-gray-100";

      header.innerHTML = `
      <div>
        <span class="font-semibold text-gray-900 dark:text-gray-100">Grupo:</span> ${grupo.id}<br>
        <span class="text-sm text-gray-500">Estado: ${grupo.estado}</span><br>
        <label class="text-sm text-gray-800 dark:text-gray-300">📅 Fecha: </label>
        <input type="date" 
              value="${grupo.fecha ? grupo.fecha.split('T')[0] : ''}" 
              class="bg-white dark:bg-gray-700 border border-gray-400 rounded px-2 py-1 text-gray-900 dark:text-gray-100"
              onchange="actualizarFechaGrupo('${grupo.grupo_id}', this.value)">
      </div>
      <div class="flex gap-2">
        <button class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded" onclick="eliminarGrupo('${grupo.grupo_id}')">Eliminar</button>
        <button class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded" onclick="transferirGrupo('${grupo.grupo_id}')">Transferir</button>
      </div>
    `;

      const rondasDiv = document.createElement("div");
      rondasDiv.className = "p-3 overflow-x-auto";

      const tabla = document.createElement("table");
      tabla.className = "min-w-full text-sm text-left border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100";

      tabla.innerHTML = `
        <thead class="bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100">
          <tr>
            <th class="px-3 py-1">N°</th>
            <th class="px-3 py-1">Premio</th>
            <th class="px-3 py-1">Hora</th>
            <th class="px-3 py-1">Estatus</th>
          </tr>
        </thead>
        <tbody>
          ${grupo.rondas.map(r =>
            `<tr class="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
              <td class="px-3 py-1">${r.numero}</td>
              <td class="px-3 py-1">${r.premio}</td>
              <td class="px-3 py-1">
                <input type="time" 
                      value="${r.hora || ''}" 
                      class="bg-white dark:bg-gray-700 border border-gray-400 rounded px-2 py-1 text-gray-900 dark:text-gray-100"
                      onchange="actualizarHoraRonda('${r.id}', this.value)">
              </td>
              <td class="px-3 py-1">${r.estatus}</td>
            </tr>`
          ).join('')}
        </tbody>
      `;

      rondasDiv.appendChild(tabla);
      grupoDiv.appendChild(header);
      grupoDiv.appendChild(rondasDiv);
      contenedor.appendChild(grupoDiv);
    });
  } catch (err) {
    console.error("❌ Error cargando grupos:", err);
  }
}


// 🗑️ Eliminar grupo
async function eliminarGrupo(grupo_id) {
  if (!confirm("¿Seguro que deseas eliminar este grupo y sus rondas?")) return;
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/grupo/${grupo_id}`, { method: "DELETE" });
    const data = await res.json();
    alert(data.message);
    cargarGrupos();
  } catch (err) {
    console.error("❌ Error al eliminar grupo:", err);
  }
}

// 🔁 Transferir grupo
async function transferirGrupo(grupo_id) {
  if (!confirm("¿Deseas transferir este grupo a la tabla de rondas activas?")) return;
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/grupo/${grupo_id}/transferir`, { method: "POST" });
    const data = await res.json();
    alert(data.message);
    cargarGrupos();
  } catch (err) {
    console.error("❌ Error al transferir grupo:", err);
    alert("❌ Error al transferir grupo");
  }
}


function getCalculatedRounds() {
  const numRondas = parseInt(document.getElementById("calc-partidas").value);

  if (!numRondas || numRondas <= 0) return [];

  const rounds = [];
  for (let i = 1; i <= numRondas; i++) {
    const premioInput = document.getElementById(`premio-primer-${i + 1}`);
    const premio = premioInput ? parseFloat(premioInput.value) || 0 : 0;

    rounds.push({
      numero: i,
      premio
    });
  }

  return rounds;
}

async function renderRondasProgramadas() {
  try {
    const res = await fetch(`${API_URL}/rondas_programadas`);
    const rondas = await res.json();

    const container = document.getElementById("rondas-programadas-body");
    container.innerHTML = "";

    // 🔹 Agrupar por grupo_id
    const grupos = {};
    rondas.forEach(r => {
      const key = r.grupo_id || "sin_grupo";
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(r);
    });

    // 🔹 Renderizar cada grupo
    Object.entries(grupos).forEach(([grupoId, lista]) => {
      const grupoDiv = document.createElement("div");
      grupoDiv.className = "bg-gray-800 text-white rounded-lg shadow-md mb-6 p-4 border border-gray-600";

      // Cabecera general del grupo
      const cabecera = document.createElement("div");
      cabecera.className = "flex justify-between items-center mb-4";
      cabecera.innerHTML = `
        <div>
          <h3 class="font-bold text-lg">🧩 Grupo ${grupoId.slice(0, 6).toUpperCase()}</h3>
          <p class="text-sm text-gray-300">
            Fecha: <input type="date" class="bg-gray-700 rounded px-2 py-1 text-white" value="${lista[0].fecha?.split("T")[0] || ""}" data-grupo="${grupoId}" data-field="fecha">
            &nbsp;|&nbsp;
            Estatus: <span class="font-semibold">${lista[0].estatus || "en espera"}</span>
          </p>
        </div>
        <div class="flex gap-2">
          <button class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded save-group-btn" data-grupo="${grupoId}">💾 Guardar</button>
          <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transfer-group-btn" data-grupo="${grupoId}">📤 Transferir</button>
          <button class="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded program-group-btn" data-grupo="${grupoId}">🕒 Programar</button>
        </div>
      `;
      grupoDiv.appendChild(cabecera);

      // Tabla interna con las rondas del grupo
      const tabla = document.createElement("table");
      tabla.className = "w-full text-sm text-left text-gray-300 border-t border-gray-600";
      tabla.innerHTML = `
        <thead class="text-gray-400 border-b border-gray-600">
          <tr>
            <th class="py-2 px-2">N°</th>
            <th class="py-2 px-2">Premio</th>
            <th class="py-2 px-2">Hora</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(r => `
            <tr class="border-b border-gray-700 hover:bg-gray-700">
              <td class="py-2 px-2">${r.numero}</td>
              <td class="py-2 px-2">${r.premio}</td>
              <td class="py-2 px-2">
                <input type="time" 
                      value="${r.hora || ''}" 
                      class="bg-white dark:bg-gray-700 border border-gray-400 rounded px-2 py-1 text-gray-900 dark:text-gray-100"
                      onchange="actualizarHoraRonda('${r.id}', this.value)">
            </tr>
          `).join("")}
        </tbody>
      `;
      grupoDiv.appendChild(tabla);
      container.appendChild(grupoDiv);
    });

    // Asignar eventos a botones de grupo
    document.querySelectorAll(".save-group-btn").forEach(btn =>
      btn.addEventListener("click", e => handleSaveGroup(e.target.dataset.grupo))
    );
    document.querySelectorAll(".transfer-group-btn").forEach(btn =>
      btn.addEventListener("click", e => handleTransferGroup(e.target.dataset.grupo))
    );
    document.querySelectorAll(".program-group-btn").forEach(btn =>
      btn.addEventListener("click", e => handleProgramGroup(e.target.dataset.grupo))
    );

  } catch (err) {
    console.error("❌ Error al renderizar rondas programadas:", err);
  }
}

async function handleSaveGroup(grupoId) {
  const rows = document.querySelectorAll(`input[data-id][data-field][data-id]`);
  const updates = [];

  rows.forEach(input => {
    const id = input.dataset.id;
    const field = input.dataset.field;
    const value = input.value;
    if (id && field) {
      updates.push({ id, field, value });
    }
  });

  try {
    for (const up of updates) {
      await fetch(`${API_URL}/rondas_programadas/${up.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [up.field]: up.value })
      });
    }
    alert(`✅ Grupo ${grupoId.slice(0, 6)} actualizado.`);
  } catch (err) {
    console.error("❌ Error actualizando grupo:", err);
  }
}

async function handleTransferGroup(grupoId) {
  if (!confirm(`📤 ¿Transferir las rondas del grupo ${grupoId.slice(0, 6)} al juego activo?`)) return;
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/transferir/${grupoId}`, { method: "POST" });
    const data = await res.json();
    alert(data.message || "Transferencia completada.");
  } catch (err) {
    console.error("❌ Error transfiriendo grupo:", err);
  }
}

async function handleProgramGroup(grupoId) {
  const fecha = document.querySelector(`input[data-grupo="${grupoId}"][data-field="fecha"]`)?.value;
  if (!fecha) return alert("⚠️ Debes seleccionar una fecha para este grupo.");
  try {
    const res = await fetch(`${API_URL}/rondas_programadas/programar/${grupoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha })
    });
    const data = await res.json();
    alert(data.message || "Grupo programado correctamente.");
  } catch (err) {
    console.error("❌ Error programando grupo:", err);
  }
}

// =====================================
// 🔹 Evento del botón "Reiniciar juego"
// =====================================
document.getElementById("admin-reset-game")?.addEventListener("click", async () => {
  if (!currentUser || currentUser.rol_nombre !== "admin") {
    alert("⚠️ Solo el administrador puede reiniciar el juego.");
    return;
  }

  if (!confirm("❌ Esto borrará todas las rondas, números y cartones públicos. ¿Seguro?")) return;

  try {
    const res = await fetch(`${API_URL}/rondas/reset`, { method: "POST" });
    const data = await res.json();

    if (data.success) {
      resetBoardsUI();
      // Limpiar UI de ganadores y reclamos
      try { fetchGanadores({ preserveIfEmpty: true }); } catch(e) { console.warn('fetchGanadores tras reset fallo:', e); }
      try { fetchReclamosPendientes(); } catch(e) { console.warn('fetchReclamosPendientes tras reset fallo:', e); }

      alert("✅ Juego reiniciado.");
      cargarCartonesUsuario();
      cargarCartonesUsuarioPanel();
      cargarCartonesApartados();
      verCartones();
    } else {
      alert("Error al reiniciar: " + (data.error || "desconocido"));
    }
  } catch (err) {
    console.error("❌ Error al resetear juego:", err);
    alert("Error en el servidor.");
  }
});

// 👇 función para reiniciar tableros
function resetBoardsUI() {
  calledNumbers = [];
  renderBoard("board");
  renderBoard("admin-board");
  renderBoard("board-live");
  document.getElementById("last-number-admin").textContent = "--";
  document.getElementById("prev-number-admin").textContent = "--";
  document.getElementById("last-number-board").textContent = "--";
  document.getElementById("prev-number-board").textContent = "--";
  document.getElementById("last-number-board-live").textContent = "--";
  document.getElementById("prev-number-board-live").textContent = "--";
}

document.getElementById("generate-cards-button").addEventListener("click", async () => {
  const cantidad = parseInt(document.getElementById("num-cards-to-generate").value);

  if (!cantidad || cantidad <= 0) {
    alert("Debes indicar una cantidad válida de cartones.");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/cartones/generar-publicos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cantidad })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✅ Se publicaron ${data.publicados} cartones.`);
    } else {
      alert("❌ " + (data.error || "Error desconocido al generar cartones."));
    }
  } catch (err) {
    console.error("❌ Error al generar cartones:", err);
    alert("Error en el servidor.");
  }
});

// =========================
// CARGA INICIAL
// =========================

async function cargarRondasYNumeros() {
  try {
    // 1. Obtener la ronda activa
    const resRondas = await fetch(`${API_URL}/rondas/activas`);
    
    const rondas = await resRondas.json();

    if (rondas.length === 0) {
      //console.warn("⚠️ No hay rondas activas.");
      currentRoundId = null;
      updateActiveRoundUI();
      return;
    }

    currentRoundId = rondas[0].id; // tomar la primera activa

    // 2. Obtener números ya cantados
    const resNumeros = await fetch(`${API_URL}/numeros/${currentRoundId}`);
    const numeros = await resNumeros.json();

    // Marcar en los tableros
    numeros.forEach(num => {
      calledNumbers.push(num);
      markNumberInBoards(num);
    });

    // Actualizar UI último y penúltimo
    updateLastPrevUi();

    // Verificar estado de ronda y actualizar UI general
    ensureRoundActiveState('cargarRondasYNumeros');
  } catch (err) {
    console.error("❌ Error al cargar rondas y números:", err);
  }
}

function initWebSocket() {
  if (window.socket && window.socket.readyState === WebSocket.OPEN) return;

  window.socket = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host);

  window.socket.onopen = () => {
      console.log("🟢 WS conectado");

      // Si el usuario ya estaba logueado, re-avisamos al servidor
      const u = JSON.parse(localStorage.getItem("usuario"));
      if (u?.id) {
          window.socket.send(JSON.stringify({
              type: "usuario_unido",
              usuario_id: u.id,
              nombre: u.nombre,
              ts: Date.now()
          }));
      }
  };

  window.socket.onmessage = (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.warn("WS mensaje inválido:", event.data);
      return;
    }

    /* ======================================================
      🟢 EVENTO: USUARIO SE UNIÓ
    ====================================================== */
    if (msg.type === "usuario_unido") {
      console.log("🟢 Usuario entró:", msg);

      const current = JSON.parse(localStorage.getItem("usuario"));
      const isSelf = current && Number(current.id) === Number(msg.usuario_id);

      const joinId = `join:${msg.usuario_id}`;

      // Evitar spam del mismo usuario
      if (!recentJoinShown.has(joinId)) {
        markJoinShown(joinId);

        if (isSelf) {
          showRankMarqueeMessage(
            `🎉 Bienvenido ${msg.nombre}! Participa en las rondas de hoy.`,
            2
          );
        } else {
          showRankMarqueeMessage(
            `${msg.nombre} se ha unido al bingo.`,
            2
          );
        }
      }

      refreshOnlinePlayersList();
      refreshPlayersCount();
      loadRankingAndPlayers();
    }

    /* ======================================================
      🔴 EVENTO: USUARIO SALIÓ
    ====================================================== */
    if (msg.type === "usuario_salio") {
      console.log("🔴 Usuario salió:", msg);

      showTemporaryGlobalMessage(`⚫ ${msg.nombre} se ha desconectado`);

      refreshOnlinePlayersList();
      refreshPlayersCount();
    }

    /* ======================================================
      📢 EVENTO: NUEVO NÚMERO CANTADO (WS)
    ====================================================== */
    if (msg.type === "nuevo_numero") {
      console.log("📢 Número recibido en WS:", msg.numero, msg.speakText);

      if (!calledNumbers.includes(msg.numero)) {
        calledNumbers.push(msg.numero);
        markNumberInBoards(msg.numero);
        updateLastPrevUi();
      }

      // Instrucción de TTS/ping enviada por el servidor: reproducir en todos los clientes
      try {
        const text = msg.speakText || msg.numero;
        const rate = msg.speakParams?.rate;
        const pitch = msg.speakParams?.pitch;
        speakNumber(text, { rate, pitch, ping: msg.ping !== false }).catch(e => console.warn('speakNumber WS fallo:', e));
      } catch (e) { console.warn('speakNumber WS fallo (sync):', e); }
    }

    if (msg.type === "bingo_cantado") {
      console.log("🏆 Bingo cantado recibido:", msg);

      // Mostrar mensaje global
      showRankMarqueeMessage(
        `🏆 ${msg.nombre} cantó BINGO`,
        2
      );

      // Reproducir sonido y mostrar animación cuando un jugador canta bingo
      try { reproducirSonidoGanador(); } catch(e) { console.warn('reproducirSonidoGanador fallo:', e); }
      try { mostrarAnimacionGanador(); } catch(e) { console.warn('mostrarAnimacionGanador fallo:', e); }

      // 🔒 SOLO ADMIN / MOD CARGA LOS RECLAMOS
      if (
        currentUser &&
        (currentUser.rol_nombre === "admin" || currentUser.rol_nombre === "moderador")
      ) {
        // Refrescar la lista de reclamos pendientes (source of truth) cuando un jugador canta bingo
        try {
          fetchReclamosPendientes();
        } catch (e) {
          console.error('❌ Error refrescando reclamos tras bingo_cantado WS:', e);
        }
      }
    }

    if (msg.type === "reclamo_bingo") {
      const r = msg.reclamo;

      // Si soy admin o moderador, refrescar la lista completa (source of truth)
      if (currentUser && (currentUser.rol_nombre === "admin" || currentUser.rol_nombre === "moderador")) {
        try { fetchReclamosPendientes(); } catch (e) { console.warn('fetchReclamosPendientes error:', e); }
      } else {
        // Usuario normal → mostrar mensaje local breve y reproducir animación/sonido
        const cont = document.getElementById("Cartones_reclamos");
        if (cont) cont.innerHTML = `
          <p class="text-yellow-400 text-sm font-semibold">📣 Reclamo: cartón <b>${String(r.carton).padStart(3,'0')}</b> — Esperando validación.</p>
        `;
        try { reproducirSonidoGanador(); } catch(e) { console.warn('reproducirSonidoGanador fallo:', e); }
        try { mostrarAnimacionGanador(); } catch(e) { console.warn('mostrarAnimacionGanador fallo:', e); }
      }
    }

    if (msg.type === 'ganador_aprobado') {
      console.log('WS: ganador aprobado', msg.ganador);
      // Actualizar vista de ganadores y reclamos (no borrar ganadores si el endpoint responde vacío transitoriamente)
      try { fetchGanadores({ preserveIfEmpty: true }); } catch (e) { console.warn('fetchGanadores error:', e); }
      try { fetchReclamosPendientes(); } catch (e) { console.warn('fetchReclamosPendientes error:', e); }

      // Reproducir sonido de aprobado y mostrar aviso breve
      try { reproducirAprobado(); } catch (e) { console.warn('reproducirAprobado fallo:', e); }

      // Actualizar UI de partidas/status para añadir el cartón ganador al detalle de la ronda, y refrescar stats
      try { updateRondaGanadoresOnUI(msg.ganador.ronda, msg.ganador.carton); } catch (e) { console.warn('updateRondaGanadoresOnUI fallo:', e); }
      try { renderPartidasStatus(); } catch (e) { console.warn('renderPartidasStatus fallo:', e); }
      try { refreshStats(); } catch (e) { console.warn('refreshStats fallo:', e); }

      // Mostrar un aviso breve en ticker (visibilidad global)
      try { showTemporaryGlobalMessage(`🏆 Ganador aprobado: ${msg.ganador.nombre} - Cartón ${String(msg.ganador.carton).padStart(3,'0')}`, 6000); } catch (e) {}

      // Asegurar que el estado de ronda actualiza botones dependientes
      ensureRoundActiveState('ws:ganador_aprobado');
    }

    // Se borra la lista de ganadores (evento broadcast desde reset)
    if (msg.type === 'ganadores_cleared') {
      try { renderGanadores([]); } catch (e) { console.warn('renderGanadores fallo tras clear:', e); }
    }

    // Se borra la lista de reclamos (evento broadcast desde reset)
    if (msg.type === 'reclamos_cleared') {
      try { renderReclamosBingo([]); } catch (e) { console.warn('renderReclamosBingo fallo tras clear:', e); }
    }

    if (msg.type === 'reclamo_rechazado') {
      // Actualizar la lista de reclamos si alguno fue rechazado
      try { fetchReclamosPendientes(); } catch (e) { console.warn('fetchReclamosPendientes error:', e); }
      // Opcional: mostrar aviso breve
      try { showTemporaryGlobalMessage('⚠️ Reclamo rechazado', 4000); } catch (e) {}
    }

    /* ======================================================
      🧾 EVENTO: CARTONES PUBLICADOS
    ====================================================== */
    if (msg.type === "cartones_publicados") {
      console.log("📢 Cartones publicados:", msg.cartones);

      const ordenados = [...msg.cartones].sort((a, b) => a.id - b.id);
      renderCartones(ordenados.map(c => c.codigo));
      try { refreshStats(); } catch (e) { console.warn('refreshStats after cartones_publicados failed', e); }
    }

    /* ======================================================
      🧹 EVENTO: RESET DE JUEGO
    ====================================================== */
    if (msg.type === "reset_game") {
      console.log("🧹 Reset recibido");

      calledNumbers = [];

      ["board", "admin-board", "board-live"].forEach(renderBoard);

      updateLastPrevUi();

      document.getElementById("cards-display").innerHTML = `
        <p class="text-gray-400 col-span-full text-center">
          No hay cartones disponibles
        </p>
      `;

      document.getElementById("cartones-count").textContent = "0";

      // Actualizar estado de ronda (posiblemente ya no hay ronda activa)
      ensureRoundActiveState('ws:reset_game');
    }

    if (msg.type === "ganadores_detectados") {
      console.log("🏆 Ganadores detectados por WS:", msg.ganadores);

      // Mostrar los ganadores detectados (no reproducir sonido aquí — reproducir al reclamar)
      renderGanadores(msg.ganadores);

      // (no automatic disable of the verify button) 

      // 🔸 Actualizar botones de aprobación en la tabla de reclamos según los ganadores detectados
      try { updateApprovalButtonsForVerification(msg.ganadores); } catch (e) { console.warn('updateApprovalButtonsForVerification error (WS):', e); }
    }

    // ==================================================
    // 🚩 EVENTO: selecciones actualizadas por otro cliente
    // ==================================================
    if (msg.type === "selecciones_actualizadas") {
      const { usuario_id, carton, numeros } = msg;

      // Solo actualizar si corresponde al usuario logueado
      const u = JSON.parse(localStorage.getItem("usuario"));
      if (!u || Number(u.id) !== Number(usuario_id)) return;

      const cartonCodigo = String(carton).padStart(3, "0");
      const cardHeader = Array.from(document.querySelectorAll('.carton-number')).find(h => h.textContent.includes(cartonCodigo));
      if (!cardHeader) return;
      const card = cardHeader.closest('.bingo-card');
      if (!card) return;

      // Limpiar marcas previas
      card.querySelectorAll('td.marked').forEach(td => {
        td.className = "bingo-cell bg-[#eaeaea] text-[#222] text-xl font-semibold border border-[#1b1b2f] w-1/5 h-14 rounded-md cursor-pointer transition duration-300 hover:bg-yellow-200 hover:scale-105";
      });

      // Aplicar nuevas
      (numeros || []).forEach(n => {
        const cells = Array.from(card.querySelectorAll('td'));
        const target = cells.find(c => c.textContent && c.textContent.trim() === String(n));
        if (target && !target.classList.contains('marked')) {
          target.classList.add('marked', 'bg-gradient-to-br', 'from-yellow-400', 'to-yellow-600', 'text-white', 'shadow-lg');
        }
      });
    }

    if (msg.type === "selecciones_limpiar") {
      const { usuario_id, carton } = msg;
      const u = JSON.parse(localStorage.getItem("usuario"));
      if (!u || Number(u.id) !== Number(usuario_id)) return;

      const cartonCodigo = String(carton).padStart(3, "0");
      const cardHeader = Array.from(document.querySelectorAll('.carton-number')).find(h => h.textContent.includes(cartonCodigo));
      if (!cardHeader) return;
      const card = cardHeader.closest('.bingo-card');
      if (!card) return;

      card.querySelectorAll('td.marked').forEach(td => {
        td.className = "bingo-cell bg-[#eaeaea] text-[#222] text-xl font-semibold border border-[#1b1b2f] w-1/5 h-14 rounded-md cursor-pointer transition duration-300 hover:bg-yellow-200 hover:scale-105";
      });
    }

  };


  window.socket.onclose = () => {
      console.warn("WS cerrado, reintentando...");
      setTimeout(initWebSocket, 2000);
  };

  window.socket.onerror = (err) => {
      console.error("WS error:", err);
  };
}

function renderGanadores(ganadores) {
  const contenedor = document.getElementById("Ganadores");
  contenedor.innerHTML = "";

  ganadores.forEach(g => {
    contenedor.innerHTML += `
      <div class="bg-gradient-to-r from-black via-red-900 to-yellow-800 p-4 rounded mb-3 text-white shadow-lg border border-yellow-500">
        <div class="flex flex-wrap gap-4 items-center">
          <div class="text-lg font-bold text-yellow-300">🏆 Cartón #${g.carton}</div>
          <div>👤 ${g.usuario.nombre}</div>
          <div>🆔 Cédula: ${g.usuario.cedula}</div>
          <div>📞 Teléfono: ${g.usuario.telefono}</div>
          ${g.premio ? `<div class="font-semibold text-red-300">🎁 Premio: ${g.premio}</div>` : ""}
        </div>
      </div>
    `;
  });

  // Actualizar estadísticas relacionadas tras renderizar ganadores
  try { refreshStats(); } catch (e) { console.warn('refreshStats after renderGanadores failed:', e); }
}

function showRankMarqueeMessage(text, maxTimes = 2) {
    const el = document.getElementById("rank-marquee");
    if (!el) return;

    let countKey = `marquee:${text}`;
    let count = parseInt(localStorage.getItem(countKey) || "0");

    if (count >= maxTimes) return;

    count++;
    localStorage.setItem(countKey, String(count));

    el.innerText = text;

    // Reiniciar animación (marquee fake)
    el.classList.remove("animate");
    void el.offsetWidth;
    el.classList.add("animate");
}

async function cargarDisponibles() {
  try {
    const res = await fetch(`${API_URL}/cartones/disponibles`);
    if (!res.ok) return;
    const data = await res.json();

    // Actualizar contadores (API devuelve publicos/no_publicos)
    if (data && typeof data.publicos !== 'undefined') {
      const elPub = document.getElementById("cartones-publicos-count");
      const elNo = document.getElementById("cartones-no-publicos-count");
      if (elPub) elPub.textContent = data.publicos;
      if (elNo) elNo.textContent = data.no_publicos;
    }

  } catch (err) {
    console.error("❌ Error cargando cartones disponibles:", err);
  }
}

// ==========================
// PANEL DE SELECCIÓN DE CARTONES
// ==========================


async function cargarCartonesUsuario() {
  try {
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    const usuarioId = usuario?.id;
    if (!usuarioId) {
      console.error("⚠️ Usuario no autenticado o ID no encontrado.");
      return;
    }

    const res = await fetch(`${API_URL}/cartones/usuario/${usuarioId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const cartones = await res.json();
    const panel = document.getElementById("panel-cartones");
    const botonVoucher = document.getElementById("submit-voucher-button");

    // 🔸 Inicialmente deshabilitado
    botonVoucher.disabled = true;
    botonVoucher.classList.add("opacity-50", "cursor-not-allowed");

    panel.innerHTML = "";

    if (!cartones.length) {
      panel.innerHTML = `<p class="text-gray-600 text-center">No tienes cartones apartados.</p>`;
      return;
    }

    cartones.forEach(c => {
      const div = document.createElement("div");
      div.className = `
        numero-item bg-white text-gray-500 border border-gray-300 rounded-lg shadow-md
        p-3 m-2 text-center text-lg font-semibold cursor-pointer
        hover:bg-blue-100 transition select-none
      `;

      // Formato 000 para el número del cartón
      const codigoFormateado = String(c.numero ?? c.codigo ?? c.id ?? "").padStart(3, "0");
      div.textContent = codigoFormateado;
      div.dataset.id = c.id;
      div.dataset.numero = codigoFormateado;
      div.dataset.seleccionado = "false";

      // Evento de selección visual
      div.addEventListener("click", () => {
        const seleccionado = div.dataset.seleccionado === "true";
        div.dataset.seleccionado = (!seleccionado).toString();
        div.classList.toggle("border-blue-600");
        div.classList.toggle("bg-blue-100");

        // 🔹 Verificar si hay algún número seleccionado
        const algunSeleccionado = document.querySelectorAll(
          ".numero-item[data-seleccionado='true']"
        ).length > 0;

        if (algunSeleccionado) {
          botonVoucher.disabled = false;
          botonVoucher.classList.remove("opacity-50", "cursor-not-allowed");
        } else {
          botonVoucher.disabled = true;
          botonVoucher.classList.add("opacity-50", "cursor-not-allowed");
        }
      });

      panel.appendChild(div);
    });

  } catch (err) {
    console.error("❌ Error al cargar cartones:", err);
  }
}

async function cargarCartonesUsuarioPanel() {
  const usuario = JSON.parse(localStorage.getItem("usuario"));
  const usuarioId = usuario?.id;

  if (!usuarioId) {
    console.error("⚠️ Usuario no autenticado o ID no encontrado.");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/cartones/usuarios/${usuarioId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    const container = document.getElementById("bingo-cards-container");
    container.innerHTML = ""; 

    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = `<p class="text-gray-500 text-center">No tienes cartones asignados.</p>`;
      return;
    }

    // ------------------------------
    // UI: Últimos números
    // ------------------------------
    const numbersSection = document.createElement("div");
    numbersSection.className = "called-numbers grid grid-cols-2 gap-4 items-center mb-1";

    function createNumberDisplay(labelText, id) {
      const wrapper = document.createElement("div");
      wrapper.className =
        "flex items-center justify-center gap-3 p-3 rounded-xl bg-[#111827] border border-gray-700 shadow-inner text-white";
      
      const label = document.createElement("span");
      label.className = "font-semibold text-gray-300 text-md";
      label.textContent = labelText;

      const number = document.createElement("div");
      number.id = id;
      number.className =
        "text-2xl font-extrabold text-yellow-400 drop-shadow-[0_0_8px_rgba(255,215,0,0.9)] tracking-wider";
      number.textContent = "—";

      wrapper.appendChild(label);
      wrapper.appendChild(number);
      return wrapper;
    }

    // ------------------------------
    // Helpers
    // ------------------------------
    function numberToBingoFormat(n) {
      const num = Number(n);
      if (isNaN(num)) return "—";
      if (num <= 15) return `B${num}`;
      if (num <= 30) return `I${num}`;
      if (num <= 45) return `N${num}`;
      if (num <= 60) return `G${num}`;
      if (num <= 75) return `O${num}`;
      return String(num);
    }

    function flashNumber(el) {
      if (!el) return;
      el.animate(
        [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(1.15)", opacity: 1 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 400, easing: "ease-out" }
      );
    }

    function actualizarNumeros(last, prev) {
      const lastEl = document.getElementById("last-number");
      const prevEl = document.getElementById("prev-number");

      if (lastEl) {
        lastEl.textContent = last ? numberToBingoFormat(last) : "—";
        flashNumber(lastEl);
      }
      if (prevEl) {
        prevEl.textContent = prev ? numberToBingoFormat(prev) : "—";
        flashNumber(prevEl);
      }
    }

    // ------------------------------
    // Cargar números actuales
    // ------------------------------
    async function populateLastNumbers() {
      try {
        let last = null;
        let prev = null;

        if (window.calledNumbers?.length) {
          const arr = window.calledNumbers;
          last = arr[arr.length - 1] ?? null;
          prev = arr[arr.length - 2] ?? null;
        }

        actualizarNumeros(last, prev);
      } catch (err) {
        console.error("❌ Error al poblar últimos números:", err);
      }
    }

    await populateLastNumbers();

    // ------------------------------
    // WebSocket live update
    // ------------------------------
    if (window.socket) {
      window.socket.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "numbers_update" && msg.data) {
            const { last, prev } = msg.data;
            actualizarNumeros(last, prev);
          }
        } catch (err) {
          console.warn("⚠️ Mensaje WS inválido:", err);
        }
      });
    }

    // ------------------------------
    // Render de cartones
    // ------------------------------
    const grid = document.createElement("div");

    // 🟩 SOLO CAMBIAMOS ESTO → ahora 1–2–3 columnas responsive
    grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 p-1";

    data.forEach((carton) => {
      const numeros = carton.numeros;
      const codigo = carton.codigo ?? carton.numero;
      if (!numeros) return;

      const cardDiv = document.createElement("div");
      cardDiv.className =
        "bingo-card w-[280px] h-[430px] bg-gradient-to-br from-[#1b1b2f] to-[#16215e] " +
        "border-4 border-yellow-600 rounded-2xl p-2 shadow-lg";

      // Encabezado
      const cartonNumber = document.createElement("div");
      cartonNumber.className =
        "carton-number text-center text-white text-lg font-bold bg-yellow-600 py-2 mb-2 rounded-md shadow-md";
      cartonNumber.textContent = `Cartón ${String(codigo).padStart(3, "0")}`;

      // Si este cartón ya fue aprobado como ganador en rondas anteriores, marcar como deshabilitado
      const isPrevWinner = _ganadoresAprobadosMap.has(String(codigo).padStart(3,'0'));
      if (isPrevWinner) {
        const info = _ganadoresAprobadosMap.get(String(codigo).padStart(3,'0'));
        cartonNumber.classList.remove('bg-yellow-600');
        cartonNumber.classList.add('bg-gray-500');
        cartonNumber.textContent = `Cartón ganador (Ronda ${info.ronda || '—'})`;
        cardDiv.classList.add('carton-disabled', 'opacity-60');
        cardDiv.style.pointerEvents = 'none';
      }

      cardDiv.appendChild(cartonNumber);

      // BINGO Header
      const header = document.createElement("div");
      header.className =
        "bingo-header grid grid-cols-5 bg-yellow-600 text-white font-extrabold text-4xl " +
        "tracking-widest rounded-lg p-2";
      header.innerHTML = "BINGO".split("")
        .map((l) => `<div class='flex justify-center items-center'>${l}</div>`)
        .join("");
      cardDiv.appendChild(header);

      // Tabla 5x5
      const table = document.createElement("table");
      table.className = "bingo-grid w-full text-center select-none border-collapse";

      numeros.forEach((fila, filaIndex) => {
        const tr = document.createElement("tr");

        fila.forEach((num, colIndex) => {
          const td = document.createElement("td");

          if (filaIndex === 2 && colIndex === 2) {
            const img = document.createElement("img");
            img.src = "/assets/FREE/Generated Image October 22, 2025 - 3_15PM (1).png";
            img.alt = "FREE";
            img.className = "free-image pointer-events-none";
            td.appendChild(img);
            td.className = "td-free";
          } else {
            td.textContent = num;
            td.className =
              "bingo-cell bg-[#eaeaea] text-[#222] text-xl bingo-button-semibold " +
              "border border-[#1b1b2f] w-1/5 h-14 rounded-md cursor-pointer " +
              "transition duration-300 hover:bg-yellow-200 hover:scale-105";

            td.addEventListener("click", async () => {
              // Ignorar casilla FREE
              if (td.classList.contains('td-free')) return;

              const numText = td.textContent.trim();
              const numeroVal = isNaN(Number(numText)) ? numText : Number(numText);

              td.classList.toggle("marked");
              if (td.classList.contains("marked")) {
                td.classList.add(
                  "bg-gradient-to-br",
                  "from-yellow-400",
                  "to-yellow-600",
                  "text-white",
                  "shadow-lg"
                );
              } else {
                td.className =
                  "bingo-cell bg-[#eaeaea] text-[#222] text-xl font-semibold " +
                  "border border-[#1b1b2f] w-1/5 h-14 rounded-md cursor-pointer " +
                  "transition duration-300 hover:bg-yellow-200 hover:scale-105";
              }

              // Actualizar selección en servidor (toggle)
              try {
                await fetch(`${API_URL}/selecciones/toggle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ usuario_id: usuarioId, carton: codigo, numero: numeroVal })
                });
              } catch (err) {
                console.warn("Error actualizando selección en servidor:", err);
              }
            });
          }

          tr.appendChild(td);
        });

        table.appendChild(tr);
      });

      cardDiv.appendChild(table);
      grid.appendChild(cardDiv);

            /* =====================================================
         🏆 BOTÓN CANTAR BINGO (POR CARTÓN)
      ===================================================== */
      const bingoBtn = document.createElement("button");
      bingoBtn.className =
        "mt-3 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded-lg shadow cantar-bingo-btn";
      bingoBtn.textContent = "🏆 Cantar Bingo";

      // marcar si es prevWinner para preservar el estado cuando se actualice la UI
      if (isPrevWinner) {
        bingoBtn.disabled = true;
        bingoBtn.classList.add('opacity-50', 'cursor-not-allowed');
        bingoBtn.dataset.prevWinner = 'true';
      } else {
        bingoBtn.dataset.prevWinner = 'false';
        bingoBtn.addEventListener("click", (e) => {
          cantarBingoPorCarton({
            usuario_id: usuarioId,
            carton: codigo,
            btn: e.currentTarget
          });
        });
      }

      // Si no hay ronda activa, la acción no debe estar disponible
      if (!currentRoundId && !isPrevWinner) {
        bingoBtn.disabled = true;
        bingoBtn.classList.add('opacity-50', 'cursor-not-allowed');
        bingoBtn.title = 'No hay ronda activa';
      }

      cardDiv.appendChild(bingoBtn);

      grid.appendChild(cardDiv);
    });

    container.appendChild(grid);

    // Cargar selecciones previas del usuario y aplicarlas en los cartones
    await cargarSeleccionesUsuario(usuarioId);

  } catch (error) {
    console.error("❌ Error cargando cartones:", error);
    document.getElementById("bingo-cards-container").innerHTML =
      `<p class="text-red-500 text-center">Error al cargar cartones.</p>`;
  }
}

// Recupera selecciones guardadas del servidor y aplica las marcas en los cartones
async function cargarSeleccionesUsuario(usuarioId) {
  try {
    const res = await fetch(`${API_URL}/selecciones/usuario/${usuarioId}`);
    if (!res.ok) return;
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) return;

    // Para cada cartón, buscar el DOM y marcar los números
    for (const sel of data) {
      const cartonCodigo = String(sel.carton).padStart(3, "0");
      const numeros = sel.numeros || [];

      // localizar el cartón por su cabecera que contiene 'Cartón XXX'
      const cardHeader = Array.from(document.querySelectorAll('.carton-number')).find(h => h.textContent.includes(cartonCodigo));
      if (!cardHeader) continue;
      const card = cardHeader.closest('.bingo-card');
      if (!card) continue;

      numeros.forEach(n => {
        // buscar la celda con ese número y marcarla
        const cells = Array.from(card.querySelectorAll('td'));
        const target = cells.find(c => c.textContent && c.textContent.trim() === String(n));
        if (target && !target.classList.contains('marked')) {
          target.classList.add('marked', 'bg-gradient-to-br', 'from-yellow-400', 'to-yellow-600', 'text-white', 'shadow-lg');
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ No se pudieron cargar selecciones del usuario:', err);
  }
}

async function cantarBingoPorCarton({ usuario_id, carton, btn = null }) {
  try {
    console.log("🏆 Bingo reclamado - Cartón:", carton);

    // UX: mostrar spinner en el botón que lanzó la acción
    if (btn) setButtonLoading(btn, true, 'Reclamando...');

    // Cliente: comprobaciones rápidas locales para feedback inmediato
    try {
      const cartonCodigo = String(carton).padStart(3, '0');
      const cardHeader = Array.from(document.querySelectorAll('.carton-number')).find(h => h.textContent.includes(cartonCodigo));
      if (cardHeader) {
        const card = cardHeader.closest('.bingo-card');
        if (card && card.classList.contains('carton-disabled')) {
          const cont = document.getElementById("Cartones_reclamos");
          if (cont) {
            cont.innerHTML = `<p class="text-yellow-400 text-sm font-semibold">⚠️ Este cartón ya fue aprobado anteriormente y está inhabilitado.</p>`;
            setTimeout(() => { cont.innerHTML = ''; }, 5000);
          }
          if (btn) setButtonLoading(btn, false);
          return;
        }

        const cells = Array.from(card.querySelectorAll('td')).filter(td => !td.classList.contains('td-free'));
        const marked = cells.filter(td => td.classList.contains('marked'));
        if (marked.length < cells.length) {
          const cont = document.getElementById("Cartones_reclamos");
          if (cont) {
            cont.innerHTML = `<p class="text-yellow-400 text-sm font-semibold">⚠️ Tu cartón aún no está lleno</p>`;
            setTimeout(() => { cont.innerHTML = ''; }, 4000);
          }
          if (btn) setButtonLoading(btn, false);
          return;
        }

        // Asegurar que los numeros marcados fueron cantados
        const invalid = marked.some(td => {
          const t = td.textContent.trim();
          const num = isNaN(Number(t)) ? t : Number(t);
          return !calledNumbers.includes(num);
        });
        if (invalid) {
          const cont = document.getElementById("Cartones_reclamos");
          if (cont) {
            cont.innerHTML = `<p class="text-yellow-400 text-sm font-semibold">⚠️ Algunos números marcados aún no han sido cantados</p>`;
            setTimeout(() => { cont.innerHTML = ''; }, 5000);
          }
          if (btn) setButtonLoading(btn, false);
          return;
        }
      }
    } catch (e) {
      console.warn('Error comprobando cartón localmente antes de reclamar:', e);
    }

    // 🔴 Socket tiempo real (admin / moderador)
    if (window.socket) {
      socket.send(JSON.stringify({
        type: "bingo_cantado",
        usuario_id,
        carton,
        timestamp: Date.now()
      }));
    }

    // 🔵 API
    const res = await fetch(`${API_URL}/cartones/bingo-cantado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario_id,
        carton,
        origen: "boton"
      })
    });

    if (!res.ok) {
      // Si el servidor responde 409 -> reclamo duplicado
      if (res.status === 409) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || 'Ya existe un reclamo para este cartón';
        const cont = document.getElementById("Cartones_reclamos");
        if (cont) cont.innerHTML = `<p class="text-yellow-400 text-sm font-semibold">⚠️ ${escapeHtml(msg)}</p>`;
        return;
      }

      // Cartón no está lleno (respuesta del servidor de verificación inmediata)
      if (res.status === 400) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || 'Tu cartón aún no está lleno';
        const cont = document.getElementById("Cartones_reclamos");
        if (cont) {
          cont.innerHTML = `<p class="text-yellow-400 text-sm font-semibold">⚠️ ${escapeHtml(msg)}</p>`;
          setTimeout(() => { cont.innerHTML = ''; }, 4000);
        }
        return;
      }

      // Cartón fue ganador previamente y está inhabilitado
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || 'Cartón ya fue ganador previamente';
        try { showTemporaryGlobalMessage(msg, 5000); } catch(e){}
        try { await fetchGanadores({ preserveIfEmpty: true }); } catch (e) {}
        return;
      }

      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Error reclamando bingo");
    }

    // 👤 Usuario normal → mensaje
    const cont = document.getElementById("Cartones_reclamos");
    if (cont) {
      cont.innerHTML = `
        <p class="text-yellow-400 text-sm font-semibold">
          📣 Reclamo enviado del cartón <b>${carton}</b>.  
          Espera validación del administrador.
        </p>
      `;
    }

  } catch (err) {
    console.error("❌ Error al reclamar bingo:", err.message);
    // Mostrar mensaje de error al usuario
    const cont = document.getElementById("Cartones_reclamos");
    if (cont) cont.innerHTML = `<p class="text-red-400 text-sm font-semibold">❌ ${escapeHtml(err.message)}</p>`;
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}


document.getElementById("download-cards-button")?.addEventListener("click", async () => {
  const cards = document.querySelectorAll(".bingo-card");

  if (cards.length === 0) {
    alert("No hay cartones para descargar.");
    return;
  }

  // Crear contenedor oculto si no existe
  let hiddenContainer = document.getElementById("hidden-canvas-container");
  if (!hiddenContainer) {
    hiddenContainer = document.createElement("div");
    hiddenContainer.id = "hidden-canvas-container";
    hiddenContainer.style.position = "fixed";
    hiddenContainer.style.top = "-10000px";
    hiddenContainer.style.left = "-10000px";
    hiddenContainer.style.zIndex = "-1";
    hiddenContainer.style.background = "#fff";
    hiddenContainer.style.padding = "0";
    document.body.appendChild(hiddenContainer);
  }

  for (const card of cards) {
    const numberText = card.querySelector(".carton-number")?.textContent;
    const match = numberText?.match(/Cart[oó]n (\d+)/i);
    const cartonCode = match ? match[1] : "000";

    // Clonar el cartón
    const clone = card.cloneNode(true);

    // Estilo fijo para renderizado
    clone.style.height = "auto";
    clone.style.transform = "none";
    clone.style.animation = "none";
    clone.style.fontFamily = "Arial, sans-serif";
    clone.style.boxShadow = "none";

    // Eliminar animaciones internas
    clone.querySelectorAll(".animate-bounce-sparkle").forEach(el => el.classList.remove("animate-bounce-sparkle"));
    clone.querySelectorAll(".free").forEach(el => el.style.animation = "none");

    hiddenContainer.innerHTML = "";
    hiddenContainer.appendChild(clone);

    try {
      // Captura con alta resolución
      const canvas = await html2canvas(clone, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });

      // Redimensionar a 800px de ancho
      const resizedCanvas = document.createElement("canvas");
      resizedCanvas.width = 800;
      resizedCanvas.height = canvas.height / (canvas.width / 800);
      const ctx = resizedCanvas.getContext("2d");
      ctx.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);

      // Descargar imagen
      const link = document.createElement("a");
      link.download = `carton ${cartonCode}.png`;
      link.href = resizedCanvas.toDataURL("image/png");
      link.click();

      await new Promise((res) => setTimeout(res, 300));
    } catch (error) {
      console.error(`❌ Error al generar imagen del cartón ${cartonCode}:`, error);
    }
  }
});


document.getElementById("reset-cards-button").addEventListener("click", () => {
  document.querySelectorAll(".bingo-cell.marked").forEach(td => {
    td.className =
      "bingo-cell bg-[#eaeaea] text-[#222] font-semibold border border-[#1b1b2f] w-1/5 h-14 rounded-md cursor-pointer transition-all duration-300 hover:bg-yellow-200 hover:scale-105";
  });
});

// ===============================
// 🖼️ Previsualizar imágenes seleccionadas
// ===============================
const inputImagenes = document.getElementById("voucher-image");
const previewContainer = document.getElementById("voucher-preview");

inputImagenes.addEventListener("change", () => {
  previewContainer.innerHTML = ""; // limpiar previsualizaciones anteriores
  const archivos = inputImagenes.files;

  if (!archivos.length) return;

  [...archivos].forEach((archivo) => {
    const lector = new FileReader();

    lector.onload = (e) => {
      const img = document.createElement("img");
      img.src = e.target.result;
      img.className =
        "w-28 h-28 object-cover rounded-lg border border-gray-300 shadow-sm";
      previewContainer.appendChild(img);
    };

    lector.readAsDataURL(archivo);
  });
});

document.getElementById("submit-voucher-button").addEventListener("click", async () => {
  const archivos = inputImagenes?.files || [];

  if (!archivos.length) {
    alert("Por favor, selecciona al menos una imagen del comprobante.");
    return;
  }

  const usuario = JSON.parse(localStorage.getItem("usuario"));
  const usuario_id = usuario ? usuario.id : null;

  if (!usuario || !usuario_id) {
    alert("Error: no se encontró el usuario en sesión.");
    return;
  }

  const numeroReferencia = document.getElementById("numero-referencia").value.trim();
  const mensaje = document.getElementById("mensaje-comprobante")?.value || "";

  const numerosSeleccionados = Array.from(document.querySelectorAll(".numero-item.border-blue-600"))
    .map(el => el.textContent.trim());

  if (!numeroReferencia || numerosSeleccionados.length === 0) {
    alert("Debes ingresar el número de referencia y seleccionar al menos un número de cartón.");
    return;
  }

  const formData = new FormData();
  for (const archivo of archivos) {
    formData.append("imagenes", archivo);
  }

  formData.append("numero_referencia", numeroReferencia);
  formData.append("numeros_carton", JSON.stringify(numerosSeleccionados));
  formData.append("mensaje", mensaje);
  formData.append("usuario_id", usuario_id);

  try {
    const res = await fetch(`${API_URL}/vouchers/subir`, {
      method: "POST",
      body: formData,
    });

    const text = await res.text(); // 👈 leemos la respuesta en texto
    console.log("🧾 Respuesta del servidor:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Respuesta inválida del servidor: " + text);
    }

    if (!res.ok) throw new Error(data.error || "Error al subir el comprobante");

    console.log("✅ Comprobante subido correctamente:", data);
    alert("Comprobante enviado exitosamente.");

    inputImagenes.value = "";
    document.getElementById("numero-referencia").value = "";
    document.getElementById("mensaje-comprobante").value = "";
    document.getElementById("submit-voucher-button").disabled = true;
  } catch (err) {
    console.error("❌ Error al subir comprobante:", err);
    alert("Hubo un error al subir el comprobante. Revisa la consola para más detalles.");
  }
});


// Mostrar usuario logueado
function setUserStatusBar(user) {
  document.getElementById("status-username").textContent = user?.nombre || "Invitado";
}

// ---------- RONDAS PROGRAMADAS: FRONT-END ----------

// 📌 Obtener rondas programadas desde el backend
async function fetchRondasProgramadas() {
  try {
    const res = await fetch(`${API_URL}/rondas_programadas`);
    if (!res.ok) throw new Error("Respuesta no válida del servidor");
    const data = await res.json();
    console.log("📡 Rondas programadas:", data);
    return data;
  } catch (err) {
    console.error("Error al obtener rondas:", err);
    return [];
  }
}


function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}
function formatTime(t) {
  if (!t) return t;
  // t may be "HH:MM:SS" or "HH:MM"
  return t.slice(0,5);
}

// ------------ WebSocket: recibir notificaciones de rondas programadas due -------------
function setupRondasProgramadasWS(socket) {
  // socket debe estar inicializado en tu app (ya tienes initWebSocket en tu código)
  socket.addEventListener("message", async (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "rondas_programadas_due") {
        // data.rondas = array

        // mostrar a todos usuarios un banner (ej: toast) y
        // si es admin preguntar si desea activar
        if (currentUser && currentUser.rol_nombre === "admin") {
          for (const r of data.rondas) {
            const accept = confirm(`La ronda programada N°${r.numero} programada para ${r.fecha} ${r.hora} está lista para activarse.\n¿Deseas activarla ahora?`);
            if (accept) {
              // transfer endpoint
              const res = await fetch(`${API_URL}/rondas_programadas/${r.id}/transfer`, { method: "POST" });
              const resp = await res.json();
              if (!res.ok) {
                alert("Error al activar: " + (resp.error || res.statusText));
              } else {
                alert(`Ronda ${r.numero} activada correctamente.`);
                // opcional: solicitar al backend que haga broadcast de la nueva ronda en /api/rondas (si lo hace)
                // refrescar listas
                await renderRondasProgramadas();
                // también puedes recargar rondas/estado
                await cargarRondasYNumeros?.();
              }
            } else {
              // admin puede decidir activarla luego; pero avisamos en UI
              console.log("Admin pospuso la activación de la ronda", r.id);
            }
          }
        } else {
          // para usuarios normales mostramos un toast informativo o actualizamos status-bar
          // ejemplo simple:
          const msg = `Próxima ronda(s) programada(s): ${data.rondas.map(x=>x.numero).join(", ")}`;
          console.log(msg);
          // aquí puedes mostrar en la status-bar (implementa función actualizarStatusBar)
          if (typeof actualizarStatusBar === "function") actualizarStatusBar(msg);
        }
      }

      // también escuchamos cuando el backend emite que una ronda fue transferida (si lo implementas)
      if (data.type === "ronda_transferida") {
        // recargar tablas, etc
        await renderRondasProgramadas();
        await cargarRondasYNumeros?.();
      }
    } catch (err) {
      console.error("WS message parse error:", err);
    }
  });
}

// ==============================
// 🤖 BOT DE WHATSAPP — CONEXIÓN
// ==============================
async function initWhatsAppBot() {
  const connectBtn = document.getElementById("connect-bot-btn");
  const disconnectBtn = document.getElementById("disconnect-bot-btn");
  const listGroupsBtn = document.getElementById("list-groups-btn");
  const testMsgBtn = document.getElementById("test-msg-btn");
  const qrContainer = document.getElementById("qr-container");
  const qrImage = document.getElementById("qr-image");
  const statusText = document.getElementById("bot-status-text");
  const statusIndicator = document.getElementById("bot-status-indicator");
  const groupList = document.getElementById("group-list");

  // 🚀 Verificar estado al cargar (reconexión automática si ya está conectado)
  await updateBotStatus();

  // 🟢 Conectar bot
  connectBtn?.addEventListener("click", async () => {
    console.log("🟢 Botón conectar presionado");
    statusText.textContent = "Conectando...";
    qrContainer.classList.add("hidden");

    try {
      const res = await fetch(`${API_URL}/bot/connect`, { method: "POST" });
      const data = await res.json();

      console.log("📡 Respuesta:", data);

      if (data.qr) {
        qrContainer.classList.remove("hidden");
        qrImage.src = data.qr;
        statusText.textContent = "📱 Escanea el QR desde tu WhatsApp";
      } else {
        qrContainer.classList.add("hidden"); // 🧹 Oculta QR
        statusText.textContent = "Conectado ✅"; // 🟢 Estado correcto
        statusIndicator.classList.replace("bg-red-500", "bg-green-500");
        
      }

      await updateBotStatus();
    } catch (err) {
      console.error("❌ Error al conectar bot:", err);
      alert(`Error al conectar bot: ${err.message}`);
      statusText.textContent = "Error al conectar ❌";
    }
  });

  // 🔴 Desconectar bot
  disconnectBtn?.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_URL}/bot/disconnect`, { method: "POST" });
      const data = await res.json();
      alert(data.message);
      await updateBotStatus();
    } catch (err) {
      console.error("❌ Error al desconectar:", err);
      alert("No se pudo desconectar el bot.");
    }
  });

  // 📋 Listar grupos
  listGroupsBtn?.addEventListener("click", async () => {
    console.log("📋 Solicitando lista de grupos...");
    try {
      // 🔹 Llamamos al endpoint que devuelve los grupos + el seleccionado
      const res = await fetch(`${API_URL}/bot/groups`);
      const data = await res.json();

      if (data.error) {
        alert(`⚠️ ${data.error}`);
        return;
      }

      const { groups, selectedGroupId } = data; // 🧠 Nuevo: incluir el grupo guardado

      if (!groups || groups.length === 0) {
        groupList.innerHTML = "<p class='text-gray-500'>No se encontraron grupos.</p>";
        return;
      }

      // 🔹 Renderizamos los grupos con su estado (seleccionado o no)
      groupList.innerHTML = groups
        .map(
          (g) => `
          <div class="group-item flex justify-between items-center p-2 rounded-md shadow-sm border transition ${
            g.id === selectedGroupId ? "bg-gray-300" : "bg-white hover:bg-gray-100"
          }" data-group-id="${g.id}">
            <div>
              <b>${g.name || "Grupo sin nombre"}</b><br>
              <small class="text-gray-600">${g.id}</small>
            </div>
            <button 
              class="select-group-btn px-3 py-1 rounded-md font-semibold transition ${
                g.id === selectedGroupId
                  ? "bg-gray-400 text-black cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700 text-white"
              }"
              ${g.id === selectedGroupId ? "disabled" : ""}
              data-group-id="${g.id}">
              ${g.id === selectedGroupId ? "✅ Seleccionado" : "Seleccionar"}
            </button>
          </div>`
        )
        .join("");

        // Si hay un grupo seleccionado, resaltarlo automáticamente
        if (data.selectedGroupId) {
          const selectedItem = document.querySelector(
            `[data-group-id="${data.selectedGroupId}"]`
          );
          if (selectedItem) {
            selectedItem.classList.add("bg-gray-200");
            const btn = selectedItem.querySelector("button");
            btn.textContent = "✅ Seleccionado";
            btn.disabled = true;
            btn.classList.remove("bg-green-600", "hover:bg-green-700");
            btn.classList.add("bg-gray-400", "cursor-not-allowed");
          }
        }

      // 🧠 Evento dinámico para seleccionar grupo
      document.querySelectorAll(".select-group-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const groupId = e.target.dataset.groupId;
          const parent = e.target.closest(".group-item");
          const groupName = parent.querySelector("b").textContent;
          console.log("✅ Seleccionando grupo:", groupId);

          try {
            // 🔹 Llamamos al endpoint para guardar el grupo en la BD
            const res = await fetch(`${API_URL}/bot/config`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ group_id: groupId, group_name: groupName }),
            });
            const data = await res.json();

            if (data.success) {
              // 🔄 Actualiza visualmente la selección
              document.querySelectorAll(".group-item").forEach((el) => {
                el.classList.remove("bg-gray-300");
                el.classList.add("bg-white");
                const btn = el.querySelector("button");
                btn.textContent = "Seleccionar";
                btn.className =
                  "select-group-btn bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md transition";
                btn.disabled = false;
              });

              parent.classList.remove("bg-white");
              parent.classList.add("bg-gray-300");

              e.target.textContent = "✅ Seleccionado";
              e.target.className =
                "select-group-btn bg-gray-400 text-black px-3 py-1 rounded-md cursor-not-allowed";
              e.target.disabled = true;

              alert(`✅ Grupo configurado: ${groupName}`);
            } else {
              throw new Error(data.error || "Error al guardar grupo");
            }
          } catch (err) {
            console.error("❌ Error configurando grupo:", err);
            alert(`❌ Error configurando grupo: ${err.message}`);
          }
        });
      });
    } catch (err) {
      console.error("❌ Error al listar grupos:", err);
      groupList.innerHTML = "<p class='text-red-500'>Error al obtener grupos. Revisa la consola.</p>";
    }
  });

  // ============================================================
  // 👥 Botón para listar miembros del grupo seleccionado
  // ============================================================
  const listMembersBtn = document.createElement("button");
  listMembersBtn.id = "list-members-btn";
  listMembersBtn.textContent = "👥 Ver miembros del grupo";
  listMembersBtn.className =
    "px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition";

  // 🔹 Insertamos el botón después de "Listar Grupos"
  document
    .getElementById("list-groups-btn")
    ?.insertAdjacentElement("afterend", listMembersBtn);

  // ============================================================
  // 📦 Contenedor principal de miembros
  // ============================================================
  const membersSection = document.createElement("div");
  membersSection.id = "members-section";
  membersSection.className = "mt-6 hidden";
  document.getElementById("tab-configuracion").appendChild(membersSection);

  membersSection.innerHTML = `
    <div class="bg-gray-800 text-white p-4 rounded-lg shadow-md mb-2 flex justify-between items-center">
      <h3 class="text-xl font-bold">👥 Miembros del Grupo</h3>
      <input 
        type="text" 
        id="member-search" 
        placeholder="🔍 Buscar por nombre o número..." 
        class="w-64 text-black px-3 py-1 rounded-md border border-gray-300 focus:ring-2 focus:ring-green-400 outline-none"
      />
    </div>
    <div id="members-list" class="bg-gray-100 p-4 rounded-lg shadow-inner text-left text-gray-800 overflow-auto max-h-80 space-y-2"></div>
  `;

  // ============================================================
  // 👥 Botón para listar miembros del grupo
  // ============================================================
  // al hacer click: pedir miembros
listMembersBtn.addEventListener("click", async () => {
  console.log("👥 Solicitando miembros del grupo seleccionado...");
  
  const membersSection = document.getElementById("members-section");
  const membersList = document.getElementById("members-list");
  const searchInput = document.getElementById("member-search");
  const banner = document.getElementById("members-warning-banner");

  try {
    const res = await fetch(`${API_URL}/bot/members`);
    const data = await res.json();

    if (!data.success) {
      alert(`⚠️ ${data.error || "Error al obtener los miembros"}`);
      return;
    }

    const { members } = data;
    membersSection.classList.remove("hidden");

    if (!members || members.length === 0) {
      membersList.innerHTML = `<p class="text-gray-500">No hay miembros disponibles.</p>`;
      banner.classList.add("hidden");
      return;
    }

    // --- Mostrar advertencia si hay miembros sin nombre ---
    const incomplete = members.filter(m => !m.name || m.name === m.phone || m.name === "Sin nombre");

    if (incomplete.length > 0) {
      banner.classList.remove("hidden");
      banner.textContent = `⚠️ ${incomplete.length} miembro(s) sin nombre conocido. Revisa la consola del navegador/servidor para más detalles.`;
      console.warn("⚠️ Miembros sin nombre detectados:", incomplete);
    } else {
      banner.classList.add("hidden");
      banner.textContent = "";
    }

    // --- Guardar para búsquedas ---
    let allMembers = [...members];

    // --- Renderizar lista ---
    const renderMembers = (list) => {
      membersList.innerHTML = "";

      list.forEach(m => {
        const item = document.createElement("div");
        item.className = "member-item flex justify-between items-center p-2 rounded-md shadow-sm border bg-white text-gray-600 hover:bg-gray-50 transition";

        item.innerHTML = `
          <div>
            <b>${m.name || "Sin nombre"}</b><br>
            <small class="text-gray-600">📞 ${m.phone || "Desconocido"} | 🧩 ${m.role || "Miembro"}</small>
          </div>
          <button 
            class="send-private-btn bg-blue-600 hover:bg-blue-700 text-gray-700  px-3 py-1 rounded-md transition"
            data-user-id="${m.id}"
            data-user-name="${(m.name || "").replace(/"/g, "&quot;")}"
            data-user-phone="${(m.phone || "").replace(/"/g, "&quot;")}">
            💬 Enviar mensaje
          </button>
        `;

        membersList.appendChild(item);
      });

      // --- Añadir listeners ---
      membersList.querySelectorAll(".send-private-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const userId = e.target.dataset.userId;
          const userName = e.target.dataset.userName;
          const userPhone = e.target.dataset.userPhone;

          const mensaje = prompt(
            `✉️ Escribe el mensaje para ${userName || userPhone}:`,
            `Hola ${userName?.split(" ")[0] || ""} 👋, este es un mensaje automático del BingoBot`
          );
          if (!mensaje) return;

          try {
            const res = await fetch(`${API_URL}/bot/send-private`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, mensaje }),
            });
            const data = await res.json();
            if (data.success) {
              alert(`✅ Mensaje enviado a ${userName || userPhone}`);
            } else {
              alert(`❌ Error: ${data.error || "No se pudo enviar el mensaje"}`);
            }
          } catch (err) {
            console.error("❌ Error enviando mensaje privado:", err);
            alert("❌ No se pudo enviar el mensaje. Revisa la consola.");
          }
        });
      });
    };

    renderMembers(allMembers);

    // --- Filtro de búsqueda ---
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = allMembers.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(q) ||
          (m.phone || "").includes(q) ||
          (m.role || "").toLowerCase().includes(q)
      );
      renderMembers(filtered);
    };

  } catch (err) {
    console.error("❌ Error al obtener miembros:", err);
    alert("❌ Error al listar los miembros del grupo.");
  }
});


  // 🧪 Enviar mensaje de prueba
  testMsgBtn?.addEventListener("click", async () => {
    const text =
      document.getElementById("test-message-input")?.value?.trim() ||
      "🎯 Mensaje predeterminado del BingoBot";

    console.log("📨 Enviando mensaje:", text);

    try {
      const res = await fetch(`${API_URL}/bot/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json().catch(() => {
        throw new Error("❌ La respuesta del servidor no es JSON válido.");
      });

      if (data.success) {
        alert("✅ Mensaje enviado correctamente al grupo configurado.");
      } else {
        alert(`⚠️ No se pudo enviar el mensaje: ${data.error || data.message}`);
      }
    } catch (err) {
      console.error("❌ Error al enviar mensaje:", err);
      alert(`❌ Error al enviar mensaje: ${err.message}`);
    }
  });

  // 🔄 Actualizar estatus del bot
  async function updateBotStatus() {
    try {
      const res = await fetch(`${API_URL}/bot/status`);
      const data = await res.json();

      //console.log("📡 Estado actual del bot:", data);

      if (data.connected) {
        statusIndicator.classList.remove("bg-red-500");
        statusIndicator.classList.add("bg-green-500");
        statusText.textContent = "Conectado ✅";
        qrContainer.classList.add("hidden");
      } else {
        statusIndicator.classList.remove("bg-green-500");
        statusIndicator.classList.add("bg-red-500");
        statusText.textContent = "Desconectado ❌";
      }

    } catch (err) {
      console.error("⚠️ Error al obtener estado:", err);
      statusText.textContent = "Error obteniendo estado ⚠️";
    }
    
  }
}

async function renderPartidasStatus(data) {
  const container = document.getElementById("partidas-status");
  if (!container) return;

  try {
    const estadoMap = {
      "en espera": { texto: "En espera", color: "text-yellow-400", borde: "border-yellow-400" },
      "activa": { texto: "Activa", color: "text-green-400", borde: "border-green-400" },
      "finalizada": { texto: "Finalizada", color: "text-gray-400", borde: "border-gray-400" }
    };

    // Obtener datos si no vienen por argumento
    let rondas = data;
    if (!Array.isArray(rondas)) {
      const res = await fetch(`${API_URL}/rondas`);
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
      rondas = await res.json();
    }

    container.innerHTML = "";

    if (!Array.isArray(rondas) || rondas.length === 0) {
      container.innerHTML = `<p class="text-gray-400 text-center text-xs">⚠️ No hay rondas registradas.</p>`;
      return;
    }

    // Layout: dos columnas en pantallas md+, una columna en móviles
    container.className = `grid grid-cols-1 md:grid-cols-2 gap-4 p-2`;

    rondas.forEach(ronda => {
      const estado = estadoMap[(ronda.estatus || "").toLowerCase()] || estadoMap["en espera"];
      const card = document.createElement("div");
      card.className = `
        w-full bg-gray-700 hover:bg-gray-600 border ${estado.borde}
        rounded-md shadow p-3
        transition-all duration-300 cursor-pointer
      `;

      const numero = ronda.numero ?? "?";
      const premio = ronda.premio ?? 0;
      const hora = ronda.hora_inicio
        ? new Date(ronda.hora_inicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : (ronda.hora || "—");
      const ganadores = Array.isArray(ronda.ganadores)
        ? ronda.ganadores.join(", ")
        : (ronda.ganador || "—");

      card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <h3 class="font-bold text-sm text-white">Ronda ${numero}</h3>
          <span class="text-[11px] font-semibold ${estado.color}">${estado.texto}</span>
        </div>

        <div class="details hidden flex-col gap-1 text-xs text-gray-200">
          <p><strong class="text-gray-300">🕒</strong> ${hora}</p>
          <p><strong class="text-gray-300">💰</strong> ${premio} Bs.</p>
          <p><strong class="text-gray-300">🏆</strong> ${ganadores}</p>
        </div>
      `;

      card.addEventListener("click", () => {
        const details = card.querySelector(".details");
        details.classList.toggle("hidden");
      });

      container.appendChild(card);
    });
  } catch (err) {
    console.error("❌ Error al renderizar partidas-status:", err);
    container.innerHTML = `<p class="text-red-500 text-center text-xs">Error al cargar las rondas.</p>`;
  }
}

// Actualizar la UI de una ronda concreta para añadir/mergear cartones ganadores
function updateRondaGanadoresOnUI(rondaNumero, cartonNumber) {
  try {
    if (!rondaNumero) return;
    const container = document.getElementById('partidas-status');
    if (!container) return;

    const cards = Array.from(container.querySelectorAll('div'));
    for (const card of cards) {
      const h3 = card.querySelector('h3');
      if (!h3) continue;
      const text = h3.textContent || '';
      const match = text.match(/Ronda\s*(\d+)/i);
      if (!match) continue;
      const num = Number(match[1]);
      if (num !== Number(rondaNumero)) continue;

      const details = card.querySelector('.details');
      if (!details) continue;

      const trophyP = details.querySelector('p:nth-child(3)');
      if (!trophyP) continue;

      // Extraer current list, añadir si no existe
      const cur = trophyP.textContent.replace(/🏆/g, '').trim();
      const existing = cur === '—' ? [] : cur.split(',').map(s => s.trim()).filter(Boolean);
      if (!existing.includes(String(cartonNumber))) existing.push(String(cartonNumber));

      trophyP.innerHTML = `<strong class="text-gray-300">🏆</strong> ${existing.join(', ')}`;
      return;
    }
  } catch (err) {
    console.warn('updateRondaGanadoresOnUI error:', err);
  }
}

// Actualizar cada 5 segundos para reflejar cambios en tiempo real
setInterval(() => renderPartidasStatus(), 5000);
renderPartidasStatus();

// =============================
// 🔒 Helpers: habilitar/deshabilitar acciones dependientes de ronda activa
// =============================
function updateActiveRoundUI() {
  const hasActive = !!currentRoundId;

  // Admin: llamar número
  const callBtn = document.getElementById('admin-call-number');
  if (callBtn) {
    callBtn.disabled = !hasActive || !(currentUser && currentUser.rol_nombre === 'admin');
    if (!hasActive) callBtn.title = 'No hay ronda activa';
    else callBtn.title = '';
  }

  // Admin: verificar cartones
  const verifyBtn = document.getElementById('admin-verify-cards');
  if (verifyBtn) {
    verifyBtn.disabled = !hasActive || !(currentUser && (currentUser.rol_nombre === 'admin' || currentUser.rol_nombre === 'moderador'));
    if (!hasActive) verifyBtn.title = 'No hay ronda activa';
    else verifyBtn.title = '';
  }

  // Player: botones de Cantar Bingo (por cartón)
  document.querySelectorAll('.cantar-bingo-btn').forEach(btn => {
    try {
      if (!hasActive) {
        btn.disabled = true;
        btn.classList.add('opacity-50','cursor-not-allowed');
        btn.title = 'No hay ronda activa';
      } else {
        if (!btn.dataset.prevWinner || btn.dataset.prevWinner !== 'true') {
          btn.disabled = false;
          btn.classList.remove('opacity-50','cursor-not-allowed');
          btn.title = '';
        }
      }
    } catch (e) { /* ignore */ }
  });
}

// Centralizado: verificar estado de ronda y actualizar UI. Devuelve boolean (si hay ronda activa)
function ensureRoundActiveState(source = 'unknown') {
  const active = !!currentRoundId;
  try {
    // siempre actualizamos la UI
    updateActiveRoundUI();
    // mostrar un pequeño log para debug (se puede quitar luego)
    if (!active) console.debug(`ensureRoundActiveState: no hay ronda activa (origin=${source})`);
  } catch (e) {
    console.warn('ensureRoundActiveState error:', e);
  }
  return active;
}

// Añadir a window para llamadas manuales desde consola/tests
window.ensureRoundActiveState = ensureRoundActiveState;

// =========================
// BOTÓN "INICIAR / SIGUIENTE RONDA"
// =========================
async function handleNextRound() {
  const btn = document.getElementById("admin-next-round");
  btn.disabled = true;
  btn.textContent = "Procesando...";

  try {
    const res = await fetch(`${API_URL}/rondas/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al iniciar ronda");

    alert(data.message);

    // 🔄 Refrescar tablero directamente si backend lo devuelve
    if (data.rondas && Array.isArray(data.rondas)) {
      renderPartidasStatus(data.rondas);
    } else {
      await renderPartidasStatus();
    }
    resetBoardsUI();  
    // 🟢 Cambiar texto del botón
    btn.textContent = data.message.includes("Siguiente")
      ? "Iniciar Bingo"
      : "Siguiente Ronda";
    
    cargarRondasYNumeros();

    // Verificar estado y actualizar botones dependientes
    ensureRoundActiveState('handleNextRound:success');

  } catch (err) {
    console.error("❌ Error al manejar las rondas:", err);
    alert(err.message);
    btn.textContent = "Iniciar Bingo";

    // Asegurar que el UI refleja que probablemente no hay ronda activa
    ensureRoundActiveState('handleNextRound:failure');
  } finally {
    btn.disabled = false;
  }
}

// 🟩 Elementos base
const cardsDisplay = document.getElementById("cards-display");

const usuario = JSON.parse(localStorage.getItem("usuario"));
const usuario_id = usuario ? usuario.id : null;  // Si el usuario está logueado, tomamos el id

// 🎯 Manejo centralizado de clicks en el contenedor de cartones
// Usa seleccionarODesmarcarCarton(cedula, codigo, div)
cardsDisplay.addEventListener("click", (e) => {
  const card = e.target.closest("[data-carton]");
  if (!card) return;

  const codigo = card.dataset.carton;
  if (!codigo) return;

  // obtener identificación del usuario (cedula) desde localStorage o currentUser
  const usuario = JSON.parse(localStorage.getItem("usuario")) || currentUser || null;
  const cedula = usuario?.cedula || usuario?.id || null;

  // si no hay usuario logueado, avisar
  if (!cedula) {
    alert("Debes iniciar sesión para apartar o liberar cartones.");
    return;
  }

  // Llamar a la función de negocio que selecciona o desmarca el cartón
  try {
    seleccionarODesmarcarCarton(cedula, codigo, card);
  } catch (err) {
    console.error("Error al seleccionar/desmarcar cartón:", err);
  }
});

document.querySelectorAll('.config-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Actualiza estilos de pestañas
    document.querySelectorAll('.config-tab-btn').forEach(b => {
      b.classList.remove('bg-green-600', 'text-white');
      b.classList.add('bg-gray-300', 'text-gray-800');
    });
    btn.classList.add('bg-green-600', 'text-white');

    // Muestra la sección correspondiente
    document.querySelectorAll('.config-section').forEach(sec => sec.classList.add('hidden'));
    document.querySelector(btn.dataset.target).classList.remove('hidden');
  });
});

// Inserción rápida de variables en la plantilla
document.querySelectorAll(".var-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const textarea = document.getElementById("plantilla-mensaje");
    const variable = btn.dataset.var;
    const cursorPos = textarea.selectionStart;
    const text = textarea.value;
    textarea.value = text.slice(0, cursorPos) + variable + text.slice(cursorPos);
    textarea.focus();
  });
});

document.getElementById("reserve-card-button").addEventListener("click", () => {
  const targetTab = "cartones";

  // Ocultar todas las pestañas
  document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

  // Mostrar la pestaña "cartones"
  document.getElementById(`tab-${targetTab}`).classList.remove("hidden");

  // Resetear estilos de botones
  document.querySelectorAll(".tab-button").forEach(b => {
    b.classList.remove("bg-blue-700", "text-white");
    b.classList.add("bg-gray-200", "text-gray-800");
  });

  // Marcar como activo el botón correspondiente
  const activeBtn = document.querySelector(`.tab-button[data-tab="${targetTab}"]`);
  if (activeBtn) {
    activeBtn.classList.remove("bg-gray-200", "text-gray-800");
    activeBtn.classList.add("bg-blue-700", "text-white");
  }
});

// Activar pestaña visualmente
const navTabs = document.querySelectorAll(".nav-tab");
navTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    navTabs.forEach(t => t.classList.remove("bg-[#374151]"));
    tab.classList.add("bg-[#374151]");
  });
});

async function cargarListaDePermisos() {
  try {
    const res = await fetch(`${API_URL}/permisos`);
    if (!res.ok) throw new Error("No se pudo obtener la lista de permisos");

    const permisos = await res.json();

    const contenedor = document.getElementById("permiso-lista");
    contenedor.innerHTML = ""; // Limpiar contenido previo

    permisos.forEach(({ clave, descripcion }) => {
      const label = document.createElement("label");
      label.className = "flex items-center space-x-2";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "permiso-checkbox";
      checkbox.dataset.perm = clave;

      const texto = document.createElement("span");
      texto.className = "text-gray-700";
      texto.textContent = descripcion || clave;

      label.appendChild(checkbox);
      label.appendChild(texto);
      contenedor.appendChild(label);
    });
  } catch (err) {
    console.error("❌ Error al cargar lista de permisos:", err.message);
  }
}

// ✅ Cargar permisos asignados a un rol por nombre
async function cargarPermisosPorNombreDeRol(rol_nombre) {
  try {
    const res = await fetch(`${API_URL}/permisos/rol/nombre/${encodeURIComponent(rol_nombre)}`);
    if (!res.ok) throw new Error("No se pudo obtener los permisos del rol");

    const { permisos } = await res.json();

    document.querySelectorAll(".permiso-checkbox").forEach(checkbox => {
      const clave = checkbox.dataset.perm;
      checkbox.checked = permisos.includes(clave);
    });
  } catch (err) {
    console.error("❌ Error al cargar permisos del rol:", err.message);
  }
  setupAutoGuardadoDePermisos();
}

async function cargarRoles() {
  try {
    const res = await fetch(`${API_URL}/roles`);
    if (!res.ok) throw new Error("No se pudo obtener la lista de roles");

    const roles = await res.json();
    const selector = document.getElementById("rol-selector");

    // Limpiar opciones previas excepto la primera
    selector.innerHTML = `<option value="" disabled selected>-- Selecciona un rol --</option>`;

    roles.forEach(({ id, nombre }) => {
      const option = document.createElement("option");
      option.value = nombre; // Usamos el nombre como valor para buscar permisos por nombre
      option.textContent = nombre;
      selector.appendChild(option);
    });
  } catch (err) {
    console.error("❌ Error al cargar roles:", err.message);
  }
}

function setupAutoGuardadoDePermisos() {
  document.querySelectorAll(".permiso-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", async () => {
      const rolSelect = document.getElementById("rol-selector");
      const rol_nombre = rolSelect.options[rolSelect.selectedIndex].text;

      const permisosSeleccionados = Array.from(document.querySelectorAll(".permiso-checkbox"))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.perm);

      // 🧭 Guardar pestaña activa antes de aplicar cambios
      const pestañaActiva = document.querySelector(".tab-button.active");
      const pestañaId = pestañaActiva?.dataset.tab;

      try {
        const res = await fetch(`${API_URL}/permisos/rol/nombre/${encodeURIComponent(rol_nombre)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permisos: permisosSeleccionados })
        });

        if (!res.ok) throw new Error("Error al guardar permisos");

        console.log("✅ Permisos actualizados para el rol:", rol_nombre);

        // 🔄 Reaplicar permisos visuales sin recargar
        await aplicarPermisos();

        // 🔁 Restaurar pestaña activa si sigue visible
        if (pestañaId) {
          const restaurar = document.querySelector(`.tab-button[data-tab='${pestañaId}']:not(.hidden)`);
          if (restaurar) restaurar.click();
        }

      } catch (err) {
        console.error("❌ Error al guardar permisos:", err.message);
      }
    });
  });
}

// 🎯 Evento: cuando se selecciona un rol
document.getElementById("rol-selector").addEventListener("change", async e => {
  const rol_nombre = e.target.options[e.target.selectedIndex].text;
  await cargarPermisosPorNombreDeRol(rol_nombre);
});

// Obtener los botones
const btnMisCartones = document.getElementById("mis-cartones-btn");

// Obtener las vistas
const viewMisCartones = document.getElementById("mis-cartones-view");

// Cambiar a "Mis Cartones"
btnMisCartones.addEventListener("click", () => {

    // Mostrar la vista de Mis Cartones
    viewMisCartones.classList.remove("hidden");

    const sampleCard = document.getElementById("sample-bingo-card");
    if (sampleCard) {
      sampleCard.classList.add("hidden");
    }
});

// 🔹 Cargar cartones apartados del jugador
async function cargarCartonesDelJugador(cedula) {
    const contenedor = document.getElementById("cartones-elegidos-list");
    contenedor.innerHTML = "Cargando...";

    const resp = await fetch(`${API_URL}/cartones/jugadores/cartones/${cedula}`);

    if (!resp.ok) {
        contenedor.innerHTML = `<p class="text-red-400">Error al cargar cartones</p>`;
        return;
    }

    const data = await resp.json();

    contenedor.innerHTML = "";

    if (!data.cartones || data.cartones.length === 0) {
        contenedor.innerHTML =
        `<p class="text-gray-400 text-center">No tienes cartones apartados</p>`;
        return;
    }

    data.cartones.forEach(num => {
        const div = document.createElement("div");
        div.className =
            "bg-blue-600 text-white p-4 rounded-xl text-center font-bold shadow-md";

        div.textContent = String(num).padStart(3,'0');

        contenedor.appendChild(div);
    });
}

// 🔹 Función para manejar la selección o deselección de cartón

async function seleccionarODesmarcarCarton(cedula, codigo, div) {
    // Verificar si el cartón ya está en "Tus cartones elegidos"
    const elegidoList = document.getElementById("cartones-elegidos-list");
    const codigoStr = String(codigo).padStart(3, '0');
    const cardElegido = Array.from(elegidoList.children).find(child => child.textContent === codigoStr);

    if (cardElegido) {
        // Si el cartón ya está elegido, deseleccionarlo (quitarlo de la lista y liberar en la base de datos)
        cardElegido.remove(); // Eliminar de la lista de "Tus cartones elegidos"

        // Asegurarse de detener cualquier animación en la tarjeta origen
        try {
          // 'div' es la tarjeta en cards-display pasada desde el listener
          if (div && div.classList) {
            div.classList.remove("animate-pulse");
            div.classList.remove("bg-blue-500");
            div.classList.add("bg-green-500");
          } else {
            // intentar buscar la tarjeta en el contenedor por data attribute
            const origin = document.querySelector(`[data-carton="${String(codigo)}"]`);
            if (origin) {
              origin.classList.remove("animate-pulse");
              origin.classList.remove("bg-blue-500");
              origin.classList.add("bg-green-500");
            }
          }
        } catch (e) {
          console.warn("Error limpiando animación de la tarjeta:", e);
        }

        // Liberar cartón en la base de datos
        await liberarCarton(cedula, codigo);
    } else {
        // Si el cartón no está seleccionado, hacer parpadeo y agregarlo a la lista de elegidos
        if (div && div.classList) div.classList.add("animate-pulse");

        // Apartar el cartón en la base de datos
        const resp = await fetch(`${API_URL}/cartones/apartar-directo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cedula, id_carton: codigo })
        });

        const data = await resp.json();

        if (!resp.ok) {
            // En caso de error, quitar la animación y mostrar error
            if (div && div.classList) div.classList.remove("animate-pulse");
            return alert("Error: " + (data.error || "No se pudo apartar el cartón"));
        }

        // Mostrar el cartón en la sección de "Tus cartones elegidos"
        const divElegido = document.createElement("div");
        // Tamaño más compacto: pequeño padding, fuente reducida y dimensiones fijas
        divElegido.className = "bg-blue-500 text-white font-bold p-2 text-center rounded-md shadow-sm cursor-pointer text-sm flex items-center justify-center";
        divElegido.style.minWidth = "3.2rem";
        divElegido.style.minHeight = "2rem";
        divElegido.textContent = codigoStr;
        // Permitir deseleccionar al hacer clic: pasar la tarjeta origen si existe
        divElegido.onclick = () => seleccionarODesmarcarCarton(cedula, codigo, div);

        elegidoList.appendChild(divElegido);

        // Detener parpadeo en la tarjeta origen una vez confirmado
        try {
          if (div && div.classList) {
            div.classList.remove("animate-pulse");
            // marcar visualmente como "apartado"
            div.classList.remove("bg-green-500");
            div.classList.add("bg-blue-500");
          } else {
            const origin = document.querySelector(`[data-carton="${String(codigo)}"]`);
            if (origin) {
              origin.classList.remove("animate-pulse");
              origin.classList.remove("bg-green-500");
              origin.classList.add("bg-blue-500");
            }
          }
        } catch (e) {
          console.warn("Error limpiando animación post-apartar:", e);
        }
    }
    // refrescar lista del usuario
    cargarCartonesUsuario();
    verCartones();
}

// 🔹 Función para liberar el cartón (marcar como disponible nuevamente)
async function liberarCarton(cedula, codigo) {
    const resp = await fetch(`${API_URL}/cartones/liberar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cedula, id_carton: codigo })
    });

    const data = await resp.json();

    if (!resp.ok) return alert("Error al liberar el cartón: " + data.error);
    // Liberar el cartón en la base de datos
    await fetch(`${API_URL}/cartones/inventario/liberar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_carton: codigo })
    });

}

document.getElementById("btn-buscar-mis-cartones")
.addEventListener("click", async () => {

    const cedula = document.getElementById("cedula-mis-cartones").value.trim();
    const grid = document.getElementById("mis-cartones-grid");
    const controls = document.getElementById("mis-cartones-controls");

    if (!cedula) return alert("Ingrese una cédula");

    grid.innerHTML = "Buscando...";
    controls.classList.add("hidden");

    const resp = await fetch(`${API_URL}/cartones/por-cedula/${cedula}`);
    const data = await resp.json();

    if (!data.cartones || data.cartones.length === 0) {
        grid.innerHTML = "<p class='text-red-500'>No se encontraron cartones.</p>";
        return;
    }

    controls.classList.remove("hidden");

    const ordenados = data.cartones.sort((a, b) => a.id - b.id);
    grid.innerHTML = "";

    ordenados.forEach(c => {
        const div = document.createElement("div");
        div.className =
            "bg-blue-600 hover:bg-blue-500 text-white font-bold p-4 text-center rounded-lg shadow cursor-pointer";
        div.textContent = c.codigo.toString().padStart(3, '0');
        grid.appendChild(div);
    });
});

document.getElementById("mis-cartones-download")
.addEventListener("click", async () => {

    const cedula = document.getElementById("cedula-mis-cartones").value.trim();

    const url = `${API_URL}/cartones/descargar/${cedula}`;
    window.open(url, "_blank");
});

document.getElementById("mis-cartones-reset").addEventListener("click", () => {
    document.getElementById("cedula-mis-cartones").value = "";
    document.getElementById("mis-cartones-grid").innerHTML = "";
    document.getElementById("mis-cartones-controls").classList.add("hidden");
});

// Activar pestaña visualmente
const tabButtons = document.querySelectorAll(".tab-button");
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    tabButtons.forEach(b => b.classList.remove("bg-[#374151]")); // quitar fondo activo
    btn.classList.add("bg-[#374151]"); // aplicar fondo activo
  });
});

function setupUserMenuSafe() {
  const btn = document.getElementById("user-menu-button");
  const menu = document.getElementById("user-menu");
  if (!btn || !menu) {
    console.warn("setupUserMenuSafe: user-menu-button o user-menu no encontrados");
    return;
  }

  // evitar doble inicialización
  if (btn.dataset.menuInitialized === "1") return;
  btn.dataset.menuInitialized = "1";

  let open = false;
  const openMenu = () => {
    menu.classList.remove("hidden");
    open = true;
    btn.setAttribute("aria-expanded", "true");
    console.log("user-menu: abierto");
  };
  const closeMenu = () => {
    menu.classList.add("hidden");
    open = false;
    btn.setAttribute("aria-expanded", "false");
    console.log("user-menu: cerrado");
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    setTimeout(() => (open ? closeMenu() : openMenu()), 0);
  });

  // Prevenir que clic dentro del menu cierre por el listener global
  menu.addEventListener("click", (e) => e.stopPropagation());

  // Cerrar al click fuera o con ESC
  document.addEventListener("click", () => {
    if (open) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (open) closeMenu();
      const modal = document.getElementById("user-profile-modal");
      if (modal && !modal.classList.contains("hidden")) closeModal(modal);
    }
  });

  // Manejo del modal de perfil
  const perfilBtn = document.getElementById("user-profile");
  const logoutBtn = document.getElementById("logout-button");
  const modal = document.getElementById("user-profile-modal");

  function openModal(m) {
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
    // focus al primer campo si existe
    setTimeout(() => m.querySelector("input, button, select")?.focus(), 50);
  }
  function closeModal(m) {
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
  }

  if (perfilBtn) {
    perfilBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      if (modal) openModal(modal);
    });
  }

  if (modal) {
    // cerrar al clicar en el overlay (fuera del contenido)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
    // detectar botones de cierre comunes dentro del modal
    modal.querySelectorAll("[data-modal-close], .modal-close, #auth-modal-close, #close-modal").forEach((el) =>
      el.addEventListener("click", () => closeModal(modal))
    );
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      if (typeof logout === "function") {
        try {
          logout();
        } catch (err) {
          console.warn("Logout handler lanzó error:", err);
        }
      }
    });
  }

  console.log("setupUserMenuSafe: inicializado correctamente");
}

// Helper closeModal en scope global si se usa desde listeners de teclado
function closeModal(m) {
  if (!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
}

function renderRankTicker() {
  const marquee = document.getElementById("rank-marquee");
  if (!marquee) return;

  // Si no hay usuario logueado mostramos el mensaje promocional
  if (!currentUser) {
    marquee.textContent =
      "Juega al bingo en línea, interactúa y compite por premios. ¡Regístrate para empezar a jugar!";
    marquee.classList.remove("has-data");
    return;
  }

  // Usuario logueado: intentamos obtener info dinámica del backend (endpoint de ejemplo)
  marquee.textContent = "";
  marquee.classList.add("has-data");

  // Intentamos obtener ranking / actividad; si el endpoint no existe, caemos al fallback
  fetch(`${API_URL}/usuarios/ranking`)
    .then(async (res) => {
      if (!res.ok) throw new Error("No ranking");
      const json = await res.json();
      // asumimos json es array [{name, score}, ...] — adaptarlo según tu API real
      if (!Array.isArray(json) || json.length === 0) {
      // No mostrar mensaje de "se unió" aquí para evitar duplicados; usamos WebSocket para eso
      const name = currentUser?.nombre || currentUser?.name || currentUser?.cedula || "Usuario";
      marquee.textContent = `Bienvenido, ${name}! Participa en las rondas de hoy.`;
        return;
      }
      const items = json
        .slice(0, 10)
        .map((u) => `${u.name || u.nombres || u.nombre || u.cedula} (${u.score ?? u.puntos ?? ""})`)
        .join(" • ");
      marquee.textContent = items;
    })
    .catch(() => {
      // No mostrar mensaje de "se unió" aquí para evitar duplicados; usamos WebSocket para eso
      const name = currentUser?.nombre || currentUser?.name || currentUser?.cedula || "Usuario";
      marquee.textContent = `Bienvenido, ${name}! Participa en las rondas de hoy.`;
    });
}

// =======================================================
// 🏆 RANKING + LISTA (SIN LIMPIAR JUGADORES ONLINE)
// =======================================================
async function loadRankingAndPlayers() {
  try {
    const res = await fetch(`${API_URL}/usuarios/ranking`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      console.warn("No se pudo cargar ranking:", data);
      updateRanking([]);
      return;
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];

    const rankingItems = rows.map(r => ({
      nombre: r.nombre || r.name || r.cedula || "Jugador",
      rondas: r.rondas ?? r.rondas_jugadas ?? 0,
      estado: r.estado || '',
      pct: Math.round(((r.puntos ?? r.puntos_total ?? 0) / 100))
    }));

    updateRanking(rankingItems);

  } catch (err) {
    console.warn("Error cargando ranking:", err);
    updateRanking([]);
  }
}

const btnVerify = document.getElementById("admin-verify-cards");
let _verifyingInProgress = false;

async function verifyCartones({ manual = true } = {}) {
  if (_verifyingInProgress) return;
  _verifyingInProgress = true;

  if (manual) {
    try { setButtonLoading(btnVerify, true, 'Verificando...'); } catch (e) { console.warn('setButtonLoading not available', e); }
  }

  try {
    const res = await fetch(`${API_URL}/cartones/verificar-ganadores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      // try to show server-provided message
      let body = null;
      try { body = await res.json(); } catch (e) { /* ignore */ }
      const msg = (body && (body.error || body.mensaje)) ? (body.error || body.mensaje) : `Error consultando ganadores (status ${res.status})`;

      document.getElementById("Ganadores").innerHTML = `
        <div class="text-red-500 font-bold">❌ ${escapeHtml(msg)}</div>
      `;

      if (manual) try { setButtonLoading(btnVerify, false); } catch (e) { console.warn('setButtonLoading not available', e); }
      _verifyingInProgress = false;
      return;
    }

    const data = await res.json();

    const contenedor = document.getElementById("Ganadores");
    contenedor.innerHTML = "";

    const ganadores = Array.isArray(data.ganadores) ? data.ganadores : [];

    if (ganadores.length === 0) {
      const msgEmpty = data && data.mensaje ? data.mensaje : 'No hay cartones ganadores todavía';
      contenedor.innerHTML = `
        <div class="text-yellow-400 font-bold text-lg">
          ❌ ${escapeHtml(msgEmpty)}
        </div>`;
      if (manual) try { setButtonLoading(btnVerify, false); } catch (e) { console.warn('setButtonLoading not available', e); }
      _verifyingInProgress = false;
      return;
    }

    // 🎊 Mostrar ganadores (sin reproducir sonido aquí — sonido se reproduce al reclamar)
    renderGanadores(ganadores);

    // 🔸 Habilitar botones de aprobación/rechazo en la tabla de reclamos según la verificación
    try { updateApprovalButtonsForVerification(ganadores); } catch(e) { console.warn('updateApprovalButtonsForVerification error:', e); }

    // El botón no se deshabilita automáticamente; el admin puede volver a verificar manualmente
    if (manual) {
      try { setButtonLoading(btnVerify, false); } catch (e) { console.warn('setButtonLoading not available', e); }
    }

  } catch (err) {
    console.error("❌ Error verificando cartones:", err);

    document.getElementById("Ganadores").innerHTML = `
      <div class="text-red-500 font-bold">
        ❌ Error al verificar cartones
      </div>`;

    if (manual) try { setButtonLoading(btnVerify, false); } catch (e) { console.warn('setButtonLoading not available', e); }
  } finally {
    _verifyingInProgress = false;
  }
}

btnVerify.addEventListener("click", async () => {
  await verifyCartones({ manual: true });
});

// Auto-verificación para admins/moderadores
let _autoVerifyInterval = null;
function startAutoVerifyIfAdmin() {
  if (!currentUser) return;
  if (!(currentUser.rol_nombre === 'admin' || currentUser.rol_nombre === 'moderador')) return;
  if (_autoVerifyInterval) return; // ya iniciado

  // Increased auto-verification interval to 30s to reduce load
  _autoVerifyInterval = setInterval(async () => {
    await verifyCartones({ manual: false });
  }, 30000); // every 30s
}

function stopAutoVerify() {
  if (_autoVerifyInterval) { clearInterval(_autoVerifyInterval); _autoVerifyInterval = null; }
}

// Mostrar mensaje corto sólo para administradores/moderadores (no en el ticker global)
function showAdminTempMessage(text, ttl = 4000) {
  try {
    if (!currentUser) return; // seguridad extra
    if (!(currentUser.rol_nombre === 'admin' || currentUser.rol_nombre === 'moderador')) return;

    const el = document.getElementById('status-msg');
    if (!el) return;
    const prev = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = prev; }, ttl);
  } catch (err) {
    console.warn('showAdminTempMessage error:', err);
  }
}

// Refrescar estadísticas globales y contadores visibles en la UI
async function refreshStats() {
  try {
    // 1) Usuarios con cartones apartados/aprobados
    const apartRes = await fetch(`${API_URL}/cartones/apartados`);
    let apart = [];
    if (apartRes.ok) apart = await apartRes.json();
    const uniqueUsers = new Set((apart || []).map(r => r.cedula || r.nombre || r.telefono));
    document.getElementById('stats-total-users').textContent = uniqueUsers.size;

    // 2) Rondas finalizadas (rondas jugadas)
    const rondasRes = await fetch(`${API_URL}/rondas`);
    let rondas = [];
    if (rondasRes.ok) rondas = await rondasRes.json();
    const finalizadas = (rondas || []).filter(r => (r.estatus || '').toLowerCase() === 'finalizada').length;
    document.getElementById('stats-total-games').textContent = finalizadas;

    // 3) Bingos aprobados
    const ganRes = await fetch(`${API_URL}/cartones/ganadores`);
    let ganadores = [];
    if (ganRes.ok) ganadores = await ganRes.json();
    document.getElementById('stats-total-bingos').textContent = Array.isArray(ganadores) ? ganadores.length : 0;

    // 4) Cartones públicos / no públicos
    try { await cargarDisponibles(); } catch (e) { console.warn('cargarDisponibles error in refreshStats:', e); }
  } catch (err) {
    console.warn('refreshStats error:', err);
  }
}

function reproducirSonidoGanador() {
  const audio = new Audio("/assets/sounds/Bingo.mp3");
  audio.play().catch(() => {});
}

function mostrarAnimacionGanador() {
  document.body.classList.add("ganador-flash");
  setTimeout(() => {
    document.body.classList.remove("ganador-flash");
  }, 3000);
}

function reproducirAprobado() {
  const audio = new Audio("/assets/sounds/Aprobado.mp3");
  audio.play().catch(() => {});
}

// Helper: show/hide a small spinner on a button and update its label
function setButtonLoading(btn, loading = true, text) {
  try {
    if (!btn) return;

    if (loading) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      if (!btn.dataset.origDisabled) btn.dataset.origDisabled = String(btn.disabled || false);
      btn.disabled = true;
      const label = text || (btn.dataset && btn.dataset.origHtml ? null : btn.textContent) || "Procesando...";
      // spinner SVG (small)
      const spinner = `<svg class="animate-spin inline-block mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>`;
      btn.innerHTML = `${spinner}${escapeHtml(String(label))}`;
    } else {
      // restore
      btn.disabled = false;
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
      if (btn.dataset.origDisabled) delete btn.dataset.origDisabled;
    }
  } catch (err) {
    console.warn('setButtonLoading error:', err);
    try { btn.disabled = !loading; } catch(e){}
  }
}

function esCartonGanador(matriz, numerosCantados) {
  const cantados = new Set(numerosCantados);

  const marcado = n => n === null || cantados.has(n);

  // Filas
  for (const fila of matriz) {
    if (fila.every(marcado)) return true;
  }

  // Columnas
  for (let c = 0; c < 5; c++) {
    if (matriz.every(fila => marcado(fila[c]))) return true;
  }

  // Diagonales
  if (
    matriz.every((fila, i) => marcado(fila[i])) ||
    matriz.every((fila, i) => marcado(fila[4 - i]))
  ) return true;

  return false;
}

const checkBingo = document.getElementById("check-cantar-bingo");
const bingoWarning = document.getElementById("bingo-warning");

let recognition = null;
let micActivo = false;

checkBingo.addEventListener("change", async () => {
  if (checkBingo.checked) {
    bingoWarning.classList.remove("hidden");
    await activarMicrofono();
  } else {
    bingoWarning.classList.add("hidden");
    desactivarMicrofono();
  }
});

async function activarMicrofono() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    alert("Tu navegador no soporta reconocimiento de voz");
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const texto = event.results[event.results.length - 1][0].transcript
      .toLowerCase()
      .trim();

    console.log("🎙️ Detectado:", texto);

    if (texto.includes("bingo")) {
      console.log("🎙️ ¡BINGO DETECTADO POR VOZ!");
      cantarBingo("voz");
    }

  };

  recognition.onerror = (e) => {
    console.error("🎙️ Error micrófono:", e);
  };

  recognition.start();
  micActivo = true;
  console.log("🎤 Micrófono activado");
}

function mostrarAvisoNoGanador() {
  const cont = document.getElementById("Ganadores");
  cont.innerHTML = `
    <div class="bg-red-900 text-red-200 p-3 rounded-lg text-center font-bold">
      ❌ Bingo inválido — el cartón no coincide
    </div>
  `;
}

function desactivarMicrofono() {
  if (recognition && micActivo) {
    recognition.stop();
    recognition = null;
    micActivo = false;
    console.log("🎤 Micrófono desactivado");
  }
}

function renderReclamosBingo(reclamos = []) {
  const contenedor = document.getElementById("Cartones_reclamos");

  if (!Array.isArray(reclamos) || reclamos.length === 0) {
    contenedor.innerHTML = `
      <p class="text-yellow-400 text-sm">
        ⚠️ Bingo cantado, pero no tienes cartones registrados
      </p>`;
    return;
  }

  // Si es admin o moderador mostramos la columna de aprobación
  const esAdmin = currentUser && (currentUser.rol_nombre === "admin" || currentUser.rol_nombre === "moderador");

  contenedor.innerHTML = `
    <table class="w-full text-sm text-white border border-gray-700 rounded">
      <thead class="bg-gray-800">
        <tr>
          <th class="px-2 py-1 border">Cartón</th>
          <th class="px-2 py-1 border">Nombre</th>
          <th class="px-2 py-1 border">Teléfono</th>
          ${esAdmin ? '<th class="px-2 py-1 border">Aprobación</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${reclamos.map(r => `
          <tr class="bg-gray-900" data-id="${r.id ?? ''}" data-carton="${r.carton}">
            <td class="px-2 py-1 border text-center font-bold">${String(r.carton).padStart(3, '0')}</td>
            <td class="px-2 py-1 border">${escapeHtml(r.nombre)}</td>
            <td class="px-2 py-1 border">${escapeHtml(r.telefono)}</td>
            ${esAdmin ? `
              <td class="px-2 py-1 border text-center">
                ${r.estado === 'aprobado' ? `
                  <span class="inline-block bg-green-700 text-white px-3 py-1 rounded font-semibold">Aprobado</span>
                ` : r.estado === 'rechazado' ? `
                  <span class="inline-block bg-red-700 text-white px-3 py-1 rounded font-semibold">Rechazado</span>
                ` : `
                  <button class="approve-btn bg-green-600 text-white px-3 py-1 rounded mr-2" data-id="${r.id}" data-carton="${r.carton}" disabled>Aprobar</button>
                  <button class="reject-btn bg-red-600 text-white px-3 py-1 rounded" data-id="${r.id}" data-carton="${r.carton}" disabled>Rechazar</button>
                `}
              </td>
            ` : ''}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // Añadimos delegación de eventos para los botones (si es admin)
  if (esAdmin) {
    contenedor.querySelectorAll('.approve-btn, .reject-btn').forEach(btn => {
      // asegurarnos de que el listener no se duplique
      btn.removeEventListener('click', handleReclamoAction);
      btn.addEventListener('click', handleReclamoAction);
    });
  }
}

// Cargar reclamos pendientes (admins/mods) desde backend
async function fetchReclamosPendientes() {
  try {
    const res = await fetch(`${API_URL}/cartones/reclamos/pendientes`);
    if (!res.ok) return renderReclamosBingo([]);
    const rows = await res.json();
    renderReclamosBingo(rows);
  } catch (err) {
    console.warn('fetchReclamosPendientes error:', err);
  }
}

// Manejar clicks en los botones de aprobar/rechazar (delegado)
async function handleReclamoAction(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const carton = btn.dataset.carton;
  if (!id) return alert('Falta id del reclamo');

  if (btn.classList.contains('approve-btn')) {
    // Aprobar reclamo
    try {
      btn.disabled = true;
      btn.textContent = 'Procesando...';

      // 1) Marcar reclamo como aprobado y persistir ganador (el endpoint ya hace el upsert en 'ganadores' y envía WS)
      const res = await fetch(`${API_URL}/cartones/reclamos/${id}/aprobar`, { method: 'PUT' });
      if (!res.ok) {
        // try to surface server-provided message
        let body = null; try { body = await res.json(); } catch (e) {}
        const msg = body && (body.error || body.mensaje) ? (body.error || body.mensaje) : 'Error aprobando reclamo';
        throw new Error(msg);
      }

      const body = await res.json();
      if (!body || !body.success) throw new Error('Error guardando ganador');

      // 2) Refresh UI (approved reclamo will remain visible due to endpoint change)
      await Promise.allSettled([fetchReclamosPendientes(), fetchGanadores({ preserveIfEmpty: true })]);

      // Optionally show a success message with ganador info and play aprobado sound
      try {
        if (body.ganador) {
          reproducirAprobado();
          const cartonMsg = String(body.ganador.carton || btn.dataset.carton || '000').padStart(3,'0');
          const nombre = escapeHtml(body.ganador.nombre || 'Jugador');
          showTemporaryGlobalMessage(`🏆 Ganador guardado: ${nombre} - Cartón ${cartonMsg}`, 5000);
        }
      } catch(e) { console.warn('mostrar mensaje de ganador fallo:', e); }
    } catch (err) {
      console.error('approve reclamo error:', err);
      btn.disabled = false;
      btn.textContent = 'Aprobar';
    }
  }

  if (btn.classList.contains('reject-btn')) {
    try {
      btn.disabled = true;
      btn.textContent = 'Procesando...';

      const res = await fetch(`${API_URL}/cartones/reclamos/${id}/rechazar`, { method: 'PUT' });
      if (!res.ok) throw new Error('Error rechazando reclamo');

      await fetchReclamosPendientes();
    } catch (err) {
      console.error('reject reclamo error:', err);
      btn.disabled = false;
      btn.textContent = 'Rechazar';
    }
  }
}

// Actualiza los botones de aprobación/rechazo después de ejecutar la verificación
function updateApprovalButtonsForVerification(ganadores = []) {
  const winners = new Set((ganadores || []).map(g => String(g.carton)));
  const table = document.getElementById('Cartones_reclamos');
  if (!table) return;

  table.querySelectorAll('tr[data-carton]').forEach(tr => {
    const carton = tr.dataset.carton;
    const approveBtn = tr.querySelector('.approve-btn');
    const rejectBtn = tr.querySelector('.reject-btn');

    if (winners.has(String(carton))) {
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false; // permitir también rechazar si fuese necesario
    } else {
      if (approveBtn) approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = false; // permitir rechazo de los que no sean válidos
    }
  });
}

// Cargar ganadores desde backend (para mostrar en #Ganadores)
// preserveIfEmpty: if true, do not clear existing UI when server returns an empty list (useful after approve actions)
async function fetchGanadores({ preserveIfEmpty = false } = {}) {
  try {
    const res = await fetch(`${API_URL}/cartones/ganadores`);
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    if (rows.length === 0 && preserveIfEmpty) return; // keep existing UI

    // Build map of approved winners for UI disabling
    _ganadoresAprobadosMap = new Map();
    rows.forEach(r => {
      try { _ganadoresAprobadosMap.set(String(r.carton).padStart(3,'0'), { ronda: r.ronda, usuario: r.usuario }); } catch(e){}
    });

    renderGanadores(rows);

    // Apply disabled visuals to any rendered cartones
    try { applyDisabledWinnersToRenderedCartones(); } catch(e) { console.warn('applyDisabledWinners failed:', e); }
  } catch (err) {
    console.warn('fetchGanadores error:', err);
  }
} 

// =====================================
// 🔹 Inicialización general
// =====================================

document.addEventListener("DOMContentLoaded", async () => {

  try { loadRankingAndPlayers(); } catch (e) {}

  try {
    // 🔸 Cargar usuario desde localStorage
    currentUser = JSON.parse(localStorage.getItem("usuario")) || null;

    // Cargar lista de usuarios y contador al iniciar la página
    refreshOnlinePlayersList();
    try { refreshPlayersCount(); } catch (e) { console.warn('refreshPlayersCount inicial falló:', e); }

    // Inicializar voces TTS (si está disponible)
    try { populateSpeechVoices(); } catch (e) { console.warn('populateSpeechVoices inicial falló:', e); }

    // Cargar ganadores al iniciar (público)
    try { await fetchGanadores(); } catch (e) { console.warn('fetchGanadores inicial falló:', e); }

    // Si soy admin o moderador, además traer reclamos pendientes
    if (currentUser && (currentUser.rol_nombre === 'admin' || currentUser.rol_nombre === 'moderador')) {
      try { await fetchReclamosPendientes(); } catch (e) { console.warn('fetchReclamosPendientes inicial falló:', e); }
    }

    // 🔸 Render inicial del ticker (muestra mensaje si no hay usuario)
    try { renderRankTicker(); } catch (e) { console.warn("renderRankTicker no disponible:", e); }

    // 🔸 Cargar datos iniciales (safe calls)
    await Promise.allSettled([cargarRondasYNumeros(), cargarDisponibles()]);

    // 🔸 Si es admin, cargar recursos extra (safe)
    if (currentUser?.rol_nombre === "admin") {
      await Promise.allSettled([cargarCartonesApartados(), cargarListaDePermisos(), cargarGrupos(), cargarRoles()]);
    }

    // 🔸 Inicializaciones principales (safe)
    await Promise.allSettled([initWhatsAppBot(), (async () => initWebSocket())()]);
    try { aplicarPermisos(); } catch (e) { console.warn("aplicarPermisos error:", e); }

    // 🔸 Binding para auto-canto (admin) — habilita start/stop desde UI
    try {
      const autoToggle = document.getElementById('admin-auto-toggle');
      const autoCallInterval = document.getElementById('auto-call-interval');
      const autoBrakeInterval = document.getElementById('auto-brake-interval');
      const autoNextInterval = document.getElementById('auto-next-interval');

      async function apiAutoStart() {
        const body = {
          callIntervalSec: Number(autoCallInterval?.value) || 5,
          brakeIntervalSec: Number(autoBrakeInterval?.value) || 5,
          nextIntervalSec: Number(autoNextInterval?.value) || 5
        };
        const res = await fetch(`${API_URL}/auto/start`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        return res.json();
      }

      async function apiAutoStop() {
        const res = await fetch(`${API_URL}/auto/stop`, { method: 'POST' });
        return res.json();
      }

      if (autoToggle) {
        autoToggle.addEventListener('change', async (e) => {
          if (autoToggle.checked) {
            try { await apiAutoStart(); showAdminTempMessage('Auto-canto iniciado', 3000); } catch (err) { console.error('start auto error', err); autoToggle.checked = false; }
          } else {
            try { await apiAutoStop(); showAdminTempMessage('Auto-canto detenido', 3000); } catch (err) { console.error('stop auto error', err); autoToggle.checked = true; }
          }
        });
      }
    } catch (e) { console.warn('auto-canto binding error:', e); }

    // 🔸 Si el usuario está logueado, cargar sus cartones y selecciones
    if (currentUser?.id) {
      try { await cargarCartonesUsuarioPanel(); } catch (e) { console.warn('Error cargando panel de cartones del usuario:', e); }
    }

    // 🔸 Refrescar estadísticas y estados visibles (a intervalos)
    try { await refreshStats(); } catch (e) { console.warn('refreshStats inicial falló:', e); }
    setInterval(() => { try { refreshStats(); } catch (e) {} }, 10000);

    try { renderPartidasStatus(); } catch (e) {}
    try { cargarCartonesUsuario(); } catch (e) {}
    try { verCartones(); } catch (e) {}
    try { cargarProyecciones(); } catch (e) {}
    try { cargarCartonesUsuarioPanel(); } catch (e) {}

    // 🔸 Botón siguiente ronda (si existe)
    const btnNext = document.getElementById("admin-next-round");
    if (btnNext) {
      btnNext.addEventListener("click", handleNextRound);
    } else {
      console.debug("admin-next-round no encontrado en el DOM.");
    }

    // 🔸 Mostrar u ocultar elementos según sesión (safe)
    const sidebarMenuEl = document.getElementById("sidebarMenu");
    const btnOpenLoginEl = document.getElementById("btn-open-login");
    const logoutBtnEl = document.getElementById("logout-button");
    const userMenuBtnEl = document.getElementById("user-menu-button");
    const sampleCard = document.getElementById("sample-bingo-card");

    if (currentUser && currentUser.id) {
      if (typeof showScreen === "function" && typeof gameScreen !== "undefined") {
        try { showScreen(gameScreen); } catch (e) {}
        sidebarMenuEl?.classList.remove("hidden");
        if (sampleCard) sampleCard.classList.add("hidden");
      }
      btnOpenLoginEl?.classList.add("hidden");
      logoutBtnEl?.classList.remove("hidden");
      userMenuBtnEl?.classList.remove("hidden");
      setUserStatusBar(currentUser);
      const statusMsg = document.getElementById("status-msg");
      if (statusMsg) {
          statusMsg.textContent = `Jugador: ${currentUser.nombre}`;
      }
    } else {
      // no usuario
      btnOpenLoginEl?.classList.remove("hidden");
      logoutBtnEl?.classList.add("hidden");
      userMenuBtnEl?.classList.add("hidden");
      if (sampleCard) sampleCard.classList.remove("hidden");
    }

    // 🔸 Inicializar menú de usuario seguro
    try { setupUserMenuSafe(); } catch (err) { console.error("Error inicializando user menu:", err); }

    // Handlers for auth modal are added near the top-level to avoid duplicates
    // (no-op here; kept for clarity)

    // 🔸 Asegurar que al cerrar sesión actualizamos UI y ticker
    logoutBtnEl?.addEventListener("click", () => {
      // La lógica de logout ya existe en tu código; aquí sincronizamos UI/ticker
      currentUser = null;
      localStorage.removeItem("usuario");
      // ocultar elementos de sesión
      sidebarMenuEl?.classList.add("hidden");
      btnOpenLoginEl?.classList.remove("hidden");
      logoutBtnEl?.classList.add("hidden");
      userMenuBtnEl?.classList.add("hidden");
      // mostrar sample card si aplica
      if (sampleCard) sampleCard.classList.remove("hidden");
      // actualizar ticker y status bar
      try { renderRankTicker(); } catch (e) {}
      try { setUserStatusBar({ nombre: "Invitado" }); } catch (e) {}
    });

    // 🔸 Escuchar cambios de storage (login en otra pestaña)
    window.addEventListener("storage", (e) => {
      if (e.key === "usuario") {
        currentUser = JSON.parse(localStorage.getItem("usuario")) || null;
        try { renderRankTicker(); } catch (err) {}
        try { setUserStatusBar(currentUser || { nombre: "Invitado" }); } catch (err) {}
        // ajustar visibilidad básica
        if (currentUser && currentUser.id) {
          btnOpenLoginEl?.classList.add("hidden");
          logoutBtnEl?.classList.remove("hidden");
          userMenuBtnEl?.classList.remove("hidden");
        } else {
          btnOpenLoginEl?.classList.remove("hidden");
          logoutBtnEl?.classList.add("hidden");
          userMenuBtnEl?.classList.add("hidden");
        }
      }
    });

    // 🔸 Render final del ticker por si cambió algo durante init
    try { renderRankTicker(); } catch (e) {}

  } catch (err) {
    console.error("❌ Error durante la inicialización:", err);
  }
});