// ============================================================
// AirdropAlpha Dashboard — Frontend Logic
// ============================================================

(function () {
  'use strict';

  const API = '';  // Relative — same origin

  // ---- State ----
  let opportunities = [];
  let currentFilter = 'all';

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    checkDemoMode();
    checkHealth();
    loadOpportunities();
    loadAgentStats();
    setupFilterButtons();
  });

  // ---- Demo Mode ----
  function checkDemoMode() {
    fetch(`${API}/api/agent/info`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data.demoMode) {
          const banner = document.getElementById('demo-banner');
          banner.classList.remove('hidden');
          document.body.classList.add('has-demo-banner');
        }
      })
      .catch(() => { /* ignore — demo mode check is best-effort */ });
  }

  // ---- Health Check ----
  function checkHealth() {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const dot = document.getElementById('status-dot');
          const text = document.getElementById('status-text');
          dot.classList.add('online');
          text.textContent = 'Online';

          // Update hero stats
          const d = data.data;
          setText('stat-opportunities', d.opportunities);
          setText('stat-scans', d.scanner?.scanCount ?? '—');
          setText('stat-uptime', formatUptime(d.uptime));

          if (d.scanner?.protocols) {
            setText('stat-protocols', d.scanner.protocols.length);
          }
        }
      })
      .catch(() => {
        document.getElementById('status-dot').classList.add('offline');
        document.getElementById('status-text').textContent = 'Offline';
      });
  }

  // ---- Opportunities ----
  function loadOpportunities() {
    fetch(`${API}/api/opportunities`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          opportunities = data.data;
          renderOpportunities(opportunities);
        } else {
          showOpportunitiesError('Failed to load opportunities');
        }
      })
      .catch(err => {
        showOpportunitiesError('Cannot connect to API');
        console.error('Failed to load opportunities:', err);
      });
  }

  function renderOpportunities(opps) {
    const grid = document.getElementById('opportunities-grid');

    if (!opps || opps.length === 0) {
      grid.innerHTML = `
        <div class="loading-spinner">
          <p style="color: var(--text-muted)">No opportunities found. Scanner may still be initializing...</p>
        </div>`;
      return;
    }

    grid.innerHTML = opps.map((opp, i) => `
      <div class="opp-card fade-in-up" style="animation-delay: ${i * 0.07}s" data-protocol="${opp.sourceProtocol.toLowerCase()}">
        <div class="opp-header">
          <div>
            <div class="opp-protocol">${escHtml(opp.sourceProtocol)}</div>
            <div class="opp-name">${escHtml(opp.name)}</div>
          </div>
          <div class="opp-token">${escHtml(opp.symbol)}</div>
        </div>
        <div class="opp-metrics">
          <div>
            <div class="opp-metric-label">Est. Value</div>
            <div class="opp-metric-value text-green">
              ${opp.estimatedValueUsd != null ? '$' + opp.estimatedValueUsd.toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div class="opp-metric-label">Confidence</div>
            <div class="opp-metric-value">${Math.round((opp.confidence ?? 0) * 100)}%</div>
          </div>
          <div>
            <div class="opp-metric-label">Safety Score</div>
            <div class="opp-metric-value" style="color: ${scoreColor(opp.safetyScore)}">${opp.safetyScore}/100</div>
          </div>
          <div>
            <div class="opp-metric-label">Effort</div>
            <div class="opp-metric-value">${escHtml(opp.effort ?? '—')}</div>
          </div>
        </div>
        <div class="opp-footer">
          ${riskBadge(opp.safetyScore, opp.riskLevel)}
          <span class="status-badge status-${(opp.status || '').toLowerCase()}">${escHtml(opp.status)}</span>
        </div>
      </div>
    `).join('');
  }

  function showOpportunitiesError(msg) {
    document.getElementById('opportunities-grid').innerHTML = `
      <div class="loading-spinner">
        <p style="color: var(--risk-high)">⚠ ${escHtml(msg)}</p>
        <button class="btn btn-secondary" style="margin-top: 12px" onclick="location.reload()">Retry</button>
      </div>`;
  }

  // ---- Filter ----
  function setupFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        const filtered = currentFilter === 'all'
          ? opportunities
          : opportunities.filter(o => o.sourceProtocol.toLowerCase().includes(currentFilter));
        renderOpportunities(filtered);
      });
    });
  }

  // ---- Safety Scanner ----
  window.app = window.app || {};

  window.app.scanAddress = function () {
    const input = document.getElementById('safety-address');
    const address = input.value.trim();
    if (!address) { input.focus(); return; }
    performScan(address);
  };

  window.app.quickScan = function (address) {
    document.getElementById('safety-address').value = address;
    performScan(address);
  };

  function performScan(address) {
    const resultDiv = document.getElementById('safety-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `
      <div class="scan-loading">
        <p>🔍 Scanning <code class="text-mono">${escHtml(address.slice(0, 8))}...${escHtml(address.slice(-6))}</code></p>
        <div class="bar"><div class="bar-fill"></div></div>
        <p style="font-size: 12px; color: var(--text-muted)">Running dual-layer analysis...</p>
      </div>`;

    fetch(`${API}/api/safety/${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          renderSafetyResult(data.data, address);
        } else {
          resultDiv.innerHTML = `<p style="color: var(--risk-high)">⚠ ${escHtml(data.error || 'Analysis failed')}</p>`;
        }
      })
      .catch(err => {
        resultDiv.innerHTML = `<p style="color: var(--risk-high)">⚠ Could not connect to safety scanner</p>`;
        console.error('Safety scan error:', err);
      });
  }

  function renderSafetyResult(report, address) {
    const resultDiv = document.getElementById('safety-result');
    const score = report.combinedScore ?? 0;
    const circumference = 2 * Math.PI * 56;
    const dashOffset = circumference - (score / 100) * circumference;
    const color = scoreColor(score);

    const internalScore = report.internalScore ?? 0;
    const shieldScore = report.agentShieldScore;

    let flagsHtml = '';
    if (report.flags && report.flags.length > 0) {
      flagsHtml = `
        <div class="safety-breakdown">
          <h4>Risk Factors (${report.flags.length})</h4>
          ${report.flags.map(f => `
            <div class="safety-flag severity-${f.severity}">
              <span class="safety-flag-icon">${severityIcon(f.severity)}</span>
              <div class="safety-flag-text">
                <div>${escHtml(f.message)}</div>
                ${f.details ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px">${escHtml(f.details)}</div>` : ''}
                <div class="safety-flag-category">${escHtml(f.category)}</div>
              </div>
            </div>
          `).join('')}
        </div>`;
    } else {
      flagsHtml = `
        <div class="safety-breakdown">
          <h4>Risk Factors</h4>
          <p style="color: var(--accent-green); text-align: center; padding: 16px">✓ No risk factors detected</p>
        </div>`;
    }

    resultDiv.innerHTML = `
      <div class="safety-score-display">
        <div class="safety-score-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle class="score-bg" cx="70" cy="70" r="56"/>
            <circle class="score-fg" cx="70" cy="70" r="56"
              stroke="${color}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${dashOffset}"/>
          </svg>
          <div class="safety-score-number" style="color: ${color}">${score}</div>
        </div>
        <div class="safety-score-label">
          ${riskBadge(score, report.riskLevel)}
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); font-family: var(--font-mono)">
          ${escHtml(address.slice(0, 12))}...${escHtml(address.slice(-8))}
        </div>
      </div>
      <div class="safety-scores-bar">
        <div class="score-bar-item">
          <label>Internal Score: ${internalScore}/100</label>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width: ${internalScore}%; background: ${scoreColor(internalScore)}"></div>
          </div>
        </div>
        <div class="score-bar-item">
          <label>AgentShield: ${shieldScore != null ? shieldScore + '/100' : 'N/A'}</label>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width: ${shieldScore ?? 0}%; background: ${scoreColor(shieldScore ?? 50)}"></div>
          </div>
        </div>
      </div>
      ${flagsHtml}
    `;
  }

  // ---- Agent Stats ----
  function loadAgentStats() {
    Promise.all([
      fetch(`${API}/api/agent/info`).then(r => r.json()),
      fetch(`${API}/health`).then(r => r.json()),
    ])
      .then(([info, health]) => {
        renderAgentStats(
          info.success ? info.data : null,
          health.success ? health.data : null,
        );
      })
      .catch(() => {
        document.getElementById('agent-stats').innerHTML = `
          <div class="loading-spinner">
            <p style="color: var(--risk-high)">⚠ Cannot load agent stats</p>
          </div>`;
      });
  }

  function renderAgentStats(info, health) {
    const grid = document.getElementById('agent-stats');
    const cards = [];

    if (info) {
      cards.push(agentCard('Agent Name', info.name || 'AirdropAlpha', info.description || ''));
      cards.push(agentCard('Version', info.version || '—', `Phase: ${info.phase || '—'}`));
      cards.push(agentCard('Demo Mode', info.demoMode ? '🧪 ENABLED' : '🔴 DISABLED', 'Seed data from known protocols'));
    }

    if (health) {
      cards.push(agentCard('Status', health.status === 'healthy' ? '🟢 Healthy' : '🔴 Unhealthy', `Uptime: ${formatUptime(health.uptime)}`));
      cards.push(agentCard('Opportunities', String(health.opportunities ?? '—'), `Scans: ${health.scanner?.scanCount ?? '—'}`));
      cards.push(agentCard('Executor', health.executorReady ? '⚡ Ready' : '⏸ Simulation', 'Auto-execution engine'));

      if (health.scanner?.protocols) {
        const protos = health.scanner.protocols;
        cards.push(
          `<div class="agent-card">
            <div class="agent-card-title">Protocols</div>
            <div class="agent-card-value">${protos.length} Active</div>
            <div class="tag-list">
              ${protos.map(p => `<span class="tag">${escHtml(p)}</span>`).join('')}
            </div>
          </div>`
        );
      }

      cards.push(agentCard('Network', health.scanner?.networkAvailable ? '🌐 Connected' : '❌ Disconnected', 'Solana Devnet'));
    }

    grid.innerHTML = cards.join('');
  }

  function agentCard(title, value, sub) {
    return `
      <div class="agent-card">
        <div class="agent-card-title">${escHtml(title)}</div>
        <div class="agent-card-value">${value}</div>
        ${sub ? `<div class="agent-card-sub">${escHtml(sub)}</div>` : ''}
      </div>`;
  }

  // ---- Helpers ----
  function scoreColor(score) {
    if (score >= 70) return 'var(--risk-safe)';
    if (score >= 40) return 'var(--risk-medium)';
    return 'var(--risk-high)';
  }

  function riskBadge(score, riskLevel) {
    if (score >= 70) return `<span class="risk-badge risk-safe">🟢 SAFE</span>`;
    if (score >= 40) return `<span class="risk-badge risk-medium">🟡 MEDIUM</span>`;
    if (score >= 20) return `<span class="risk-badge risk-high">🔴 HIGH RISK</span>`;
    return `<span class="risk-badge risk-critical">🔴 CRITICAL</span>`;
  }

  function severityIcon(severity) {
    switch (severity) {
      case 'danger': return '🔴';
      case 'warning': return '🟡';
      case 'info': return 'ℹ️';
      default: return '•';
    }
  }

  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text);
  }

  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

})();
