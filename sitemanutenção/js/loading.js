document.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("loadingStatus");
  const progress = document.getElementById("loadingProgress");
  const percent = document.getElementById("loadingPercent");
  const params = new URLSearchParams(window.location.search);
  const requestedNext = params.get("next") || sessionStorage.getItem("liftcore_loading_target") || "./dashboard.html";
  const next = requestedNext.includes("://") ? "./dashboard.html" : requestedNext;

  if (!window.LiftcoreApi?.requireSession()) {
    return;
  }

  try {
    await window.LiftcoreApi.bootstrap((step) => {
      status.textContent = step.label;
      progress.style.width = `${step.progress}%`;
      percent.textContent = `${step.progress}%`;
    });

    status.textContent = "Painel pronto";
    progress.style.width = "100%";
    percent.textContent = "100%";
    sessionStorage.removeItem("liftcore_loading_target");

    window.setTimeout(() => {
      window.location.replace(next);
    }, 320);
  } catch (error) {
    console.error("Falha ao carregar o painel.", error);
    status.textContent = "Não foi possível carregar. Voltando ao login.";
    window.setTimeout(() => window.location.replace("./index.html"), 1200);
  }
});
