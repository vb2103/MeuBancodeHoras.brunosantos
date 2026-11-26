import { escapeHtml, formatDateBR } from './config.js';
import { computeAnalyticsSummary, formatDaysFromMinutes, formatHHMM, maskPrivacyHours } from './time.js';

let balanceChartInstance = null;
let monthlyChartInstance = null;
let ratioChartInstance = null;

export function destroyCharts() {
  if (balanceChartInstance) {
    balanceChartInstance.destroy();
    balanceChartInstance = null;
  }
  if (monthlyChartInstance) {
    monthlyChartInstance.destroy();
    monthlyChartInstance = null;
  }
  if (ratioChartInstance) {
    ratioChartInstance.destroy();
    ratioChartInstance = null;
  }
}

function createCenterTextPlugin(centerTitle, centerValue, isDark) {
  return {
    id: 'saldoCenterText',
    beforeDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText(centerTitle, cx, cy - 11);
      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.font = '700 16px "JetBrains Mono", monospace';
      ctx.fillText(centerValue, cx, cy + 10);
      ctx.restore();
    }
  };
}

function renderInsightsCards(analytics, _chronoEntries, _dailyMinutes, privacyMode = false) {
  const fmtH = (mins, plus = false) => {
    const raw = formatHHMM(mins, plus);
    return privacyMode ? maskPrivacyHours(raw) : raw;
  };
  const expTitle = document.getElementById('analyticsExpiryTitle');
  const expText = document.getElementById('analyticsExpiryText');
  if (expTitle && expText) {
    if (analytics.expiredMinutes > 0) {
      expTitle.textContent = `${fmtH(analytics.expiredMinutes)} com prazo vencido`;
      expText.textContent =
        'Existem créditos que passaram da data limite sem uso em folga. Você pode encerrar ou dar baixa nos prazos abaixo.';
    } else if (analytics.expiringSoonMinutes > 0) {
      expTitle.textContent = `${fmtH(analytics.expiringSoonMinutes)} vencendo em breve`;
      expText.textContent =
        'Suas folgas descontam primeiro as horas mais antigas que vencem antes. Vale planejar uma folga antes do prazo.';
    } else if (analytics.nextCriticalBucket) {
      expTitle.textContent = 'Prazos em dia';
      expText.textContent =
        `Nenhuma hora perto de vencer. O próximo crédito a vencer é ${fmtH(analytics.nextCriticalBucket.remainingMinutes)} em ${formatDateBR(analytics.nextCriticalBucket.expiry)}.`;
    } else {
      expTitle.textContent = 'Tudo já compensado';
      expText.textContent = 'Não há horas antigas pendentes aguardando folga no seu extrato.';
    }
  }

  const originTitle = document.getElementById('analyticsOriginTitle');
  const originText = document.getElementById('analyticsOriginText');
  if (originTitle && originText) {
    if (analytics.creditedMinutesTotal === 0) {
      originTitle.textContent = 'Sem créditos registrados';
      originText.textContent = 'Quando você trabalhar em feriados ou fizer horas extras, o bônus em HH:MM aparecerá aqui.';
    } else if (analytics.bonusMinutes > 0) {
      originTitle.textContent = `${fmtH(analytics.bonusMinutes, true)} de bônus gerados`;
      originText.textContent =
        `Você trabalhou ${fmtH(analytics.workedMinutesTotal)} e acumulou ${fmtH(analytics.creditedMinutesTotal)} no banco graças aos multiplicadores (ex.: feriado 1.4x).`;
    } else {
      originTitle.textContent = `${fmtH(analytics.creditedMinutesTotal)} acumulados`;
      originText.textContent =
        `Feriados somam ${fmtH(analytics.holidayCreditsMinutes)} e horas extras somam ${fmtH(analytics.overtimeCreditsMinutes)} no período.`;
    }
  }
}

function renderFifoExpiryTimeline(analytics, privacyMode = false) {
  const container = document.getElementById('expiryBreakdownContainer');
  if (!container) return;
  const fmtH = (mins) => {
    const raw = formatHHMM(mins);
    return privacyMode ? maskPrivacyHours(raw) : raw;
  };

  if (!analytics.openBuckets.length) {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2.5">
        <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0"></i>
        <span>Ótima notícia: não há créditos em aberto com risco de vencimento no momento.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = analytics.openBuckets.map((bucket) => {
    const barColor = bucket.badge.isExpired
      ? 'bg-rose-500'
      : bucket.badge.isAlert
        ? 'bg-amber-500'
        : 'bg-indigo-600';
    const openPct = Math.max(4, 100 - bucket.usedPct);
    const canWriteOff = Boolean(bucket.badge?.isExpired || bucket.badge?.isAlert);
    const badgeText = privacyMode && bucket.expiry
      ? `${formatDateBR(bucket.expiry)}${bucket.badge.isExpired ? ' (Vencido)' : ''}`
      : bucket.badge.label;

    return `
      <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col gap-2.5 min-w-0">
        <div class="flex items-start justify-between gap-2.5 min-w-0">
          <div class="min-w-0 flex-1">
            <span class="block font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">${formatDateBR(bucket.date)}</span>
            <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug mt-0.5 break-words">${escapeHtml(bucket.title)}</h4>
          </div>
          <span class="px-2 py-0.5 rounded-md border text-[11px] font-medium tabular-nums whitespace-nowrap shrink-0 ${bucket.badge.badgeClass}">${escapeHtml(badgeText)}</span>
        </div>

        <div class="space-y-1.5">
          <p class="text-xs text-slate-600 dark:text-slate-300 tabular-nums leading-relaxed">
            Resta compensar <strong class="font-mono text-slate-900 dark:text-white">${fmtH(bucket.remainingMinutes)}</strong> de ${fmtH(bucket.totalMinutes)}
            ${bucket.usedMinutes > 0 ? `• ${fmtH(bucket.usedMinutes)} abatidos` : '• 100% disponível'}
          </p>
          <div class="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-label="Proporção restante deste crédito">
            <div class="h-full rounded-full ${barColor} transition-all duration-300" style="width: ${openPct}%"></div>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          ${canWriteOff ? `
          <button type="button" data-bucket-id="${escapeHtml(bucket.id)}" class="writeoff-bucket-btn min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition">
            Encerrar / Dar baixa
          </button>` : ''}
          <button type="button" data-sim-minutes="${bucket.remainingMinutes}" class="sim-from-bucket-btn min-h-[40px] px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 text-xs font-semibold transition">
            Simular folga
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function formatChartAxisTick(hoursVal, showPlus, isCompact, privacyMode = false) {
  if (privacyMode) return '••h';
  const mins = Math.round(Number(hoursVal) * 60);
  if (isCompact && mins % 60 === 0) {
    const h = Math.trunc(mins / 60);
    if (h === 0) return '0h';
    return `${h > 0 && showPlus ? '+' : ''}${h}h`;
  }
  return formatHHMM(mins, showPlus);
}

function renderBalanceLineChart(chronoEntries, dailyMinutes, scope, isDark, gridColor, textColor, isCompact, privacyMode = false) {
  const canvas = document.getElementById('balanceChart');
  const emptyBox = document.getElementById('balanceChartEmpty');
  const filtered = scope === 'realized'
    ? chronoEntries.filter((e) => e.status === 'realized')
    : chronoEntries;

  if (!filtered.length) {
    if (balanceChartInstance) {
      balanceChartInstance.destroy();
      balanceChartInstance = null;
    }
    canvas.classList.add('hidden');
    emptyBox?.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  emptyBox?.classList.add('hidden');

  let acc = 0;
  const computed = filtered.map((e) => {
    acc += e.deltaMinutes;
    return { ...e, curveMinutes: acc };
  });

  const labels = computed.map((i) => formatDateBR(i.date).slice(0, 5));
  const dataHours = computed.map((i) => Number((i.curveMinutes / 60).toFixed(4)));
  const zeroBaseline = computed.map(() => 0);
  const pointColors = computed.map((i) => (i.type === 'credit' ? '#10b981' : '#f43f5e'));

  if (balanceChartInstance) balanceChartInstance.destroy();
  balanceChartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Saldo Acumulado',
          data: dataHours,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.14)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: pointColors,
          pointBorderColor: isDark ? '#0f172a' : '#ffffff',
          pointBorderWidth: 1.5
        },
        {
          label: 'Linha Zero (00:00)',
          data: zeroBaseline,
          borderColor: isDark ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.4)',
          borderDash: [5, 5],
          borderWidth: 1.25,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0, right: isCompact ? 4 : 0, top: 2, bottom: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: isCompact ? 'start' : 'end',
          labels: { color: textColor, boxWidth: isCompact ? 10 : 12, font: { size: isCompact ? 10 : 11 } }
        },
        tooltip: {
          enabled: !privacyMode,
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const entry = computed[idx];
              return entry ? `${formatDateBR(entry.date)} — ${entry.title}` : '';
            },
            label: (ctx) => {
              const entry = computed[ctx.dataIndex];
              if (!entry) return '';
              const impact = entry.type === 'credit'
                ? `+${formatHHMM(entry.minutes)} acumulados`
                : `-${formatHHMM(entry.minutes)} de folga/saída`;
              return [
                `Movimento (${entry.status === 'realized' ? 'Realizado' : 'Previsto'}): ${impact}`,
                `Saldo após este dia: ${formatHHMM(entry.curveMinutes, true)} (≈ ${formatDaysFromMinutes(entry.curveMinutes, dailyMinutes)})`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: textColor,
            font: { size: isCompact ? 10 : 11 },
            maxTicksLimit: isCompact ? 6 : 12,
            maxRotation: isCompact ? 40 : 0
          }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: isCompact ? 10 : 11 },
            maxTicksLimit: isCompact ? 6 : 8,
            callback: (val) => formatChartAxisTick(val, true, isCompact, privacyMode)
          }
        }
      }
    }
  });
}

function renderMonthlyBarsChart(analytics, isDark, gridColor, textColor, isCompact, privacyMode = false) {
  const canvas = document.getElementById('monthlyChart');
  const emptyBox = document.getElementById('monthlyChartEmpty');
  if (!canvas) return;

  if (!analytics.monthlySeries.length) {
    if (monthlyChartInstance) {
      monthlyChartInstance.destroy();
      monthlyChartInstance = null;
    }
    canvas.classList.add('hidden');
    emptyBox?.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  emptyBox?.classList.add('hidden');

  const labels = analytics.monthlySeries.map((m) => m.label);
  const creditsHours = analytics.monthlySeries.map((m) => Number((m.creditsMinutes / 60).toFixed(4)));
  const debitsHours = analytics.monthlySeries.map((m) => Number((m.debitsMinutes / 60).toFixed(4)));

  if (monthlyChartInstance) monthlyChartInstance.destroy();
  monthlyChartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Horas ganhas (+)',
          data: creditsHours,
          backgroundColor: isDark ? 'rgba(16, 185, 129, 0.85)' : '#10b981',
          borderRadius: 6,
          maxBarThickness: 34
        },
        {
          label: 'Folgas / saídas (-)',
          data: debitsHours,
          backgroundColor: isDark ? 'rgba(244, 63, 94, 0.85)' : '#f43f5e',
          borderRadius: 6,
          maxBarThickness: 34
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0, right: isCompact ? 4 : 0, top: 2, bottom: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: isCompact ? 'start' : 'end',
          labels: { color: textColor, boxWidth: isCompact ? 10 : 12, font: { size: isCompact ? 10 : 11 } }
        },
        tooltip: {
          enabled: !privacyMode,
          callbacks: {
            label: (ctx) => {
              const m = analytics.monthlySeries[ctx.dataIndex];
              const mins = ctx.datasetIndex === 0 ? m.creditsMinutes : m.debitsMinutes;
              return `${ctx.dataset.label}: ${formatHHMM(mins)}`;
            },
            afterBody: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const m = analytics.monthlySeries[idx];
              return m ? [`Saldo líquido no mês: ${formatHHMM(m.netMinutes, true)}`] : [];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: textColor,
            font: { size: isCompact ? 10 : 11 },
            maxTicksLimit: isCompact ? 6 : 12
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: isCompact ? 10 : 11 },
            maxTicksLimit: isCompact ? 6 : 8,
            callback: (val) => formatChartAxisTick(val, false, isCompact, privacyMode)
          }
        }
      }
    }
  });
}

function renderRatioDonutChart(analytics, mode, isDark, textColor, privacyMode = false) {
  const canvas = document.getElementById('ratioChart');
  const emptyBox = document.getElementById('ratioChartEmpty');
  const legendBox = document.getElementById('ratioLegendDetails');
  const fmtH = (mins) => {
    const raw = formatHHMM(mins);
    return privacyMode ? maskPrivacyHours(raw) : raw;
  };

  const rawItems = mode === 'origin'
    ? [
      { label: 'Feriados Trabalhados', mins: analytics.holidayCreditsMinutes, color: '#4f46e5', dot: 'bg-indigo-600' },
      { label: 'Horas Extras / Plantões', mins: analytics.overtimeCreditsMinutes, color: '#0ea5e9', dot: 'bg-sky-500' },
      { label: 'Ajustes / Manuais', mins: analytics.otherCreditsMinutes, color: '#8b5cf6', dot: 'bg-violet-500' }
    ]
    : [
      { label: 'Disponível (prazo longo)', mins: analytics.safeOpenMinutes, color: '#10b981', dot: 'bg-emerald-500' },
      { label: 'Vence em até 60 dias', mins: analytics.expiringSoonMinutes, color: '#f59e0b', dot: 'bg-amber-500' },
      { label: 'Vencido sem folga', mins: analytics.expiredMinutes, color: '#e11d48', dot: 'bg-rose-600' },
      { label: 'Já usado em folgas', mins: analytics.compensatedMinutes, color: '#64748b', dot: 'bg-slate-500' }
    ];

  const items = rawItems.filter((i) => i.mins > 0);
  const total = items.reduce((s, i) => s + i.mins, 0);

  if (!items.length || total === 0) {
    if (ratioChartInstance) {
      ratioChartInstance.destroy();
      ratioChartInstance = null;
    }
    canvas.classList.add('hidden');
    emptyBox?.classList.remove('hidden');
    if (legendBox) legendBox.innerHTML = '';
    return;
  }

  canvas.classList.remove('hidden');
  emptyBox?.classList.add('hidden');

  const centerTitle = mode === 'origin' ? 'Total ganho' : 'Saldo aberto';
  const centerValue = mode === 'origin'
    ? fmtH(analytics.creditedMinutesTotal)
    : fmtH(analytics.openRemainingMinutes);

  if (ratioChartInstance) ratioChartInstance.destroy();
  ratioChartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [{
        data: items.map((i) => i.mins),
        backgroundColor: items.map((i) => i.color),
        borderWidth: 0
      }]
    },
    plugins: [createCenterTextPlugin(centerTitle, centerValue, isDark)],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !privacyMode,
          callbacks: {
            label: (ctx) => {
              const pct = Math.round((Number(ctx.raw) / total) * 100);
              return `${ctx.label}: ${formatHHMM(ctx.raw)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  if (legendBox) {
    legendBox.innerHTML = items.map((i) => {
      const pct = Math.round((i.mins / total) * 100);
      return `
        <div class="flex items-center justify-between text-xs py-1">
          <span class="flex items-center gap-2 text-slate-600 dark:text-slate-300 truncate">
            <span class="w-2.5 h-2.5 rounded-full ${i.dot} shrink-0"></span>
            <span class="truncate">${escapeHtml(i.label)}</span>
          </span>
          <span class="font-mono font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">${fmtH(i.mins)} (${pct}%)</span>
        </div>
      `;
    }).join('');
  }
}

export function renderCharts(chronoEntries, remainingMap = new Map(), settings = {}, options = {}) {
  const dailyMinutes = Number(settings?.dailyMinutes) || 480;
  const privacyMode = Boolean(options.privacyMode);
  const analytics = computeAnalyticsSummary(chronoEntries, remainingMap, dailyMinutes);

  renderInsightsCards(analytics, chronoEntries, dailyMinutes, privacyMode);
  renderFifoExpiryTimeline(analytics, privacyMode);

  if (typeof window.Chart !== 'function') return;

  const isDark = document.documentElement.classList.contains('dark');
  const isCompact = typeof window !== 'undefined' && window.innerWidth < 768;
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.06)';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const balanceScope = options.balanceScope || 'all';
  const ratioMode = options.ratioMode || 'composition';

  renderBalanceLineChart(chronoEntries, dailyMinutes, balanceScope, isDark, gridColor, textColor, isCompact, privacyMode);
  renderMonthlyBarsChart(analytics, isDark, gridColor, textColor, isCompact, privacyMode);
  renderRatioDonutChart(analytics, ratioMode, isDark, textColor, privacyMode);
}
