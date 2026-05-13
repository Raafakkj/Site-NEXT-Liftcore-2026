const camerasGrid = document.getElementById('cameras-grid');

function renderCameras(state) {
  const cameras = state.camerasPage?.cameras;

  if (!camerasGrid || !cameras) {
    return;
  }

  camerasGrid.replaceChildren();

  for (const camera of cameras) {
    const card = document.createElement('div');
    const name = document.createElement('strong');
    const status = document.createElement('span');

    card.className = 'card camera-card';
    name.textContent = camera.name;
    status.textContent = camera.status;
    status.className = camera.tone === 'negative' ? 'negative' : 'positive';

    card.append(name, status);
    camerasGrid.append(card);
  }
}

window.LiftCoreAPI?.subscribeState(renderCameras);
