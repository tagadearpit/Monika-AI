/* global Chart */
'use strict';

const state = {
    csrfToken: '',
    overview: null,
    reports: [],
    audit: [],
    sessions: [],
    suspendedUsers: [],
    theme: localStorage.getItem('monika_theme') || 'dark',
    chartData: null,
    searchTimeout: null,
    maintenanceMode: false
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

// --- TABS ---
function initTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.tab-panel');

    function switchTab(tabName) {
        tabs.forEach(t => {
            const isActive = t.dataset.tab === tabName;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', isActive);
        });
        panels.forEach(p => {
            p.classList.toggle('active', p.id === `panel-${tabName}`);
        });
        window.location.hash = tabName;
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Restore from URL hash
    const hash = window.location.hash.replace('#', '');
    const validTabs = ['overview', 'users', 'moderation', 'analytics'];
    if (hash && validTabs.includes(hash)) {
        switchTab(hash);
    }
}

// --- API ---
async function parseJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.status === 401) {
        window.location.href = '/admin-login';
        throw new Error('Admin session expired.');
    }
    return response;
}

async function init() {
    try {
        const configResponse = await fetch('/api/config', { credentials: 'include', cache: 'no-store' });
        const config = await configResponse.json();
        state.csrfToken = config.csrfToken || '';

        const sessionResponse = await fetch('/api/admin/session', { credentials: 'include', cache: 'no-store' });
        if (!sessionResponse.ok) {
            window.location.href = '/admin-login';
            return;
        }

        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) statusBadge.innerHTML = '<span class="status-dot"></span> Session verified';

        $('adminStatus').textContent = 'Loading dashboard...';
        $('adminStatus').hidden = false;
        
        showSkeleton('reportList', 3);
        showSkeleton('auditList', 5);
        showSkeleton('suspendedUsersList', 2);
        
        await Promise.all([
            loadOverview(), 
            loadReports(), 
            loadAudit(),
            loadSessions(),
            loadAnalytics(),
            loadSuspendedUsers(),
            loadMaintenanceStatus()
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
        ['Users', data.users, 'fa-users'],
        ['New users (24h)', data.newUsers24h, 'fa-user-plus'],
        ['Active users (24h)', data.activeUsers24h, 'fa-user-clock'],
        ['Conversations', data.conversations, 'fa-comments'],
        ['Messages', data.messages, 'fa-envelope'],
        ['Active sessions', data.activeSessions, 'fa-laptop'],
        ['Open reports', data.reports, 'fa-flag'],
        ['Pending reminders', data.pendingReminders, 'fa-bell'],
        ['AI failures (24h)', data.aiFailures24h, 'fa-robot'],
        ['Auth events (24h)', data.authenticationFailures24h, 'fa-key'],
        ['Rate limits (24h)', data.rateLimitEvents24h, 'fa-gauge-high'],
        ['AI requests', data.usage?.messages || 0, 'fa-bolt'],
        ['Estimated tokens', data.usage?.estimatedTokens || 0, 'fa-microchip'],
        ['Cost (USD)', Number(data.usage?.estimatedCostUsd || 0).toFixed(4), 'fa-dollar-sign']
    ];
    
    const grid = $('metricGrid');
    if (grid) {
        grid.innerHTML = metrics.map(([label, value, icon]) => `
            <div class="kpi-card fade-in">
                <div class="kpi-top">
                    <p class="kpi-label">${label}</p>
                    <div class="kpi-icon"><i class="fas ${icon}"></i></div>
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
            <strong>${report.feedback?.reportType || 'report'} · ${report.userIdMasked || report.userId}</strong>
            <p>${report.content}</p>
            <small class="muted">${report.feedback?.comment || new Date(report.feedback?.updatedAt || report.createdAt).toLocaleString()}</small>
        </div>
    `).join('');
}

async function loadAudit(category) {
    const categoryParam = category ? `?category=${encodeURIComponent(category)}` : '';
    const response = await apiFetch(`/api/admin/audit${categoryParam}`, { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) return;
    state.audit = Array.isArray(data) ? data : [];
    const list = $('auditList');
    if (!list) return;
    if (!state.audit.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No audit events.</strong></div>';
        return;
    }
    list.innerHTML = state.audit.map(event => {
        const identifier = event.identifierMasked || event.userIdMasked || event.userId || event.metadata?.email
            || (String(event.action || '').startsWith('admin_') || String(event.action || '').startsWith('admin.') ? 'admin' : 'anonymous');
        const methodLabel = event.method ? ` (${event.method})` : '';
        return `
        <div class="list-item fade-in">
            <strong>${event.action}</strong>
            <small class="muted">${identifier}${methodLabel} · ${new Date(event.createdAt).toLocaleString()}</small>
        </div>
    `;
    }).join('');
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
                <div class="muted" style="font-size:0.78rem;">${s.operatingSystem || 'OS unknown'} · ${s.userIdMasked || s.userId}</div>
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

async function loadSuspendedUsers() {
    const list = $('suspendedUsersList');
    if (!list) return;
    const response = await apiFetch('/api/admin/users/suspended', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok) {
        list.innerHTML = '<div class="list-item"><strong class="muted">Could not load suspended users.</strong></div>';
        return;
    }
    state.suspendedUsers = Array.isArray(data) ? data : [];
    if (!state.suspendedUsers.length) {
        list.innerHTML = '<div class="list-item"><strong class="muted">No suspended users.</strong></div>';
        return;
    }
    list.innerHTML = state.suspendedUsers.map(u => `
        <div class="suspended-user-item fade-in">
            <div class="user-info">
                <strong>${u.sessionIdMasked || u.sessionId}</strong>
                <small>${u.suspensionReason || 'No reason given'} · Suspended ${new Date(u.suspendedAt).toLocaleString()}</small>
            </div>
            <button class="secondary-action-btn unsuspend-btn" data-user-id="${u.sessionId}" type="button">
                <i class="fas fa-circle-check"></i> Unsuspend
            </button>
        </div>
    `).join('');

    list.querySelectorAll('.unsuspend-btn').forEach(btn => {
        btn.onclick = async () => {
            const userId = btn.getAttribute('data-user-id');
            if (!await confirmAction(`Unsuspend ${userId}?`)) return;
            const resp = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suspended: false, reason: '' })
            });
            if (!resp.ok) return showAdminToast('Failed to unsuspend user.', 'error');
            showAdminToast('User suspension removed.', 'success');
            await Promise.all([loadSuspendedUsers(), loadOverview(), loadAudit()]);
        };
    });
}

async function loadMaintenanceStatus() {
    try {
        const response = await apiFetch('/api/admin/maintenance', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (response.ok) {
            state.maintenanceMode = !!data.maintenanceMode;
            updateMaintenanceUI();
        }
    } catch (_) {
        // Non-critical — toggle will still work
    }
}

function updateMaintenanceUI() {
    const toggle = $('maintenanceToggle');
    const pill = $('maintenanceStatusPill');
    if (toggle) toggle.checked = state.maintenanceMode;
    if (pill) {
        if (state.maintenanceMode) {
            pill.className = 'pill danger maintenance-status-pill';
            pill.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Active';
        } else {
            pill.className = 'pill success maintenance-status-pill';
            pill.innerHTML = '<i class="fas fa-check-circle"></i> Off';
        }
    }
}

async function toggleMaintenance() {
    const action = state.maintenanceMode ? 'disable' : 'enable';
    if (!await confirmAction(`Are you sure you want to ${action} maintenance mode? ${!state.maintenanceMode ? 'All non-admin API endpoints will return 503.' : 'Normal service will resume.'}`)) {
        // Revert the checkbox
        const toggle = $('maintenanceToggle');
        if (toggle) toggle.checked = state.maintenanceMode;
        return;
    }
    try {
        const response = await apiFetch('/api/admin/maintenance', { method: 'POST' });
        const data = await parseJson(response);
        if (!response.ok) throw new Error('Toggle failed');
        state.maintenanceMode = !!data.maintenanceMode;
        updateMaintenanceUI();
        showAdminToast(`Maintenance mode ${state.maintenanceMode ? 'enabled' : 'disabled'}.`, 'success');
    } catch (e) {
        showAdminToast(e.message, 'error');
        // Revert
        const toggle = $('maintenanceToggle');
        if (toggle) toggle.checked = state.maintenanceMode;
    }
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
    await Promise.all([loadOverview(), loadAudit(), loadSessions(), loadSuspendedUsers()]);
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
    users.forEach(u => html += `<div class="list-item fade-in"><strong>User: ${u.sessionIdMasked || u.sessionId}</strong><small class="muted">Status: ${u.suspendedAt ? 'Suspended' : 'Active'} · Last Active: ${u.lastActive ? new Date(u.lastActive).toLocaleString() : 'N/A'}</small></div>`);
    auditEvents.forEach(a => html += `<div class="list-item fade-in"><strong>Audit: ${a.action}</strong><small class="muted">User: ${a.userIdMasked || a.userId || 'anon'} · ${new Date(a.createdAt).toLocaleString()}</small></div>`);
    reports.forEach(r => html += `<div class="list-item fade-in"><strong>Report: ${r.feedback?.reportType || 'report'}</strong><p style="margin:4px 0">${r.content}</p><small class="muted">User: ${r.userIdMasked || r.userId} · ${new Date(r.createdAt).toLocaleString()}</small></div>`);
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
    initTabs();
    init();
    
    // Bindings
    if ($('suspendUserBtn')) $('suspendUserBtn').onclick = () => setSuspension(true);
    if ($('unsuspendUserBtn')) $('unsuspendUserBtn').onclick = () => setSuspension(false);
    if ($('refreshReportsBtn')) $('refreshReportsBtn').onclick = () => { showSkeleton('reportList'); loadReports(); };
    if ($('refreshAuditBtn')) $('refreshAuditBtn').onclick = () => {
        const category = $('auditCategoryFilter')?.value || '';
        showSkeleton('auditList', 5);
        loadAudit(category);
    };
    if ($('refreshDashboardBtn')) $('refreshDashboardBtn').onclick = init;
    if ($('adminLogoutBtn')) $('adminLogoutBtn').onclick = async () => {
        try {
            await apiFetch('/api/admin/logout', { method: 'POST' });
        } catch (_) {
            // already redirecting to /admin-login if the session was invalid — ignore
        }
        window.location.href = '/admin-login';
    };
    if ($('refreshSessionsBtn')) $('refreshSessionsBtn').onclick = loadSessions;
    if ($('refreshSuspendedBtn')) $('refreshSuspendedBtn').onclick = () => {
        showSkeleton('suspendedUsersList', 2);
        loadSuspendedUsers();
    };
    if ($('adminSearchBtn')) $('adminSearchBtn').onclick = handleSearch;
    if ($('adminClearSearchBtn')) $('adminClearSearchBtn').onclick = clearSearch;
    
    // Maintenance toggle
    if ($('maintenanceToggle')) $('maintenanceToggle').onchange = toggleMaintenance;

    // Audit category filter
    if ($('auditCategoryFilter')) {
        $('auditCategoryFilter').onchange = () => {
            const category = $('auditCategoryFilter').value;
            showSkeleton('auditList', 5);
            loadAudit(category);
        };
    }

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
