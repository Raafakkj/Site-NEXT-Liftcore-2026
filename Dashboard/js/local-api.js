const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');

const rootDir = path.resolve(__dirname, '..');
const statePath = path.join(rootDir, 'data', 'state.json');
const port = Number(process.env.PORT) || 3000;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function readVehiclesFromXLSX() {
  try {
    const filePath = path.join(__dirname, '..', '..', 'LeituradeplacaXLSX', 'LiftCore_Sistema_Placas.xlsx');
    const workbook = XLSX.readFile(filePath);

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const dataRows = rows.slice(1);

    return dataRows.map((row) => ({
      plate: row[0] || '---',
      owner: row[1] || '---',
      access: row[2] || '---',
      cpf: row[3] || '---',
      model: row[4] || '---',
      weight_KG: (typeof row[5] === 'number' ? row[5] : parseFloat(row[5])) || 2.0,
      status: String(row[2] || '').trim() === 'Liberado' ? 'Liberado' : 'Bloqueado'
    }));

  } catch (error) {
    console.error('Erro ao ler XLSX:', error);
    return [];
  }
}

const defaultVehicles = {
  today_total: 0,
  blocked_total: 0,
  items: []
};

const defaultCameras = [
  { name: 'CAMERA 01', online: true },
  { name: 'CAMERA 02', online: true }
];

function normalizeRawState(rawState) {
  return {
    elevator: {
      plate: rawState.elevator?.plate || 'FTR-9021',
      floor: rawState.elevator?.floor || 'G1',
      direction: rawState.elevator?.direction || 'Parado',
      speed_mps: rawState.elevator?.speed_mps ?? 0,
      weight_KG: rawState.elevator?.weight_KG ?? 0,
      cabin_temp_c: rawState.elevator?.cabin_temp_c ?? 24,
      motor_temp_c: rawState.elevator?.motor_temp_c ?? 40,
      door: rawState.elevator?.door || 'TRAVADA'
    },
    vehicles: {
      today_total: rawState.vehicles?.today_total ?? defaultVehicles.today_total,
      blocked_total: rawState.vehicles?.blocked_total ?? defaultVehicles.blocked_total,
      items: Array.isArray(rawState.vehicles?.items) && rawState.vehicles.items.length
        ? rawState.vehicles.items
        : readVehiclesFromXLSX()
    },
    cameras: Array.isArray(rawState.cameras) && rawState.cameras.length
      ? rawState.cameras
      : defaultCameras
  };
}

function classifyRange(value, safeMax, warningMax, safeNote, warningNote, dangerNote) {
  if (value <= safeMax) {
    return { tone: 'positive', note: safeNote, level: 0 };
  }

  if (value <= warningMax) {
    return { tone: 'negative', note: warningNote, level: 1 };
  }

  return { tone: 'negative', note: dangerNote, level: 2 };
}

function evaluateDoor(value) {
  const normalized = String(value ?? '').toUpperCase();
  const isSafe = normalized.includes('TRAVADA') || normalized.includes('FECHADA');

  return {
    tone: isSafe ? 'positive' : 'negative',
    note: isSafe ? 'Seguro' : 'Aberta',
    level: isSafe ? 0 : 2
  };
}

function vehicleBadgeTone(status) {
  if (status === 'No elevador') {
    return 'warning';
  }

  if (status === 'Bloqueado') {
    return 'negative';
  }

  return status === 'Liberado' ? 'success' : 'warning';
}

function formatDashboard(rawState) {
  const elevator = rawState.elevator;
  const currentVehicle = rawState.vehicles.items.find((vehicle) => vehicle.plate === elevator.plate);

  const speedStatus = classifyRange(elevator.speed_mps, 1.6, 2.1, 'Normal', 'Alta', 'Critica');
  const weightStatus = classifyRange(elevator.weight_KG, 5, 8, 'Estavel', 'Alto', 'Excesso');
  const cabinStatus = classifyRange(elevator.cabin_temp_c, 38, 50, 'Confortavel', 'Aquecida', 'Critica');
  const motorStatus = classifyRange(elevator.motor_temp_c, 55, 65, 'Normal', 'Atencao', 'Critica');
  const doorStatus = evaluateDoor(elevator.door);

  const highestLevel = Math.max(
    speedStatus.level,
    weightStatus.level,
    cabinStatus.level,
    motorStatus.level,
    doorStatus.level
  );

  const status =
    highestLevel === 0
      ? { value: 'SEGURO', note: 'Leitura normal', tone: 'positive' }
      : highestLevel === 1
        ? { value: 'ALERTA', note: 'Revisar sensores', tone: 'negative' }
        : { value: 'RISCO', note: 'Intervencao necessaria', tone: 'negative' };

  return {
    status,
    currentVehiclePlate: {
      value: elevator.plate,
      note: currentVehicle ? currentVehicle.model : 'Sem cadastro',
      tone: 'positive'
    },
    floor: {
      value: elevator.floor,
      note: elevator.direction,
      tone: 'positive'
    },
    speed: {
      value: `${elevator.speed_mps.toFixed(1)} m/s`,
      note: speedStatus.note,
      tone: speedStatus.tone
    },
    weight: {
      value: `${elevator.weight_KG.toFixed(1)} KG`,
      note: weightStatus.note,
      tone: weightStatus.tone
    },
    cabinTemperature: {
      value: `${elevator.cabin_temp_c} °C`,
      note: cabinStatus.note,
      tone: cabinStatus.tone
    },
    temperature: {
      value: `${elevator.motor_temp_c} °C`,
      note: motorStatus.note,
      tone: motorStatus.tone
    },
    door: {
      value: elevator.door,
      note: doorStatus.note,
      tone: doorStatus.tone
    }
  };
}

function formatVehiclesPage(rawState) {
  const blockedTone = rawState.vehicles.blocked_total > 2 ? 'negative' : 'positive';

  return {
    today: {
      value: rawState.vehicles.today_total,
      note: 'Fluxo normal',
      tone: 'positive'
    },
    blocked: {
      value: rawState.vehicles.blocked_total,
      note: blockedTone === 'negative' ? 'Necessita revisao' : 'Dentro do esperado',
      tone: blockedTone
    },
    vehicles: rawState.vehicles.items.map((vehicle) => ({
      plate: vehicle.plate,
      owner: vehicle.owner,
      access: vehicle.access,
      cpf: vehicle.cpf,
      status: vehicle.status,
      tone: vehicle.access === 'Liberado' ? 'success' : 'negative'
    }))
  };
}

function formatCamerasPage(rawState) {
  return {
    cameras: rawState.cameras.map((camera) => ({
      name: camera.name,
      status: camera.online ? 'Online' : 'Sem sinal',
      tone: camera.online ? 'positive' : 'negative'
    }))
  };
}

function buildClientState(rawState) {
  return {
    dashboard: formatDashboard(rawState),
    vehiclesPage: formatVehiclesPage(rawState),
    camerasPage: formatCamerasPage(rawState)
  };
}

async function readRawState() {
  const file = await fs.readFile(statePath, 'utf8');
  return normalizeRawState(JSON.parse(file));
}

async function readState() {
  const raw = await readRawState();
  const fileVehicles = readVehiclesFromXLSX();
  if (Array.isArray(fileVehicles) && fileVehicles.length) {
    raw.vehicles = raw.vehicles || {};
    raw.vehicles.items = fileVehicles;
  }

  return buildClientState(raw);
}

async function writeRawState(state) {
  const normalizedState = normalizeRawState(state);
  await fs.writeFile(statePath, `${JSON.stringify(normalizedState, null, 2)}\n`, 'utf8');
  return normalizedState;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      mergeDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }

  return target;
}

function randomNumber(min, max, decimals = 0) {
  const value = Math.random() * (max - min) + min;
  return Number(value.toFixed(decimals));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomizeState(rawState) {
  const currentFloor = Number(String(rawState.elevator.floor).replace(/[^\d-]/g, '')) || 1;
  const nextDirection =
    currentFloor >= 5 ? 'Descendo' :
    currentFloor <= 1 ? 'Subindo' :
    rawState.elevator.direction;
  const floorDelta = nextDirection === 'Subindo' ? 1 : -1;
  const nextFloor = clamp(currentFloor + floorDelta, 1, 5);
  const shouldSwapVehicle = Math.random() > 0.84;

  const fileVehicles = readVehiclesFromXLSX();
  const pool = (Array.isArray(fileVehicles) && fileVehicles.length)
    ? fileVehicles
    : (Array.isArray(rawState.vehicles?.items) && rawState.vehicles.items.length ? rawState.vehicles.items : [{ plate: '---', weight_KG: 2.0 }]);

  const currentVehicle = (Array.isArray(rawState.vehicles?.items) && rawState.vehicles.items.length)
    ? rawState.vehicles.items.find((v) => v.plate === rawState.elevator.plate) || pool[0]
    : pool[0];

  const activeVehicle = shouldSwapVehicle
    ? pool[Math.floor(Math.random() * pool.length)]
    : currentVehicle;

  rawState.elevator.plate = activeVehicle.plate;
  rawState.elevator.floor = `G${nextFloor}`;
  rawState.elevator.direction = nextDirection;
  rawState.elevator.speed_mps = randomNumber(0.9, 2.0, 1);
  rawState.elevator.weight_KG = clamp(randomNumber((activeVehicle.weight_KG || 2.0) - 0.2, (activeVehicle.weight_KG || 2.0) + 0.3, 1), 1.0, 3.4);
  rawState.elevator.cabin_temp_c = clamp(rawState.elevator.cabin_temp_c + (Math.random() > 0.5 ? 1 : -1), 20, 31);
  rawState.elevator.motor_temp_c = clamp(rawState.elevator.motor_temp_c + (Math.random() > 0.5 ? 2 : -2), 38, 72);
  rawState.elevator.door = rawState.elevator.speed_mps > 0.3 ? 'TRAVADA' : (Math.random() > 0.5 ? 'TRAVADA' : 'ABERTA');

  rawState.vehicles.blocked_total = Math.floor(Math.random() * 5);
  rawState.cameras = rawState.cameras.map((camera) => ({
    ...camera,
    online: Math.random() > 0.25
  }));

  return rawState;
}

async function serveApi(request, response, pathname) {
  if (pathname !== '/api/state' && pathname !== '/api/randomize') {
    sendJson(response, 404, { error: 'Endpoint nao encontrado.' });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/state') {
    sendJson(response, 200, await readState());
    return;
  }

  if (request.method === 'PUT' && pathname === '/api/state') {
    const nextRawState = await writeRawState(await readBody(request));
    sendJson(response, 200, buildClientState(nextRawState));
    return;
  }

  if (request.method === 'PATCH' && pathname === '/api/state') {
    const rawState = await readRawState();
    const patch = await readBody(request);
    const nextRawState = await writeRawState(mergeDeep(rawState, patch));
    sendJson(response, 200, buildClientState(nextRawState));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/randomize') {
    const nextRawState = await writeRawState(randomizeState(await readRawState()));
    sendJson(response, 200, buildClientState(nextRawState));
    return;
  }

  sendJson(response, 405, { error: 'Metodo nao permitido.' });
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end('Acesso negado.');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      'Content-Type': contentTypes[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(file);
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Arquivo nao encontrado.');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await serveApi(request, response, url.pathname);
      return;
    }

    await serveStatic(request, response, decodeURIComponent(url.pathname));
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`LiftCore local em http://localhost:${port}`);
  console.log(`API em http://localhost:${port}/api/state`);
});
