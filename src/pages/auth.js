/* ---------------- AUTH ---------------- */
import { esc } from '../core/utils.js';
import { LOGO, ic } from '../core/icons.js';
import { D, S } from '../core/store.js';
import { effectiveDark } from '../core/theme.js';

export function authShell(inner) {
  return `<div class="auth"><div class="auth-top"><span class="brand">${LOGO(22)}</span><div class="row"><button class="ibtn" data-a="toggleDark" data-tip="Toggle theme" aria-label="Toggle theme">${ic(effectiveDark() ? 'sun' : 'moon', 16)}</button></div></div>
    <div class="auth-c">${inner}</div>
    <div class="auth-foot" style="padding:18px;font-size:12px" ><span class="faint">© 2026 Gr8r Studio · Terms · Privacy</span></div></div>`;
}
export const ferr = k => (S.ui.errors[k] ? `<span class="err" id="${k}-err">${ic('circle-alert', 12)}${S.ui.errors[k]}</span>` : '');
export const icls = k => (S.ui.errors[k] ? 'is-error' : '');
/* Sign-in is the only screen: there is no public sign-up, and admins reset passwords. S.ui.errors.login shows above the fields.
   S.ui.af keeps what was typed (the email, and the remember-me choice) across re-renders; the actions module updates it as you type. */
export function renderAuth() {
  const e = S.ui.errors;
  const f = S.ui.af || (S.ui.af = { email: '' });
  return authShell(
    `<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doLogin" novalidate>
    <div style="display:flex;justify-content:center">${LOGO(30)}</div><h1>Welcome back</h1><p class="sub">Sign in to ${esc(D().ws.name)}</p>
    ${e.login ? `<div class="alert danger" role="alert">${ic('circle-alert', 15)}<span>${esc(e.login)}</span></div>` : ''}
    <div class="field"><label class="label" for="l-email">Email</label><input class="input input-lg ${icls('email')}" id="l-email" type="email" value="${esc(f.email)}" data-in="loginField" data-f="email" autocomplete="email" aria-invalid="${!!e.email}" aria-describedby="email-err">${ferr('email')}</div>
    <div class="field"><label class="label" for="l-pw">Password</label>
      <div class="inwrap"><input class="input input-lg ${icls('pw')}" id="l-pw" type="${S.ui.showPw ? 'text' : 'password'}" autocomplete="current-password" style="padding-right:38px" aria-invalid="${!!e.pw}"><button type="button" class="ibtn ibtn-sm" style="position:absolute;right:5px" data-a="toggleShowPw" aria-label="${S.ui.showPw ? 'Hide' : 'Show'} password">${ic(S.ui.showPw ? 'eye-off' : 'eye', 15)}</button></div>${ferr('pw')}</div>
    <label class="row" style="font-size:13px;gap:8px;cursor:pointer"><input type="checkbox" class="check" id="l-rem" data-in="loginField" data-f="remember" ${f.remember === false ? '' : 'checked'}>Remember me for 30 days</label>
    <button class="btn btn-primary btn-lg btn-block" data-a="doLogin" id="login-btn">Sign in</button>
    <p class="auth-foot">Forgot your password? Ask an admin to reset it.</p></form>`,
  );
}
