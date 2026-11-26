import { getLocalDateISO } from './config.js';
import { supabaseClient } from './db.js';
import { exportJSONBackup } from './export.js';
import { getActiveRuleSummary } from './rules-catalog.js';
import {
  evaluatePasswordPolicy,
  formatAuthTimestampBR,
  getUserInitials,
  mapAuthErrorMessage,
  renderPasswordStrengthUI,
  wirePasswordVisibilityToggle
} from './security.js';
import { formatHHMM } from './time.js';
import { runWithButtonLoading } from './modals.js';

export function createProfileManager(ctx) {
  let activeTab = 'perfil';

  const modal = document.getElementById('profileModal');
  const alertBox = document.getElementById('profileAlert');
  const nameInput = document.getElementById('profileNameInput');
  const newEmailInput = document.getElementById('profileNewEmail');
  const emailPwdInput = document.getElementById('profileEmailPassword');
  const curPwdInput = document.getElementById('profileCurrentPassword');
  const newPwdInput = document.getElementById('profileNewPassword');
  const confirmPwdInput = document.getElementById('profileConfirmPassword');
  const pwdMatchHint = document.getElementById('profilePwdMatchHint');

  const resetEmailPwdToggle = wirePasswordVisibilityToggle(
    document.getElementById('toggleProfileEmailPwdBtn'),
    emailPwdInput
  );
  const resetCurPwdToggle = wirePasswordVisibilityToggle(
    document.getElementById('toggleProfileCurrentPwdBtn'),
    curPwdInput
  );
  const resetNewPwdToggle = wirePasswordVisibilityToggle(
    document.getElementById('toggleProfileNewPwdBtn'),
    newPwdInput
  );
  const resetConfirmPwdToggle = wirePasswordVisibilityToggle(
    document.getElementById('toggleProfileConfirmPwdBtn'),
    confirmPwdInput
  );

  function showProfileAlert(message, type = 'info') {
    alertBox.classList.remove(
      'hidden',
      'bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800',
      'bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800',
      'bg-amber-50', 'text-amber-800', 'border-amber-200', 'dark:bg-amber-950/60', 'dark:text-amber-200', 'dark:border-amber-800',
      'bg-sky-50', 'text-sky-800', 'border-sky-200', 'dark:bg-sky-950/60', 'dark:text-sky-200', 'dark:border-sky-800'
    );
    if (type === 'success') {
      alertBox.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 'dark:bg-emerald-950/60', 'dark:text-emerald-200', 'dark:border-emerald-800');
    } else if (type === 'error') {
      alertBox.classList.add('bg-rose-50', 'text-rose-800', 'border-rose-200', 'dark:bg-rose-950/60', 'dark:text-rose-200', 'dark:border-rose-800');
    } else if (type === 'warning') {
      alertBox.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-200', 'dark:bg-amber-950/60', 'dark:text-amber-200', 'dark:border-amber-800');
    } else {
      alertBox.classList.add('bg-sky-50', 'text-sky-800', 'border-sky-200', 'dark:bg-sky-950/60', 'dark:text-sky-200', 'dark:border-sky-800');
    }
    alertBox.textContent = message;
  }

  function clearProfileAlert() {
    alertBox.classList.add('hidden');
    alertBox.textContent = '';
  }

  function clearSensitiveInputs() {
    emailPwdInput.value = '';
    curPwdInput.value = '';
    newPwdInput.value = '';
    confirmPwdInput.value = '';
    resetEmailPwdToggle?.();
    resetCurPwdToggle?.();
    resetNewPwdToggle?.();
    resetConfirmPwdToggle?.();
    refreshPasswordFeedback();
  }

  function refreshPasswordFeedback() {
    const user = ctx.getUser();
    const val = newPwdInput.value;
    const evaluation = evaluatePasswordPolicy(val, {
      email: user?.email || '',
      currentPassword: curPwdInput.value
    });

    renderPasswordStrengthUI(
      {
        barEl: document.getElementById('profilePwdStrengthBar'),
        labelEl: document.getElementById('profilePwdStrengthLabel'),
        listEl: document.getElementById('profilePwdRequirementsList')
      },
      evaluation,
      val.length > 0
    );

    const confirmVal = confirmPwdInput.value;
    if (!confirmVal) {
      pwdMatchHint.textContent = '';
      pwdMatchHint.className = 'text-[11px] min-h-[1rem]';
    } else if (val === confirmVal) {
      pwdMatchHint.textContent = 'As senhas coincidem ✓';
      pwdMatchHint.className = 'text-[11px] font-medium text-emerald-600 dark:text-emerald-400 min-h-[1rem]';
    } else {
      pwdMatchHint.textContent = 'A confirmação não coincide com a nova senha';
      pwdMatchHint.className = 'text-[11px] font-medium text-rose-600 dark:text-rose-400 min-h-[1rem]';
    }
  }

  function switchTab(tabName) {
    activeTab = tabName;
    clearProfileAlert();
    ['perfil', 'seguranca'].forEach((t) => {
      document.getElementById(`profilePanel-${t}`).classList.toggle('hidden', t !== tabName);
      const btn = document.getElementById(`profileTabBtn-${t}`);
      btn.className = t === tabName
        ? 'profile-tab-btn px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm transition'
        : 'profile-tab-btn px-3.5 py-2 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
    });
  }

  function syncProfileHeaderSummary() {
    const user = ctx.getUser();
    const settings = ctx.getSettings();
    const displayName = settings.userName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário';

    document.getElementById('profileModalAvatar').textContent = getUserInitials(displayName, user?.email || '');
    document.getElementById('profileModalDisplayName').textContent = displayName;
    document.getElementById('profileModalEmail').textContent = user?.email || '—';
    const hiddenUserEl = document.getElementById('profileUsernameHidden');
    if (hiddenUserEl) hiddenUserEl.value = user?.email || '';

    const statusBadge = document.getElementById('profileEmailStatusBadge');
    const isConfirmed = Boolean(user?.email_confirmed_at || user?.confirmed_at);
    statusBadge.textContent = isConfirmed ? 'E-mail verificado' : 'Aguardando confirmação';
    statusBadge.className = isConfirmed
      ? 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';

    document.getElementById('profileCreatedAt').textContent = formatAuthTimestampBR(user?.created_at);
    document.getElementById('profileLastLoginAt').textContent = formatAuthTimestampBR(user?.last_sign_in_at);
    document.getElementById('profileRuleSummary').textContent =
      `${getActiveRuleSummary(settings)} (${settings.stateUf || 'SP'}) • ${formatHHMM(settings.dailyMinutes)}/dia`;
  }

  function openProfileModal(defaultTab = 'perfil') {
    ctx.captureLastFocus();
    syncProfileHeaderSummary();
    const settings = ctx.getSettings();
    nameInput.value = settings.userName || '';
    newEmailInput.value = '';
    clearSensitiveInputs();
    switchTab(defaultTab);
    modal.classList.remove('hidden');
    window.lucide?.createIcons();
    if (window.innerWidth >= 768) {
      if (defaultTab === 'seguranca') curPwdInput.focus();
      else nameInput.focus();
    }
  }

  function closeProfileModal() {
    clearSensitiveInputs();
    clearProfileAlert();
    modal.classList.add('hidden');
    ctx.restoreLastFocus();
  }

  ctx.registerExternalModal('profileModal', closeProfileModal);

  document.getElementById('closeProfileModalBtn').addEventListener('click', closeProfileModal);
  document.getElementById('closeProfileFooterBtn').addEventListener('click', closeProfileModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeProfileModal();
  });

  document.querySelectorAll('.profile-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.profileTab));
  });

  document.getElementById('profileOpenSettingsBtn').addEventListener('click', () => {
    closeProfileModal();
    ctx.openSettingsModal();
  });

  curPwdInput.addEventListener('input', refreshPasswordFeedback);
  newPwdInput.addEventListener('input', refreshPasswordFeedback);
  confirmPwdInput.addEventListener('input', refreshPasswordFeedback);

  // Salvar Nome do Perfil (sincroniza bh_params + Supabase Auth user_metadata)
  document.getElementById('profileIdentityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearProfileAlert();
    const user = ctx.getUser();
    if (!user) return;
    const cleanName = nameInput.value.trim();
    if (!cleanName) {
      showProfileAlert('Informe um nome válido para exibição.', 'error');
      nameInput.focus();
      return;
    }

    const btn = document.getElementById('profileSaveNameBtn');
    await runWithButtonLoading(btn, 'Salvando...', async () => {
      const ok = await ctx.saveSettings({ ...ctx.getSettings(), userName: cleanName }, { silentToast: true });
      if (!ok) return;

      const { data, error } = await supabaseClient.auth.updateUser({
        data: { full_name: cleanName }
      });
      if (error) {
        showProfileAlert(`Nome salvo nos parâmetros, mas houve aviso no Auth: ${mapAuthErrorMessage(error)}`, 'warning');
      } else if (data?.user) {
        ctx.setUser(data.user);
      }
      syncProfileHeaderSummary();
      showProfileAlert('Nome do perfil atualizado com sucesso!', 'success');
      ctx.showToast('Perfil atualizado!');
    });
  });

  // Solicitar alteração de E-mail com reautenticação prévia
  document.getElementById('profileEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearProfileAlert();
    const user = ctx.getUser();
    if (!user?.email) return;

    const nextEmail = newEmailInput.value.trim().toLowerCase();
    const currentPwd = emailPwdInput.value;

    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      showProfileAlert('Informe um endereço de e-mail válido.', 'error');
      newEmailInput.focus();
      return;
    }
    if (nextEmail === user.email.toLowerCase()) {
      showProfileAlert('O novo e-mail precisa ser diferente do e-mail atual.', 'error');
      newEmailInput.focus();
      return;
    }
    if (!currentPwd) {
      showProfileAlert('Por segurança, informe sua senha atual para alterar o e-mail.', 'error');
      emailPwdInput.focus();
      return;
    }

    const btn = document.getElementById('profileSaveEmailBtn');
    await runWithButtonLoading(btn, 'Validando...', async () => {
      try {
        const { error: reauthErr } = await supabaseClient.auth.signInWithPassword({
          email: user.email,
          password: currentPwd
        });
        if (reauthErr) {
          showProfileAlert('Senha atual incorreta. A alteração de e-mail foi bloqueada.', 'error');
          emailPwdInput.focus();
          return;
        }

        const redirectTo = window.location.origin + window.location.pathname;
        const { error: updateErr } = await supabaseClient.auth.updateUser(
          { email: nextEmail },
          { emailRedirectTo: redirectTo }
        );
        if (updateErr) {
          showProfileAlert(mapAuthErrorMessage(updateErr), 'error');
          return;
        }

        newEmailInput.value = '';
        emailPwdInput.value = '';
        resetEmailPwdToggle?.();
        showProfileAlert(
          `Solicitação enviada! Confirme no(s) e-mail(s) enviado(s) para concluir a troca para ${nextEmail}.`,
          'success'
        );
        ctx.showToast('Link de confirmação enviado!');
      } catch {
        showProfileAlert('Falha de conexão ao solicitar alteração de e-mail.', 'error');
      } finally {
        emailPwdInput.value = '';
      }
    });
  });

  // Alterar Senha com reautenticação obrigatória, política de força e revogação de outras sessões
  document.getElementById('profilePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearProfileAlert();
    const user = ctx.getUser();
    if (!user?.email) return;

    const currentPwd = curPwdInput.value;
    const newPwd = newPwdInput.value;
    const confirmPwd = confirmPwdInput.value;
    const revokeOthers = Boolean(document.getElementById('profileRevokeOthersCheckbox')?.checked);

    if (!currentPwd) {
      showProfileAlert('Informe sua senha atual para confirmar sua identidade.', 'error');
      curPwdInput.focus();
      return;
    }

    const policy = evaluatePasswordPolicy(newPwd, {
      email: user.email,
      currentPassword: currentPwd
    });
    if (!policy.valid) {
      showProfileAlert(policy.reason || 'A nova senha não atende aos requisitos mínimos de segurança.', 'error');
      newPwdInput.focus();
      return;
    }

    if (newPwd !== confirmPwd) {
      showProfileAlert('A confirmação de senha não coincide com a nova senha.', 'error');
      confirmPwdInput.focus();
      return;
    }

    const btn = document.getElementById('profileSavePasswordBtn');
    await runWithButtonLoading(btn, 'Atualizando...', async () => {
      try {
        // 1. Reautenticação obrigatória (protege contra sessão deixada aberta)
        const { error: reauthErr } = await supabaseClient.auth.signInWithPassword({
          email: user.email,
          password: currentPwd
        });
        if (reauthErr) {
          showProfileAlert('Senha atual incorreta. Nenhuma alteração foi realizada.', 'error');
          curPwdInput.focus();
          return;
        }

        // 2. Atualização segura da senha no Supabase Auth
        const { data, error: updateErr } = await supabaseClient.auth.updateUser({
          password: newPwd
        });
        if (updateErr) {
          showProfileAlert(mapAuthErrorMessage(updateErr), 'error');
          return;
        }
        if (data?.user) {
          ctx.setUser(data.user);
        }

        // 3. Revoga tokens de outros dispositivos se marcado (mantém sessão atual)
        let sessionMsg = '';
        if (revokeOthers) {
          const { error: revokeErr } = await supabaseClient.auth.signOut({ scope: 'others' });
          sessionMsg = revokeErr
            ? ' (aviso: não foi possível encerrar sessões remotas)'
            : ' Outras sessões foram desconectadas.';
        }

        clearSensitiveInputs();
        showProfileAlert(`Senha alterada com segurança!${sessionMsg}`, 'success');
        ctx.showToast('Senha alterada com segurança!');
      } catch {
        showProfileAlert('Erro de rede ao alterar a senha. Tente novamente.', 'error');
      }
    });
  });

  document.getElementById('profileForgotCurrentPwdBtn').addEventListener('click', async () => {
    const user = ctx.getUser();
    if (!user?.email) return;
    const ok = await ctx.confirmDialog({
      title: 'Enviar redefinição por e-mail?',
      message: `Enviaremos um link seguro de recuperação de senha para ${user.email}.`,
      confirmText: 'Enviar link',
      cancelText: 'Cancelar',
      variant: 'primary'
    });
    if (!ok) return;

    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) {
        showProfileAlert(mapAuthErrorMessage(error), 'error');
      } else {
        showProfileAlert(`Link de recuperação enviado para ${user.email}.`, 'success');
        ctx.showToast('E-mail de recuperação enviado!');
      }
    } catch {
      showProfileAlert('Falha de conexão ao enviar e-mail de recuperação.', 'error');
    }
  });

  document.getElementById('profileRevokeOthersBtn').addEventListener('click', async () => {
    const ok = await ctx.confirmDialog({
      title: 'Desconectar outros dispositivos?',
      message: 'Todos os outros navegadores e celulares conectados serão desconectados, mantendo apenas esta sessão atual.',
      confirmText: 'Desconectar outros',
      cancelText: 'Cancelar',
      variant: 'warning'
    });
    if (!ok) return;

    try {
      const { error } = await supabaseClient.auth.signOut({ scope: 'others' });
      if (error) {
        showProfileAlert(mapAuthErrorMessage(error), 'error');
      } else {
        showProfileAlert('Todas as outras sessões foram encerradas com sucesso.', 'success');
        ctx.showToast('Outras sessões encerradas!');
      }
    } catch {
      showProfileAlert('Erro de conexão ao encerrar sessões remotas.', 'error');
    }
  });

  document.getElementById('profileLogoutGlobalBtn').addEventListener('click', async () => {
    const ok = await ctx.confirmDialog({
      title: 'Sair de todos os dispositivos?',
      message: `Sua sessão será encerrada aqui (${getLocalDateISO()}) e em qualquer outro navegador ou celular logado na sua conta.`,
      confirmText: 'Sair de tudo',
      cancelText: 'Cancelar',
      variant: 'danger'
    });
    if (!ok) return;
    closeProfileModal();
    await ctx.onLogout('global');
  });

  document.getElementById('profileLogoutLocalBtn').addEventListener('click', async () => {
    closeProfileModal();
    await ctx.onLogout('local');
  });

  document.getElementById('profileExportJsonBtn').addEventListener('click', () => {
    exportJSONBackup(ctx.getSettings(), ctx.getEntries());
    ctx.showToast('Backup JSON baixado!');
  });

  return {
    openProfileModal,
    closeProfileModal,
    syncProfileHeaderSummary
  };
}
