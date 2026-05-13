(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const isNode = typeof module !== "undefined" && module.exports;
  const SESSION_KEY = "liftcore_maintenance_session";
  let memorySession = null;

  const DEFAULT_USER = {
    id: "admin",
    login: "571073",
    name: "Administrador",
    shortName: "Admin",
    role: "Administrador",
    roleDescription: "Administrador do sistema",
    profile: {
      fullName: "Administrador Liftcore",
      phone: "",
      email: "",
      specialty: "Gestao de manutencao",
      status: "Disponivel"
    },
    permissions: ["admin", "maintenance:read", "maintenance:write", "users:write"]
  };

  const fallbackState = {
    elevator: {
      id: "E-01",
      name: "Elevador EVA",
      status: "Operando",
      availability: "98%",
      lastRevision: "08/05/2026",
      dailyUse: "68%"
    },
    metrics: {
      "elevators-active": "1",
      "maintenance-today": "0",
      "critical-failures": "0",
      "system-uptime": "98%"
    },
    maintenance: [],
    profiles: [DEFAULT_USER.profile],
    users: []
  };

  function wait(ms) {
    return new Promise((resolve) => root.setTimeout(resolve, ms));
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || body.error || `HTTP ${response.status}`);
    }
    return body;
  }

  function createSession(user = DEFAULT_USER, token = null) {
    const safeUser = {
      id: user.id,
      login: user.login,
      name: user.name,
      shortName: user.shortName,
      role: user.role,
      roleDescription: user.roleDescription,
      profile: user.profile || {},
      permissions: user.permissions || []
    };
    const session = {
      token,
      user: safeUser,
      createdAt: Date.now(),
      elevatorId: fallbackState.elevator.id
    };

    if (root.sessionStorage) {
      root.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      memorySession = session;
    }

    return session;
  }

  function getSession() {
    if (!root.sessionStorage) return memorySession;

    try {
      const raw = root.sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    memorySession = null;
    if (root.sessionStorage) {
      root.sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function authHeaders() {
    const token = getSession()?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function authenticate(login, password) {
    await wait(180);
    try {
      const result = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password })
      });
      return { ok: true, session: createSession(result.user, result.token) };
    } catch (error) {
      const isDefaultLogin = login === "571073" && password === "123456";
      if (root.location?.protocol === "file:" && isDefaultLogin) {
        return { ok: true, session: createSession(DEFAULT_USER) };
      }
      return { ok: false, message: error.message || "Login ou senha incorretos." };
    }
  }

  async function bootstrap(onStep) {
    const steps = [
      "Validando sessao",
      "Carregando planilha de manutencao",
      "Sincronizando perfis",
      "Preparando painel"
    ];

    for (let index = 0; index < steps.length; index += 1) {
      if (typeof onStep === "function") {
        onStep({
          label: steps[index],
          progress: Math.round(((index + 1) / steps.length) * 100)
        });
      }
      await wait(280);
    }

    return getDashboardState();
  }

  async function getDashboardState() {
    try {
      const state = await requestJson("/api/state", { headers: authHeaders() });
      return { user: getSession()?.user || DEFAULT_USER, ...state };
    } catch {
      return { user: getSession()?.user || DEFAULT_USER, ...fallbackState };
    }
  }

  async function saveMaintenance(row, payload) {
    return requestJson(`/api/maintenance/${row}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
  }

  async function createMaintenance(payload) {
    return requestJson("/api/maintenance", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
  }

  async function registerUser(payload) {
    const result = await requestJson("/api/users", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return result;
  }

  async function downloadReport(kind) {
    const response = await fetch(`/api/reports/${kind}`, {
      cache: "no-store",
      headers: authHeaders()
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Nao foi possivel baixar o relatorio.");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `liftcore-${kind}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function requireSession() {
    const session = getSession();
    if (!session) {
      if (root.location) {
        root.location.replace("./index.html");
      }
      return null;
    }
    return session;
  }

  function startLocalServer() {
    if (!isNode) return;

    const http = require("http");
    const fs = require("fs/promises");
    const fsSync = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const XLSX = require("xlsx");

    const siteRoot = path.resolve(__dirname, "..");
    const projectRoot = path.resolve(siteRoot, "..");
    const usersPath = path.join(siteRoot, "data", "logins.json");
    const maintenancePath = findMaintenanceWorkbook(projectRoot);
    const port = Number(process.argv[2] || process.env.PORT || 3000);
    const sessions = new Map();
    const mimeTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon"
    };

    function findMaintenanceWorkbook(rootPath) {
      const queue = [rootPath];
      const matches = [];

      while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try {
          entries = fsSync.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            queue.push(fullPath);
            continue;
          }

          const normalized = entry.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (normalized.endsWith(".xlsx") && normalized.includes("manuten")) {
            matches.push(fullPath);
          }
        }
      }

      return matches.sort((a, b) => {
        const aRoot = path.dirname(a) === rootPath ? 0 : 1;
        const bRoot = path.dirname(b) === rootPath ? 0 : 1;
        return aRoot - bRoot || fsSync.statSync(b).mtimeMs - fsSync.statSync(a).mtimeMs;
      })[0];
    }

    function makeId(value) {
      return String(value || crypto.randomUUID()).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
      const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
      return { salt, hash };
    }

    function verifyPassword(password, user) {
      if (user.passwordHash && user.passwordSalt) {
        return hashPassword(password, user.passwordSalt).hash === user.passwordHash;
      }
      return user.senha && password === user.senha;
    }

    function safeUser(user) {
      return {
        id: user.id,
        login: user.login,
        name: user.name,
        shortName: user.shortName,
        role: user.role,
        roleDescription: user.roleDescription,
        profile: user.profile,
        permissions: user.permissions || []
      };
    }

    function defaultUsers() {
      const password = hashPassword("123456", "liftcore-admin-local");
      return {
        users: [{
          ...DEFAULT_USER,
          passwordHash: password.hash,
          passwordSalt: password.salt
        }]
      };
    }

    async function readUsers() {
      try {
        const data = JSON.parse(await fs.readFile(usersPath, "utf8"));
        if (Array.isArray(data.users)) return data;

        if (data.login && data.senha) {
          const password = hashPassword(data.senha, "liftcore-admin-local");
          return {
            users: [{
              ...DEFAULT_USER,
              login: data.login,
              passwordHash: password.hash,
              passwordSalt: password.salt
            }]
          };
        }
      } catch {
        await fs.mkdir(path.dirname(usersPath), { recursive: true });
      }

      const seeded = defaultUsers();
      await writeUsers(seeded);
      return seeded;
    }

    async function writeUsers(data) {
      await fs.writeFile(usersPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }

    function readMaintenanceWorkbook() {
      if (!maintenancePath) return { workbook: null, sheet: null, sheetName: null };
      const workbook = XLSX.readFile(maintenancePath);
      const sheetName = workbook.SheetNames[0];
      return { workbook, sheetName, sheet: workbook.Sheets[sheetName] };
    }

    function readMaintenance() {
      const { sheet } = readMaintenanceWorkbook();
      if (!sheet) return [];

      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      return rows.slice(1)
        .map((row, index) => ({
          row: index + 2,
          category: String(row[0] || "").trim(),
          item: String(row[1] || "").trim(),
          situation: String(row[2] || "").trim(),
          notes: String(row[3] || "").trim(),
          priority: String(row[4] || "baixa").trim().toLowerCase()
        }))
        .filter((item) => item.category || item.item);
    }

    function writeMaintenanceRow(rowNumber, payload) {
      const { workbook, sheetName, sheet } = readMaintenanceWorkbook();
      if (!sheet) throw new Error("Planilha de manutencao nao encontrada.");

      const current = readMaintenance().find((item) => item.row === rowNumber) || {};
      const next = { ...current, ...payload };
      const columns = ["category", "item", "situation", "notes", "priority"];
      columns.forEach((key, index) => {
        const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: index });
        sheet[address] = { t: "s", v: String(next[key] ?? "") };
      });
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      range.e.r = Math.max(range.e.r, rowNumber - 1);
      sheet["!ref"] = XLSX.utils.encode_range(range);
      XLSX.writeFile(workbook, maintenancePath);
      return readMaintenance().find((item) => item.row === rowNumber);
    }

    function appendMaintenance(payload) {
      const items = readMaintenance();
      const nextRow = items.reduce((max, item) => Math.max(max, item.row), 1) + 1;
      return writeMaintenanceRow(nextRow, payload);
    }

    function readDashboardState() {
      const statePath = path.join(projectRoot, "Dashboard", "data", "state.json");
      try {
        return JSON.parse(fsSync.readFileSync(statePath, "utf8"));
      } catch {
        return {};
      }
    }

    function readVehiclesFromXLSX() {
      const filePath = path.join(projectRoot, "LeituradeplacaXLSX", "LiftCore_Sistema_Placas.xlsx");
      try {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        return rows.slice(1).map((row) => ({
          plate: String(row[0] || "").trim().toUpperCase(),
          owner: String(row[1] || "").trim(),
          access: String(row[2] || "").trim(),
          cpf: String(row[3] || "").trim(),
          model: String(row[4] || "Veiculo cadastrado").trim(),
          weight_KG: Number(row[5]) || 0
        })).filter((vehicle) => vehicle.plate);
      } catch {
        return [];
      }
    }

    function buildElevatorSnapshot(critical, availability) {
      const live = readDashboardState().elevator || {};
      const vehicles = readVehiclesFromXLSX();
      const plate = String(live.plate || "---").trim().toUpperCase();
      const vehicle = vehicles.find((item) => item.plate === plate) || null;
      const hasVehicle = Boolean(plate && plate !== "---");
      const door = String(live.door || "FECHADA").toUpperCase();
      const status = critical || door.includes("ABERTA") ? "Atencao" : "Operando";

      return {
        id: "E-01",
        name: "Elevador EVA",
        status,
        availability,
        lastRevision: new Date().toLocaleDateString("pt-BR"),
        dailyUse: "68%",
        floor: String(live.floor || "1"),
        direction: String(live.direction || "Parado"),
        speed_mps: Number(live.speed_mps ?? 0),
        weight_KG: Number(live.weight_KG ?? 0),
        cabin_temp_c: Number(live.cabin_temp_c ?? 0),
        motor_temp_c: Number(live.motor_temp_c ?? 0),
        door,
        plate: hasVehicle ? plate : "---",
        hasVehicle,
        vehicle,
        specs: {
          model: "LiftCore EVA",
          type: "Elevador didatico monitorado",
          floors: "G1 a G5",
          drive: "Motor de passo com tracao por correia",
          controller: "Controle embarcado + leitura local",
          sensors: "Porta, presenca, peso, temperatura e velocidade",
          safety: "Porta travada e checklist de seguranca"
        }
      };
    }

    function buildState() {
      const maintenance = readMaintenance();
      const critical = maintenance.filter((item) =>
        ["alta", "critica", "crítica"].includes(item.priority) ||
        /falha|crit/i.test(item.situation)
      ).length;
      const completed = maintenance.filter((item) => /ok|feito|conclu|inspecionado/i.test(item.situation)).length;
      const availability = maintenance.length && completed
        ? `${Math.max(0, Math.round((completed / maintenance.length) * 100))}%`
        : "98%";

      return {
        elevator: buildElevatorSnapshot(critical, availability),
        metrics: {
          "elevators-active": "1",
          "maintenance-today": String(maintenance.length),
          "critical-failures": String(critical),
          "system-uptime": availability
        },
        maintenance,
        profiles: [],
        users: []
      };
    }

    function normalizeText(value) {
      return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "");
    }

    function createReportWorkbook(state, user) {
      const workbook = XLSX.utils.book_new();
      const maintenance = state.maintenance || [];
      const elevator = state.elevator || {};
      const completed = maintenance.filter((item) => /ok|feito|conclu|inspecionado/i.test(item.situation)).length;

      const resumo = XLSX.utils.aoa_to_sheet([
        ["Liftcore Maintenance - Relatorio do Turno"],
        ["Gerado em", new Date().toLocaleString("pt-BR")],
        ["Tecnico", user?.name || "Nao identificado"],
        ["Elevador", elevator.name || "EVA"],
        ["Status", elevator.status || "---"],
        ["Andar", elevator.floor || "---"],
        ["Direcao", elevator.direction || "---"],
        ["Porta", elevator.door || "---"],
        ["Carro dentro", elevator.hasVehicle ? `Sim - ${elevator.plate}` : "Nao"],
        ["Checklist", `${completed}/${maintenance.length} concluidos`]
      ]);
      resumo["!cols"] = [{ wch: 22 }, { wch: 38 }];
      XLSX.utils.book_append_sheet(workbook, resumo, "Resumo");

      const checklistRows = [
        ["ID", "Categoria", "Item revisado", "Situacao", "Observacoes", "Prioridade"],
        ...maintenance.map((item) => [
          item.row,
          item.category,
          item.item,
          item.situation || "Pendente",
          item.notes,
          item.priority
        ])
      ];
      const checklist = XLSX.utils.aoa_to_sheet(checklistRows);
      checklist["!cols"] = [{ wch: 8 }, { wch: 18 }, { wch: 34 }, { wch: 18 }, { wch: 42 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(workbook, checklist, "Checklist");

      const tecnico = XLSX.utils.aoa_to_sheet([
        ["Campo", "Valor"],
        ["Placa no elevador", elevator.plate || "---"],
        ["Proprietario", elevator.vehicle?.owner || "---"],
        ["Acesso", elevator.vehicle?.access || "---"],
        ["Velocidade m/s", elevator.speed_mps ?? "---"],
        ["Peso KG", elevator.weight_KG ?? "---"],
        ["Temp. cabine C", elevator.cabin_temp_c ?? "---"],
        ["Temp. motor C", elevator.motor_temp_c ?? "---"],
        ["Modelo", elevator.specs?.model || "---"],
        ["Acionamento", elevator.specs?.drive || "---"],
        ["Sensores", elevator.specs?.sensors || "---"]
      ]);
      tecnico["!cols"] = [{ wch: 24 }, { wch: 52 }];
      XLSX.utils.book_append_sheet(workbook, tecnico, "Elevador");

      return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    }

    function createPdf(lines) {
      const cleanLines = lines.map(normalizeText).slice(0, 44);
      const content = [
        "BT",
        "/F1 18 Tf",
        "50 790 Td",
        "(Liftcore Maintenance) Tj",
        "0 -28 Td",
        "/F1 11 Tf",
        ...cleanLines.map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj 0 -16 Td`),
        "ET"
      ].join("\n");

      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
      ];

      let pdf = "%PDF-1.4\n";
      const offsets = [0];
      objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
      });
      const xref = Buffer.byteLength(pdf);
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      offsets.slice(1).forEach((offset) => {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
      });
      pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return Buffer.from(pdf, "binary");
    }

    function createElevatorPdf(state, user) {
      const elevator = state.elevator || {};
      const maintenance = state.maintenance || [];
      const pending = maintenance.filter((item) => !/ok|feito|conclu|inspecionado/i.test(item.situation));
      return createPdf([
        `Relatorio tecnico do elevador EVA`,
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        `Tecnico: ${user?.name || "Nao identificado"}`,
        "",
        `Status: ${elevator.status || "---"}`,
        `Andar atual: ${elevator.floor || "---"}`,
        `Direcao: ${elevator.direction || "---"}`,
        `Porta: ${elevator.door || "---"}`,
        `Velocidade: ${elevator.speed_mps ?? "---"} m/s`,
        `Peso: ${elevator.weight_KG ?? "---"} KG`,
        `Temperatura cabine: ${elevator.cabin_temp_c ?? "---"} C`,
        `Temperatura motor: ${elevator.motor_temp_c ?? "---"} C`,
        `Carro dentro: ${elevator.hasVehicle ? `Sim - ${elevator.plate}` : "Nao"}`,
        `Proprietario: ${elevator.vehicle?.owner || "---"}`,
        "",
        `Especificacoes`,
        `Modelo: ${elevator.specs?.model || "---"}`,
        `Pavimentos: ${elevator.specs?.floors || "---"}`,
        `Acionamento: ${elevator.specs?.drive || "---"}`,
        `Sensores: ${elevator.specs?.sensors || "---"}`,
        "",
        `Checklist: ${maintenance.length - pending.length}/${maintenance.length} concluidos`,
        ...pending.slice(0, 12).map((item) => `Pendente #${item.row}: ${item.category} - ${item.item}`)
      ]);
    }

    function sendBinary(response, statusCode, contentType, filename, body) {
      response.writeHead(statusCode, {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      });
      response.end(body);
    }

    function sendJson(response, statusCode, body) {
      response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(JSON.stringify(body));
    }

    function readBody(request) {
      return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (error) {
            reject(error);
          }
        });
      });
    }

    async function requireApiUser(request) {
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token || !sessions.has(token)) return null;
      const { users } = await readUsers();
      return users.find((user) => user.id === sessions.get(token).userId) || null;
    }

    function isAdmin(user) {
      return Boolean(user?.permissions?.includes("admin"));
    }

    async function serveApi(request, response, pathname) {
      if (request.method === "POST" && pathname === "/api/auth/login") {
        const { login, password } = await readBody(request);
        const data = await readUsers();
        const user = data.users.find((item) => item.login === String(login || "").trim());

        if (!user || !verifyPassword(String(password || ""), user)) {
          sendJson(response, 401, { message: "Login ou senha incorretos." });
          return;
        }

        const token = crypto.randomBytes(24).toString("hex");
        sessions.set(token, { userId: user.id, createdAt: Date.now() });
        sendJson(response, 200, { token, user: safeUser(user) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/state") {
        const data = await readUsers();
        const state = buildState();
        state.profiles = data.users.map((user) => ({ ...user.profile, userId: user.id, login: user.login, role: user.role }));
        state.users = data.users.map(safeUser);
        sendJson(response, 200, state);
        return;
      }

      if (request.method === "POST" && pathname === "/api/users") {
        const requester = await requireApiUser(request);
        if (!isAdmin(requester)) {
          sendJson(response, 403, { message: "Apenas administradores podem registrar pessoas." });
          return;
        }

        const body = await readBody(request);
        const data = await readUsers();
        const login = String(body.login || "").trim();
        const password = String(body.password || "").trim();
        const fullName = String(body.fullName || "").trim();
        if (!login || !password || !fullName) {
          sendJson(response, 400, { message: "Informe login, senha e nome completo." });
          return;
        }
        if (data.users.some((user) => user.login === login)) {
          sendJson(response, 409, { message: "Ja existe uma pessoa com esse login." });
          return;
        }

        const passwordData = hashPassword(password);
        const role = body.role === "Administrador" ? "Administrador" : "Tecnico";
        const user = {
          id: makeId(`${fullName}-${login}`),
          login,
          name: fullName,
          shortName: fullName.split(/\s+/).slice(0, 2).join(" "),
          role,
          roleDescription: role === "Administrador" ? "Administrador do sistema" : "Tecnico de manutencao",
          profile: {
            fullName,
            phone: String(body.phone || "").trim(),
            email: String(body.email || "").trim(),
            specialty: String(body.specialty || "Manutencao geral").trim(),
            status: String(body.status || "Disponivel").trim()
          },
          permissions: role === "Administrador"
            ? ["admin", "maintenance:read", "maintenance:write", "users:write"]
            : ["maintenance:read", "maintenance:write"],
          passwordHash: passwordData.hash,
          passwordSalt: passwordData.salt
        };

        data.users.push(user);
        await writeUsers(data);
        sendJson(response, 201, { user: safeUser(user) });
        return;
      }

      if (request.method === "PUT" && pathname.startsWith("/api/maintenance/")) {
        const requester = await requireApiUser(request);
        if (!requester) {
          sendJson(response, 401, { message: "Sessao invalida." });
          return;
        }

        const row = Number(pathname.split("/").pop());
        const body = await readBody(request);
        sendJson(response, 200, { item: writeMaintenanceRow(row, body), state: buildState() });
        return;
      }

      if (request.method === "POST" && pathname === "/api/maintenance") {
        const requester = await requireApiUser(request);
        if (!requester) {
          sendJson(response, 401, { message: "Sessao invalida." });
          return;
        }
        sendJson(response, 201, { item: appendMaintenance(await readBody(request)), state: buildState() });
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/reports/")) {
        const requester = await requireApiUser(request);
        if (!requester) {
          sendJson(response, 401, { message: "Sessao invalida." });
          return;
        }

        const state = buildState();
        const file = pathname.split("/").pop();
        if (file === "maintenance.xlsx") {
          sendBinary(
            response,
            200,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "liftcore-relatorio-manutencao.xlsx",
            createReportWorkbook(state, requester)
          );
          return;
        }

        if (file === "elevator.pdf") {
          sendBinary(
            response,
            200,
            "application/pdf",
            "liftcore-relatorio-elevador.pdf",
            createElevatorPdf(state, requester)
          );
          return;
        }
      }

      sendJson(response, 404, { message: "Endpoint nao encontrado." });
    }

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const decodedPath = decodeURIComponent(requestUrl.pathname);

      try {
        if (decodedPath.startsWith("/api/")) {
          await serveApi(request, response, decodedPath);
          return;
        }

        const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
        const filePath = path.resolve(siteRoot, relativePath);

        if (!filePath.startsWith(siteRoot)) {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Acesso negado");
          return;
        }

        const content = await fs.readFile(filePath);
        const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
        response.end(content);
      } catch (error) {
        if (decodedPath.startsWith("/api/")) {
          sendJson(response, 500, { message: error.message });
          return;
        }
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Arquivo nao encontrado");
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}/`;
      console.log(`Servidor local rodando em ${url}`);
      console.log("Login admin inicial: 571073 / 123456");
      console.log("Pressione Ctrl+C para encerrar.");
    });
  }

  const LiftcoreApi = {
    authenticate,
    bootstrap,
    clearSession,
    createMaintenance,
    getDashboardState,
    getSession,
    registerUser,
    requireSession,
    saveMaintenance,
    downloadReport
  };

  root.LiftcoreApi = LiftcoreApi;

  if (isNode) {
    module.exports = LiftcoreApi;
    if (require.main === module) startLocalServer();
  }
})();
