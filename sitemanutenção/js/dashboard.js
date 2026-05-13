document.addEventListener("DOMContentLoaded", () => {
  const session = window.LiftcoreApi?.requireSession();
  if (!session) return;
  const REVIEW_KEY = "liftcore_active_revision";
  const SETTINGS_KEY = "liftcore_maintenance_settings";
  const DEFAULT_SETTINGS = {
    requireReview: true,
    pendingOnly: true,
    highlightCritical: true,
    autoOpenAlerts: false,
    alertThreshold: "media",
    queueLimit: 3,
    confirmPendingOnFinish: true,
    completionTarget: 90
  };
  let dashboardSettings = loadSettings();
  let currentView = "dashboard";
  let lastSyncAt = Date.now();
  let lastAutoAlertSignature = "";

  const viewCopy = {
    dashboard: {
      eyebrow: "Turno tecnico",
      title: "Painel do EVA",
      subtitle: "Fila de manutencao, checklist e alertas do elevador."
    },
    maintenance: {
      eyebrow: "Checklist",
      title: "Manutencao em campo",
      subtitle: "Registre a situacao real de cada item da planilha."
    },
    elevators: {
      eyebrow: "Ativo",
      title: "Elevador EVA",
      subtitle: "Resumo tecnico do equipamento monitorado."
    },
    alerts: {
      eyebrow: "Risco",
      title: "Alertas do turno",
      subtitle: "Pendencias e prioridades para nao sair sem resposta."
    },
    reports: {
      eyebrow: "Entrega",
      title: "Relatorios",
      subtitle: "Fechamento do turno baseado no checklist."
    },
    technicians: {
      eyebrow: "Equipe",
      title: "Perfis tecnicos",
      subtitle: "Pessoas cadastradas com credencial e funcao."
    },
    settings: {
      eyebrow: "Configuracoes",
      title: "Regras do turno",
      subtitle: "Controle operacional, alertas e acessos do site de manutencao."
    }
  };

  const title = document.getElementById("pageTitle");
  const subtitle = document.getElementById("pageSubtitle");
  const eyebrow = document.getElementById("sectionEyebrow");
  const navItems = [...document.querySelectorAll("[data-nav]")];
  const views = [...document.querySelectorAll("[data-view]")];

  window.LiftcoreDashboard = window.LiftcoreDashboard || {};
  window.LiftcoreDashboard.binders = {};

  document.querySelectorAll("[data-bind]").forEach((el) => {
    const key = el.getAttribute("data-bind");
    if (key) window.LiftcoreDashboard.binders[key] = el;
  });

  window.LiftcoreDashboard.update = (key, value) => {
    const el = window.LiftcoreDashboard.binders[key];
    if (el) el.textContent = value;
  };

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(nextSettings = dashboardSettings) {
    dashboardSettings = {
      ...DEFAULT_SETTINGS,
      ...nextSettings,
      queueLimit: Number(nextSettings.queueLimit) || DEFAULT_SETTINGS.queueLimit,
      completionTarget: Math.min(100, Math.max(0, Number(nextSettings.completionTarget) || DEFAULT_SETTINGS.completionTarget))
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(dashboardSettings));
  }

  function priorityThresholdRank() {
    return priorityRank(dashboardSettings.alertThreshold);
  }

  function canEditChecklist() {
    return !dashboardSettings.requireReview || isReviewActive();
  }

  function settingValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number") return Number(input.value);
    return input.value;
  }

  function syncSettingsControls() {
    document.querySelectorAll("[data-setting]").forEach((input) => {
      const key = input.dataset.setting;
      if (!(key in dashboardSettings)) return;
      if (input.type === "checkbox") input.checked = Boolean(dashboardSettings[key]);
      else input.value = dashboardSettings[key];
    });
  }

  function bindSettingsControls() {
    document.querySelectorAll("[data-setting]").forEach((input) => {
      input.addEventListener("change", async () => {
        saveSettings({ ...dashboardSettings, [input.dataset.setting]: settingValue(input) });
        syncSettingsControls();
        if (window.__liftcoreLastState) await applyState(window.__liftcoreLastState, { keepSyncTime: true });
      });
    });
    syncSettingsControls();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    return String(name || "U")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U";
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function priorityRank(priority) {
    const value = normalize(priority);
    if (value.includes("crit")) return 4;
    if (value.includes("alta")) return 3;
    if (value.includes("media")) return 2;
    return 1;
  }

  function isDone(item) {
    return /ok|feito|conclu|final|inspecionado|resolvido/.test(normalize(item.situation));
  }

  function pendingItems(items = []) {
    return items.filter((item) => !isDone(item));
  }

  function sortedByRisk(items = []) {
    return [...items].sort((a, b) => {
      const risk = priorityRank(b.priority) - priorityRank(a.priority);
      return risk || a.row - b.row;
    });
  }

  function statusClass(item) {
    const text = `${item.priority} ${item.situation}`;
    if (priorityRank(item.priority) >= 3 || normalize(text).includes("crit")) return "danger";
    if (priorityRank(item.priority) === 2 || normalize(text).includes("acompanhar")) return "warning";
    if (isDone(item)) return "success";
    return "neutral";
  }

  function statusLabel(item) {
    if (item.situation) return item.situation;
    return isDone(item) ? "Concluido" : "Pendente";
  }

  function priorityLabel(priority) {
    const value = normalize(priority);
    if (value.includes("crit")) return "critica";
    if (value.includes("alta")) return "alta";
    if (value.includes("media")) return "media";
    return "baixa";
  }

  function getRevision() {
    try {
      return JSON.parse(localStorage.getItem(REVIEW_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setRevision(value) {
    if (value) localStorage.setItem(REVIEW_KEY, JSON.stringify(value));
    else localStorage.removeItem(REVIEW_KEY);
  }

  function isReviewActive() {
    const revision = getRevision();
    return Boolean(revision?.startedAt && !revision?.finishedAt);
  }

  function formatTime(value) {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function renderUser(user = {}) {
    document.querySelectorAll(".user-label strong").forEach((el) => {
      el.textContent = user.shortName || "Admin";
    });
    document.querySelectorAll(".user-label small").forEach((el) => {
      el.textContent = user.role || "Operador";
    });

    document.querySelectorAll(".topbar .avatar, .user-card .avatar").forEach((el) => {
      el.textContent = initials(user.name || user.profile?.fullName || "Admin");
    });

    const userName = document.getElementById("userName");
    const userRole = document.getElementById("userRole");
    if (userName) userName.textContent = user.name || "Administrador";
    if (userRole) userRole.textContent = user.roleDescription || "Operador de manutencao";
  }

  function renderShift(data) {
    const user = data.user || session.user || {};
    const items = data.maintenance || [];
    const pending = pendingItems(items);
    const highest = sortedByRisk(pending)[0];
    const completed = items.filter(isDone).length;
    const greeting = document.getElementById("shiftGreeting");
    const focus = document.getElementById("shiftFocus");
    const hint = document.getElementById("shiftHint");
    const pill = document.getElementById("shiftStatusPill");

    if (greeting) {
      greeting.textContent = `${user.shortName || user.name || "Tecnico"}, ${pending.length} item(ns) aguardam atualizacao.`;
    }

    if (focus) {
      focus.textContent = highest ? highest.item : "Checklist sem pendencias";
    }

    if (hint) {
      hint.textContent = items.length
        ? `${completed} de ${items.length} item(ns) concluidos.`
        : "Nenhum item encontrado na planilha.";
    }

    if (pill) {
      pill.className = `status ${highest ? statusClass(highest) : "success"}`;
      pill.textContent = highest ? `Prioridade ${priorityLabel(highest.priority)}` : "Em dia";
    }
  }

  function renderMetrics(data) {
    const items = data.maintenance || [];
    const highRisk = pendingItems(items).filter((item) => priorityRank(item.priority) >= 3).length;
    const completed = items.filter(isDone).length;
    const completion = items.length ? `${Math.round((completed / items.length) * 100)}%` : "100%";

    window.LiftcoreDashboard.update("elevators-active", data.metrics?.["elevators-active"] || "1");
    window.LiftcoreDashboard.update("maintenance-today", String(items.length));
    window.LiftcoreDashboard.update("critical-failures", String(highRisk));
    window.LiftcoreDashboard.update("system-uptime", completion);
  }

  function renderReviewClock(data) {
    const revision = getRevision();
    const active = isReviewActive();
    const editingAllowed = canEditChecklist();
    const items = data.maintenance || [];
    const completed = items.filter(isDone).length;
    const pending = items.length - completed;
    const titleEl = document.getElementById("revisionClockTitle");
    const textEl = document.getElementById("revisionClockText");
    const startBtn = document.querySelector(".clock-start");
    const finishBtn = document.querySelector(".clock-finish");
    const progressEl = document.getElementById("checklistProgress");
    const hintEl = document.getElementById("checklistModeHint");
    const createForm = document.getElementById("maintenanceCreateForm");
    const createSlot = document.getElementById("maintenanceCreateSlot");
    const newItemButtons = document.querySelectorAll('[data-action="new-ticket"]');
    document.body.classList.toggle("review-active", editingAllowed);

    if (titleEl) {
      titleEl.textContent = active
        ? "Revisao em andamento"
        : dashboardSettings.requireReview
          ? "Revisao ainda nao iniciada"
          : "Edicao liberada";
    }

    if (textEl) {
      textEl.textContent = active
        ? `Entrada registrada por ${revision.user || "tecnico"} em ${formatTime(revision.startedAt)}. Pendentes: ${pending}.`
        : dashboardSettings.requireReview
          ? "Clique em iniciar para liberar OK, Acompanhar e Falha nos itens."
          : "As configuracoes permitem editar sem bater inicio de revisao.";
    }

    if (startBtn) {
      startBtn.disabled = active;
      startBtn.innerHTML = active
        ? '<i class="fa-solid fa-check" aria-hidden="true"></i>Revisao iniciada'
        : '<i class="fa-solid fa-play" aria-hidden="true"></i>Iniciar revisao';
    }

    if (finishBtn) {
      finishBtn.disabled = !active;
    }

    if (progressEl) {
      progressEl.textContent = `${completed} de ${items.length} concluidos`;
    }

    if (hintEl) {
      hintEl.textContent = editingAllowed ? "Edicao liberada." : "Inicie a revisao para editar.";
    }

    if (createForm) {
      const showCreate = editingAllowed && createSlot?.classList.contains("show-create");
      createForm.hidden = !showCreate;
      createForm.style.display = showCreate ? "" : "none";
    }

    if (!editingAllowed) createSlot?.classList.remove("show-create");

    newItemButtons.forEach((button) => {
      button.disabled = !editingAllowed;
      button.title = editingAllowed ? "" : "Inicie a revisao para adicionar itens.";
    });
  }

  function renderPriorityQueue(items = []) {
    const target = document.getElementById("priorityQueue");
    if (!target) return;

    const source = dashboardSettings.pendingOnly ? pendingItems(items) : items;
    const queue = sortedByRisk(source).slice(0, dashboardSettings.queueLimit);
    target.innerHTML = queue.length ? queue.map((item) => `
      <article class="work-item priority-${priorityLabel(item.priority)}">
        <div class="work-main">
          <span class="work-kicker">#${item.row} | ${escapeHtml(item.category || "Geral")}</span>
          <strong>${escapeHtml(item.item || "Item sem nome")}</strong>
        </div>
        <span class="status ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span>
        <button class="icon-link" type="button" data-open-row="${item.row}" aria-label="Abrir item #${item.row}">
          <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
        </button>
      </article>
    `).join("") : `
      <div class="empty-state">
        <strong>Checklist sem pendencias abertas.</strong>
        <small>Novos itens podem ser adicionados pela tela de checklist.</small>
      </div>
    `;
  }

  function renderAssetStatus(data) {
    const target = document.getElementById("assetStatus");
    if (!target) return;

    const elevator = data.elevator || {};
    const carText = elevator.hasVehicle ? `Sim - ${elevator.plate}` : "Nao";
    target.innerHTML = `
      <div class="asset-line">
        <span>Status</span>
        <strong>${escapeHtml(elevator.status || "Operando")}</strong>
      </div>
      <div class="asset-line">
        <span>Andar atual</span>
        <strong>${escapeHtml(elevator.floor || "--")}</strong>
      </div>
      <div class="asset-line">
        <span>Carro dentro</span>
        <strong>${escapeHtml(carText)}</strong>
      </div>
      <div class="asset-line">
        <span>Porta</span>
        <strong>${escapeHtml(elevator.door || "--")}</strong>
      </div>
    `;

    const mainStatus = document.getElementById("assetMainStatus");
    const mainCopy = document.getElementById("assetMainCopy");
    if (mainStatus) mainStatus.textContent = elevator.status || "Operando";
    if (mainCopy) {
      mainCopy.textContent = `Andar ${elevator.floor || "--"} | ${elevator.direction || "Parado"} | carro dentro: ${carText}`;
    }

    renderElevatorArt(elevator);
    renderLiveSpecs(elevator);
  }

  function renderElevatorArt(elevator = {}) {
    const stack = document.getElementById("floorStack");
    if (!stack) return;

    const current = Number(String(elevator.floor || "1").replace(/[^\d]/g, "")) || 1;
    const floors = [5, 4, 3, 2, 1];
    stack.innerHTML = floors.map((floor) => {
      const active = floor === current;
      return `
        <div class="floor-row ${active ? "active" : ""}">
          <span class="floor-label">G${floor}</span>
          <div class="floor-track">
            ${active ? `
              <div class="cabin-art">
                <i class="fa-solid fa-elevator" aria-hidden="true"></i>
                ${elevator.hasVehicle ? '<i class="fa-solid fa-car-side car-inside" aria-hidden="true"></i>' : ""}
                <small>${escapeHtml(elevator.hasVehicle ? elevator.plate : "VAZIO")}</small>
              </div>
            ` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderLiveSpecs(elevator = {}) {
    const grid = document.getElementById("liveSpecGrid");
    if (!grid) return;

    const vehicle = elevator.vehicle || {};
    const specs = [
      ["Velocidade", `${Number(elevator.speed_mps || 0).toFixed(1)} m/s`],
      ["Peso", `${Number(elevator.weight_KG || 0).toFixed(1)} KG`],
      ["Temp. cabine", `${elevator.cabin_temp_c ?? "--"} C`],
      ["Temp. motor", `${elevator.motor_temp_c ?? "--"} C`],
      ["Placa", elevator.hasVehicle ? elevator.plate : "---"],
      ["Acesso", vehicle.access || "---"]
    ];

    grid.innerHTML = specs.map(([label, value]) => `
      <div class="spec-pill">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");
  }

  function renderCategoryBoard(items = []) {
    const target = document.getElementById("categoryBoard");
    if (!target) return;

    const groups = items.reduce((acc, item) => {
      const key = item.category || "Geral";
      if (!acc[key]) acc[key] = { total: 0, done: 0, high: 0 };
      acc[key].total += 1;
      if (isDone(item)) acc[key].done += 1;
      if (priorityRank(item.priority) >= 3) acc[key].high += 1;
      return acc;
    }, {});

    target.innerHTML = Object.entries(groups).map(([category, info]) => {
      const percent = info.total ? Math.round((info.done / info.total) * 100) : 0;
      return `
        <article class="area-row">
          <div>
            <strong>${escapeHtml(category)}</strong>
            <small>${info.done}/${info.total} concluidos</small>
          </div>
          <div class="progress" aria-label="${percent}% concluido">
            <span style="width:${percent}%"></span>
          </div>
          <span class="area-risk">${info.high} alta</span>
        </article>
      `;
    }).join("") || `
      <div class="empty-state">
        <strong>Nenhuma area cadastrada.</strong>
        <small>A planilha ainda nao possui itens.</small>
      </div>
    `;
  }

  function alertMarkup(item) {
    const tone = statusClass(item);
    const icon = tone === "danger" ? "fa-triangle-exclamation" : tone === "warning" ? "fa-clock" : "fa-circle-info";
    return `
      <article class="alert ${tone === "danger" ? "critical" : tone}" role="status">
        <i class="fa-solid ${icon}" aria-hidden="true"></i>
        <span>
          <strong>${escapeHtml(item.item || "Item do checklist")}</strong>
          <small>${escapeHtml(item.category || "Geral")} | prioridade ${escapeHtml(priorityLabel(item.priority))} | ${escapeHtml(statusLabel(item))}</small>
        </span>
      </article>
    `;
  }

  function renderAlerts(items = []) {
    const minimum = priorityThresholdRank();
    const alerts = sortedByRisk(pendingItems(items)).filter((item) =>
      priorityRank(item.priority) >= minimum || (item.notes && priorityRank(item.priority) >= 2)
    ).slice(0, 8);
    const html = alerts.length ? alerts.map(alertMarkup).join("") : `
      <article class="alert info" role="status">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
        <span>
          <strong>Nenhum alerta aberto</strong>
          <small>O checklist nao possui prioridade ${escapeHtml(dashboardSettings.alertThreshold)} ou maior pendente.</small>
        </span>
      </article>
    `;

    const dashboardAlerts = document.getElementById("dashboardAlerts");
    const alertsList = document.getElementById("alertsList");
    if (dashboardAlerts) dashboardAlerts.innerHTML = html;
    if (alertsList) alertsList.innerHTML = html;
  }

  function renderRoutine(items = []) {
    const target = document.getElementById("routineList");
    if (!target) return;

    const elevator = window.__liftcoreLastState?.elevator || {};
    const specs = elevator.specs || {};
    const rows = [
      ["Modelo", specs.model],
      ["Tipo", specs.type],
      ["Pavimentos", specs.floors],
      ["Acionamento", specs.drive],
      ["Controlador", specs.controller],
      ["Sensores", specs.sensors],
      ["Seguranca", specs.safety]
    ];

    target.innerHTML = rows.map(([label, value]) => `
      <article class="routine-item">
        <i class="fa-solid fa-microchip" aria-hidden="true"></i>
        <span>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(value || "---")}</small>
        </span>
      </article>
    `).join("");
  }

  function renderMaintenance(items = []) {
    const list = document.getElementById("checklistCards");
    if (!list) return;
    const editingAllowed = canEditChecklist();
    list.classList.toggle("is-locked", !editingAllowed);

    if (!editingAllowed) {
      list.innerHTML = sortedByRisk(items).map((item) => `
        <article data-row="${item.row}" class="check-card locked priority-${priorityLabel(item.priority)} ${isDone(item) ? "done" : ""}">
          <div class="locked-check-row">
            <span class="work-kicker">#${item.row} | ${escapeHtml(item.category || "Geral")}</span>
            <strong>${escapeHtml(item.item || "Item sem nome")}</strong>
            <span class="status ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span>
          </div>
        </article>
      `).join("");
      return;
    }

    list.innerHTML = sortedByRisk(items).map((item) => `
      <article data-row="${item.row}" class="check-card priority-${priorityLabel(item.priority)} ${isDone(item) ? "done" : ""}">
        <header class="check-card-head">
          <span class="work-kicker">#${item.row} | ${escapeHtml(item.category || "Geral")}</span>
          <span class="status ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span>
        </header>
        <div class="check-card-body">
          <div>
            <h3>${escapeHtml(item.item || "Item sem nome")}</h3>
          </div>
          <div class="quick-state" aria-label="Acoes rapidas do item #${item.row}">
            <button type="button" class="quick-ok" data-quick-status="ok"><i class="fa-solid fa-check" aria-hidden="true"></i>OK</button>
            <button type="button" class="quick-watch" data-quick-status="watch"><i class="fa-solid fa-eye" aria-hidden="true"></i>Acompanhar</button>
            <button type="button" class="quick-fail" data-quick-status="fail"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Falha</button>
          </div>
        </div>
        <details class="advanced-fields">
          <summary>Observacao e ajustes</summary>
          <div class="check-fields">
            <label>Situacao
              <input class="table-input" data-field="situation" value="${escapeHtml(item.situation)}" placeholder="Ex: OK, Acompanhar, Falha encontrada">
            </label>
            <label>Prioridade
              <select class="table-input" data-field="priority">
                ${["baixa", "media", "alta", "critica"].map((priority) =>
                  `<option value="${priority}" ${priority === priorityLabel(item.priority) ? "selected" : ""}>${priority}</option>`
                ).join("")}
              </select>
            </label>
            <label class="wide-field">Observacao tecnica
              <textarea class="table-input" data-field="notes" rows="2" placeholder="O que foi visto? O que precisa ser feito?">${escapeHtml(item.notes)}</textarea>
            </label>
            <label>Sistema
              <input class="table-input" data-field="category" value="${escapeHtml(item.category)}">
            </label>
            <label class="wide-field">Item revisado
              <input class="table-input" data-field="item" value="${escapeHtml(item.item)}">
            </label>
            <button class="text-button row-save" type="button">Salvar ajustes</button>
          </div>
        </details>
      </article>
    `).join("");
  }

  function collectCardPayload(card) {
    const payload = {};
    card.querySelectorAll("[data-field]").forEach((field) => {
      payload[field.dataset.field] = field.value.trim();
    });
    return payload;
  }

  async function saveChecklistCard(card, button = null) {
    if (!card) return;
    const payload = collectCardPayload(card);
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = "Salvando";
    }

    try {
      await window.LiftcoreApi.saveMaintenance(card.dataset.row, payload);
      await applyState(await window.LiftcoreApi.getDashboardState());
    } catch (error) {
      alert(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || "Salvar";
      }
    }
  }

  async function applyQuickStatus(button) {
    if (!canEditChecklist()) {
      alert("Primeiro clique em Iniciar revisao. Isso registra o inicio do trabalho.");
      return;
    }

    const card = button.closest(".check-card");
    const status = button.dataset.quickStatus;
    const situation = card.querySelector('[data-field="situation"]');
    const priority = card.querySelector('[data-field="priority"]');

    if (status === "ok") {
      situation.value = "OK";
      priority.value = "baixa";
    }

    if (status === "watch") {
      situation.value = "Acompanhar";
      priority.value = "media";
    }

    if (status === "fail") {
      situation.value = "Falha encontrada";
      priority.value = "alta";
    }

    await saveChecklistCard(card, button);
  }

  function renderProfiles(profiles = []) {
    const grid = document.getElementById("profilesGrid");
    if (!grid) return;

    grid.innerHTML = profiles.map((profile) => `
      <article class="person-card">
        <span class="avatar">${escapeHtml(initials(profile.fullName))}</span>
        <h3>${escapeHtml(profile.fullName || "Sem nome")}</h3>
        <p>${escapeHtml(profile.specialty || profile.role || "Manutencao geral")}</p>
        <small>${escapeHtml(profile.status || "Disponivel")} | ${escapeHtml(profile.login || "")}</small>
      </article>
    `).join("") || `
      <div class="empty-state">
        <strong>Nenhum perfil cadastrado.</strong>
        <small>Administradores podem criar pessoas em Acessos.</small>
      </div>
    `;
  }

  function ensureMaintenanceCreator() {
    const slot = document.getElementById("maintenanceCreateSlot");
    if (!slot || document.getElementById("maintenanceCreateForm")) return;

    const form = document.createElement("form");
    form.id = "maintenanceCreateForm";
    form.className = "inline-form";
    form.hidden = true;
    form.style.display = "none";
    form.innerHTML = `
      <input name="category" placeholder="Sistema" required>
      <input name="item" placeholder="Item revisado" required>
      <select name="priority" aria-label="Prioridade">
        <option value="baixa">baixa</option>
        <option value="media">media</option>
        <option value="alta">alta</option>
        <option value="critica">critica</option>
      </select>
      <input name="situation" placeholder="Situacao inicial">
      <button class="primary-button" type="submit"><i class="fa-solid fa-plus" aria-hidden="true"></i>Adicionar</button>
    `;
    slot.appendChild(form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        await window.LiftcoreApi.createMaintenance({ ...data, notes: "" });
        form.reset();
        slot.classList.remove("show-create");
        await applyState(await window.LiftcoreApi.getDashboardState());
      } catch (error) {
        alert(error.message);
      }
    });
  }

  function renderAdminRegistration(user = {}) {
    const slot = document.getElementById("adminRegisterSlot");
    if (!slot) return;
    if (!Array.isArray(user.permissions) || !user.permissions.includes("admin")) {
      slot.innerHTML = `
        <div class="empty-state">
          <strong>Acesso administrativo necessario.</strong>
          <small>Seu perfil pode operar o checklist, mas nao cadastra novos usuarios.</small>
        </div>
      `;
      return;
    }
    if (document.getElementById("adminRegisterForm")) return;

    const form = document.createElement("form");
    form.id = "adminRegisterForm";
    form.className = "admin-form";
    form.innerHTML = `
      <div class="admin-form-header">
        <strong>Registrar pessoa</strong>
        <small>Cria credencial e perfil tecnico.</small>
      </div>
      <div class="form-grid">
        <label>Nome completo<input name="fullName" required></label>
        <label>Login<input name="login" required></label>
        <label>Senha<input name="password" type="password" required></label>
        <label>Perfil
          <select name="role">
            <option>Tecnico</option>
            <option>Administrador</option>
          </select>
        </label>
        <label>Especialidade<input name="specialty" placeholder="Ex: eletrica"></label>
        <label>Status<input name="status" placeholder="Disponivel"></label>
        <label>E-mail<input name="email" type="email"></label>
        <label>Telefone<input name="phone"></label>
      </div>
      <button class="primary-button" type="submit"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Registrar</button>
      <p class="form-feedback" id="adminRegisterFeedback" role="status"></p>
    `;

    slot.innerHTML = "";
    slot.appendChild(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const feedback = document.getElementById("adminRegisterFeedback");
      const payload = Object.fromEntries(new FormData(form).entries());

      try {
        await window.LiftcoreApi.registerUser(payload);
        feedback.textContent = "Pessoa registrada com sucesso.";
        feedback.className = "form-feedback success";
        form.reset();
        await applyState(await window.LiftcoreApi.getDashboardState());
      } catch (error) {
        feedback.textContent = error.message;
        feedback.className = "form-feedback danger";
      }
    });
  }

  function renderSettings(data = {}) {
    document.body.classList.toggle("highlight-critical", Boolean(dashboardSettings.highlightCritical));

    const enabledCount = document.getElementById("settingsEnabledCount");
    if (enabledCount) {
      enabledCount.textContent = Object.entries(dashboardSettings)
        .filter(([, value]) => value === true)
        .length;
    }

    const items = data.maintenance || [];
    const completed = items.filter(isDone).length;
    const completion = items.length ? Math.round((completed / items.length) * 100) : 100;
    const pending = pendingItems(items).length;
    const highRisk = pendingItems(items).filter((item) => priorityRank(item.priority) >= priorityThresholdRank()).length;
    const health = document.getElementById("settingsHealthNote");
    if (health) {
      health.className = `settings-note ${completion >= dashboardSettings.completionTarget ? "success" : "warning"}`;
      health.textContent = `${completion}% de conformidade contra meta de ${dashboardSettings.completionTarget}%. ${pending} pendente(s).`;
    }

    const dataGrid = document.getElementById("settingsDataGrid");
    if (dataGrid) {
      const elevator = data.elevator || {};
      const profiles = data.profiles || [];
      dataGrid.innerHTML = [
        ["Elevador", elevator.name || "EVA"],
        ["Status do ativo", elevator.status || "---"],
        ["Checklist", `${completed}/${items.length} concluidos`],
        ["Alertas no corte atual", String(highRisk)],
        ["Perfis cadastrados", String(profiles.length || data.users?.length || 0)],
        ["Ultima sincronizacao", formatTime(lastSyncAt)]
      ].map(([label, value]) => `
        <article class="settings-data-item">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `).join("");
    }

    renderSettingsUsers(data);
  }

  function renderSettingsUsers(data = {}) {
    const target = document.getElementById("settingsUsersList");
    if (!target) return;

    const users = Array.isArray(data.users) && data.users.length
      ? data.users.map((user) => ({
          name: user.name,
          login: user.login,
          role: user.role,
          specialty: user.profile?.specialty,
          status: user.profile?.status
        }))
      : (data.profiles || []).map((profile) => ({
          name: profile.fullName,
          login: profile.login,
          role: profile.role,
          specialty: profile.specialty,
          status: profile.status
        }));

    target.innerHTML = users.length ? users.map((user) => `
      <article class="access-row">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</span>
        <span>
          <strong>${escapeHtml(user.name || "Usuario")}</strong>
          <small>${escapeHtml(user.specialty || "Manutencao geral")} | ${escapeHtml(user.status || "Disponivel")}</small>
        </span>
        <span class="status neutral">${escapeHtml(user.role || "Tecnico")}</span>
        <code>${escapeHtml(user.login || "---")}</code>
      </article>
    `).join("") : `
      <div class="empty-state">
        <strong>Nenhum usuario listado.</strong>
        <small>Cadastre o primeiro perfil administrativo ou tecnico.</small>
      </div>
    `;
  }

  function maybeOpenAlerts(items = []) {
    if (!dashboardSettings.autoOpenAlerts || currentView !== "dashboard") return;
    const risky = sortedByRisk(pendingItems(items)).filter((item) => priorityRank(item.priority) >= priorityThresholdRank());
    if (!risky.length) return;

    const signature = risky.map((item) => `${item.row}:${item.priority}:${item.situation}`).join("|");
    if (signature === lastAutoAlertSignature) return;

    lastAutoAlertSignature = signature;
    setView("alerts");
  }

  async function applyState(data, options = {}) {
    window.__liftcoreLastState = data;
    if (!options.keepSyncTime) lastSyncAt = Date.now();
    renderUser(data.user || session.user);
    renderShift(data);
    renderMetrics(data);
    renderReviewClock(data);
    renderPriorityQueue(data.maintenance || []);
    renderAssetStatus(data);
    renderCategoryBoard(data.maintenance || []);
    renderAlerts(data.maintenance || []);
    renderRoutine(data.maintenance || []);
    renderMaintenance(data.maintenance || []);
    renderProfiles(data.profiles || []);
    renderSettings(data);
    renderAdminRegistration(data.user || session.user);
    ensureMaintenanceCreator();
    maybeOpenAlerts(data.maintenance || []);
  }

  async function hydrateFromApi() {
    if (!window.LiftcoreApi) return;
    await applyState(await window.LiftcoreApi.getDashboardState());
  }

  function setView(viewName, updateHash = true) {
    const nextView = viewCopy[viewName] ? viewName : "dashboard";
    currentView = nextView;

    views.forEach((view) => {
      view.classList.toggle("active", view.dataset.view === nextView);
    });

    navItems.forEach((item) => {
      const active = item.dataset.nav === nextView;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    eyebrow.textContent = viewCopy[nextView].eyebrow;
    title.textContent = viewCopy[nextView].title;
    subtitle.textContent = viewCopy[nextView].subtitle;

    if (updateHash) history.replaceState(null, "", `#${nextView}`);
  }

  function openMaintenanceRow(rowNumber) {
    setView("maintenance");
    window.setTimeout(() => {
      const row = document.querySelector(`[data-row="${rowNumber}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("is-focused");
      window.setTimeout(() => row.classList.remove("is-focused"), 1600);
    }, 80);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      setView(item.dataset.nav);
    });
  });

  document.querySelectorAll("[data-open-view]").forEach((item) => {
    item.addEventListener("click", () => setView(item.dataset.openView));
  });

  document.addEventListener("click", async (event) => {
    const rowButton = event.target.closest("[data-open-row]");
    if (rowButton) {
      openMaintenanceRow(rowButton.dataset.openRow);
      return;
    }

    const saveButton = event.target.closest(".row-save");
    if (saveButton) {
      await saveChecklistCard(saveButton.closest(".check-card"), saveButton);
      return;
    }

    const quickButton = event.target.closest("[data-quick-status]");
    if (quickButton) {
      await applyQuickStatus(quickButton);
      return;
    }

    const reportButton = event.target.closest("[data-report]");
    if (reportButton) {
      reportButton.disabled = true;
      const original = reportButton.textContent;
      reportButton.textContent = "Gerando...";
      try {
        await window.LiftcoreApi.downloadReport(reportButton.dataset.report);
      } catch (error) {
        alert(error.message);
      } finally {
        reportButton.disabled = false;
        reportButton.textContent = original;
      }
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action === "sync") hydrateFromApi();
    if (action === "start-review") {
      setRevision({
        startedAt: Date.now(),
        user: session.user?.shortName || session.user?.name || "Tecnico"
      });
      await hydrateFromApi();
    }
    if (action === "finish-review") {
      const state = window.__liftcoreLastState || {};
      const pending = pendingItems(state.maintenance || []).length;
      if (dashboardSettings.confirmPendingOnFinish && pending && !confirm(`Ainda existem ${pending} item(ns) pendentes. Finalizar mesmo assim?`)) return;
      setRevision(null);
      await hydrateFromApi();
    }
    if (action === "notifications") setView("alerts");
    if (action === "new-ticket") {
      setView("maintenance");
      if (!canEditChecklist()) {
        alert("Inicie a revisao antes de adicionar itens.");
        return;
      }
      const slot = document.getElementById("maintenanceCreateSlot");
      const form = document.getElementById("maintenanceCreateForm");
      slot?.classList.add("show-create");
      if (form) {
        form.hidden = false;
        form.style.display = "";
        form.querySelector("input")?.focus();
      }
    }
    if (action === "record-issue") setView("maintenance");
    if (action === "checklist") setView("maintenance");
  });

  window.LiftcoreDashboard.onUserAction = (action) => {
    if (action === "settings") setView("settings");
    if (action === "profile") setView("technicians");
  };

  saveSettings(dashboardSettings);
  bindSettingsControls();
  const initialView = window.location.hash.replace("#", "");
  setView(initialView || "dashboard", false);
  hydrateFromApi();
});
