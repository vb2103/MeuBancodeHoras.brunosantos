import { escapeHtml } from './config.js';
import { supabaseClient } from './db.js';
import {
  evaluatePasswordPolicy,
  mapAuthErrorMessage,
  renderPasswordStrengthUI,
  wirePasswordVisibilityToggle
} from './security.js';

export function setupAuth({ onSessionReady, onUserUpdated, onSignedOut, onToast }) {
  let authMode = 'login'; // 'login' | 'signup' | 'reset' | 'update_password'
  let loadedUserId = null;
  let isAuthBusy = false;

  const authScreen = document.getElementById('authScreen');
  const authAlert = document.getElementById('authAlert');
  const resendBtn = document.getElementById('resendConfirmBtn');
  const tabLogin = document.getElementById('tabAuthLogin');
  const tabSignup = document.getElementById('tabAuthSignup');
  const nameWrap = document.getElementById('authNameWrapper');
  const emailWrap = document.getElementById('authEmailWrapper');
  const emailInput = document.getElementById('authEmail');
  const pwdWrap = document.getElementById('authPasswordWrapper');
  const pwdInput = document.getElementById('authPassword');
  const confirmWrap = document.getElementById('authConfirmPasswordWrapper');
  const confirmInput = document.getElementById('authConfirmPassword');
  const strengthWrap = document.getElementById('authPwdStrengthWrapper');
  const forgotBtn = document.getElementById('forgotPwdBtn');
  const submitBtn = document.getElementById('authSubmitBtn');
  const backBtn = document.getElementById('backToLoginBtn');
  const authTabs = document.getElementById('authTabs');
  const loadingOverlay = document.getElementById('loadingOverlay');

  const resetPwdToggle = wirePasswordVisibilityToggle(document.getElementById('toggleAuthPwdBtn'), pwdInput);
  const resetConfirmToggle = wirePasswordVisibilityToggle(document.getElementById('toggleAuthConfirmPwdBtn'), confirmInput);

  function getSubmitHtmlForMode(mode) {
    if (mode === 'signup') {
      return '<span>Criar Conta e Enviar Confirmação</span><i data-lucide="user-plus" class="w-4 h-4"></i>';
    }
    if (mode === 'reset') {
      return '<span>Enviar Link de Recuperação</span><i data-lucide="mail" class="w-4 h-4"></i>';
    }
    if (mode === 'update_password') {
      return '<span>Salvar Nova Senha</span><i data-lucide="key-round" class="w-4 h-4"></i>';
    }
    return '<span>Entrar no Painel</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
  }

  function showAuthAlert(message, type = 'error') {
    authAlert.classList.remove(
      'hidden',
      'bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800',
      'bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800',
      'bg-amber-50', 'text-amber-800', 'border-amber-200', 'dark:bg-amber-950/60', 'dark:text-amber-200', 'dark:border-amber-800'
    );
    if (type === 'success') {
      authAlert.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800');
    } else if (type === 'warning') {
      authAlert.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-200', 'dark:bg-amber-950/60', 'dark:text-amber-200', 'dark:border-amber-800');
    } else {
      authAlert.classList.add('bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800');
    }
    authAlert.innerHTML = message;
  }

  function updateAuthStrengthFeedback() {
    if (authMode !== 'signup' && authMode !== 'update_password') return;
    const evaluation = evaluatePasswordPolicy(pwdInput.value, { email: emailInput.value });
    renderPasswordStrengthUI(
      {
        barEl: document.getElementById('authPwdStrengthBar'),
        labelEl: document.getElementById('authPwdStrengthLabel'),
        listEl: document.getElementById('authPwdRequirementsList')
      },
      evaluation,
      pwdInput.value.length > 0
    );
  }

  function switchAuthMode(mode) {
    authMode = mode;
    authAlert.classList.add('hidden');
    resendBtn.classList.add('hidden');
    emailWrap.classList.remove('hidden');
    emailInput.required = true;
    forgotBtn.classList.remove('hidden');

    if (mode === 'login') {
      authTabs.classList.remove('hidden');
      tabLogin.className = 'py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition';
      tabSignup.className = 'py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      nameWrap.classList.add('hidden');
      pwdWrap.classList.remove('hidden');
      pwdInput.required = true;
      pwdInput.minLength = 6;
      pwdInput.autocomplete = 'current-password';
      pwdInput.placeholder = 'Sua senha de acesso';
      confirmWrap?.classList.add('hidden');
      if (confirmInput) confirmInput.required = false;
      strengthWrap?.classList.add('hidden');
      backBtn.classList.add('hidden');
    } else if (mode === 'signup') {
      authTabs.classList.remove('hidden');
      tabSignup.className = 'py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition';
      tabLogin.className = 'py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      nameWrap.classList.remove('hidden');
      pwdWrap.classList.remove('hidden');
      pwdInput.required = true;
      pwdInput.minLength = 8;
      pwdInput.autocomplete = 'new-password';
      pwdInput.placeholder = 'Mínimo 8 caracteres fortes';
      confirmWrap?.classList.remove('hidden');
      if (confirmInput) confirmInput.required = true;
      strengthWrap?.classList.remove('hidden');
      backBtn.classList.add('hidden');
    } else if (mode === 'reset') {
      authTabs.classList.add('hidden');
      nameWrap.classList.add('hidden');
      pwdWrap.classList.add('hidden');
      pwdInput.required = false;
      confirmWrap?.classList.add('hidden');
      if (confirmInput) confirmInput.required = false;
      strengthWrap?.classList.add('hidden');
      backBtn.classList.remove('hidden');
    } else if (mode === 'update_password') {
      authTabs.classList.add('hidden');
      nameWrap.classList.add('hidden');
      emailWrap.classList.add('hidden');
      emailInput.required = false;
      forgotBtn.classList.add('hidden');
      pwdWrap.classList.remove('hidden');
      pwdInput.required = true;
      pwdInput.minLength = 8;
      pwdInput.autocomplete = 'new-password';
      pwdInput.value = '';
      pwdInput.placeholder = 'Nova senha (mín. 8 caracteres)';
      confirmWrap?.classList.remove('hidden');
      if (confirmInput) {
        confirmInput.required = true;
        confirmInput.value = '';
      }
      strengthWrap?.classList.remove('hidden');
      backBtn.classList.add('hidden');
    }

    if (confirmInput && mode !== 'login') confirmInput.value = '';
    resetPwdToggle?.();
    resetConfirmToggle?.();
    updateAuthStrengthFeedback();
    submitBtn.innerHTML = getSubmitHtmlForMode(mode);
    window.lucide?.createIcons();
  }

  pwdInput.addEventListener('input', updateAuthStrengthFeedback);
  emailInput.addEventListener('input', updateAuthStrengthFeedback);
  tabLogin.addEventListener('click', () => switchAuthMode('login'));
  tabSignup.addEventListener('click', () => switchAuthMode('signup'));
  forgotBtn.addEventListener('click', () => switchAuthMode('reset'));
  backBtn.addEventListener('click', () => switchAuthMode('login'));

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isAuthBusy) return;
    isAuthBusy = true;

    const email = emailInput.value.trim();
    const password = pwdInput.value;
    const confirmPwd = confirmInput?.value || '';
    const fullName = document.getElementById('authName').value.trim();
    resendBtn.classList.add('hidden');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Processando...';

    try {
      const redirectTo = window.location.origin + window.location.pathname;

      if (authMode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('email not confirmed')) {
            showAuthAlert('<strong>E-mail ainda não confirmado.</strong> Verifique sua caixa de entrada (ou spam) e clique no link enviado antes de entrar.', 'warning');
            resendBtn.classList.remove('hidden');
          } else if (msg.includes('invalid login credentials')) {
            showAuthAlert('E-mail ou senha incorretos. Verifique seus dados e tente novamente.', 'error');
          } else {
            showAuthAlert(mapAuthErrorMessage(error), 'error');
          }
        }
      } else if (authMode === 'signup') {
        if (!fullName) {
          showAuthAlert('Informe seu nome completo para criar a conta.', 'error');
          return;
        }
        const policy = evaluatePasswordPolicy(password, { email });
        if (!policy.valid) {
          showAuthAlert(escapeHtml(policy.reason), 'error');
          pwdInput.focus();
          return;
        }
        if (password !== confirmPwd) {
          showAuthAlert('A confirmação de senha não coincide.', 'error');
          confirmInput?.focus();
          return;
        }

        const { error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: fullName }
          }
        });
        if (error) {
          showAuthAlert(mapAuthErrorMessage(error), 'error');
        } else {
          pwdInput.value = '';
          if (confirmInput) confirmInput.value = '';
          switchAuthMode('login');
          showAuthAlert(
            `<strong>Conta criada com sucesso!</strong> Enviamos um link de confirmação para <strong>${escapeHtml(email)}</strong> (verifique também a caixa de spam) e depois faça login abaixo.`,
            'success'
          );
        }
      } else if (authMode === 'reset') {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
          showAuthAlert(mapAuthErrorMessage(error), 'error');
        } else {
          showAuthAlert(`Se existir uma conta para <strong>${escapeHtml(email)}</strong>, enviaremos um link seguro de redefinição.`, 'success');
        }
      } else if (authMode === 'update_password') {
        const policy = evaluatePasswordPolicy(password, { email });
        if (!policy.valid) {
          showAuthAlert(escapeHtml(policy.reason), 'error');
          pwdInput.focus();
          return;
        }
        if (password !== confirmPwd) {
          showAuthAlert('A confirmação de senha não coincide.', 'error');
          confirmInput?.focus();
          return;
        }

        const { data, error } = await supabaseClient.auth.updateUser({ password });
        if (error) {
          showAuthAlert('Erro ao atualizar senha: ' + mapAuthErrorMessage(error), 'error');
        } else {
          pwdInput.value = '';
          if (confirmInput) confirmInput.value = '';
          if (window.location.hash || window.location.search.includes('code=')) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          onToast('Senha atualizada com sucesso!');
          switchAuthMode('login');
          authScreen.classList.add('hidden');
          if (data?.user) {
            loadedUserId = data.user.id;
            await onSessionReady(data.user);
          }
        }
      }
    } catch {
      showAuthAlert('Falha de conexão ao autenticar. Verifique sua internet e tente novamente.', 'error');
    } finally {
      isAuthBusy = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = getSubmitHtmlForMode(authMode);
      window.lucide?.createIcons();
    }
  });

  resendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;
    const redirectTo = window.location.origin + window.location.pathname;
    try {
      const { error } = await supabaseClient.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) {
        showAuthAlert('Erro ao reenviar: ' + mapAuthErrorMessage(error), 'error');
      } else {
        showAuthAlert(`Novo e-mail de confirmação enviado para <strong>${escapeHtml(email)}</strong>.`, 'success');
        resendBtn.classList.add('hidden');
      }
    } catch {
      showAuthAlert('Erro de rede ao reenviar confirmação.', 'error');
    }
  });

  async function performLogout(scope = 'local') {
    try {
      await supabaseClient.auth.signOut({ scope });
    } finally {
      loadedUserId = null;
      pwdInput.value = '';
      if (confirmInput) confirmInput.value = '';
      switchAuthMode('login');
      authScreen.classList.remove('hidden');
      onSignedOut();
      onToast(scope === 'global' ? 'Todas as sessões foram encerradas' : 'Sessão encerrada');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', () => performLogout('local'));
  document.getElementById('settingsLogoutBtn')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.add('hidden');
    performLogout('local');
  });

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      loadingOverlay.classList.add('hidden');
      authScreen.classList.remove('hidden');
      switchAuthMode('update_password');
      showAuthAlert('Defina sua nova senha forte abaixo para acessar o <strong>SaldoHoras</strong>.', 'warning');
      return;
    }

    if (event === 'SIGNED_OUT' || !session?.user) {
      loadedUserId = null;
      loadingOverlay.classList.add('hidden');
      authScreen.classList.remove('hidden');
      onSignedOut();
      return;
    }

    if (event === 'USER_UPDATED' && loadedUserId === session.user.id) {
      onUserUpdated?.(session.user);
      return;
    }

    if (event === 'TOKEN_REFRESHED' && loadedUserId === session.user.id) {
      return;
    }

    if (loadedUserId === session.user.id && event === 'SIGNED_IN') {
      authScreen.classList.add('hidden');
      return;
    }

    loadedUserId = session.user.id;
    authScreen.classList.add('hidden');
    await onSessionReady(session.user);
  });

  return { switchAuthMode, performLogout };
}
