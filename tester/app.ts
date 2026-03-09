const API_BASE = 'http://localhost:3001/api';

// Elements
const cfgTokenLimit = document.getElementById('cfg-token-limit') as HTMLInputElement;
const cfgCostLimit = document.getElementById('cfg-cost-limit') as HTMLInputElement;
const cfgSimThreshold = document.getElementById('cfg-sim-threshold') as HTMLInputElement;
const updateConfigBtn = document.getElementById('update-config-btn') as HTMLButtonElement;

const subjectIdInput = document.getElementById('subject-id') as HTMLInputElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendRequestBtn = document.getElementById('send-request-btn') as HTMLButtonElement;
const hugePromptBtn = document.getElementById('huge-prompt-btn') as HTMLButtonElement;

const logsContainer = document.getElementById('logs-container') as HTMLDivElement;
const subjectList = document.getElementById('subject-list') as HTMLDivElement;
const statTotalKeys = document.getElementById('stat-total-keys') as HTMLSpanElement;
const statActiveSubjects = document.getElementById('stat-active-subjects') as HTMLSpanElement;
const refreshStatsBtn = document.getElementById('refresh-stats-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusDot = document.querySelector('.dot') as HTMLSpanElement;

// Initialization
async function init() {
    try {
        const res = await fetch(`${API_BASE}/config`);
        if (res.ok) {
            const config = await res.json();
            updateConfigFields(config);
            setOnline(true);
        } else {
            setOnline(false);
        }
    } catch (e) {
        setOnline(false);
    }
    refreshStats();
    // Start polling stats every 3 seconds
    setInterval(refreshStats, 3000);
}

function setOnline(online: boolean) {
    statusText.innerText = online ? 'SYSTEM ACTIVE' : 'ENGINE OFFLINE';
    statusDot.className = online ? 'dot online' : 'dot';
}

function updateConfigFields(config: any) {
    if (config.minuteTokenLimit) cfgTokenLimit.value = config.minuteTokenLimit;
    if (config.dailyCostLimitUSD) cfgCostLimit.value = config.dailyCostLimitUSD;
    if (config.abuseDetection) {
        cfgSimThreshold.value = config.abuseDetection.promptSimilarityThreshold;
    }
}

// Actions
updateConfigBtn.addEventListener('click', async () => {
    const config = {
        minuteTokenLimit: parseInt(cfgTokenLimit.value),
        dailyCostLimitUSD: parseFloat(cfgCostLimit.value),
        abuseDetection: {
            promptSimilarityThreshold: parseInt(cfgSimThreshold.value),
        }
    };

    try {
        const res = await fetch(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (res.ok) {
            addLog('system', 'Security policy synchronized');
        }
    } catch (e: any) {
        addLog('error', `Policy sync failed: ${e.message}`);
    }
});

sendRequestBtn.addEventListener('click', async () => {
    const subjectId = subjectIdInput.value;
    const prompt = promptInput.value;

    if (!prompt) {
        alert('Prompt payload required');
        return;
    }

    sendRequestBtn.disabled = true;
    sendRequestBtn.innerText = 'Transmitting...';

    try {
        const res = await fetch(`${API_BASE}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectId, prompt })
        });

        const data = await res.json();
        if (res.ok) {
            addLog('allowed', `Request authorized. ${data.response.totalTokens} tokens consumed.`, data.response);
        } else {
            addLog('blocked', `Request denied: ${data.reason}`, data.details);
        }
    } catch (e: any) {
        addLog('error', `Transmission failure: ${e.message}`);
    } finally {
        sendRequestBtn.disabled = false;
        sendRequestBtn.innerText = 'Fire Request';
        refreshStats();
    }
});

hugePromptBtn.addEventListener('click', () => {
    promptInput.value = 'A'.repeat(50000);
});

refreshStatsBtn.addEventListener('click', refreshStats);

async function refreshStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        if (res.ok) {
            const stats = await res.json();
            renderStats(stats);
            setOnline(true);
        }
    } catch (e) {
        setOnline(false);
    }
}

function renderStats(stats: any) {
    statTotalKeys.innerText = stats.global.totalKeys;
    statActiveSubjects.innerText = stats.global.activeSubjects;

    const subjects = stats.subjects;
    if (Object.keys(subjects).length === 0) {
        subjectList.innerHTML = '<div class="empty-state" style="padding: 2rem 0;">No subjects tracked.</div>';
        return;
    }

    subjectList.innerHTML = '';
    for (const sid in subjects) {
        const subject = subjects[sid];
        const models = subject.models;

        for (const modelId in models) {
            const m = models[modelId];
            const score = m.abuseScore || 0;
            const scorePercent = Math.min(100, score);
            const scoreClass = score < 30 ? 'low' : score < 70 ? 'medium' : 'high';

            const item = document.createElement('div');
            item.className = 'subject-item';
            item.innerHTML = `
                <div class="subject-info">
                    <span class="subject-id">${sid} <span style="opacity:0.5; font-size:0.7rem;">(${modelId})</span></span>
                    <span class="tag">${m.minuteTokens || 0} req/min</span>
                </div>
                <div class="abuse-score-container">
                    <div class="progress-bar-bg">
                        <div class="progress-bar ${scoreClass}" style="width: ${scorePercent}%"></div>
                    </div>
                    <div class="score-text">
                        <span>Abuse Score</span>
                        <span>${score}/100</span>
                    </div>
                </div>
                <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${m.rollingAvg ? `<span class="tag">Avg: ${m.rollingAvg}t</span>` : ''}
                    ${m.dailySpend ? `<span class="tag">Spend: $${(m.dailySpend / 100).toFixed(2)}</span>` : ''}
                </div>
            `;
            subjectList.appendChild(item);
        }
    }
}

resetBtn.addEventListener('click', async () => {
    if (confirm('Erase all security metadata?')) {
        await fetch(`${API_BASE}/reset`, { method: 'POST' });
        addLog('system', 'Redis state purged');
        refreshStats();
    }
});

function addLog(type: string, message: string, details: any = null) {
    if (logsContainer.querySelector('.empty-state')) {
        logsContainer.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let metaHtml = '';
    if (details) {
        const flags = [];
        if (details.abuseFlags && details.abuseFlags.length > 0) flags.push(...details.abuseFlags);
        if (details.velocitySpike) flags.push('VELOCITY_SPIKE');
        if (details.softThrottled) flags.push('SOFT_THROTTLED');

        if (flags.length > 0) {
            metaHtml = `<div class="log-footer">${flags.map(f => `<span class="tag tag-warning">${f}</span>`).join('')}</div>`;
        }
    }

    entry.innerHTML = `
        <div class="log-header">
            <span class="log-status">${type}</span>
            <span class="log-time">${time}</span>
        </div>
        <div class="log-content">${message}</div>
        ${metaHtml}
    `;

    logsContainer.insertBefore(entry, logsContainer.firstChild);

    // Keep only last 50 logs
    if (logsContainer.children.length > 50) {
        logsContainer.removeChild(logsContainer.lastChild!);
    }
}

init();
