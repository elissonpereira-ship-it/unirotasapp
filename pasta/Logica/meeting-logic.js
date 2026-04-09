/**
 * UniRotas - Lógica de Reuniões (Módulo Ultra-Fidelidade V2 - Nativo Supabase)
 * Implementado com auditoria anti-fraude, fluxos A-B-C-D e otimização TSP.
 */

/* ── ESTADO GLOBAIS ── */
window.m_state = {
    role: null,           // 'driver' | 'pax' | 'individual'
    location: null,       // { id, name, address, lat, lng }
    vehicleType: 'carro', // 'carro' | 'moto'
    paxSelected: [],      // [{uid, name, lat, lng, isOnline, target}]
    checkpoints: [],      // [{type, lat, lng, ts, label}]
    passengersData: {},   // { uid: { embark, dropoff, status } }
    status: 'idle',       // 'idle' | 'outbound' | 'at_meeting' | 'return'
    startTime: null,
    currentSession: null
};
const m_state = window.m_state;

/* ── CONSTANTES ── */
const KM_VALUE_CAR = 0.90;
const KM_VALUE_MOTO = 0.40;
const GPS_TIMEOUT_MS = 900000; // 15 minutos de tolerância para oscilações de sinal

/* ── HELPERS ── */
function m_showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) {
        console.warn("Toast element not found, using alert:", msg);
        return;
    }
    el.textContent = msg;
    el.className = `toast toast-${type} show`;
    setTimeout(() => el.classList.remove('show'), 3500);
}

function m_showView(viewId) {
    const views = ['m-view-role', 'm-view-location', 'm-view-search', 'm-view-outbound', 'm-view-at-meeting', 'm-view-return', 'm-view-individual', 'm-view-pax-waiting'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function m_haversine(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function m_saveState() {
    localStorage.setItem('unirotas_m_v2_state', JSON.stringify(m_state));
}

function m_init() {
    console.log("📍 Inicializando lógica de Reunião...");
    
    // Se já temos um estado em memória com status ativo, não sobrescrevemos do localStorage 
    // a menos que seja um carregamento inicial (status idle)
    if (m_state.status === 'idle' || !m_state.sessionId) {
        const saved = localStorage.getItem('unirotas_m_v2_state');
        if (saved) {
            Object.assign(m_state, JSON.parse(saved));
            console.log("💾 Estado recuperado do Storage:", m_state.status);
        }
    }

    // Agora processa o status atual (seja o recém-lido ou o que já estava em memória)
    if (m_state.status === 'outbound') {
        m_resumeOutbound();
        m_refreshSessionData();
    }
    else if (m_state.status === 'at_meeting') m_showView('m-view-at-meeting');
    else if (m_state.status === 'return') {
        m_resumeReturn();
        m_refreshSessionData();
    }
    else if (m_state.status === 'pax_waiting') {
        m_resumePaxWaiting();
        m_refreshSessionData();
    }
    else {
        m_showView('m-view-role');
    }
    
    m_initRealtimeListeners();
    m_autoDiscoverSession();
}

function m_resumePaxWaiting() {
    m_state.role = 'pax';
    m_showView('m-view-pax-waiting');
    const msg = document.getElementById('m-pax-waiting-msg');
    if (msg && m_state.currentSession) msg.textContent = `Carona com ${m_state.currentSession.driver_name || 'Colega'}`;
    m_subscribeToSession();
    if (typeof m_renderInbox === 'function') m_renderInbox();
}

// BUSCA DADOS FRESCOS DA SESSÃO SE ESTIVER EM CURSO
async function m_refreshSessionData() {
    if (!m_state.sessionId) return;
    try {
        const { data, error } = await window.supabase
            .from('meeting_sessions')
            .select('*')
            .eq('id', m_state.sessionId)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            console.warn("⚠️ Sessão não encontrada no DB no momento.");
            // Não limpamos imediatamente para evitar flickering em caso de micro-atraso do Supabase
            return;
        }

        m_state.currentSession = data;
        
        // Garantia de persistência do papel (role)
        if (data.driver_id === window.currentVendorUid) m_state.role = 'driver';
        else m_state.role = 'pax';

        m_renderOutboundList();
        m_renderReturnList(); 
        if (typeof m_renderInbox === 'function') m_renderInbox();
    } catch (e) { 
        console.error("Erro ao dar refresh na sessão:", e); 
    }
}

// BUSCA SESSÃO ATIVA ONDE SOU PASSAGEIRO
async function m_autoDiscoverSession() {
    const myUid = window.currentVendorUid;
    if (!myUid) return;

    try {
        const { data, error } = await window.supabase
            .from('meeting_sessions')
            .select('*')
            .is('finalized_at', null)
            .order('created_at', { ascending: false });

        if (error) throw error;
        const mySession = data.find(s => s.passengers && s.passengers.some(p => p.uid === myUid));

        if (mySession) {
            console.log("📍 Sessão vinculada encontrada via DB:", mySession.id);
            m_state.sessionId = mySession.id;
            m_state.currentSession = mySession;
            m_state.role = 'pax'; // Se achei nos passengers, sou pax

            const myInfo = mySession.passengers.find(p => p.uid === myUid);
            if (myInfo && myInfo.confirmed_presence) {
                m_state.status = 'at_meeting';
                m_showView('m-view-at-meeting');
            } else {
                m_state.status = 'pax_waiting';
                m_showView('m-view-pax-waiting');
                const msg = document.getElementById('m-pax-waiting-msg');
                if (msg) msg.textContent = `Carona com ${mySession.driver_name || 'Colega'}`;
            }
            m_saveState();
            m_subscribeToSession();
            if (typeof m_renderInbox === 'function') m_renderInbox();
        }
        m_listenForInvites();
    } catch (e) {
        console.error("Erro na autodescoberta:", e.message);
    }
}

let m_inviteChannel = null;
function m_listenForInvites() {
    if (!window.currentVendorUid || m_inviteChannel) return;

    m_inviteChannel = window.supabase.channel('global_invites', { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_sessions' }, payload => {
            console.log("🔔 Novo convite via Banco Detectado");
            m_handleNewInvitePayload(payload.new);
        })
        .on('broadcast', { event: 'new_invite' }, payload => {
            console.log("🚀 Novo convite via BROADCAST Detectado");
            m_handleNewInvitePayload(payload.payload.session);
        })
        .subscribe();
}

function m_handleNewInvitePayload(sessionData) {
    const myUid = window.currentVendorUid;
    if (!sessionData.passengers) return;

    const isForMe = sessionData.passengers.some(p => p.uid === myUid && !p.canceled);
    if (isForMe && m_state.sessionId !== sessionData.id) {
        console.log("✅ Convite detectado, aguardando confirmação do usuário...");
        
        m_openConfirmModal(
            "Convite de Carona",
            `O colega ${sessionData.driver_name} te enviou um convite de carona para a reunião. Aceitar?`,
            async () => {
                console.log("🎯 Aceitando convite...");
                
                // 1. Atualiza estado em memória IMEDIATAMENTE
                m_state.sessionId = sessionData.id;
                m_state.currentSession = sessionData;
                m_state.status = 'pax_waiting';
                m_state.role = 'pax';
                m_saveState();

                // 2. Muda para a aba Reunião (isso chama o m_init, mas nosso m_init agora está blindado)
                if (typeof showScreen === 'function') showScreen('reuniao');
                
                // 3. Força a view e o rádio
                m_showView('m-view-pax-waiting');
                const msg = document.getElementById('m-pax-waiting-msg');
                if (msg) msg.textContent = `Carona com ${sessionData.driver_name || 'Colega'}`;
                
                m_subscribeToSession();
                m_showToast("Carona aceita!", "success");
            }
        );
    }
}

/* ── FLUXOS DE CONFIGURAÇÃO (SUPABASE NATIVE) ── */
function m_selectRole(role) {
    m_state.role = role;
    m_saveState();
    m_showView('m-view-location');
    m_loadLocations();
}

async function m_loadLocations() {
    const list = document.getElementById('m-location-list');
    if (!list) return;
    list.innerHTML = '<p style="padding:15px; opacity:0.5;">Buscando locais...</p>';

    try {
        const { data, error } = await window.supabase
            .from('meeting_locations')
            .select('*');

        if (error) throw error;
        if (!data || data.length === 0) {
            list.innerHTML = '<p style="padding:15px; opacity:0.5;">Nenhum local ativo.</p>';
            return;
        }

        list.innerHTML = data.map(loc => `
            <button class="action-btn" onclick='m_setMeetingLocation(${JSON.stringify(loc)})' 
                    style="width:100%; text-align:left; background:var(--glass); border:1px solid var(--border); padding:16px; border-radius:18px; margin-bottom:10px;">
                <div style="font-weight:800; color:#fff;">${loc.name}</div>
                <div style="font-size:0.7rem; color:var(--muted);">${loc.address}</div>
            </button>
        `).join('');
    } catch (e) {
        console.error("Erro ao carregar locais:", e);
        list.innerHTML = '<p style="color:var(--danger); padding:15px;">Erro ao carregar locais. Verifique a conexão.</p>';
    }
}

function m_setMeetingLocation(loc) {
    m_state.location = loc;
    m_saveState();
    if (m_state.role === 'driver') {
        m_showView('m-view-search');
    } else {
        m_showView('m-view-individual');
        const destInfo = document.getElementById('m-indiv-location-info');
        if (destInfo) destInfo.textContent = `Local: ${loc.name}`;
    }
}

function m_setVehicle(type) {
    m_state.vehicleType = type;
    m_saveState();
    const btnCarro = document.getElementById('m-btn-veh-carro');
    const btnMoto = document.getElementById('m-btn-veh-moto');

    if (btnCarro) {
        if (type === 'carro') btnCarro.classList.add('active-veh');
        else btnCarro.classList.remove('active-veh');
    }
    if (btnMoto) {
        if (type === 'moto') btnMoto.classList.add('active-veh');
        else btnMoto.classList.remove('active-veh');
    }
}

async function m_searchPassengers(q) {
    const container = document.getElementById('m-search-results');
    if (!container) return;

    if (!q || q.length < 2) {
        container.innerHTML = '';
        container.style.display = 'none';
        container.classList.add('hidden');
        return;
    }

    try {
        const myUid = window.currentVendorUid;
        let { data, error } = await window.supabase
            .from('usuarios')
            .select('uid, name, cpf')
            .or(`name.ilike.%${q}%,cpf.ilike.%${q}%`)
            .limit(10);

        if (error) throw error;
        const filtered = data ? data.filter(u => u.uid !== myUid) : [];

        container.style.display = 'block';
        container.classList.remove('hidden');

        if (filtered.length === 0) {
            container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.8rem;">Nenhum colega encontrado.</div>`;
        } else {
            container.innerHTML = filtered.map(u => `
                <div class="search-result-item" onclick="m_togglePaxSelection('${u.uid}', '${u.name}')" style="cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="flex:1">
                        <div style="font-weight:700; color:#fff; font-size:0.95rem;">${u.name}</div>
                        <div style="font-size:0.7rem; color:var(--gold);">${u.cpf || 'Vendedor UniRotas'}</div>
                    </div>
                    <i data-lucide="plus" style="color:var(--gold); width:18px;"></i>
                </div>
            `).join('');
        }
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<p style="color:var(--danger); padding:15px; font-size:0.8rem;">Erro na busca.</p>`;
    }
}

function m_togglePaxSelection(uid, name) {
    const idx = m_state.paxSelected.findIndex(p => p.uid === uid);
    if (idx > -1) {
        m_state.paxSelected.splice(idx, 1);
    } else {
        m_state.paxSelected.push({ uid, name, target: true });
        const input = document.getElementById('m-pax-search');
        const results = document.getElementById('m-search-results');
        if (input) input.value = '';
        if (results) {
            results.style.display = 'none';
            results.innerHTML = '';
        }
    }
    m_renderChips();
    m_saveState();
}

function m_renderChips() {
    const container = document.getElementById('m-selected-chips');
    if (!container) return;
    container.innerHTML = m_state.paxSelected.map(p => `
        <div class="pax-chip" style="background:var(--gold-bg); border:1px solid var(--gold); padding:8px 14px; border-radius:20px; font-size:0.75rem; color:#fff; display:flex; align-items:center; gap:8px;">
            <span style="font-weight:700;">${p.name.split(' ')[0]}</span>
            <i data-lucide="x" style="width:14px; cursor:pointer;" onclick="m_togglePaxSelection('${p.uid}')"></i>
        </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

/* ── FLUXO DE IDA (OUTBOUND) ── */
async function m_startOutbound() {
    if (!window.isTracking || !window.lastLat || !window.lastLon) {
        return m_showToast("Ative o GPS antes de iniciar!", "error");
    }
    m_state.status = 'outbound';
    m_state.startTime = new Date().toISOString();

    // UUID Generator v4
    const sessionId = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    m_state.sessionId = sessionId;
    const sessionData = {
        id: sessionId,
        driver_id: window.currentVendorUid,
        driver_name: window.currentVendorName,
        status: 'outbound',
        meeting_location_name: m_state.location?.name || '',
        meeting_location_address: m_state.location?.address || '',
        meeting_location_lat: m_state.location?.lat || 0,
        meeting_location_lng: m_state.location?.lng || 0,
        vehicle_type: m_state.vehicleType || 'carro',
        passengers: m_state.paxSelected.map(p => ({ uid: p.uid, name: p.name, boarded: false, signal_embark: false })),
        date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
    };

    try {
        const { error } = await window.supabase.from('meeting_sessions').upsert(sessionData);
        if (error) throw error;

        m_state.currentSession = sessionData;
        m_state.role = 'driver'; // Motorista que inicia
        m_saveState();
        m_resumeOutbound();
        if (typeof m_renderInbox === 'function') m_renderInbox();

        // 🚀 BROADCAST GLOBAL DO CONVITE
        if (m_inviteChannel) {
            m_inviteChannel.send({
                type: 'broadcast',
                event: 'new_invite',
                payload: { session: sessionData }
            });
        }
    } catch (e) {
        console.error("Erro ao iniciar rota:", e.message);
        m_showToast("Erro ao iniciar sessão", "error");
    }
}

async function m_startOutboundSolo() {
    console.log("🚀 Iniciando jornada solo para a reunião...");
    if (!window.isTracking || !window.lastLat || !window.lastLon) {
        return m_showToast("Ative o GPS antes de iniciar!", "error");
    }
    m_state.paxSelected = [];
    m_state.location = m_state.location || {}; // Garante que temos um destino
    m_startOutbound();
}

function m_resumeOutbound() {
    m_state.role = 'driver';
    m_showView('m-view-outbound');
    const destName = document.getElementById('m-outbound-dest-name');
    if (destName) destName.textContent = m_state.location?.name || 'Destino';
    m_startGpsPolling();
    m_subscribeToSession();
    m_renderOutboundList();
    if (typeof m_renderInbox === 'function') m_renderInbox();
}

let m_sessionChannel = null;
function m_subscribeToSession() {
    if (!m_state.sessionId) return;
    if (m_sessionChannel) window.supabase.removeChannel(m_sessionChannel);

    console.log("👂 Sintonizando canal da sessão:", m_state.sessionId);
    m_sessionChannel = window.supabase
        .channel(`session_${m_state.sessionId}`, { config: { broadcast: { self: true } } })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meeting_sessions', filter: `id=eq.${m_state.sessionId}` }, payload => {
            console.log("🔄 Update via Banco recebido", payload.new.id);
            const data = payload.new;
            if (!data) return;
            m_state.currentSession = data;

            // Garante que o role esteja atualizado
            if (data.driver_id === window.currentVendorUid) m_state.role = 'driver';
            else m_state.role = 'pax';

            m_checkForEmbarkModal(data);
            m_renderOutboundList();
            if (typeof m_renderInbox === 'function') m_renderInbox();
        })
        .on('broadcast', { event: 'embark_signal' }, payload => {
            console.log("🚀 Broadcast de EMBARQUE recebido", payload.payload);
            const myUid = window.currentVendorUid;
            if (payload.payload.targetUid === myUid) {
                console.log("✨ ABRINDO MODAL DE EMBARQUE!");
                const modal = document.getElementById('m-modal-embark');
                if (modal) modal.classList.add('show');
            }
        })
        .on('broadcast', { event: 'ride_canceled' }, payload => {
            console.log("🚫 Viagem cancelada pelo motorista");
            m_showToast("O motorista cancelou a viagem.", "error");
            m_cleanupSession();
        })
        .on('broadcast', { event: 'pax_canceled' }, async payload => {
            const paxUid = payload.payload.uid;
            console.log("👤 Passageiro cancelou:", paxUid);
            
            // Se eu sou o MOTORISTA, eu atualizo o banco (já que passageiros podem ter RLS restrito)
            if (m_state.role === 'driver' && m_state.currentSession) {
                console.log("🛠️ Motorista processando cancelamento no DB para:", paxUid);
                const updatedList = m_state.currentSession.passengers.map(p => {
                    if (p.uid === paxUid) return { ...p, canceled: true, target: false };
                    return p;
                });
                
                try {
                    await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
                    m_state.currentSession.passengers = updatedList;
                    m_renderOutboundList();
                    m_showToast("Um passageiro cancelou a carona.", "info");
                } catch (e) {
                    console.error("Erro ao motorista atualizar cancelamento:", e);
                }
            } else {
                await m_refreshSessionData();
            }
        })
        .subscribe(status => {
            console.log("📡 Status do canal da sessão:", status);
            if (status === 'SUBSCRIBED' && m_state.status === 'pax_waiting') {
                m_startDistanceRadar();
            }
        });
}

function m_startDistanceRadar() {
    console.log("📡 Radar de Distância Ativo");
    if (m_state.radarInterval) clearInterval(m_state.radarInterval);

    m_state.radarInterval = setInterval(async () => {
        if (!m_state.sessionId || !m_state.currentSession || m_state.status !== 'pax_waiting') {
            return clearInterval(m_state.radarInterval);
        }

        const { data: driver } = await window.supabase
            .from('vendedores')
            .select('lat, lon')
            .eq('uid', m_state.currentSession.driver_id)
            .maybeSingle();

        if (driver && driver.lat && window.lastLat) {
            const dist = m_haversine(window.lastLat, window.lastLon, driver.lat, driver.lon);
            const radarEl = document.getElementById('m-pax-dist-radar');
            if (radarEl) radarEl.textContent = dist < 0.1 ? "CHEGANDO" : `${dist.toFixed(1)} km`;
        }
    }, 10000);
}

function m_cleanupSession() {
    if (m_gpsInterval) clearInterval(m_gpsInterval);
    if (m_state.radarInterval) clearInterval(m_state.radarInterval);
    if (m_sessionChannel) window.supabase.removeChannel(m_sessionChannel);
    m_state.role = null;
    m_state.location = null;
    m_state.vehicleType = 'carro';
    m_state.paxSelected = [];
    m_state.checkpoints = [];
    m_state.passengersData = {};
    m_state.status = 'idle';
    m_state.startTime = null;
    m_state.sessionId = null;
    m_state.currentSession = null;
    localStorage.removeItem('unirotas_m_v2_state');
    m_showView('m-view-role');
    const modal = document.getElementById('m-modal-embark');
    if (modal) modal.classList.remove('show');
}

function m_checkForEmbarkModal(data) {
    const myUid = window.currentVendorUid;
    const myInfo = data.passengers ? data.passengers.find(p => p.uid === myUid) : null;

    if (myInfo && myInfo.signal_embark && !myInfo.boarded) {
        console.log("🚪 Sinal via Banco: Abrindo modal");
        const modal = document.getElementById('m-modal-embark');
        if (modal) modal.classList.add('show');
    }

    if (data.status === 'at_meeting' && myInfo && myInfo.boarded && !myInfo.confirmed_presence) {
        const modalPresence = document.getElementById('m-modal-presence-carona');
        if (modalPresence) modalPresence.classList.add('show');

        // Também mostra o botão fixo na tela para redundância
        const arrivalArea = document.getElementById('m-pax-arrival-area');
        if (arrivalArea) arrivalArea.classList.remove('hidden');
    }
}

// PASSAGEIRO CONFIRMA PRESENÇA NA REUNIÃO (VALIDA GPS)
async function m_paxConfirmPresence() {
    if (!m_state.sessionId || !m_state.currentSession) return;

    // Confirmação explícita para evitar cliques acidentais
    if (!confirm("Confirmar sua presença no local da reunião?\n(Isso encerrará o chat desta carona)")) return;

    const loc = m_state.currentSession;
    const dist = m_haversine(window.lastLat, window.lastLon, loc.meeting_location_lat, loc.meeting_location_lng);

    // Deixa confirmar se estiver por perto ou se o carona confiar no motorista (mas mantemos validação de GPS por segurança)
    if (dist > 0.25) {
        return m_showToast('Você precisa estar no local da reunião para confirmar!', 'error');
    }

    const myUid = window.currentVendorUid;
    const updatedList = JSON.parse(JSON.stringify(m_state.currentSession.passengers)).map(p => {
        if (p.uid === myUid) return { ...p, confirmed_presence: true, arrival_ts: new Date().toISOString() };
        return p;
    });

    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        closeModal('m-modal-presence-carona');

        // Limpa a área do botão redundante
        const arrivalArea = document.getElementById('m-pax-arrival-area');
        if (arrivalArea) arrivalArea.classList.add('hidden');

        // LIMPEZA DO CHAT (Carona -> Motorista)
        await m_cleanupChatAfterMeeting(m_state.currentSession.driver_id);

        m_showToast("Presença Confirmada!", "success");
        m_showView('m-view-at-meeting');
    } catch (e) { console.error(e); }
}

// FAXINA NO BANCO DE DADOS: Remove mensagens entre motorista e carona após confirmação
async function m_cleanupChatAfterMeeting(partnerUid) {
    if (!partnerUid) return;
    const myUid = window.currentVendorUid;
    console.log(`🧹 [CLEANUP] Faxinando chat: ${myUid} <-> ${partnerUid}`);

    try {
        const { error } = await window.supabase.from('mensagens')
            .delete()
            .or(`and(vendor_uid.eq.${myUid},receiver_uid.eq.${partnerUid}),and(vendor_uid.eq.${partnerUid},receiver_uid.eq.${myUid})`);

        if (error) throw error;

        console.log("✅ Chat limpo com sucesso.");
        if (typeof m_renderInbox === 'function') m_renderInbox();
    } catch (e) {
        console.error("❌ Falha na faxina do chat:", e);
    }
}

async function m_sendEmbarkSignal(paxUid) {
    if (!m_state.sessionId || !m_state.currentSession) {
        console.error("❌ Sessão não carregada para enviar sinal");
        return;
    }

    const updatedList = JSON.parse(JSON.stringify(m_state.currentSession.passengers)).map(p => {
        if (p.uid === paxUid) return { ...p, signal_embark: true };
        return p;
    });

    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        m_state.currentSession.passengers = updatedList;

        if (m_sessionChannel) {
            console.log("📤 Enviando BROADCAST embark_signal para:", paxUid);
            m_sessionChannel.send({
                type: 'broadcast',
                event: 'embark_signal',
                payload: { targetUid: paxUid }
            });
        }

        m_renderOutboundList();
        m_showToast("Aviso enviado!", "success");
    } catch (e) { console.error(e); }
}

async function m_paxConfirmEmbark() {
    if (!m_state.sessionId || !m_state.currentSession) return;
    const myUid = window.currentVendorUid;

    const updatedList = JSON.parse(JSON.stringify(m_state.currentSession.passengers)).map(p => {
        if (p.uid === myUid) return { ...p, boarded: true, signal_embark: false };
        return p;
    });

    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        m_state.currentSession.passengers = updatedList;
        const modal = document.getElementById('m-modal-embark');
        if (modal) modal.classList.remove('show');
        m_showToast("Embarque confirmado!", "success");
        m_renderOutboundList();
    } catch (e) { console.error(e); }
}

async function m_paxRejectEmbark() {
    if (!m_state.sessionId || !m_state.currentSession) return;
    const myUid = window.currentVendorUid;

    const updatedList = JSON.parse(JSON.stringify(m_state.currentSession.passengers)).map(p => {
        if (p.uid === myUid) return { ...p, signal_embark: false };
        return p;
    });

    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        m_state.currentSession.passengers = updatedList;
        const modal = document.getElementById('m-modal-embark');
        if (modal) modal.classList.remove('show');
        m_showToast("Sinal ignorado.", "info");
        m_renderOutboundList();
    } catch (e) { console.error(e); }
}

function m_renderOutboundList() {
    const container = document.getElementById('m-outbound-pax-list');
    if (!container) return;
    const pList = m_state.currentSession?.passengers || m_state.paxSelected;

    container.innerHTML = pList.map(p => {
        const sp = m_state.paxSelected.find(x => x.uid === p.uid);
        const isOnline = sp ? sp.isOnline : false;
        const boarded = p.boarded;
        const canceled = p.canceled === true || p.canceled === 'true'; 
        const isTarget = p.target !== false && !canceled;

        return `
            <div class="meeting-card" style="margin-bottom:8px; opacity: ${boarded || canceled ? '0.7' : '1'}; border-left: 4px solid ${isTarget && isOnline ? 'var(--gold)' : 'transparent'}; overflow: visible;">
                <div style="display:flex; justify-content:space-between; align-items:center; position:relative;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="display:flex; align-items:center;">
                            ${canceled ? `
                                <div style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; opacity:0.3;">
                                    <i data-lucide="slash" style="width:14px; color:#ef4444;"></i>
                                </div>
                            ` : `
                                <div class="pax-checkbox ${boarded ? 'checked' : ''}" 
                                     onclick="${m_state.status === 'outbound' ? `m_togglePaxBoarding('${p.uid}')` : `m_togglePaxRoute('${p.uid}')`}">
                                    <i data-lucide="check" style="width:12px;"></i>
                                </div>
                            `}
                        </div>
                        <div>
                            <div style="font-weight:700; font-size:0.9rem; color: ${canceled ? 'rgba(255,255,255,0.6)' : '#fff'}">
                                ${p.name}
                            </div>
                            <div style="font-size:0.75rem; color:${canceled ? '#ef4444' : (isOnline ? '#10b981' : '#ef4444')}; font-weight:600;">
                                ${canceled ? 'GPS INATIVO' : (isOnline ? 'GPS ATIVO' : 'GPS INATIVO')}
                            </div>
                            ${canceled ? `<div style="color:var(--gold); font-size:0.7rem; font-weight:800; margin-top:2px;">(cancelou carona)</div>` : ''}
                        </div>
                    </div>

                    <div class="pax-actions-container">
                        ${boarded ? `
                            <div style="background:rgba(16,185,129,0.1); color:#10b981; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem;">EMBARCADO</div>
                        ` : (canceled ? `
                            <div style="color:#ef4444; font-size:0.6rem; font-weight:700; opacity:0.7;">REMOVIDO</div>
                        ` : `
                            <button class="pax-menu-btn" onclick="m_togglePaxMenu('${p.uid}')">
                                <i data-lucide="menu"></i>
                            </button>
                            <div id="drop-${p.uid}" class="pax-actions-dropdown">
                                <div class="pax-dropdown-item info" onclick="m_openPaxChat('${p.uid}', '${p.name}')">
                                    <i data-lucide="message-square"></i> CHAT
                                </div>
                                <div class="pax-dropdown-item gold" onclick="m_sendEmbarkSignal('${p.uid}')">
                                    <i data-lucide="door-open"></i> EMBARQUE
                                </div>
                            </div>
                        `)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// TOGGLE SELEÇÃO PARA ROTA
async function m_toggleRouteTarget(uid) {
    if (!m_state.sessionId || !m_state.currentSession) return;

    const updatedList = m_state.currentSession.passengers.map(p => {
        if (p.uid === uid) return { ...p, target: !p.target };
        return p;
    });

    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        m_state.currentSession.passengers = updatedList;
        m_renderOutboundList();
    } catch (e) { console.error(e); }
}

function m_closeAllActionMenus() {
    document.querySelectorAll('.pax-actions-dropdown').forEach(d => d.classList.remove('show'));
}

function m_togglePaxMenu(uid) {
    const target = document.getElementById(`drop-${uid}`);
    const isShowing = target ? target.classList.contains('show') : false;
    m_closeAllActionMenus();
    if (target && !isShowing) target.classList.add('show');
}

function m_openPaxChat(uid, name) {
    m_closeAllActionMenus();
    if (typeof showScreen === 'function') {
        showScreen('chat');
        if (typeof m_openConvo === 'function') {
            m_openConvo(uid, name);
        }
    }
}

function m_togglePaxWaitingMenu() {
    const target = document.getElementById('pax-waiting-dropdown');
    const isShowing = target ? target.classList.contains('show') : false;
    m_closeAllActionMenus();
    if (target && !isShowing) target.classList.add('show');
}

// Ouvinte global para fechar menus ao clicar fora
document.addEventListener('click', (e) => {
    if (!e.target.closest('.pax-actions-container') && 
        !e.target.closest('.btn-pax-menu-trigger') && 
        !e.target.closest('.pax-actions-dropdown')) {
        m_closeAllActionMenus();
    }
}, true);

function m_paxCancelRide() {
    if (!m_state.sessionId || !m_state.currentSession) return;
    const myUid = window.currentVendorUid;

    m_openConfirmModal(
        "Cancelar Carona",
        "Deseja realmente cancelar sua carona?",
        async () => {
            try {
                // BROADCAST PARA O MOTORISTA (Ele fará o update no DB pois tem permissão de escrita)
                if (m_sessionChannel) {
                    m_sessionChannel.send({
                        type: 'broadcast',
                        event: 'pax_canceled',
                        payload: { uid: myUid }
                    });
                }
                
                // Limpa Mensagens localmente para o carona
                await window.supabase.from('mensagens').delete().eq('vendor_uid', myUid);

                m_showToast("Carona cancelada.", "error");
                
                // Pequeno delay para garantir que o broadcast saiu antes de fechar o canal
                setTimeout(() => {
                    m_cleanupSession();
                }, 500);
            } catch (e) {
                console.error(e);
                m_showToast("Erro ao cancelar.", "error");
            }
        }
    );
}

function m_openDriverChat() {
    m_togglePaxWaitingMenu();
    if (typeof showScreen === 'function') {
        showScreen('chat');
        const s = m_state.currentSession;
        if (s && s.driver_id && typeof m_openConvo === 'function') {
            m_openConvo(s.driver_id, s.driver_name || 'Motorista');
        }
    }
}

/* ── GPS LOOP ── */
let m_gpsInterval = null;
function m_startGpsPolling() {
    if (m_gpsInterval) clearInterval(m_gpsInterval);
    m_syncGpsLoop();
    m_gpsInterval = setInterval(m_syncGpsLoop, 15000);
}

async function m_syncGpsLoop() {
    const uids = m_state.paxSelected.map(p => p.uid);
    if (uids.length === 0) return;
    try {
        const { data } = await window.supabase.from('vendedores').select('*').in('uid', uids);
        if (data) {
            data.forEach(v => {
                const p = m_state.paxSelected.find(x => x.uid === v.uid);
                if (p) {
                    p.lat = v.lat || p.lat; p.lng = v.lng || p.lng;
                    const ts = v.last_active || v.updated_at;
                    p.isOnline = ts ? (Date.now() - new Date(ts).getTime() < GPS_TIMEOUT_MS) : false;
                }
            });
        }
        m_renderOutboundList();
    } catch (e) { console.error(e); }
}

/* ── GERAL ── */
async function m_confirmPresence() {
    const dist = m_haversine(window.lastLat, window.lastLon, m_state.location?.lat, m_state.location?.lng);
    if (dist > 0.20) return m_showToast('Você precisa estar no local!', 'error');
    try {
        await window.supabase.from('meeting_sessions').insert({
            driver_name: window.currentVendorName, driver_id: window.currentVendorUid,
            role: 'individual', date: new Date().toISOString().split('T')[0],
            checkpoints: [{ lat: window.lastLat, lng: window.lastLon, ts: new Date().toISOString(), label: 'PRESENÇA' }]
        });
        m_showToast('Presença confirmada!', 'success');
        m_showView('m-view-at-meeting');
    } catch (e) { console.error(e); }
}

let m_realtimeInitialized = false;
function m_initRealtimeListeners() {
    if (!window.currentVendorUid || m_realtimeInitialized) return;
    m_realtimeInitialized = true;

    window.supabase.channel('public:participants')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vendedores' }, () => {
            if (m_state.status === 'outbound' || m_state.status === 'return') m_syncGpsLoop();
        })
        .subscribe();
}

window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
};

async function m_confirmArrival() {
    if (!m_state.sessionId || !m_state.currentSession) return;

    // Confirmação explícita para o motorista
    if (!confirm("Confirmar chegada na reunião?\n(Isso encerrará os chats com seus caronas)")) return;

    m_state.status = 'at_meeting';
    m_state.checkpoints.push({
        type: 'arrival',
        label: 'REUNIÃO',
        lat: window.lastLat,
        lng: window.lastLon,
        ts: new Date().toISOString()
    });

    try {
        await window.supabase.from('meeting_sessions').update({
            status: 'at_meeting',
            checkpoints: m_state.checkpoints
        }).eq('id', m_state.sessionId);

        // MOTORISTA LIMPA CHAT COM TODOS OS CARONAS
        const passengers = m_state.currentSession.passengers || [];
        for (const pax of passengers) {
            await m_cleanupChatAfterMeeting(pax.uid);
        }

        m_saveState();
        m_showView('m-view-at-meeting');
        if (m_gpsInterval) clearInterval(m_gpsInterval);
        m_showToast("Chegada confirmada e chats limpos!", "success");
    } catch (e) { console.error(e); }
}

function m_abortJourney() {
    if (m_sessionChannel) {
        m_sessionChannel.send({
            type: 'broadcast',
            event: 'ride_canceled',
            payload: { reason: 'driver_aborted' }
        });
    }
    m_cleanupSession();
    m_showToast("Viagem cancelada.", "info");
}

/* ── FLUXO DE RETORNO (RETURN) ── */
async function m_startReturnJourney() {
    if (!m_state.sessionId) return;
    m_state.status = 'return';
    m_state.checkpoints.push({ type: 'return_start', label: 'INÍCIO RETORNO', lat: window.lastLat, lng: window.lastLon, ts: new Date().toISOString() });

    try {
        await window.supabase.from('meeting_sessions').update({
            status: 'return',
            checkpoints: m_state.checkpoints
        }).eq('id', m_state.sessionId);

        m_saveState();
        m_resumeReturn();
    } catch (e) { console.error("Erro ao iniciar retorno:", e); }
}

function m_resumeReturn() {
    m_showView('m-view-return');
    m_startGpsPolling();
    m_renderReturnList();
}

function m_renderReturnList() {
    const container = document.getElementById('m-return-pax-list');
    if (!container) return;
    const pList = m_state.currentSession?.passengers || [];

    container.innerHTML = pList.map(p => {
        const dropped = p.dropped_off;
        const canceled = p.canceled;
        
        // Se cancelou, não mostramos o botão de desembarque e mudamos a opacidade
        return `
            <div class="meeting-card" style="margin-bottom:10px; opacity: ${dropped || canceled ? '0.7' : '1'}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:700; color: ${canceled ? 'rgba(255,255,255,0.6)' : '#fff'}">
                            ${p.name}
                        </div>
                        <div style="font-size:0.75rem; color:${canceled ? '#ef4444' : (dropped ? 'var(--success)' : 'var(--gold)')}; font-weight:600;">
                            ${canceled ? 'GPS INATIVO' : (dropped ? 'DESEMBARCADO ✅' : 'EM TRÂNSITO... 🚗')}
                        </div>
                        ${canceled ? `<div style="color:var(--gold); font-size:0.7rem; font-weight:800; margin-top:2px;">(cancelou carona)</div>` : ''}
                    </div>
                    ${(!dropped && !canceled) ? `
                        <button class="action-btn success" style="width:50px; height:50px; border-radius:12px;" 
                                onclick="m_confirmDropoff('${p.uid}')">
                            <i data-lucide="check" style="width:20px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

async function m_confirmDropoff(uid) {
    if (!m_state.sessionId || !m_state.currentSession) return;
    const updatedList = JSON.parse(JSON.stringify(m_state.currentSession.passengers)).map(p => {
        if (p.uid === uid) return { ...p, dropped_off: true, dropoff_ts: new Date().toISOString() };
        return p;
    });
    try {
        await window.supabase.from('meeting_sessions').update({ passengers: updatedList }).eq('id', m_state.sessionId);
        m_state.currentSession.passengers = updatedList;
        m_renderReturnList();
        m_showToast("Desembarque confirmado!", "success");
    } catch (e) { console.error(e); }
}

async function m_finalizeAll() {
    if (!m_state.sessionId) return;
    try {
        await window.supabase.from('meeting_sessions').update({
            finalized_at: new Date().toISOString(),
            status: 'completed'
        }).eq('id', m_state.sessionId);
        m_abortJourney();
        m_showToast("Viagem finalizada com sucesso!", "success");
    } catch (e) { console.error(e); }
}

function m_generateBestRoute() {
    console.log("🗺️ Gerando melhor caminho...");

    if (!window.isTracking || !window.lastLat || !window.lastLon) {
        return m_showToast("GPS desativado. Ative-o para gerar o melhor caminho!", "error");
    }

    const sess = m_state.currentSession;
    if (!sess) return m_showToast("Sessão não iniciada.", "error");

    const destLat = sess.meeting_location_lat;
    const destLng = sess.meeting_location_lng;

    if (!destLat || !destLng) return m_showToast("Local de destino não definido.", "error");

    const origin = `${window.lastLat},${window.lastLon}`;
    const dest = `${destLat},${destLng}`;

    // Waypoints para passageiros aguardando embarque
    let waypoints = "";
    if (sess.passengers && sess.passengers.length > 0) {
        const routePaxes = sess.passengers.filter(p => p.target && !p.boarded);
        if (routePaxes.length > 0) {
            const points = routePaxes.map(p => {
                // Busca coordenadas frescas no estado local de GPS
                const sp = m_state.paxSelected.find(x => x.uid === p.uid);
                return sp && sp.lat ? `${sp.lat},${sp.lng}` : null;
            }).filter(w => w !== null);

            if (points.length > 0) {
                waypoints = "&waypoints=" + points.join("|");
            }
        }
    }

    const travelMode = sess.vehicle_type === 'moto' ? 'two_wheeler' : 'driving';
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypoints}&travelmode=${travelMode}`;

    window.open(url, '_blank');
}
