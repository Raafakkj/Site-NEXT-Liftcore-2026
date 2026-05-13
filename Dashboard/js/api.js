const REFRESH_INTERVAL = 250;
const API_STATE_URL = '/api/state';

async function fetchState() {
  const response = await fetch(API_STATE_URL, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`API respondeu com status ${response.status}`);
  }

  return response.json();
}

function subscribeState(render) {
  let refreshInFlight = false;

  async function refresh() {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;

    try {
      const state = await fetchState();
      render(state);
    } catch (error) {
      console.warn('Nao foi possivel carregar /api/state.', error);
    } finally {
      refreshInFlight = false;
    }
  }

  refresh();
  window.setInterval(refresh, REFRESH_INTERVAL);
}

window.LiftCoreAPI = {
  subscribeState
};
