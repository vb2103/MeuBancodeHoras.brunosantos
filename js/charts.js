import { formatDateBR } from './config.js';
import { formatHHMM } from './time.js';

let balanceChartInstance = null;
let ratioChartInstance = null;

export function destroyCharts() {
  if (balanceChartInstance) {
    balanceChartInstance.destroy();
    balanceChartInstance = null;
  }
  if (ratioChartInstance) {
    ratioChartInstance.destroy();
    ratioChartInstance = null;
  }
}

export function renderCharts(chronoEntries) {
  if (typeof window.Chart !== 'function') return;

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.06)';
  const textColor = isDark ? '#94a3b8' : '#64748b';

  const labels = chronoEntries.map((i) => formatDateBR(i.date).slice(0, 5));
  const dataHours = chronoEntries.map((i) => Number((i.runningMinutes / 60).toFixed(4)));
  const exactMinutesList = chronoEntries.map((i) => i.runningMinutes);

  if (balanceChartInstance) balanceChartInstance.destroy();
  const ctx1 = document.getElementById('balanceChart').getContext('2d');
  balanceChartInstance = new window.Chart(ctx1, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Saldo Acumulado (HH:MM)',
        data: dataHours,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.14)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#4f46e5'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const entry = chronoEntries[idx];
              return entry ? `${formatDateBR(entry.date)} — ${entry.title}` : '';
            },
            label: (ctx) => {
              const mins = exactMinutesList[ctx.dataIndex] ?? Math.round(ctx.parsed.y * 60);
              return `Saldo acumulado: ${formatHHMM(mins, true)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (val) => formatHHMM(Math.round(Number(val) * 60), true)
          }
        }
      }
    }
  });

  const totalCreditsMins = chronoEntries
    .filter((e) => e.type === 'credit')
    .reduce((s, e) => s + (Number(e.minutes) || 0), 0);
  const totalDebitsMins = chronoEntries
    .filter((e) => e.type === 'debit')
    .reduce((s, e) => s + (Number(e.minutes) || 0), 0);

  if (ratioChartInstance) ratioChartInstance.destroy();
  const ctx2 = document.getElementById('ratioChart').getContext('2d');
  ratioChartInstance = new window.Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: [
        `Créditos (${formatHHMM(totalCreditsMins)})`,
        `Folgas/Saídas (${formatHHMM(totalDebitsMins)})`
      ],
      datasets: [{
        data: [totalCreditsMins, totalDebitsMins],
        backgroundColor: ['#10b981', '#f43f5e'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label.split('(')[0].trim()}: ${formatHHMM(ctx.raw)}`
          }
        }
      }
    }
  });
}
