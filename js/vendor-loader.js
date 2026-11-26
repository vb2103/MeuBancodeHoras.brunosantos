/**
 * Carregamento sob demanda de bibliotecas pesadas com versão fixa e SRI.
 * Mantém Chart.js (Gráficos) e jsPDF (PDF) fora do caminho crítico de boot.
 */

export const PINNED_VENDORS = Object.freeze({
  lucide: {
    url: 'https://unpkg.com/lucide@1.81.0/dist/umd/lucide.min.js',
    integrity: 'sha384-I2eWHxO0tZqgUh5VERQyal+mmk2fGHjoqeYV3JjQb2aoe800N7hrumBW5rUGaN+b'
  },
  supabase: {
    url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.min.js',
    integrity: 'sha384-7i/4BYWz4Mn+lJfg2HWfEPfZQ7tmFKF3CTSKlXBpxWjNlLjcg+T6smpHG4gLmU1u'
  },
  chartjs: {
    url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
    integrity: 'sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC'
  },
  jspdf: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    integrity: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk'
  },
  jspdfAutotable: {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
    integrity: 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3'
  }
});

const pendingScriptLoads = new Map();

function loadExternalScript(url, integrity) {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Ambiente sem DOM'));
  }

  const existing = document.querySelector(`script[src="${url}"]`);
  if (existing?.dataset.loaded === '1') {
    return Promise.resolve();
  }

  if (pendingScriptLoads.has(url)) {
    return pendingScriptLoads.get(url);
  }

  const promise = new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    script.src = url;
    if (integrity) script.integrity = integrity;
    script.crossOrigin = 'anonymous';
    script.async = true;

    const cleanup = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      script.dataset.loaded = '1';
      resolve();
    };
    const onError = () => {
      cleanup();
      pendingScriptLoads.delete(url);
      if (!existing && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(new Error(`Falha ao carregar recurso externo: ${url}`));
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      document.head.appendChild(script);
    }
  });

  pendingScriptLoads.set(url, promise);
  return promise;
}

export async function ensureChartJs() {
  if (typeof window !== 'undefined' && typeof window.Chart === 'function') {
    return window.Chart;
  }
  await loadExternalScript(PINNED_VENDORS.chartjs.url, PINNED_VENDORS.chartjs.integrity);
  if (typeof window === 'undefined' || typeof window.Chart !== 'function') {
    throw new Error('Biblioteca de gráficos indisponível.');
  }
  return window.Chart;
}

export async function ensureJsPdf() {
  if (typeof window !== 'undefined' && window.jspdf?.jsPDF && typeof window.jspdf?.jsPDF?.API?.autoTable === 'function') {
    return window.jspdf.jsPDF;
  }
  if (!window.jspdf?.jsPDF) {
    await loadExternalScript(PINNED_VENDORS.jspdf.url, PINNED_VENDORS.jspdf.integrity);
  }
  if (typeof window.jspdf?.jsPDF?.API?.autoTable !== 'function') {
    await loadExternalScript(PINNED_VENDORS.jspdfAutotable.url, PINNED_VENDORS.jspdfAutotable.integrity);
  }
  if (!window.jspdf?.jsPDF) {
    const err = new Error('Biblioteca jsPDF indisponível offline no momento.');
    err.code = 'JSPDF_UNAVAILABLE';
    throw err;
  }
  return window.jspdf.jsPDF;
}
