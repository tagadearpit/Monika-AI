/* global Chart, performance */
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
    maintenanceMode: false,
    livePollingTimer: null,
    livePollingActive: false
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
        <i class="fas ${type === 'error' ? 'fa-paw' : 'fa-check-circle'}" style="color: ${type === 'error' ? 'var(--v2-danger)' : 'var(--v2-success)'}; font-size: 1.4rem;"></i>
        <div style="flex:1">
            <h4 style="margin:0; font-size: 0.95rem;">${type === 'error' ? 'Oops!' : 'Notice'}</h4>
            <p style="margin:2px 0 0; font-size: 0.85rem;" class="muted">${message}</p>
        </div>
        <button style="background:transparent; border:none; color:var(--v2-muted); cursor:pointer;" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
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

// --- KPI COUNT-UP ANIMATION ---
function animateCountUp(element, target, duration = 900) {
    const start = 0;
    const startTime = performance.now();
    const isDecimal = String(target).includes('.');
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic for a satisfying deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (target - start) * eased;
        
        if (isDecimal) {
            element.textContent = current.toFixed(4);
        } else {
            element.textContent = Math.round(current).toLocaleString();
        }
        
        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            // Ensure final value is exact
            element.textContent = isDecimal ? Number(target).toFixed(4) : Number(target).toLocaleString();
        }
    }
    
    requestAnimationFrame(update);
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

        // Start live activity polling
        startLiveActivityPolling();
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
                <h3 class="kpi-value" data-target="${value}">0</h3>
            </div>
        `).join('');

        // Animate count-up for each KPI value
        grid.querySelectorAll('.kpi-value').forEach(el => {
            const target = parseFloat(el.dataset.target) || 0;
            animateCountUp(el, target);
        });
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

// --- ANALYTICS ---
async function loadAnalytics() {
    const response = await apiFetch('/api/admin/analytics', { method: 'GET', cache: 'no-store' });
    const data = await parseJson(response);
    if (!response.ok || !window.Chart) return;
    state.chartData = data;
    renderCharts();
}

// --- CHARTS ---
let chartsObj = {};

function createGradient(ctx, canvas, colorTop, colorBottom) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);
    return gradient;
}

function chartDefaults() {
    Chart.defaults.color = 'rgba(160, 180, 210, 0.6)';
    Chart.defaults.font.family = "'JetBrains Mono', 'Consolas', monospace";
    Chart.defaults.font.size = 11;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.point.radius = 3;
    Chart.defaults.elements.point.hoverRadius = 6;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
}

function renderCharts() {
    if (!state.chartData || !window.Chart) return;
    chartDefaults();

    const { dates, signups, activeUsers, messages, errors, devices, featureTotals } = state.chartData;

    // 1. Growth & Engagement — line chart
    if (chartsObj.growth) chartsObj.growth.destroy();
    const growthCanvas = $('growthChart');
    if (growthCanvas) {
        const gCtx = growthCanvas.getContext('2d');
        chartsObj.growth = new Chart(growthCanvas, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: 'Signups',
                        data: signups,
                        borderColor: '#34d399',
                        backgroundColor: createGradient(gCtx, growthCanvas, 'rgba(52, 211, 153, 0.25)', 'rgba(52, 211, 153, 0.01)'),
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#34d399'
                    },
                    {
                        label: 'Active Users',
                        data: activeUsers,
                        borderColor: '#38bdf8',
                        backgroundColor: createGradient(gCtx, growthCanvas, 'rgba(56, 189, 248, 0.2)', 'rgba(56, 189, 248, 0.01)'),
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#38bdf8'
                    },
                    {
                        label: 'Messages',
                        data: messages,
                        borderColor: '#818cf8',
                        backgroundColor: createGradient(gCtx, growthCanvas, 'rgba(129, 140, 248, 0.15)', 'rgba(129, 140, 248, 0.01)'),
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#818cf8'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: 'rgba(56, 189, 248, 0.05)' } },
                    y: { grid: { color: 'rgba(56, 189, 248, 0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    // 2. Errors Over Time — bar chart
    if (chartsObj.errors) chartsObj.errors.destroy();
    const errorsCanvas = $('errorsChart');
    if (errorsCanvas) {
        const eCtx = errorsCanvas.getContext('2d');
        chartsObj.errors = new Chart(errorsCanvas, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Errors',
                    data: errors,
                    backgroundColor: createGradient(eCtx, errorsCanvas, 'rgba(248, 113, 113, 0.7)', 'rgba(248, 113, 113, 0.2)'),
                    borderColor: 'rgba(248, 113, 113, 0.9)',
                    borderWidth: 1,
                    borderRadius: 4,
                    hoverBackgroundColor: 'rgba(248, 113, 113, 0.9)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: 'rgba(56, 189, 248, 0.05)' } },
                    y: { grid: { color: 'rgba(56, 189, 248, 0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    // 3. Sessions by Device — two doughnut charts
    const doughnutColors = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#a78bfa', '#fb923c'];

    if (chartsObj.browser) chartsObj.browser.destroy();
    const browserCanvas = $('browserChart');
    if (browserCanvas && devices?.browsers) {
        const browserLabels = Object.keys(devices.browsers);
        const browserData = Object.values(devices.browsers);
        chartsObj.browser = new Chart(browserCanvas, {
            type: 'doughnut',
            data: {
                labels: browserLabels,
                datasets: [{
                    data: browserData,
                    backgroundColor: doughnutColors.slice(0, browserLabels.length),
                    borderColor: 'rgba(14, 22, 42, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10 } },
                    title: { display: true, text: 'Browsers', color: 'rgba(160, 180, 210, 0.7)', font: { size: 12, weight: '600' } }
                }
            }
        });
    }

    if (chartsObj.os) chartsObj.os.destroy();
    const osCanvas = $('osChart');
    if (osCanvas && devices?.operatingSystems) {
        const osLabels = Object.keys(devices.operatingSystems);
        const osData = Object.values(devices.operatingSystems);
        chartsObj.os = new Chart(osCanvas, {
            type: 'doughnut',
            data: {
                labels: osLabels,
                datasets: [{
                    data: osData,
                    backgroundColor: doughnutColors.slice(0, osLabels.length),
                    borderColor: 'rgba(14, 22, 42, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10 } },
                    title: { display: true, text: 'Operating Systems', color: 'rgba(160, 180, 210, 0.7)', font: { size: 12, weight: '600' } }
                }
            }
        });
    }

    // 4. Feature Usage — bar chart (lifetime totals)
    if (chartsObj.feature) chartsObj.feature.destroy();
    const featureCanvas = $('featureChart');
    if (featureCanvas && featureTotals) {
        const fCtx = featureCanvas.getContext('2d');
        const featureLabels = ['Conversations', 'Messages', 'Reminders', 'Memory Facts'];
        const featureData = [
            featureTotals.conversations || 0,
            featureTotals.messages || 0,
            featureTotals.reminders || 0,
            featureTotals.memoryFacts || 0
        ];
        const barColors = [
            createGradient(fCtx, featureCanvas, 'rgba(56, 189, 248, 0.7)', 'rgba(56, 189, 248, 0.2)'),
            createGradient(fCtx, featureCanvas, 'rgba(129, 140, 248, 0.7)', 'rgba(129, 140, 248, 0.2)'),
            createGradient(fCtx, featureCanvas, 'rgba(52, 211, 153, 0.7)', 'rgba(52, 211, 153, 0.2)'),
            createGradient(fCtx, featureCanvas, 'rgba(251, 191, 36, 0.7)', 'rgba(251, 191, 36, 0.2)')
        ];
        chartsObj.feature = new Chart(featureCanvas, {
            type: 'bar',
            data: {
                labels: featureLabels,
                datasets: [{
                    label: 'Lifetime Totals',
                    data: featureData,
                    backgroundColor: barColors,
                    borderColor: ['#38bdf8', '#818cf8', '#34d399', '#fbbf24'],
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    x: { grid: { color: 'rgba(56, 189, 248, 0.05)' }, beginAtZero: true },
                    y: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

// --- LIVE ACTIVITY PANEL ---
function formatAuditEvent(event) {
    const identifier = event.identifierMasked || event.userIdMasked || event.userId || event.metadata?.email
        || (String(event.action || '').startsWith('admin_') || String(event.action || '').startsWith('admin.') ? 'admin' : 'anon');
    const methodLabel = event.method ? ` · ${event.method}` : '';
    const time = new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return { time, action: event.action, identifier: `${identifier}${methodLabel}` };
}

async function fetchLiveActivity() {
    try {
        const response = await apiFetch('/api/admin/audit', { method: 'GET', cache: 'no-store' });
        const data = await parseJson(response);
        if (!response.ok) return;

        const events = (Array.isArray(data) ? data : []).slice(0, 8);
        const feed = $('liveActivityFeed');
        if (!feed) return;

        if (!events.length) {
            feed.innerHTML = '<div class="live-event"><span class="live-event-time">--:--:--</span><span class="live-event-action muted">No events yet</span><span class="live-event-id"></span></div>';
            return;
        }

        feed.innerHTML = events.map(event => {
            const { time, action, identifier } = formatAuditEvent(event);
            return `
                <div class="live-event">
                    <span class="live-event-time">${time}</span>
                    <span class="live-event-action">${action}</span>
                    <span class="live-event-id">${identifier}</span>
                </div>
            `;
        }).join('');
    } catch (_) {
        // Silently fail — next poll will retry
    }
}

function startLiveActivityPolling() {
    // Initial fetch
    fetchLiveActivity();
    state.livePollingActive = true;
    updateLiveStatus(true);

    // Poll every 8 seconds
    state.livePollingTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
            fetchLiveActivity();
        }
    }, 8000);

    // Pause/resume on visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        // Tab became visible — fetch immediately and resume
        fetchLiveActivity();
        updateLiveStatus(true);
    } else {
        // Tab hidden — polling continues via setInterval but fetchLiveActivity
        // won't actually make requests due to the visibility check inside
        updateLiveStatus(false);
    }
}

function updateLiveStatus(active) {
    const statusPill = $('liveActivityStatus');
    if (!statusPill) return;
    if (active) {
        statusPill.className = 'pill success';
        statusPill.innerHTML = '<i class="fas fa-circle"></i> Polling';
    } else {
        statusPill.className = 'pill warning';
        statusPill.innerHTML = '<i class="fas fa-pause"></i> Paused';
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
