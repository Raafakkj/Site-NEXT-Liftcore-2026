const gridColor = 'rgba(148, 163, 184, 0.18)';
const textColor = '#64748b';
const charts = {};
const STORAGE_KEY = 'liftcore_chart_history_v1';
const LIMITS = {
  movement: 40,
  weight: 8,
  safety: 100
};

function createSeries() {
  return { labels: [], values: [], lastKey: '' };
}

const history = {
  movement: createSeries(),
  weight: createSeries(),
  safety: createSeries()
};

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);

    for (const key of Object.keys(history)) {
      const series = parsed[key];

      if (!series || !Array.isArray(series.labels) || !Array.isArray(series.values)) {
        continue;
      }

      history[key].labels = series.labels.slice(-LIMITS[key]);
      history[key].values = series.values.slice(-LIMITS[key]);
      history[key].lastKey = typeof series.lastKey === 'string' ? series.lastKey : '';
    }
  } catch (error) {
    console.warn('Nao foi possivel restaurar o historico dos graficos.', error);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn('Nao foi possivel salvar o historico dos graficos.', error);
  }
}

loadHistory();

function getCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);

  if (!canvas || typeof Chart === 'undefined') {
    return null;
  }

  return canvas;
}

function createOrUpdateChart(canvasId, config) {
  if (charts[canvasId]) {
    charts[canvasId].data = config.data;
    charts[canvasId].options = config.options;
    charts[canvasId].update('none');
    return;
  }

  const canvas = getCanvas(canvasId);

  if (!canvas) {
    return;
  }

  charts[canvasId] = new Chart(canvas, config);
}

function parseNumber(value) {
  const normalized = String(value ?? '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloor(value) {
  const match = String(value ?? '').match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function buildLabel() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 1
  });
}

function pushSeries(seriesName, key, value) {
  const series = history[seriesName];

  if (series.lastKey === key) {
    return false;
  }

  series.lastKey = key;
  series.labels.push(buildLabel());
  series.values.push(value);

  while (series.labels.length > LIMITS[seriesName]) {
    series.labels.shift();
    series.values.shift();
  }

  return true;
}

function buildMovementPoint(floorValue, speedValue, directionValue) {
  const floor = parseFloor(floorValue);
  const speed = parseNumber(speedValue);
  const direction = directionValue || '';
  const delta = Math.min(speed * 0.14, 0.28);

  if (direction.includes('Subindo')) {
    return floor + delta;
  }

  if (direction.includes('Descendo')) {
    return floor - delta;
  }

  return floor;
}

function pushHistory(state) {
  const floorValue = state.dashboard?.floor?.value || '';
  const directionValue = state.dashboard?.floor?.note || '';
  const speedValue = state.dashboard?.speed?.value || '';
  const weightValue = state.dashboard?.weight?.value || '';
  const safetyValue = state.dashboard?.status?.value || 'SEGURO';

  const changed =
    pushSeries(
      'movement',
      `${floorValue}|${directionValue}|${speedValue}`,
      buildMovementPoint(floorValue, speedValue, directionValue)
    ) ||
    pushSeries(
      'weight',
      weightValue,
      parseNumber(weightValue)
    ) ||
    pushSeries(
      'safety',
      safetyValue,
      safetyValue
    );

  if (changed) {
    saveHistory();
  }
}

function safetyDistribution() {
  return history.safety.values.reduce(
    (acc, value) => {
      if (value === 'RISCO') {
        acc.risk += 1;
      } else if (value === 'ALERTA') {
        acc.alert += 1;
      } else {
        acc.safe += 1;
      }

      return acc;
    },
    { safe: 0, alert: 0, risk: 0 }
  );
}

const sharedOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: {
      labels: {
        color: textColor,
        boxWidth: 12,
        padding: 16
      }
    }
  }
};

function renderCharts(state) {
  if (!state?.dashboard) {
    return;
  }

  pushHistory(state);
  const safety = safetyDistribution();

  createOrUpdateChart('lineChart', {
    type: 'line',
    data: {
      labels: history.movement.labels,
      datasets: [
        {
          label: 'Posicao vertical',
          data: history.movement.values,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.10)',
          fill: true,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: {
      ...sharedOptions,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, maxTicksLimit: 6 }
        },
        y: {
          ticks: {
            color: textColor,
            callback: (value) => `G${Math.round(value)}`
          },
          grid: { color: gridColor }
        }
      }
    }
  });

  createOrUpdateChart('barChart', {
    type: 'bar',
    data: {
      labels: history.weight.labels,
      datasets: [
        {
          label: 'Peso lido',
          data: history.weight.values,
          borderRadius: 6,
          backgroundColor: history.weight.values.map((value) => {
            if (value > 8) {
              return '#dc2626';
            }

            if (value > 5) {
              return '#d97706';
            }

            return '#059669';
          })
        }
      ]
    },
    options: {
      ...sharedOptions,
      scales: {
        x: {
          grid: { display: false },
          ticks: { display: false }
        },
        y: {
          ticks: {
            color: textColor,
            callback: (value) => `${value}T`
          },
          grid: { color: gridColor }
        }
      }
    }
  });

  createOrUpdateChart('donutChart', {
    type: 'doughnut',
    data: {
      labels: ['Seguro', 'Alerta', 'Risco'],
      datasets: [
        {
          data: [safety.safe, safety.alert, safety.risk],
          borderWidth: 0,
          backgroundColor: ['#059669', '#d97706', '#dc2626']
        }
      ]
    },
    options: {
      ...sharedOptions,
      cutout: '65%'
    }
  });
}

window.LiftCoreAPI?.subscribeState(renderCharts);
