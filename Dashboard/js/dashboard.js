const dashboardBindings = {
  status: {
    value: document.getElementById('dashboard-status-value'),
    note: document.getElementById('dashboard-status-note')
  },
  currentVehiclePlate: {
    value: document.getElementById('dashboard-current-vehicle-plate-value'),
    note: document.getElementById('dashboard-current-vehicle-plate-note')
  },
  floor: {
    value: document.getElementById('dashboard-floor-value'),
    note: document.getElementById('dashboard-floor-note')
  },
  speed: {
    value: document.getElementById('dashboard-speed-value'),
    note: document.getElementById('dashboard-speed-note')
  },
  weight: {
    value: document.getElementById('dashboard-weight-value'),
    note: document.getElementById('dashboard-weight-note')
  },
  cabinTemperature: {
    value: document.getElementById('dashboard-cabin-temperature-value'),
    note: document.getElementById('dashboard-cabin-temperature-note')
  },
  door: {
    value: document.getElementById('dashboard-door-value'),
    note: document.getElementById('dashboard-door-note')
  },
  temperature: {
    value: document.getElementById('dashboard-temperature-value'),
    note: document.getElementById('dashboard-temperature-note')
  }
};

function setTone(element, tone) {
  if (!element) {
    return;
  }

  element.classList.toggle('positive', tone === 'positive');
  element.classList.toggle('negative', tone === 'negative');
}

function renderDashboard(state) {
  const dashboard = state.dashboard;

  if (!dashboard) {
    return;
  }

  for (const [key, binding] of Object.entries(dashboardBindings)) {
    const item = dashboard[key];

    if (!item) {
      continue;
    }

    if (binding.value) {
      binding.value.textContent = item.value;
    }

    if (binding.note) {
      binding.note.textContent = item.note;
      setTone(binding.note, item.tone);
    }
  }
}

window.LiftCoreAPI?.subscribeState(renderDashboard);
