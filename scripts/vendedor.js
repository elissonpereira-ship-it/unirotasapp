// ── emailjs init ────────────────────────────────────────────────────────
if (typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: "OV-1JMg752txxJaSr" });
}

// ── GLOBALS ──────────────────────────────────────────────────────────────
let isTracking = false, watchId = null;
let lastLat = 0, lastLon = 0, lastTime = 0;
let vMap = null, vDirectionsRenderer = null, vDirectionsService = null;
let currentVendorName = '', currentVendorUid = '';
let isSignupMode = false, isProcessingAuth = false, chatListener = null;

// ── UI HELPERS ───────────────────────────────────────────────────────────
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    if (t) {
        t.textContent = msg;
        t.className = 'show ' + type;
        setTimeout(() => { t.className = ''; }, 3500);
    }
}

function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
}
function closeSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
}

function showScreen(id) {
    console.log("Navegando para:", id);
    closeSidebar();
    const views = ['dashboard', 'map', 'chat', 'reuniao', 'historico'];
    views.forEach(v => {
        const el = document.getElementById('view-' + v);
        if (el) el.classList.add('hidden');
    });
    
    const target = document.getElementById('view-' + id);
    if (target) {
        target.classList.remove('hidden');
        if (id === 'map' || id === 'chat') target.style.display = 'flex';
    }
    
    document.querySelectorAll('.bn-item').forEach(m => m.classList.remove('active'));
    const bn = document.getElementById('bn-' + id);
    if (bn) bn.classList.add('active');

    if (id === 'chat') loadChat();
    if (id === 'map') setTimeout(initVendedorMap, 100);
    if (id === 'reuniao') { if (typeof loadMeetingModule === 'function') loadMeetingModule(); }
    if (window.lucide) lucide.createIcons();
}

// ── GPS TRACKING ─────────────────────────────────────────────────────────
function toggleTracking() { 
    if (isTracking) stopTracking(); 
    else startTracking(); 
}

function startTracking() {
    if (!navigator.geolocation) return showToast('Sem GPS disponível', 'error');
    isTracking = true;
    document.getElementById('btn-tracking').textContent = 'PARAR RASTREAMENTO';
    document.getElementById('status-ring').classList.add('active');
    document.getElementById('status-text').textContent = 'GPS Ativo';
    
    watchId = navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        lastLat = lat; lastLon = lon;
        const cText = document.getElementById('coords-text');
        if (cText) cText.textContent = `GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        
        if (currentVendorUid) {
            firebase.database().ref('vendedores/' + currentVendorUid).update({
                lat, lon, lastActive: Date.now(), status: 'online'
            });
        }
        updateQuickCards();
    }, e => showToast('Erro GPS: ' + e.message, 'error'), { enableHighAccuracy: true });
}

function stopTracking() {
    isTracking = false;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    document.getElementById('btn-tracking').textContent = 'INICIAR RASTREAMENTO';
    document.getElementById('status-ring').classList.remove('active');
    document.getElementById('status-text').textContent = 'Expediente Inativo';
    updateQuickCards();
}

function updateQuickCards() {
    const el = document.getElementById('qcard-gps');
    if (el) el.textContent = isTracking ? 'ON' : 'OFF';
}

// ── AUTH & SESSION ───────────────────────────────────────────────────────
async function enterApp() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    currentVendorUid = user.uid;
    
    const snap = await firebase.database().ref('vendedores/' + currentVendorUid).once('value');
    if (snap.val()) {
        currentVendorName = snap.val().name;
        document.getElementById('header-first-name').textContent = currentVendorName.split(' ')[0];
    }
    
    document.getElementById('header-greeting').textContent = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-app').style.display = 'flex';
    document.getElementById('auth-splash').style.display = 'none';
    
    startTracking();
    if (window.lucide) lucide.createIcons();
}

firebase.auth().onAuthStateChanged(user => {
    if (user) enterApp();
    else {
        document.getElementById('screen-login').style.display = 'flex';
        document.getElementById('auth-splash').style.display = 'none';
    }
});

async function handleAuth() {
    if (isProcessingAuth) return;
    const cpf = document.getElementById('user-cpf-input').value.replace(/\D/g, '');
    const pass = document.getElementById('user-pass-input').value;
    if (cpf.length < 11) return showToast('CPF inválido','error');
    
    isProcessingAuth = true;
    try {
        await firebase.auth().signInWithEmailAndPassword(cpf + '@unirotas.app', pass);
    } catch (e) { 
        showToast('Credenciais incorretas','error'); 
    } finally { 
        isProcessingAuth = false; 
    }
}

async function handleLogout() {
    await firebase.auth().signOut();
    location.reload();
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function handleSendResetEmail() {
    const email = document.getElementById('reset-email-input').value;
    if (!email) return showToast('Informe o email', 'error');
    try {
        await firebase.auth().sendPasswordResetEmail(email, { redirectTo: location.href });
        showToast('Link enviado!', 'success');
        closeModal('forgot-password-modal');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function handleUpdatePassword() {
    const newPass = document.getElementById('new-pass-input').value;
    if (newPass.length < 6) return showToast('Min. 6 caracteres', 'error');
    try {
        await firebase.auth().updateUser({ password: newPass });
        showToast('Senha atualizada!', 'success');
        closeModal('new-password-modal');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// ── MAPA ─────────────────────────────────────────────────────────────────
function initVendedorMap() {
    if (vMap) return;
    const mapEl = document.getElementById('vendedor-map');
    if (!mapEl) return;
    vMap = new google.maps.Map(mapEl, {
        center: { lat: lastLat || -23.55, lng: lastLon || -46.63 },
        zoom: 15,
        styles: [{ "featureType": "all", "elementType": "all", "stylers": [{ "hue": "#e7ecf0" }] }]
    });
}

// ── CHAT ─────────────────────────────────────────────────────────────────
function loadChat() {
    if (!currentVendorUid) return;
    const container = document.getElementById('chat-messages');
    firebase.database().ref('mensagens/' + currentVendorUid).on('value', snap => {
        const msgs = Object.values(snap.val() || {});
        container.innerHTML = msgs.map(m => {
            const isMe = m.sender !== 'admin';
            return `<div class="chat-bubble ${isMe?'me':'admin'}" style="align-self:${isMe?'flex-end':'flex-start'}; background:${isMe?'var(--gold)':'var(--surface2)'}; color:${isMe?'var(--bg)':'var(--text)'}; padding:10px 14px; border-radius:15px; max-width:80%; margin-bottom:8px;">${m.text}</div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !currentVendorUid) return;
    await firebase.database().ref('mensagens/' + currentVendorUid).push({ sender: 'vendedor', text, timestamp: Date.now() });
    input.value = '';
}
