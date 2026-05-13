document.addEventListener('DOMContentLoaded', () => {

  const userDropdown = document.getElementById('userDropdown');
  if (!userDropdown) return;

  const userButton = document.getElementById('userButton');
  const userMenu = document.getElementById('userMenu');

  if (!userButton || !userMenu) return;

  function openMenu(){
    userMenu.classList.add('open');
    userButton.setAttribute('aria-expanded','true');
    userMenu.setAttribute('aria-hidden','false');
  }

  function closeMenu(){
    userMenu.classList.remove('open');
    userButton.setAttribute('aria-expanded','false');
    userMenu.setAttribute('aria-hidden','true');
  }

  userButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = userButton.getAttribute('aria-expanded') === 'true';
    if (expanded) closeMenu(); else openMenu();
  });

  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      closeMenu();
      userButton.focus();
    }
  });

  userMenu.querySelectorAll('.user-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      handleAction(action);
    });
  });

  function handleAction(action){
    switch(action){
      case 'logout':
        if (window.LiftcoreApi) window.LiftcoreApi.clearSession();
        window.location.href = './index.html';
        break;
      case 'profile':
        if (window.LiftcoreDashboard && typeof window.LiftcoreDashboard.onUserAction === 'function'){
          window.LiftcoreDashboard.onUserAction('profile');
        }
        break;
      case 'settings':
        if (window.LiftcoreDashboard && typeof window.LiftcoreDashboard.onUserAction === 'function'){
          window.LiftcoreDashboard.onUserAction('settings');
        }
        break;
      default:
        break;
    }

    closeMenu();
  }

});
