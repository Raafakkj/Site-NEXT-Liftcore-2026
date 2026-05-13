const vehiclesTodayValue = document.getElementById('vehicles-today-value');
const vehiclesTodayNote = document.getElementById('vehicles-today-note');
const vehiclesBlockedValue = document.getElementById('vehicles-blocked-value');
const vehiclesBlockedNote = document.getElementById('vehicles-blocked-note');
const vehiclesTableBody = document.getElementById('vehicles-table-body');
const vehiclesSearchInput = document.getElementById('vehicles-search');

let _currentVehicles = [];
let _currentQuery = '';

function applyTone(element, tone) {
  if (!element) return;

  element.classList.toggle('positive', tone === 'positive');
  element.classList.toggle('negative', tone === 'negative');
}

function renderVehicleSummary(summary) {
  if (!summary) return;

  if (vehiclesTodayValue) {
    vehiclesTodayValue.textContent = summary.today.value;
  }

  if (vehiclesTodayNote) {
    vehiclesTodayNote.textContent = summary.today.note;
    applyTone(vehiclesTodayNote, summary.today.tone);
  }

  if (vehiclesBlockedValue) {
    vehiclesBlockedValue.textContent = summary.blocked.value;
  }

  if (vehiclesBlockedNote) {
    vehiclesBlockedNote.textContent = summary.blocked.note;
    applyTone(vehiclesBlockedNote, summary.blocked.tone);
  }
}

function renderVehiclesTable(vehicles = []) {
  if (!vehiclesTableBody) return;

  vehiclesTableBody.replaceChildren();

  const list = vehicles;
  for (const vehicle of list) {
    const row = document.createElement('tr');

    const values = [
      vehicle.plate,
      vehicle.owner,
      vehicle.access,
      vehicle.cpf
    ];

    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value || '-';
      row.append(cell);
    }

    vehiclesTableBody.append(row);
  }
}

function filterVehicles(query) {
  _currentQuery = String(query || '').trim().toLowerCase();
  if (!_currentQuery) {
    renderVehiclesTable(_currentVehicles);
    return;
  }

  const filtered = _currentVehicles.filter((v) => {
    return [v.plate, v.owner, v.access, v.cpf, v.status, v.model]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(_currentQuery));
  });

  renderVehiclesTable(filtered);
}

function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

if (vehiclesSearchInput) {
  vehiclesSearchInput.addEventListener('input', debounce((e) => filterVehicles(e.target.value), 150));
}

function renderVehiclesPage(state) {
  const vehiclesPage = state.vehiclesPage;
  if (!vehiclesPage) return;

  renderVehicleSummary(vehiclesPage);
  _currentVehicles = Array.isArray(vehiclesPage.vehicles) ? vehiclesPage.vehicles : [];
  filterVehicles(_currentQuery);
}

window.LiftCoreAPI?.subscribeState(renderVehiclesPage);