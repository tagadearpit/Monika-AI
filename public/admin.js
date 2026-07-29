/* global Chart */
'use strict';

const state = {
    csrfToken: '',
    authToken: null,
    overview: null,
    reports: [],
    audit: [],
    sessions: [],
    theme: localStorage.getItem('monika_theme') || 'dark',
    chartData: null,
    searchTimeout: null
};

const $ = (id) => document.getElementById(id);

// --- THEME ---
function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
}
applyTheme();

// --- UI UTILS ---
function showAdminToast(message, type = 'info') {
    const container = $('adminToastContainer');
    if (!container) return alert(message);
    const toast = document.createElement('div');
    toast.className = 'glass-card';
    toast.style.padding = '14px 18px';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    toast.style.pointerEvents = 'auto';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
    toast.innerHTML = `
        <i class="fas ${type === 'error' ? 'fa-paw' : 'fa-check-circle'}" style="color: ${type === 'error' ? 'var(--admin-danger)' : 'var(--admin-success)'}; font-size: 1.4rem;"></i>
        <div style="flex:1">
            <h4 style="margin:0; font-size: 0.95rem;">${type === 'error' ? 'Oops!' : 'Notice'}</h4>
            <p style="margin:2px 0 0; font-size: 0.85rem;" class="muted">${message}</p>
        </div>
        <button style="background:transparent; border:none; color:var(--admin-muted); cursor:pointer;" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 4000);
}

function confirmAction(message) {
    return new Promise((resolve) => {
        const dialog = $('confirmDialog');
        if (!dialog) return resolve(confirm(message));
        
        $('confirmMessage').textContent = message;
        dialog.showModal();
        
        const cleanup = () => {
            dialog.close();
            $('confirmCancelBtn').onclick = null;
            $('confirmProceedBtn').onclick = null;
            document.removeEventListener('keydown', handleEscape);
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
                resolve(false);
            }
        };
        
        $('confirmCancelBtn').onclick = () => { cleanup(); resolve(false); };
        $('confirmProceedBtn').onclick = () => { cleanup(); resolve(true); };
        document.addEventListener('keydown', handleEscape);
    });
}

function showSkeleton(containerId, count = 3) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = Array(count).fill('<div class="list-item"><strong class="muted">Loading...</strong></div>').join('');
}

// --- API ---
async function parseJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

async function refreshSession() {
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken }
    });
    if (!response.ok) return false;
    const data = await response.json();
    state.authToken = data.token;
    return true;
}

async function apiFetch(url, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    if (state.authToken) headers.set('Authorization', `Bearer ${state.authToken}`);
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.status === 401 && retry && await refreshSession()) return apiFetch(url, options, false);
    return response;
}

async function init() {
    try {
        const configResponse = await fetch('/api/config', { credentials: 'include', cache: 'no-store' });
        const config = await configResponse.json();
        state.csrfToken = config.csrfToken || '';
        if (!await refreshSession()) throw new Error('Sign in to Monika AI before opening the admin dashboard.');
        
        $('adminStatus').textContent = 'Loading dashboard...';
        $('adminStatus').hidden = false;
        
        showSkeleton('reportList', 3);
        showSkeleton('auditList', 5);
        
        await Promise.all([
            loadOverview(), 
            loadReports(), 
            loadAudit(),
            loadSessions(),
            loadAnalytics()
        ]);
        
        $('adminStatus').hidden = true;
        $('adminContent').hidden = false;
    } catch (error) {
        $('adminStatus').textContent = error.message;
        $('adminStatus').classList.add('error');
    }
}

// --- DATA LOADING ---
async function loadOverview() {
    const response = await apiFetch('/api/admin/overview', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) throw new Error(data.error || 'Administrator access is required.');
    
    state.overview = data;

    const metrics = [
        ['Users', data.users],
        ['New users (24h)', data.newUsers24h],
        ['Active users (24h)', data.activeUsers24h],
        ['Conversations', data.conversations],
        ['Messages', data.messages],
        ['Active sessions', data.activeSessions],
        ['Open reports', data.reports],
        ['AI failures (24h)', data.aiFailures24h],
        ['Auth events (24h)', data.authenticationFailures24h],
        ['Rate limits (24h)', data.rateLimitEvents24h],
        ['AI requests', data.usage?.messages || 0],
        ['Estimated tokens', data.usage?.estimatedTokens || 0],
        ['Cost (USD)', Number(data.usage?.estimatedCostUsd || 0).toFixed(4)]
    ];
    
    const grid = $('metricGrid');
    if (grid) {
        grid.innerHTML = metrics.map(([label, value]) => `
            <div class="kpi-card fade-in">
                <div class="kpi-top">
                    <p class="kpi-label">${label}</p>
                    <div class="kpi-icon"><i class="fas fa-chart-line"></i></div>
                </div>
                <h3 class="kpi-value">${Number(value || 0).toLocaleString()}</h3>
            </div>
        `).join('');
    }
}

async function loadReports() {
    const response = await apiFetch('/api/admin/reports', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        showAdminToast('Could not load reports.', 'error');
        return;
    }
    state.reports = Array.isArray(data) ? data : [];
    const list = $('reportList');
    if (!list) return;
    if (!state.reports.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No reports.</strong></div>';
        return;
    }
    list.innerHTML = state.reports.map(report => `
        <div class="list-item fade-in">
            <strong>${report.feedback?.reportType || 'report'} · ${report.userId}</strong>
            <p>${report.content}</p>
            <small class="muted">${report.feedback?.comment || new Date(report.feedback?.updatedAt || report.createdAt).toLocaleString()}</small>
        </div>
    `).join('');
}

async function loadAudit() {
    const response = await apiFetch('/api/admin/audit', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    state.audit = Array.isArray(data) ? data : [];
    const list = $('auditList');
    if (!list) return;
    if (!state.audit.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No audit events.</strong></div>';
        return;
    }
    list.innerHTML = state.audit.map(event => `
        <div class="list-item fade-in">
            <strong>${event.action}</strong>
            <small class="muted">${event.userId || 'anonymous'} · ${new Date(event.createdAt).toLocaleString()}</small>
        </div>
    `).join('');
}

async function loadSessions() {
    const tbody = $('sessionTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading...</td></tr>';
    const response = await apiFetch('/api/admin/sessions', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Unable to load active sessions.</td></tr>';
        return;
    }
    state.sessions = Array.isArray(data) ? data : [];
    if (!state.sessions.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">No active sessions found.</td></tr>';
        return;
    }
    tbody.innerHTML = state.sessions.map(s => `
        <tr class="fade-in">
            <td>
                <strong>${s.deviceName || s.browser || 'Unknown Device'}</strong>
                <div class="muted" style="font-size:0.78rem;">${s.operatingSystem || 'OS unknown'} · ${s.userId}</div>
                ${s.lastIpHash ? `<div class="muted" style="font-size:0.75rem;">IP Hash: ${s.lastIpHash.substring(0,8)}...</div>` : ''}
            </td>
            <td>${s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'Just now'}</td>
            <td>${s.createdAt ? new Date(s.createdAt).toLocaleString() : 'N/A'}</td>
            <td><span class="pill success">Active</span></td>
            <td>
                <button class="danger-action-btn revoke-session-btn" data-session-id="${s._id || ''}" style="padding: 6px 12px; min-height: unset; font-size: 0.82rem;" type="button">
                    Terminate
                </button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.revoke-session-btn').forEach(btn => {
        btn.onclick = () => revokeSession(btn.getAttribute('data-session-id'));
    });
}

async function loadAnalytics() {
    const response = await apiFetch('/api/admin/analytics', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok || !window.Chart) return;
    state.chartData = data;
    renderCharts();
}

// --- CHARTS ---
let chartsObj = {};
function renderCharts() {
    if (!state.chartData || !window.Chart) return;
    
    Chart.defaults.color = 'rgba(255, 255, 255, 0.68)';
    Chart.defaults.font.family = "'Poppins', sans-serif";
    
    const { dates, users, requests, messages } = state.chartData;
    
    if (chartsObj.dailyUsers) chartsObj.dailyUsers.destroy();
    const ctxUsers = $('dailyUsersChart');
    if (ctxUsers) {
        chartsObj.dailyUsers = new Chart(ctxUsers, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Active Users',
                    data: users,
                    borderColor: '#ff4fa3',
                    backgroundColor: 'rgba(255, 79, 163, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartsObj.volume) chartsObj.volume.destroy();
    const ctxVolume = $('volumeChart');
    if (ctxVolume) {
        chartsObj.volume = new Chart(ctxVolume, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Requests',
                    data: requests,
                    backgroundColor: '#8d63ff',
                    borderRadius: 4
                }, {
                    label: 'Messages',
                    data: messages,
                    backgroundColor: '#49d17c',
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

// --- ACTIONS ---
async function revokeSession(sessionId) {
    if (!sessionId) return;
    if (!await confirmAction('Are you sure you want to terminate this session? The device will be signed out immediately.')) return;
    const response = await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (!response.ok) return showAdminToast('Failed to revoke session.', 'error');
    showAdminToast('Session terminated successfully.', 'success');
    await loadSessions();
}

async function setSuspension(suspended) {
    const userId = $('adminUserId').value.trim();
    const reason = $('adminReason').value.trim();
    if (!userId) return showAdminToast('Enter the user email or phone number.', 'error');
    if (!await confirmAction(suspended ? `Suspend ${userId}?` : `Unsuspend ${userId}?`)) return;
    
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended, reason })
    });
    if (!response.ok) return showAdminToast('Account update failed.', 'error');
    
    showAdminToast(suspended ? 'User suspended and active sessions revoked.' : 'User suspension removed.', 'success');
    $('adminUserId').value = '';
    $('adminReason').value = '';
    await Promise.all([loadOverview(), loadAudit(), loadSessions()]);
}

async function doQuickAction(action) {
    if (!await confirmAction(`Proceed with action: ${action}?`)) return;
    try {
        let endpoint = '';
        if (action === 'cache') endpoint = '/api/admin/cache';
        if (action === 'maintenance') endpoint = '/api/admin/maintenance';
        if (action === 'broadcast') {
            showAdminToast('Broadcast functionality would open a modal here.', 'info');
            return;
        }
        
        if (!endpoint) return;
        const res = await apiFetch(endpoint, { method: 'POST' });
        if (!res.ok) throw new Error('Action failed');
        showAdminToast(`Action '${action}' completed successfully.`, 'success');
    } catch (e) {
        showAdminToast(e.message, 'error');
    }
}

// --- SEARCH ---
async function handleSearch() {
    const query = $('adminSearchQuery').value.trim();
    if (!query) {
        clearSearch();
        return;
    }
    const resultBox = $('adminSearchResults');
    if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = '<div class="list-item"><strong class="muted">Searching...</strong></div>';
    }
    const response = await apiFetch(`/api/admin/search?q=${encodeURIComponent(query)}`, { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        if (resultBox) resultBox.innerHTML = '<div class="list-item"><strong class="muted">Search request failed.</strong></div>';
        return;
    }
    const { users = [], auditEvents = [], reports = [] } = data;
    const count = users.length + auditEvents.length + reports.length;
    if (!count) {
        if (resultBox) resultBox.innerHTML = '<div class="list-item"><strong class="muted">No matching records found.</strong></div>';
        return;
    }
    let html = '';
    users.forEach(u => html += `<div class="list-item fade-in"><strong>User: ${u.sessionId}</strong><small class="muted">Status: ${u.suspendedAt ? 'Suspended' : 'Active'} · Last Active: ${u.lastActive ? new Date(u.lastActive).toLocaleString() : 'N/A'}</small></div>`);
    auditEvents.forEach(a => html += `<div class="list-item fade-in"><strong>Audit: ${a.action}</strong><small class="muted">User: ${a.userId || 'anon'} · ${new Date(a.createdAt).toLocaleString()}</small></div>`);
    reports.forEach(r => html += `<div class="list-item fade-in"><strong>Report: ${r.feedback?.reportType || 'report'}</strong><p style="margin:4px 0">${r.content}</p><small class="muted">User: ${r.userId} · ${new Date(r.createdAt).toLocaleString()}</small></div>`);
    if (resultBox) resultBox.innerHTML = html;
}

function clearSearch() {
    if ($('adminSearchQuery')) $('adminSearchQuery').value = '';
    const resultBox = $('adminSearchResults');
    if (resultBox) {
        resultBox.style.display = 'none';
        resultBox.innerHTML = '';
    }
}

// --- EXPORT ---
function downloadJsonFile(dataObj, filename) {
    const jsonStr = JSON.stringify(dataObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleExport(type) {
    const ts = new Date().toISOString().slice(0, 10);
    const ex = {
        'Snapshot': { exportedAt: new Date().toISOString(), overview: state.overview, reports: state.reports, audit: state.audit, sessions: state.sessions },
        'Reports': state.reports,
        'Audit': state.audit,
        'Metrics': state.overview || {}
    };
    downloadJsonFile(ex[type], `monika-admin-${type.toLowerCase()}-${ts}.json`);
}

// --- EVENTS ---
window.addEventListener('load', () => {
    init();
    
    // Quick Actions
    const quickButtons = document.querySelectorAll('.admin-toolbar .toolbar-btn');
    if (quickButtons[0]) quickButtons[0].onclick = () => doQuickAction('broadcast');
    if (quickButtons[1]) quickButtons[1].onclick = () => doQuickAction('cache');
    if (quickButtons[2]) quickButtons[2].onclick = () => doQuickAction('maintenance');
    
    // Bindings
    if ($('suspendUserBtn')) $('suspendUserBtn').onclick = () => setSuspension(true);
    if ($('unsuspendUserBtn')) $('unsuspendUserBtn').onclick = () => setSuspension(false);
    if ($('refreshReportsBtn')) $('refreshReportsBtn').onclick = () => { showSkeleton('reportList'); loadReports(); };
    if ($('refreshAuditBtn')) $('refreshAuditBtn').onclick = () => { showSkeleton('auditList', 5); loadAudit(); };
    if ($('refreshDashboardBtn')) $('refreshDashboardBtn').onclick = init;
    if ($('refreshSessionsBtn')) $('refreshSessionsBtn').onclick = loadSessions;
    if ($('adminSearchBtn')) $('adminSearchBtn').onclick = handleSearch;
    if ($('adminClearSearchBtn')) $('adminClearSearchBtn').onclick = clearSearch;
    
    // Debounced Search
    const searchInput = $('adminSearchQuery');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(state.searchTimeout);
            state.searchTimeout = setTimeout(handleSearch, 400);
        });
    }

    // Exports
    ['Snapshot', 'Reports', 'Audit', 'Metrics'].forEach(t => {
        const btn = $(`export${t}Btn`);
        if (btn) btn.onclick = () => handleExport(t);
    });
});
