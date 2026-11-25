import { escapeHtml } from './config.js';
import { supabaseClient } from './db.js';

export function setupAuth({ onSessionReady, onSignedOut, onToast }) {
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
  const forgotBtn = document.getElementById('forgotPwdBtn');
  const submitBtn = document.getElementById('authSubmitBtn');
  const backBtn = document.getElementById('backToLoginBtn');
  const authTabs = document.getElementById('authTabs');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const togglePwdBtn = document.getElementById('toggleAuthPwdBtn');

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
      pwdInput.autocomplete = 'current-password';
      pwdInput.placeholder = 'Mínimo 6 caracteres';
      backBtn.classList.add('hidden');
    } else if (mode === 'signup') {
      authTabs.classList.remove('hidden');
      tabSignup.className = 'py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition';
      tabLogin.className = 'py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      nameWrap.classList.remove('hidden');
      pwdWrap.classList.remove('hidden');
      pwdInput.required = true;
      pwdInput.autocomplete = 'new-password';
      pwdInput.placeholder = 'Mínimo 6 caracteres';
      backBtn.classList.add('hidden');
    } else if (mode === 'reset') {
      authTabs.classList.add('hidden');
      nameWrap.classList.add('hidden');
      pwdWrap.classList.add('hidden');
      pwdInput.required = false;
      backBtn.classList.remove('hidden');
    } else if (mode === 'update_password') {
      authTabs.classList.add('hidden');
      nameWrap.classList.add('hidden');
      emailWrap.classList.add('hidden');
      emailInput.required = false;
      forgotBtn.classList.add('hidden');
      pwdWrap.classList.remove('hidden');
      pwdInput.required = true;
      pwdInput.autocomplete = 'new-password';
      pwdInput.value = '';
      pwdInput.placeholder = 'Digite sua nova senha (mín. 6 caracteres)';
      backBtn.classList.add('hidden');
    }

    pwdInput.type = 'password';
    if (togglePwdBtn) {
      togglePwdBtn.setAttribute('aria-label', 'Mostrar senha');
      togglePwdBtn.setAttribute('aria-pressed', 'false');
      togglePwdBtn.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
    }
    submitBtn.innerHTML = getSubmitHtmlForMode(mode);
    window.lucide?.createIcons();
  }

  togglePwdBtn?.addEventListener('click', () => {
    const showing = pwdInput.type === 'text';
    pwdInput.type = showing ? 'password' : 'text';
    togglePwdBtn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    togglePwdBtn.setAttribute('aria-pressed', String(!showing));
    togglePwdBtn.innerHTML = showing
      ? '<i data-lucide="eye" class="w-4 h-4"></i>'
      : '<i data-lucide="eye-off" class="w-4 h-4"></i>';
    window.lucide?.createIcons();
  });

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
            showAuthAlert(escapeHtml(error.message), 'error');
          }
        }
      } else if (authMode === 'signup') {
        if (!fullName) {
          showAuthAlert('Informe seu nome completo para criar a conta.', 'error');
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
          showAuthAlert(escapeHtml(error.message), 'error');
        } else {
          switchAuthMode('login');
          showAuthAlert(
            `<strong>Conta criada com sucesso!</strong> Enviamos um link de confirmação para <strong>${escapeHtml(email)}</strong> (verifique também a caixa de spam) e depois faça login abaixo.`,
            'success'
          );
        }
      } else if (authMode === 'reset') {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
          showAuthAlert(escapeHtml(error.message), 'error');
        } else {
          showAuthAlert(`Enviamos um link de redefinição de senha para <strong>${escapeHtml(email)}</strong>.`, 'success');
        }
      } else if (authMode === 'update_password') {
        const { data, error } = await supabaseClient.auth.updateUser({ password });
        if (error) {
          showAuthAlert('Erro ao atualizar senha: ' + escapeHtml(error.message), 'error');
        } else {
          onToast('Senha atualizada com sucesso!');
          switchAuthMode('login');
          authScreen.classList.add('hidden');
          if (data?.user) {
            loadedUserId = data.user.id;
            await onSessionReady(data.user);
          }
        }
      }
    } catch (err) {
      showAuthAlert('Falha de conexão ao autenticar. Verifique sua internet e tente novamente.', 'error');
    } finally {
      isAuthBusy = false;
      submitBtn.disabled = false;
      // Garante que o botão sempre exiba o rótulo correspondente ao modo ATUAL (corrige bug pós-signup)
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
        showAuthAlert('Erro ao reenviar: ' + escapeHtml(error.message), 'error');
      } else {
        showAuthAlert(`Novo e-mail de confirmação enviado para <strong>${escapeHtml(email)}</strong>.`, 'success');
        resendBtn.classList.add('hidden');
      }
    } catch {
      showAuthAlert('Erro de rede ao reenviar confirmação.', 'error');
    }
  });

  async function performLogout() {
    try {
      await supabaseClient.auth.signOut();
    } finally {
      loadedUserId = null;
      switchAuthMode('login');
      authScreen.classList.remove('hidden');
      onSignedOut();
      onToast('Sessão encerrada');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', performLogout);
  document.getElementById('settingsLogoutBtn')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.add('hidden');
    performLogout();
  });

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      loadingOverlay.classList.add('hidden');
      authScreen.classList.remove('hidden');
      switchAuthMode('update_password');
      showAuthAlert('Defina sua nova senha abaixo para acessar o <strong>SaldoHoras</strong>.', 'warning');
      return;
    }

    if (event === 'SIGNED_OUT' || !session?.user) {
      loadedUserId = null;
      loadingOverlay.classList.add('hidden');
      authScreen.classList.remove('hidden');
      onSignedOut();
      return;
    }

    // Evita recarregar todo o painel em renovações silenciosas de token
    if (event === 'TOKEN_REFRESHED' && loadedUserId === session.user.id) {
      return;
    }

    // Evita recarregar duas vezes no mesmo usuário já ativo durante o boot
    if (loadedUserId === session.user.id && event === 'SIGNED_IN') {
      authScreen.classList.add('hidden');
      return;
    }

    loadedUserId = session.user.id;
    authScreen.classList.add('hidden');
    await onSessionReady(session.user);
  });

  return { switchAuthMode };
}
