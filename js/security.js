import { escapeHtml } from './config.js';

const COMMON_WEAK_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '00000000',
  '11111111',
  'password',
  'password123',
  'qwertyui',
  'qwerty123',
  'abc12345',
  'admin123',
  'saldohoras',
  'saldohoras123',
  'mudar123',
  'trocar123'
]);

/**
 * Avalia força e conformidade de senha conforme boas práticas (OWASP / NIST SP 800-63B).
 */
export function evaluatePasswordPolicy(password, { email = '', currentPassword = '' } = {}) {
  const pwd = String(password || '');
  const lowerPwd = pwd.toLowerCase();
  const emailLocal = String(email || '').split('@')[0]?.trim().toLowerCase() || '';

  const hasLower = /[a-z]/.test(pwd);
  const hasUpper = /[A-Z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(pwd);
  const groupCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  const minLength = pwd.length >= 8;
  const longPassphrase = pwd.length >= 12 && groupCount >= 2;
  const hasVariety = groupCount >= 3 || longPassphrase;
  const notCommon = pwd.length > 0 && !COMMON_WEAK_PASSWORDS.has(lowerPwd) && !/^(.)\1{5,}$/.test(pwd);
  const notEmailLocal = !emailLocal || emailLocal.length < 3 || !lowerPwd.includes(emailLocal);
  const differsFromCurrent = !currentPassword || pwd !== String(currentPassword);

  const checks = {
    minLength,
    hasUpperLower: hasLower && hasUpper,
    hasDigit,
    hasSymbol,
    hasVariety,
    notTrivial: notCommon && notEmailLocal,
    differsFromCurrent
  };

  let score = 0;
  if (minLength) score += 1;
  if (groupCount >= 3) score += 1;
  if ((hasLower && hasUpper && hasDigit) || pwd.length >= 12) score += 1;
  if (hasSymbol && pwd.length >= 10) score += 1;
  if (!checks.notTrivial || !differsFromCurrent) score = Math.min(score, 1);

  const valid = Boolean(minLength && checks.hasVariety && checks.notTrivial && differsFromCurrent);

  const labels = ['Muito fraca', 'Fraca', 'Média', 'Forte', 'Muito forte'];
  const colors = [
    'bg-rose-500',
    'bg-rose-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-indigo-600'
  ];

  let reason = '';
  if (!minLength) reason = 'Use no mínimo 8 caracteres.';
  else if (!differsFromCurrent) reason = 'A nova senha deve ser diferente da senha atual.';
  else if (!checks.notTrivial) reason = 'Evite senhas comuns, repetitivas ou parte do seu e-mail.';
  else if (!checks.hasVariety) reason = 'Combine ao menos 3 tipos (maiúsculas, minúsculas, números ou símbolos) ou use 12+ caracteres.';

  return {
    score,
    label: pwd ? labels[score] : 'Aguardando',
    barColor: pwd ? colors[score] : 'bg-slate-200 dark:bg-slate-700',
    valid,
    reason,
    checks
  };
}

/**
 * Atualiza a UI do medidor de força de senha (usado no Auth e no Perfil).
 */
export function renderPasswordStrengthUI({ barEl, labelEl, listEl }, evaluation, hasValue) {
  if (!barEl || !labelEl) return;
  const pct = hasValue ? Math.max(15, Math.min(100, (evaluation.score / 4) * 100)) : 0;
  barEl.style.width = `${pct}%`;
  barEl.className = `h-full rounded-full transition-all duration-200 ${evaluation.barColor}`;
  labelEl.textContent = hasValue ? `Força: ${evaluation.label}` : 'Força: —';

  if (listEl) {
    const items = [
      { ok: evaluation.checks.minLength, text: 'Mínimo 8 caracteres' },
      { ok: evaluation.checks.hasUpperLower, text: 'Maiúsculas e minúsculas' },
      { ok: evaluation.checks.hasDigit, text: 'Ao menos 1 número' },
      { ok: evaluation.checks.hasSymbol || evaluation.valid, text: 'Símbolo ou frase longa (12+)' },
      { ok: evaluation.checks.notTrivial && evaluation.checks.differsFromCurrent, text: 'Sem sequências óbvias ou igual à atual' }
    ];
    listEl.innerHTML = items.map((item) => `
      <li class="flex items-center gap-1.5 ${hasValue && item.ok ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-500 dark:text-slate-400'}">
        <span aria-hidden="true">${hasValue && item.ok ? '✓' : '•'}</span>
        <span>${escapeHtml(item.text)}</span>
      </li>
    `).join('');
  }
}

/**
 * Retorna 1 ou 2 iniciais maiúsculas para avatar de perfil.
 */
export function getUserInitials(name = '', email = '') {
  const cleanName = String(name || '').trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const cleanEmail = String(email || '').trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();
  return 'SH';
}

/**
 * Formata timestamps ISO vindos do Supabase Auth em data/hora legível local.
 */
export function formatAuthTimestampBR(isoString) {
  if (!isoString) return '—';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Converte mensagens técnicas de autenticação em mensagens seguras em PT-BR.
 */
export function mapAuthErrorMessage(error, fallback = 'Não foi possível concluir a operação. Tente novamente.') {
  const msg = String(error?.message || '').toLowerCase();
  if (!msg) return fallback;
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada ou spam.';
  }
  if (msg.includes('same_password') || msg.includes('new password should be different')) {
    return 'A nova senha precisa ser diferente da senha atual.';
  }
  if (msg.includes('password') && (msg.includes('weak') || msg.includes('at least') || msg.includes('length'))) {
    return 'A senha não atende aos requisitos mínimos de segurança.';
  }
  if (msg.includes('unable to validate email') || msg.includes('invalid format') || msg.includes('invalid email')) {
    return 'Informe um endereço de e-mail válido.';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('email rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente de novo.';
  }
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
    return 'Já existe uma conta com este e-mail. Tente entrar ou recuperar sua senha.';
  }
  if (msg.includes('user not found')) {
    return 'Não encontramos uma conta com este e-mail.';
  }
  if (msg.includes('expired') || msg.includes('invalid token') || msg.includes('otp')) {
    return 'Este link expirou ou já foi usado. Solicite um novo link.';
  }
  if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed')) {
    return 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
  }
  if (msg.includes('reauthentication')) {
    return 'Por segurança, confirme sua senha atual antes de prosseguir.';
  }
  return fallback;
}

/**
 * Alterna visibilidade de campo de senha mantendo acessibilidade ARIA.
 */
export function wirePasswordVisibilityToggle(buttonEl, inputEl) {
  if (!buttonEl || !inputEl) return;
  const syncIcon = (showing) => {
    inputEl.type = showing ? 'text' : 'password';
    buttonEl.setAttribute('aria-label', showing ? 'Ocultar senha' : 'Mostrar senha');
    buttonEl.setAttribute('aria-pressed', String(showing));
    buttonEl.innerHTML = showing
      ? '<i data-lucide="eye-off" class="w-4 h-4"></i>'
      : '<i data-lucide="eye" class="w-4 h-4"></i>';
    window.lucide?.createIcons();
  };

  buttonEl.addEventListener('click', () => {
    syncIcon(inputEl.type !== 'text');
  });

  return () => syncIcon(false);
}
