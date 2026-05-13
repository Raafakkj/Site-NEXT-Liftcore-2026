const themeToggle = document.getElementById('theme-toggle');
const root = document.documentElement;

function updateThemeIcon(isDark) {
  const icon = themeToggle?.querySelector('i');

  if (!icon) {
    return;
  }

  icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

window.addEventListener('load', () => {
  const loader = document.getElementById('loader');

  if (!loader) {
    return;
  }

  const alreadyLoaded = sessionStorage.getItem('liftcore_loaded');

  if (alreadyLoaded) {
    loader.remove();
    return;
  }

  sessionStorage.setItem('liftcore_loaded', 'true');

  window.setTimeout(() => {
    loader.classList.add('hide');
  }, 900);

  loader.addEventListener(
    'transitionend',
    () => {
      loader.remove();
    },
    { once: true }
  );
});

if (themeToggle) {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDarkTheme = savedTheme ? savedTheme === 'dark' : prefersDark;

  root.classList.toggle('dark-mode', useDarkTheme);
  document.body.classList.toggle('dark-mode', useDarkTheme);
  updateThemeIcon(useDarkTheme);

  themeToggle.addEventListener('click', () => {
    const isDark = root.classList.toggle('dark-mode');

    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
  });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a');

  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target ||
    link.origin !== window.location.origin ||
    link.pathname === window.location.pathname
  ) {
    return;
  }

  event.preventDefault();
  document.body.classList.add('page-leaving');

  window.setTimeout(() => {
    window.location.href = link.href;
  }, 80);
});
