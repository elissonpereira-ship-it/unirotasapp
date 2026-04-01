/* UniRotas – Supabase Data & Auth Driver (Compatibility Layer) */
(function () {
    console.log("UniRotas Shim: Initializing...");
    const _SUPA_URL = 'https://ajconwarkeunpixqngnq.supabase.co';
    const _SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqY29ud2Fya2V1bnBpeHFuZ25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTQ2MDksImV4cCI6MjA5MDQ3MDYwOX0.HFHmApPMYKT_GZLJwDAY8IZSaM38CjVUN1amAah4wZM';

    if (!window.supabase) {
        console.error("UniRotas Shim: window.supabase is NOT defined. Script failed to load?");
        return;
    }

    const _sb = window.supabase.createClient(_SUPA_URL, _SUPA_KEY);
    console.log("UniRotas Shim: Client created.");

    function _toMap(arr, key, fn = null) {
        if (!arr || !arr.length) return null;
        const r = {};
        arr.forEach(row => { r[row[key]] = fn ? fn(row) : row; });
        return r;
    }
    function _normPart(row) {
        if (!row) return null;
        return {
            uid: row.vendor_uid, name: row.name, role: row.role, embarkStatus: row.embark_status,
            joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : null, locationId: row.location_id,
            locationName: row.location_name, locationAddress: row.location_address, region: row.region,
            lat: row.lat, lng: row.lng, phase: row.phase, presenceConfirmed: row.presence_confirmed,
            driverUid: row.driver_uid, driverName: row.driver_name, status: row.status, passengers: row.passengers,
            embarkLat: row.embark_lat, embarkLng: row.embark_lng, returnStatus: row.return_status || 'none'
        };

    }
    function _denormPart(d) {
        const r = {};
        if (d.uid !== undefined) r.vendor_uid = d.uid;
        if (d.name !== undefined) r.name = d.name;
        if (d.role !== undefined) r.role = d.role;
        if (d.embarkStatus !== undefined) r.embark_status = d.embarkStatus;
        if (d.locationId !== undefined) r.location_id = d.locationId;
        if (d.locationName !== undefined) r.location_name = d.locationName;
        if (d.locationAddress !== undefined) r.location_address = d.locationAddress;
        if (d.region !== undefined) r.region = d.region;
        if (d.lat !== undefined) r.lat = d.lat;
        if (d.lng !== undefined) r.lng = d.lng;
        if (d.phase !== undefined) r.phase = d.phase;
        if (d.presenceConfirmed !== undefined) r.presence_confirmed = d.presenceConfirmed;
        if (d.driverUid !== undefined) r.driver_uid = d.driverUid;
        if (d.driverName !== undefined) r.driver_name = d.driverName;
        if (d.status !== undefined) r.status = d.status;
        if (d.passengers !== undefined) r.passengers = d.passengers;
        if (d.embarkLat !== undefined) r.embark_lat = d.embarkLat;
        if (d.embarkLng !== undefined) r.embark_lng = d.embarkLng;
        if (d.returnStatus !== undefined) r.return_status = d.returnStatus;

        return r;
    }
    function _normPickup(row) {
        return {
            uid: row.passenger_uid, name: row.passenger_name, address: row.passenger_address,
            status: row.status, dropoffStatus: row.dropoff_status, order: row.sort_order
        };
    }

    async function _readPath(path) {
        const p = path.split('/').filter(Boolean);
        const q = (t) => _sb.from(t);
        
        // --- USUARIOS & VENDEDORES ---
        if (p[0] === 'usuarios' && p.length === 2) { 
            const { data } = await q('usuarios').select('*').eq('uid', p[1]).single(); 
            return data ? { ...data, address: data.address || {} } : null; 
        }
        if (p[0] === 'vendedores' && p.length === 2) { 
            const { data } = await q('vendedores').select('*').eq('uid', p[1]).single(); 
            if (!data) return null;
            return { ...data, lat: parseFloat(data.lat), lng: parseFloat(data.lon || data.lng) };
        }

        // --- MEETING (REUNIAO) ---
        if (p[0] === 'meeting') {
            if (p[1] === 'locations') {
                if (p.length === 2) { const { data } = await q('meeting_locations').select('*'); return _toMap(data, 'id'); }
                if (p.length === 3) { const { data } = await q('meeting_locations').select('*').eq('id', p[2]).single(); return data; }
            }
            if (p[1] === 'config' && p[2] === 'activeLocation') {
                const { data } = await q('meeting_locations').select('*').eq('is_active', true).limit(1).single();
                return data;
            }
            if (p[1] === 'participants') {
                if (p.length === 2) { const { data } = await q('meeting_participants').select('*'); return _toMap(data, 'vendor_uid', _normPart); }
                if (p.length === 3) { const { data } = await q('meeting_participants').select('*').eq('vendor_uid', p[2]).single(); return data ? _normPart(data) : null; }
            }
            if (p[1] === 'notifications' && p.length === 3) {
                const { data } = await q('meeting_notifications').select('*').eq('vendor_uid', p[2]).eq('handled', false).order('created_at', { ascending: false }).limit(1).single();
                return data ? data.data : null;
            }
            if (p[1] === 'driverPickups' && p.length === 3) {
                const { data } = await q('meeting_driver_pickups').select('*').eq('driver_uid', p[2]);
                return _toMap(data, 'passenger_uid', _normPickup);
            }
            if (p[1] === 'chats' && p.length === 3) {
                const { data } = await q('meeting_chats').select('*').eq('room_key', p[2]).order('ts');
                return _toMap(data, 'id', r => ({ senderUid: r.sender_uid, senderName: r.sender_name, text: r.content, timestamp: new Date(r.ts).getTime() }));
            }
        }

        // --- MENSAGENS (SUPORTE) ---
        if (p[0] === 'mensagens' && p.length === 2) {
            const { data } = await q('mensagens').select('*').eq('vendor_uid', p[1]).order('ts');
            return _toMap(data, 'id', r => ({ sender: r.sender, text: r.content, timestamp: new Date(r.ts).getTime(), read: r.read }));
        }

        // --- TYPING STATUS ---
        if (p[0] === 'typing' && p.length === 3) {
            const { data } = await q('typing_status').select('*').eq('vendor_uid', p[1]).single();
            if (!data) return false;
            return p[2] === 'admin' ? (data.admin_typing || false) : (data.vendor_typing || false);
        }

        return null;
    }

    async function _writePath(path, data) {
        const p = path.split('/').filter(Boolean);
        const now = new Date().toISOString();
        const q = (t) => _sb.from(t);
        let res;
        if (p[0] === 'vendedores' && p.length === 2) res = await q('vendedores').upsert({ uid: p[1], name: data.name, status: data.status, lat: data.lat, lon: data.lon, last_active: now });
        else if (p[0] === 'usuarios' && p.length === 2) res = await q('usuarios').upsert({ uid: p[1], name: data.name, cpf: data.cpf, email: data.email, address: data.address, registered_at: now });
        else if (p[0] === 'meeting' && p[1] === 'participants' && p.length === 3) res = await q('meeting_participants').upsert({ ..._denormPart({ uid: p[2], ...data }), joined_at: now });
        else if (p[0] === 'meeting' && p[1] === 'notifications' && p.length === 3) { await q('meeting_notifications').delete().eq('vendor_uid', p[2]).eq('handled', false); res = await q('meeting_notifications').insert({ vendor_uid: p[2], type: data.type, data: data, handled: data.handled || false }); }
        else if (p[0] === 'meeting' && p[1] === 'driverPickups' && p.length === 4) res = await q('meeting_driver_pickups').upsert({ driver_uid: p[2], passenger_uid: p[3], passenger_name: data.name, status: data.status, sort_order: data.order || 0 }, { onConflict: 'driver_uid,passenger_uid' });
        else if (p[0] === 'meeting' && p[1] === 'attendance' && p.length === 4) res = await q('meeting_attendance').upsert({ date: p[2], vendor_uid: p[3], name: data.name, role: data.role, driver_uid: data.driverUid || null, location_id: data.locationId, location_name: data.locationName, region: data.region || '', confirmed_at: now }, { onConflict: 'date,vendor_uid' });
        else if (p[0] === 'meeting' && p[1] === 'history' && p.length === 4) res = await q('meeting_history').upsert({ date: p[2], driver_uid: p[3], driver_name: data.driverName, passengers: data.passengers || null, vehicle_type: data.vehicleType || 'carro', real_route: data.realRoute || null, predicted_route: data.predictedRoute || null, total_km: data.totalKm || 0, reimbursement: data.reimbursement || 0, completed_at: now, ts: now }, { onConflict: 'date,driver_uid' });
        else if (p[0] === 'meeting' && p[1] === 'chats' && p.length === 3) res = await q('meeting_chats').insert({ room_key: p[2], sender_uid: data.senderUid, sender_name: data.senderName, content: data.text, ts: now });
        else if (p[0] === 'typing' && p.length === 3) res = await q('typing_status').upsert({ vendor_uid: p[1], side: p[2], is_typing: data === true, ts: now }, { onConflict: 'vendor_uid,side' });
        else if (p[0] === 'mensagens' && p.length === 2) res = await q('mensagens').insert({ vendor_uid: p[1], sender: data.sender, content: data.text, ts: now });
        return res;
    }


    const _activeSubs = {};
    function _subscribe(path, cb) {
        const p = path.split('/').filter(Boolean);
        let table = 'meeting_participants'; // Default fallback

        if (p[0] === 'vendedores') table = 'vendedores';
        else if (p[0] === 'mensagens') table = 'mensagens';
        else if (p[0] === 'typing') table = 'typing_status';
        else if (p[0] === 'meeting') {
            if (p[1] === 'notifications') table = 'meeting_notifications';
            else if (p[1] === 'participants') table = 'meeting_participants';
            else if (p[1] === 'chats') table = 'meeting_chats';
            else if (p[1] === 'driverPickups') table = 'meeting_driver_pickups';
            else if (p[1] === 'history') table = 'meeting_history';
        }

        _readPath(path).then(data => cb({ val: () => data }));
        const channel = _sb.channel('shim_' + path).on('postgres_changes', { event: '*', schema: 'public', table: table }, async () => { const data = await _readPath(path); cb({ val: () => data }); }).subscribe();
        _activeSubs[path] = channel;
    }

    class _Ref {
        constructor(path) { this.path = path; }
        async once() { const data = await _readPath(this.path); return { val: () => data }; }
        on(ev, cb) { if (ev === 'value') _subscribe(this.path, cb); return cb; }
        off() { if (_activeSubs[this.path]) { _sb.removeChannel(_activeSubs[this.path]); delete _activeSubs[this.path]; } }
        async set(data) { await _writePath(this.path, data); }
        async update(data) { await _writePath(this.path, data); }
        async push(data) { await _writePath(this.path, data); }
        async remove() { const p = this.path.split('/').filter(Boolean); if (p[0] === 'meeting') await _sb.from('meeting_participants').delete().eq('vendor_uid', p[2]); }
        onDisconnect() {
            return {
                update: async (data) => {
                    // Tenta sinalizar que o usuário está offline ao fechar a página (Best-effort)
                    window.addEventListener('unload', () => {
                        const url = `${_SUPA_URL}/rest/v1/vendedores?uid=eq.${currentVendorUid}`;
                        navigator.sendBeacon(url, JSON.stringify(data));
                    });
                },
                set: () => { }
            };
        }
    }

    const _auth = {
        _user: null,
        get currentUser() { return this._user ? { uid: this._user.id } : null; },
        async signInWithEmailAndPassword(email, password) {
            const { data, error } = await _sb.auth.signInWithPassword({ email, password });
            if (error) throw error;
            this._user = data.user;
            return { user: { uid: data.user.id } };
        },
        async createUserWithEmailAndPassword(email, password) {
            const { data, error } = await _sb.auth.signUp({ email, password });
            if (error) throw error;
            this._user = data.user;
            return { user: { uid: data.user.id } };
        },
        async signOut() {
            const { error } = await _sb.auth.signOut();
            if (error) console.error("Supabase Shim: Logout Error:", error);
            this._user = null;
        },
        onAuthStateChanged(cb) {
            _sb.auth.getSession().then(({ data: { session }, error }) => {
                if (error) console.error("Supabase Shim: Session Error:", error);
                this._user = session?.user || null;
                cb(this._user ? { uid: this._user.id } : null);
            }).catch(err => {
                console.error("Supabase Shim: Session catch:", err);
                cb(null);
            });
            _sb.auth.onAuthStateChange((_, session) => {
                this._user = session?.user || null;
                cb(this._user ? { uid: this._user.id } : null);
            });
        },
        async sendPasswordResetEmail(email, { redirectTo }) {
            return await _sb.auth.resetPasswordForEmail(email, { redirectTo });
        },
        async updateUser({ password }) {
            return await _sb.auth.updateUser({ password });
        }
    };

    const _shim = { auth: () => _auth, database: () => ({ ref: (path) => new _Ref(path) }) };
    window.supabase = _shim;
    window.firebase = _shim;
})();

// ── emailjs init ────────────────────────────────────────────────────────
if (typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: "OV-1JMg752txxJaSr" });
}

// ── GLOBALS ──────────────────────────────────────────────────────────────
let isTracking = false, watchId = null;
let lastLat = 0, lastLon = 0, lastTime = 0;
let vMap = null, vDirectionsRenderer = null, vDirectionsService = null;
let currentVendorName = '', currentVendorUid = '';
let isSignupMode = false, generatedCode = null, pendingUser = null;
let isProcessingAuth = false, chatListener = null;

// ── UI HELPERS ───────────────────────────────────────────────────────────
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    if (t) {
        t.textContent = msg;
        t.className = 'show ' + type;
        setTimeout(() => { t.className = ''; }, 3500);
    }
}

function showLoading(show) {
    const loader = document.getElementById('loader-wrapper') || document.getElementById('global-loader');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
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
    closeSidebar();
    const views = ['dashboard', 'map', 'chat', 'reuniao', 'historico'];
    views.forEach(v => {
        const el = document.getElementById('view-' + v);
        if (el) { el.classList.add('hidden'); el.style.display = ''; }
    });
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
    const target = document.getElementById('view-' + id);
    if (target) {
        target.classList.remove('hidden');
        if (id === 'map' || id === 'chat') {
            target.style.display = 'flex';
        } else {
            target.style.display = '';
        }
    }
    const mi = document.getElementById('menu-' + id);
    if (mi) mi.classList.add('active');
    if (id === 'map' && vMap) { google.maps.event.trigger(vMap, 'resize'); }
    if (id === 'chat') loadChat();
    if (id === 'reuniao' && typeof loadMeetingScreen === 'function') loadMeetingScreen();
    if (id === 'historico' && typeof loadMyMeetingHistory === 'function') loadMyMeetingHistory();
    if (window.lucide) lucide.createIcons();
}

// ── SUPPORT CHAT ─────────────────────────────────────────────────────────
function loadChat() {
    if (!currentVendorUid) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">Carregando mensagens...</div>';

    if (chatListener) supabase.database().ref(`mensagens/${currentVendorUid}`).off('value', chatListener);
    chatListener = supabase.database().ref(`mensagens/${currentVendorUid}`).on('value', snap => {
        const msgs = Object.values(snap.val() || {});
        container.innerHTML = msgs.map(m => {
            const isMe = m.sender !== 'admin';
            return `
                <div style="max-width:85%; padding:10px 14px; border-radius:16px; margin-bottom:10px; align-self:${isMe ? 'flex-end' : 'flex-start'}; background:${isMe ? 'var(--gold)' : 'var(--surface2)'}; color:${isMe ? 'var(--bg)' : 'var(--text)'}; font-size:0.9rem; position:relative; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    ${m.text}
                    <div style="font-size:0.6rem; opacity:0.5; margin-top:4px; text-align:right;">${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;
        const badge = document.getElementById('badge-support');
        if (badge) badge.classList.remove('active');
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !currentVendorUid) return;
    try {
        await supabase.database().ref(`mensagens/${currentVendorUid}`).push({
            sender: currentVendorName, text, timestamp: Date.now(), read: false
        });
        input.value = '';
    } catch (e) {
        showToast('Erro: ' + e.message, 'error');
    }
}

// ── AUTH HANDLERS ────────────────────────────────────────────────────────
function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    const card = document.querySelector('.login-card');
    const toggleLink = document.getElementById('auth-toggle-link');

    document.getElementById('auth-title').textContent = isSignupMode ? 'Novo Cadastro' : 'Acesso Restrito';
    document.getElementById('signup-fields').classList.toggle('hidden', !isSignupMode);
    document.getElementById('btn-login-action').textContent = isSignupMode ? 'EFETUAR CADASTRO' : 'ENTRAR NO SISTEMA';

    if (toggleLink) {
        toggleLink.textContent = isSignupMode ? 'Já tenho cadastro (Login)' : 'Solicitar novo cadastro';
    }

    const loginTop = document.querySelector('.login-top');
    if (loginTop) {
        loginTop.style.display = isSignupMode ? 'none' : 'flex';
        if (card) card.classList.toggle('signup-mode', isSignupMode);
    }
    if (isSignupMode) setTimeout(initAddressAutocomplete, 100);
}

let addressAutocomplete;
function initAddressAutocomplete() {
    const input = document.getElementById('addr-rua');
    if (!input || addressAutocomplete) return;
    addressAutocomplete = new google.maps.places.Autocomplete(input, {
        types: ['address'], componentRestrictions: { country: 'br' }, fields: ['address_components', 'geometry']
    });
    addressAutocomplete.addListener('place_changed', () => {
        const place = addressAutocomplete.getPlace();
        if (!place.address_components) return;
        let street = '', number = '', neighborhood = '', city = '', state = '', cep = '';
        for (const component of place.address_components) {
            const types = component.types;
            if (types.includes('route')) street = component.long_name;
            if (types.includes('street_number')) number = component.long_name;
            if (types.includes('sublocality_level_1')) neighborhood = component.long_name;
            if (types.includes('locality')) city = component.long_name;
            if (types.includes('administrative_area_level_1')) state = component.short_name;
            if (types.includes('postal_code')) cep = component.long_name;
        }
        if (street) input.value = street;
        document.getElementById('addr-num').value = number;
        document.getElementById('addr-bairro').value = neighborhood;
        document.getElementById('addr-cidade').value = city;
        document.getElementById('addr-cep').value = cep;
    });
}

async function handleAuth() {
    if (isProcessingAuth) return;
    const cpf = document.getElementById('user-cpf-input').value.replace(/\D/g, '');
    const pass = document.getElementById('user-pass-input').value;
    const btn = document.getElementById('btn-login-action');
    if (cpf.length < 11 || pass.length < 6) { showToast('CPF ou senha inválidos.', 'error'); return; }
    const emailFirebase = `${cpf}@unirotas.app`;
    isProcessingAuth = true;
    const orig = btn.textContent; btn.textContent = 'Aguarde...'; btn.disabled = true;
    try {
        if (isSignupMode) {
            const name = document.getElementById('user-name-input').value.trim();
            const email = document.getElementById('user-email-input').value.trim();
            const rua = document.getElementById('addr-rua').value.trim();
            const num = document.getElementById('addr-num').value.trim();
            const bairro = document.getElementById('addr-bairro').value.trim();
            const cidade = document.getElementById('addr-cidade').value.trim();
            const cep = document.getElementById('addr-cep').value.trim();
            if (!name || !email || !rua || !cidade) { showToast('Preencha os campos.', 'error'); return; }
            const res = await supabase.auth().createUserWithEmailAndPassword(emailFirebase, pass);
            const uid = res.user.uid;
            await supabase.database().ref('usuarios/' + uid).set({
                name, cpf, email, uid, address: { rua, numero: num, bairro, cidade, cep }, registeredAt: Date.now()
            });
            showToast('Sucesso!', 'success');
            enterApp(uid);
        } else {
            const res = await supabase.auth().signInWithEmailAndPassword(emailFirebase, pass);
            enterApp(res.user.uid);
        }
    } catch (e) {
        showToast('Falha: ' + (e.message || 'Erro de rede'), 'error');
    } finally {
        isProcessingAuth = false; btn.textContent = orig; btn.disabled = false;
    }
}

async function handleLogout() {
    try {
        const user = supabase.auth().currentUser;
        if (user) {
            await supabase.database().ref('vendedores/' + user.uid).update({ status: 'Offline', lastActive: Date.now() });
            try { await supabase.database().ref(`meeting/participants/${user.uid}`).remove(); } catch(_) {}
        }
        if (isTracking) stopTracking();
        await supabase.auth().signOut();
    } catch (e) {
        console.error(e);
    } finally {
        window.location.reload();
    }
}

function openForgotPasswordModal() {
    document.getElementById('forgot-password-modal').style.display = 'flex';
}
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function handleSendResetEmail() {
    const email = document.getElementById('reset-email-input').value.trim();
    if (!email) { showToast('Informe o seu e-mail.', 'error'); return; }
    try {
        await supabase.auth().sendPasswordResetEmail(email, { redirectTo: window.location.href });
        showToast('Link enviado!', 'success');
        closeModal('forgot-password-modal');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function handleUpdatePassword() {
    const newPass = document.getElementById('new-pass-input').value;
    if (newPass.length < 6) return showToast('Min. 6 caracteres', 'error');
    try {
        await supabase.auth().updateUser({ password: newPass });
        showToast('Senha atualizada!', 'success');
        closeModal('new-password-modal');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// ── GPS TRACKING ─────────────────────────────────────────────────────────
function toggleTracking() { if (isTracking) stopTracking(); else startTracking(); }
function startTracking() {
    if (!navigator.geolocation) return showToast('Sem GPS', 'error');
    isTracking = true;
    document.getElementById('btn-tracking').textContent = 'PARAR RASTREAMENTO';
    document.getElementById('status-ring').classList.add('active');
    document.getElementById('status-text').textContent = 'GPS Ativo';
    watchId = navigator.geolocation.watchPosition(pos => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        lastLat = lat; lastLon = lon;
        const cText = document.getElementById('coords-text'), aWarn = document.getElementById('accuracy-warning');
        if (cText) cText.textContent = `GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        if (aWarn) aWarn.classList.toggle('hidden', accuracy < 50);
        if (currentVendorUid) supabase.database().ref('vendedores/' + currentVendorUid).update({ lat, lon, lastActive: Date.now() });
        updateQuickCards();
        if (typeof updateUniversalPresence === 'function') updateUniversalPresence();
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

// ── HEADER & CARDS ───────────────────────────────────────────────────────
function updateHeaderName(name) {
    const el = document.getElementById('header-first-name');
    if (el) el.textContent = name;
}
function updateGreeting() {
    const el = document.getElementById('header-greeting');
    if (!el) return;
    const hr = new Date().getHours();
    let g = 'Boa noite 🌙';
    if (hr < 12) g = 'Bom dia ☀️'; else if (hr < 18) g = 'Boa tarde ⛅';
    el.textContent = g;
}
function updateQuickCards() {
    const el = document.getElementById('status-summary');
    if (el) el.textContent = isTracking ? 'Operando no momento' : 'Aguardando início';
}

function logAudit(action) {
    console.log(`[Audit] ${action} at ${new Date().toISOString()}`);
}

function initVendedorMap() {
    const el = document.getElementById('map-canvas');
    if (!el || typeof google === 'undefined') return;
    vMap = new google.maps.Map(el, {
        center: { lat: -20.31, lng: -40.31 }, zoom: 15,
        styles: [{ "featureType": "all", "elementType": "all", "stylers": [{ "invert_lightness": true }, { "saturation": 10 }, { "lightness": 30 }, { "gamma": 0.5 }, { "hue": "#435158" }] }]
    });
}

function initSupportMessageListener(uid) {
    supabase.database().ref(`mensagens/${uid}`).on('child_added', snap => {
        const m = snap.val();
        if (m.sender === 'admin' && !m.read) {
            document.getElementById('badge-support')?.classList.add('active');
            if (typeof showGlobalNotification === 'function') {
                showGlobalNotification('Suporte UniRotas', m.text, 'support');
            }
        }
    });
}

// ── ENTER APP ────────────────────────────────────────────────────────────
async function enterApp(uid) {
    currentVendorUid = uid;
    const screenLogin = document.getElementById('screen-login'), screenApp = document.getElementById('screen-app');
    const bottomNav = document.querySelector('.bottom-nav');
    if (screenLogin) { screenLogin.classList.add('hidden'); screenLogin.style.display = 'none'; }
    if (screenApp) { screenApp.classList.remove('hidden'); screenApp.style.display = 'flex'; }
    if (bottomNav) { bottomNav.style.display = 'flex'; }
    
    try {
        const snap = await supabase.database().ref('usuarios/' + uid).once('value');
        const data = snap.val() || {};
        currentVendorName = data.name || 'Vendedor';
        updateHeaderName(currentVendorName);
        updateGreeting();
        updateQuickCards();

        document.getElementById('sidebar-user-name').textContent = currentVendorName;
        document.getElementById('sidebar-user-cpf').textContent = data.cpf ? `CPF: ${data.cpf}` : 'ID Ativo';

        supabase.database().ref('vendedores/' + uid).onDisconnect().update({ status: 'Offline' });
        supabase.database().ref('vendedores/' + uid).update({ status: 'Online', name: currentVendorName, lastActive: Date.now() });

        initVendedorMap();
        if (typeof listenForMeetingNotifications === 'function') listenForMeetingNotifications(uid);
        
        initSupportMessageListener(uid);
        showScreen('dashboard');
        if (typeof loadMeetingScreen === 'function') loadMeetingScreen();
        if (typeof loadEconomyStats === 'function') loadEconomyStats();
    } catch (e) {
        console.error("EnterApp Error:", e);
    }
}

// ── INITIALIZATION ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    console.log("UniRotas: DOMContentLoaded");
    const authSplash = document.getElementById('auth-splash');
    const safetyTimeout = setTimeout(() => {
        if (authSplash && authSplash.style.display !== 'none') {
            authSplash.style.display = 'none';
            const sl = document.getElementById('screen-login');
            if (sl) { sl.classList.remove('hidden'); sl.style.display = 'flex'; }
        }
    }, 8000);

    if (window.supabase && supabase.auth) {
        supabase.auth().onAuthStateChanged((user) => {
            clearTimeout(safetyTimeout);
            if (authSplash) authSplash.style.display = 'none';
            if (user) enterApp(user.uid);
            else {
                const sl = document.getElementById('screen-login');
                const bottomNav = document.querySelector('.bottom-nav');
                if (sl) { sl.classList.remove('hidden'); sl.style.display = 'flex'; }
                if (bottomNav) { bottomNav.style.display = 'none'; }
            }
        });
    }

    // Mask for CPF info
    const cpfInput = document.getElementById('user-cpf-input');
    if (cpfInput) {
        cpfInput.addEventListener('input', function() {
            let v = this.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
            this.value = v;
        });
    }

    // Hash detection for reset password
    if (window.location.hash.includes('type=recovery')) {
        document.getElementById('new-password-modal').style.display = 'flex';
    }

    // Particles effect
    (function particles() {
        const top = document.querySelector('.login-top');
        if (!top) return;
        const wrap = document.createElement('div');
        wrap.className = 'login-particles';
        for (let i = 0; i < 15; i++) {
            const p = document.createElement('div');
            p.className = 'login-particle';
            p.style.cssText = `left:${Math.random()*100}%;bottom:${Math.random()*20}%;animation-delay:${Math.random()*5}s;`;
            wrap.appendChild(p);
        }
        top.prepend(wrap);
    })();
});
