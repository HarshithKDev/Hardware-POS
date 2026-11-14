// A short message for the login screen ("Your sign-in has expired..."), set when the app
// signs the user out by itself. It is shown on the login screen and cleared once the user
// signs in, instead of a popup that would only appear after the next login.
const KEY = 'pos_login_notice';

export function setLoginNotice(message) {
  try { sessionStorage.setItem(KEY, message); } catch { /* storage unavailable */ }
}

export function readLoginNotice() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function clearLoginNotice() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
