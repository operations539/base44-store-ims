const KEY = 'km_theme';

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage disabled */
  }
}

export function initTheme() {
  applyTheme(getTheme());
}
