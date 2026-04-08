/**
 * UniRotas - Lógica de Reuniões (Módulo Ultra-Fidelidade V2 - Nativo Supabase)
 * Implementado com auditoria anti-fraude, fluxos A-B-C-D e otimização TSP.
 * CORRIGIDO V2.1: Removido window.supabase.database(), deduplicado mrenderOutboundList,
 *                 corrigido mrenderOutboundList() sem parênteses, flag _realtimeInitialized.
 */

/* ── ESTADO GLOBAL ── */
let m_state = {
  role: null,
  location: null,
  vehicleType: 'carro',
  paxSelected: [],
  checkpoints: [],
  passengersData: {},
  status: 'idle',
  startTime: null,
  sessionId: null
};

/* ── CONSTANTES ── */
const KM_VALUE_CAR  = 0.90;
const KM_VALUE_MOTO = 0.40;
const GPS_TIMEOUT_MS = 300000; // 5 minutos

/* ── FLAG REALTIME ── */
let _realtimeInitialized = false;

/* ── HELPERS ── */
function m_showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) { console.warn('Toast not found:', msg); return; }
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove('show'), 3500);
}

function m_showView(viewId) {
  const views = [
    'm-view-role','m-view-location','m-view-search',
    'm-view-outbound','m-view-at-meeting','m-view-return','m-view-individual'
  ];
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
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function m_saveState() {
  localStorage.setItem('unirotas_m_v2_state', JSON.stringify(m_state));
}

function m_init() {
  const saved = localStorage.getItem('unirotas_m_v2_state');
  if (saved) {
    m_state = JSON.parse(saved);
    if      (m_state.status === 'outbound')    m_resumeOutbound();
    else if (m_state.status === 'at_meeting')  m_showView('m-view-at-meeting');
    else if (m_state.status === 'return')      m_resumeReturn();
    else                                        m_showView('m-view-role');
  } else {
    m_showView('m-view-role');
  }
  m_initRealtimeListeners();
}

/* ── CONFIGURAÇÃO ── */
function m_selectRole(role) {
  m_state.role = role;
  m_saveState();
  m_showView('m-view-location');
  m_loadLocations();
}

async function m_loadLocations() {
  const list = document.getElementById('m-location-list');
  if (!list) return;
  list.innerHTML = '<p style="padding:15px;opacity:0.5">Buscando locais...</p>';
  try {
    const { data, error } = await window.supabase.from('meeting_locations').select('*');
    if (error) throw error;
    if (!data || data.length === 0) {
      list.innerHTML = '<p style="padding:15px;opacity:0.5">Nenhum local ativo.</p>';
      return;
    }
    list.innerHTML = data.map(loc => `
      <button class="action-btn" onclick="m_setMeetingLocation(${JSON.stringify(loc).replace(/"/g,'&quot;')})"
        style="width:100%;text-align:left;background:var(--glass);border:1px solid var(--border);padding:16px;border-radius:18px;margin-bottom:10px;">
        <div style="font-weight:800;color:#fff">${loc.name}</div>
        <div style="font-size:0.7rem;color:var(--muted)">${loc.address}</div>
      </button>`).join('');
  } catch (e) {
    console.error('Erro ao carregar locais:', e);
    list.innerHTML = '<p style="color:var(--danger);padding:15px">Erro ao carregar locais.</p>';
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
  const btnMoto  = document.getElementById('m-btn-veh-moto');
  if (btnCarro) btnCarro.classList.toggle('active-veh', type === 'carro');
  if (btnMoto)  btnMoto.classList.toggle('active-veh', type === 'moto');
}

/* ── BUSCA DE PASSAGEIROS ── */
async function m_searchPassengers(q) {
  const container = document.getElementById('m-search-results');
  if (!container) return;
  if (!q || q.length < 2) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  try {
    const myUid = window.currentVendorUid;
    const { data, error } = await window.supabase
      .from('usuarios')
      .select('uid, name, cpf')
      .or(`name.ilike.%${q}%,cpf.ilike.%${q}%`)
      .limit(10);
    if (error) throw error;
    const filtered = data ? data.filter(u => u.uid !== myUid) : [];
    container.style.display = 'block';
    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:0.8rem">Nenhum colega encontrado com "${q}"</div>`;
      return;
    }
    container.innerHTML = filtered.map(u => `
      <div class="search-result-item" onclick="m_togglePaxSelection('${u.uid}','${u.name}')"
        style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05)">
        <div style="flex:1">
          <div style="font-weight:700;color:#fff;font-size:0.95rem">${u.name}</div>
          <div style="font-size:0.7rem;color:var(--gold)">${u.cpf} · Vendedor UniRotas</div>
        </div>
        <i data-lucide="plus" style="color:var(--gold);width:18px"></i>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('Falha na busca:', e);
    container.innerHTML = '<p style="color:var(--danger);padding:15px;font-size:0.8rem">Erro na busca. Tente novamente.</p>';
  }
}

function m_togglePaxSelection(uid, name) {
  const idx = m_state.paxSelected.findIndex(p => p.uid === uid);
  if (idx > -1) m_state.paxSelected.splice(idx, 1);
  else m_state.paxSelected.push({ uid, name, target: true });
  m_renderChips();
  m_saveState();
}

function m_renderChips() {
  const container = document.getElementById('m-selected-chips');
  if (!container) return;
  container.innerHTML = m_state.paxSelected.map(p => `
    <div class="pax-chip" style="background:var(--gold-bg);border:1px solid var(--gold);padding:8px 14px;border-radius:20px;font-size:0.75rem;color:#fff;display:flex;align-items:center;gap:8px">
      <span style="font-weight:700">${p.name.split(' ')[0]}</span>
      <i data-lucide="x" style="width:14px;cursor:pointer;color:var(--gold)" onclick="m_togglePaxSelection('${p.uid}')"></i>
    </div>`).join('');
  if (window.lucide) lucide.createIcons();
}

/* ── FLUXO DE IDA (OUTBOUND) ── */
async function m_startOutbound() {
  m_state.status    = 'outbound';
  m_state.startTime = new Date().toISOString();
  m_state.checkpoints = [{ type:'start', label:'PARTIDA', lat: window.lastLat, lng: window.lastLon, ts: m_state.startTime }];

  // Cria sessão no Supabase (100% nativo — sem .database())
  const sessionId = `SESS_${Date.now()}_${(window.currentVendorUid||'').substring(0,4)}`;
  m_state.sessionId = sessionId;

  try {
    const { error } = await window.supabase.from('meetingsessions').insert({
      id:                    sessionId,
      driverid:              window.currentVendorUid,
      drivername:            window.currentVendorName,
      status:                'outbound',
      meetinglocationname:   m_state.location?.name,
      vehicle:               m_state.vehicleType || 'carro',
      passengers:            JSON.stringify(m_state.paxSelected.map(p => ({ uid: p.uid, name: p.name, boarded: false }))),
      date:                  new Date().toISOString().split('T')[0]
    });
    if (error) console.error('Aviso: erro ao criar sessão no banco:', error.message);
  } catch (e) {
    console.error('Erro ao criar sessão:', e);
  }

  m_saveState();
  m_resumeOutbound();
}

function m_resumeOutbound() {
  m_showView('m-view-outbound');
  const destName = document.getElementById('m-outbound-dest-name');
  if (destName) destName.textContent = m_state.location?.name || 'Destino';
  m_startGpsPolling();
}

/* ── GPS POLLING ── */
let m_gpsInterval = null;

function m_startGpsPolling() {
  if (m_gpsInterval) clearInterval(m_gpsInterval);
  m_syncGpsLoop();
  m_gpsInterval = setInterval(m_syncGpsLoop, 15000);
}

async function m_syncGpsLoop() {
  const now = Date.now();
  try {
    const uids = m_state.paxSelected.map(p => p.uid);
    if (uids.length === 0) return;

    const { data, error } = await window.supabase
      .from('vendedores')
      .select('*')
      .in('uid', uids);

    if (error) { console.error('GPS RADAR erro:', error.message); return; }
    console.log('📡 [V2.1] GPS RADAR - Dados do Banco:', data);

    if (data && data.length > 0) {
      data.forEach(v => {
        const p = m_state.paxSelected.find(x => x.uid === v.uid);
        if (!p) return;
        p.lat = v.lat ?? v.latitude ?? v.lat_coord ?? p.lat;
        p.lng = v.lon ?? v.longitude ?? v.lng_coord ?? p.lng;
        const ts = v.lastactive ?? v.lastActive ?? v.updated_at ?? v.lastsync;
        if (ts) {
          const diff = now - new Date(ts).getTime();
          p.isOnline = diff < GPS_TIMEOUT_MS;
          console.log(`Radar: ${p.name} está ${p.isOnline ? 'ONLINE' : 'OFFLINE'} (atraso: ${Math.round(diff/1000)}s)`);
        } else {
          p.isOnline = false;
          console.log(`Radar: ${p.name} sem timestamp.`);
        }
      });
    }
    m_renderOutboundList(); // ← CORRIGIDO: parênteses adicionados
  } catch (e) {
    console.error('GPS RADAR falha crítica:', e);
  }
}

/* ── RENDER LISTA DE IDA ── */
function m_renderOutboundList() {
  const container = document.getElementById('m-outbound-pax-list');
  if (!container) return;

  container.innerHTML = m_state.paxSelected.map(p => {
    const gpsColor   = p.isOnline ? 'var(--success)' : 'var(--muted)';
    const gpsIcon    = p.isOnline ? 'check-circle
