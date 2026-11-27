import { escapeHtml, getAppRedirectUrl } from './config.js';
import { supabaseClient } from './db.js';
import {
  evaluatePasswordPolicy,
  mapAuthErrorMessage,
  renderPasswordStrengthUI,
  wirePasswordVisibilityToggle
} from './security.js';
import {
  clearAllInlineErrors,
  closeAnimatedModal,
  openAnimatedModal,
  prefersReducedMotion,
  readCssMs,
  renderLucideIcons,
  syncSlidingTabs,
  triggerInlineFieldError
} from './ui-motion.js';

export function setupAuth({
  onSessionReady,
  onUserUpdated,
  onBeforeLogout,
  onSignedOut,
  onToast,
  onEnterGuestMode,
  shouldRestoreGuest,
  initialMode = null,
  onAuthModalOpen
}) {
  const requestedInitialMode = initialMode === 'signup' || initialMode === 'login' || initialMode === 'guest'
    ? initialMode
    : null;
  let authMode = requestedInitialMode === 'signup' ? 'signup' : 'login'; // 'login' | 'signup' | 'reset' | 'update_password'
  let consumedInitialModeRedirect = false;
  let loadedUserId = null;
  let isAuthBusy = false;
  let explicitLogoutInFlight = false;

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

  function revealLoadingOverlay() {
    if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
    if (prefersReducedMotion()) {
      loadingOverlay.classList.add('hidden');
      loadingOverlay.classList.remove('is-revealed');
      return;
    }
    loadingOverlay.classList.add('is-revealed');
    const ms = readCssMs('--reveal-dur', 400) + 20;
    setTimeout(() => {
      loadingOverlay.classList.add('hidden');
      loadingOverlay.classList.remove('is-revealed');
    }, ms);
  }

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
    clearAllInlineErrors(authScreen);
    authAlert.classList.add('hidden');
    resendBtn.classList.add('hidden');
    emailWrap.classList.remove('hidden');
    emailInput.required = true;
    forgotBtn.classList.remove('hidden');

    if (mode === 'login') {
      authTabs.classList.remove('hidden');
      tabLogin.setAttribute('aria-selected', 'true');
      tabSignup.setAttribute('aria-selected', 'false');
      tabLogin.className = 't-tab sh-touch-h44 py-2 rounded-lg text-slate-900 dark:text-white font-semibold';
      tabSignup.className = 't-tab sh-touch-h44 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
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
      tabSignup.setAttribute('aria-selected', 'true');
      tabLogin.setAttribute('aria-selected', 'false');
      tabSignup.className = 't-tab sh-touch-h44 py-2 rounded-lg text-slate-900 dark:text-white font-semibold';
      tabLogin.className = 't-tab sh-touch-h44 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
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
    renderLucideIcons(authScreen);
    if (!authTabs.classList.contains('hidden')) {
      syncSlidingTabs(authTabs, mode === 'signup' ? tabSignup : tabLogin, {
        animate: !authScreen.classList.contains('hidden')
      });
    }
  }

  window.addEventListener('resize', () => {
    if (!authScreen.classList.contains('hidden') && !authTabs.classList.contains('hidden')) {
      syncSlidingTabs(authTabs, authMode === 'signup' ? tabSignup : tabLogin, { animate: false });
    }
  });

  pwdInput.addEventListener('input', updateAuthStrengthFeedback);
  emailInput.addEventListener('input', updateAuthStrengthFeedback);
  tabLogin.addEventListener('click', () => switchAuthMode('login'));
  tabSignup.addEventListener('click', () => switchAuthMode('signup'));
  forgotBtn.addEventListener('click', () => switchAuthMode('reset'));
  backBtn.addEventListener('click', () => switchAuthMode('login'));

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isAuthBusy) return;
    clearAllInlineErrors(authScreen);
    authAlert.classList.add('hidden');

    const email = emailInput.value.trim();
    const password = pwdInput.value;
    const confirmPwd = confirmInput?.value || '';
    const fullName = document.getElementById('authName').value.trim();

    if (authMode !== 'update_password' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      triggerInlineFieldError(emailWrap, emailInput, 'Informe um e-mail válido (ex.: voce@empresa.com.br).');
      return;
    }

    if (authMode === 'signup') {
      if (!fullName) {
        triggerInlineFieldError(nameWrap, 'authName', 'Informe seu nome completo para criar a conta.');
        return;
      }
      const policy = evaluatePasswordPolicy(password, { email });
      if (!policy.valid) {
        triggerInlineFieldError(pwdWrap, pwdInput, policy.reason || 'A senha precisa atender aos critérios abaixo.');
        return;
      }
      if (password !== confirmPwd) {
        triggerInlineFieldError(confirmWrap, confirmInput, 'As duas senhas precisam ser iguais.');
        return;
      }
    } else if (authMode === 'update_password') {
      const policy = evaluatePasswordPolicy(password, { email });
      if (!policy.valid) {
        triggerInlineFieldError(pwdWrap, pwdInput, policy.reason || 'A senha precisa atender aos critérios abaixo.');
        return;
      }
      if (password !== confirmPwd) {
        triggerInlineFieldError(confirmWrap, confirmInput, 'As duas senhas precisam ser iguais.');
        return;
      }
    } else if (authMode === 'login' && !password) {
      triggerInlineFieldError(pwdWrap, pwdInput, 'Digite sua senha para entrar.');
      return;
    }

    isAuthBusy = true;
    resendBtn.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Processando...';

    try {
      const redirectTo = getAppRedirectUrl();

      if (authMode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('email not confirmed')) {
            showAuthAlert('<strong>E-mail ainda não confirmado.</strong> Verifique sua caixa de entrada (ou spam) e clique no link enviado antes de entrar.', 'warning');
            resendBtn.classList.remove('hidden');
          } else if (msg.includes('invalid login credentials')) {
            triggerInlineFieldError(pwdWrap, pwdInput, 'E-mail ou senha incorretos. Confira e tente novamente.');
            showAuthAlert('E-mail ou senha incorretos. Verifique seus dados ou use "Esqueci a senha".', 'error');
          } else {
            showAuthAlert(mapAuthErrorMessage(error), 'error');
          }
        }
      } else if (authMode === 'signup') {
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
          showAuthAlert(`Enviamos um link de redefinição para <strong>${escapeHtml(email)}</strong>. Confira também a caixa de spam.`, 'success');
        }
      } else if (authMode === 'update_password') {
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
          closeAnimatedModal(authScreen);
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
      renderLucideIcons(authScreen);
    }
  });

  resendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;
    const redirectTo = getAppRedirectUrl();
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
    if (explicitLogoutInFlight) return false;
    if (typeof onBeforeLogout === 'function') {
      const allowed = await onBeforeLogout(scope);
      if (allowed === false) return false;
    }

    explicitLogoutInFlight = true;
    try {
      await supabaseClient.auth.signOut({ scope });
    } catch {
      await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => null);
    } finally {
      loadedUserId = null;
      emailInput.value = '';
      const authNameEl = document.getElementById('authName');
      if (authNameEl) authNameEl.value = '';
      pwdInput.value = '';
      if (confirmInput) confirmInput.value = '';
      switchAuthMode('login');
      await onSignedOut({ clearStorage: true });
      openAnimatedModal(authScreen);
      requestAnimationFrame(() => syncSlidingTabs(authTabs, tabLogin, { animate: false }));
      onToast(scope === 'global' ? 'Todas as sessões foram encerradas' : 'Sessão encerrada');
      explicitLogoutInFlight = false;
    }
    return true;
  }

  document.getElementById('logoutBtn')?.addEventListener('click', () => performLogout('local'));
  document.getElementById('startGuestModeBtn')?.addEventListener('click', () => {
    closeAnimatedModal(authScreen);
    onEnterGuestMode?.();
  });

  if (requestedInitialMode === 'signup' || requestedInitialMode === 'login') {
    switchAuthMode(requestedInitialMode);
  }

  function openAuthModal(targetMode = 'login') {
    switchAuthMode(targetMode);
    onAuthModalOpen?.({ mode: targetMode });
    openAnimatedModal(authScreen);
    requestAnimationFrame(() => syncSlidingTabs(authTabs, targetMode === 'signup' ? tabSignup : tabLogin, { animate: false }));
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      revealLoadingOverlay();
      onAuthModalOpen?.({ mode: 'update_password' });
      openAnimatedModal(authScreen);
      switchAuthMode('update_password');
      showAuthAlert('Defina sua nova senha forte abaixo para acessar o aplicativo.', 'warning');
      return;
    }

    if (event === 'SIGNED_OUT' || !session?.user) {
      loadedUserId = null;
      revealLoadingOverlay();
      if (explicitLogoutInFlight) {
        return;
      }
      if (event !== 'SIGNED_OUT' && !consumedInitialModeRedirect && requestedInitialMode === 'guest') {
        consumedInitialModeRedirect = true;
        onEnterGuestMode?.();
        return;
      }
      if (event !== 'SIGNED_OUT' && shouldRestoreGuest?.() && !requestedInitialMode) {
        onEnterGuestMode?.({ restoring: true });
        return;
      }
      if (!consumedInitialModeRedirect && (requestedInitialMode === 'signup' || requestedInitialMode === 'login')) {
        consumedInitialModeRedirect = true;
        switchAuthMode(requestedInitialMode);
      }
      emailInput.value = '';
      pwdInput.value = '';
      if (confirmInput) confirmInput.value = '';
      await onSignedOut({ clearStorage: event === 'SIGNED_OUT' });
      onAuthModalOpen?.({ mode: authMode });
      openAnimatedModal(authScreen);
      requestAnimationFrame(() => syncSlidingTabs(authTabs, authMode === 'signup' ? tabSignup : tabLogin, { animate: false }));
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
      closeAnimatedModal(authScreen);
      return;
    }

    loadedUserId = session.user.id;
    closeAnimatedModal(authScreen);
    await onSessionReady(session.user, { event });
  });

  return { switchAuthMode, openAuthModal, performLogout, revealLoadingOverlay };
}
