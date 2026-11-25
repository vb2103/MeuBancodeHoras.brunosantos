/**
 * Catálogo de referência para Sindicatos / CCTs e Ramos da Empresa (Brasil).
 * Os parâmetros sugeridos preenchem automaticamente jornada (HH:MM), multiplicadores,
 * validade e UF padrão, podendo ser ajustados manualmente conforme acordo vigente.
 */

export const UNION_CATALOG = [
  {
    code: 'sindpd_sp',
    name: 'SINDPD-SP — Tecnologia da Informação (SP)',
    sector: 'tecnologia',
    stateUf: 'SP',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.4,
    expiryDays: 180,
    note: 'Regra SINDPD-SP (Banco de Horas): jornada 08:00/dia, hora extra 1.5x e feriado trabalhado 1.4x (+40% em horas: 01:00 = 01:24; 08:00 = 11:12).'
  },
  {
    code: 'ti_sindpd',
    name: 'SINDPD / TI — Referência Nacional',
    sector: 'tecnologia',
    stateUf: 'SP',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.4,
    expiryDays: 180,
    note: 'Referência SINDPD/TI (Banco de Horas): jornada 08:00/dia, hora extra 1.5x, feriado trabalhado 1.4x (+40% em horas) e prazo de 180 dias.'
  },
  {
    code: 'sindpd_rj',
    name: 'SINDPD-RJ — Tecnologia da Informação (RJ)',
    sector: 'tecnologia',
    stateUf: 'RJ',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência TI/RJ: jornada 08:00/dia, extra 1.5x, feriado 2.0x e validade 180 dias.'
  },
  {
    code: 'sindados_mg',
    name: 'SINDADOS-MG — Processamento de Dados (MG)',
    sector: 'tecnologia',
    stateUf: 'MG',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência TI/MG: jornada 08:00/dia, extra 1.5x, feriado 2.0x e validade 180 dias.'
  },
  {
    code: 'bancarios',
    name: 'Contraf / FENABAN — Categoria Bancária',
    sector: 'financeiro',
    stateUf: 'SP',
    dailyMinutes: 360,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência Bancários: jornada padrão 06:00/dia (30h/sem), extra 1.5x, feriado 2.0x.'
  },
  {
    code: 'comerciarios',
    name: 'Fecomerciários / SECOM — Comércio & Varejo',
    sector: 'comercio',
    stateUf: 'SP',
    dailyMinutes: 440,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    note: 'Referência Comércio: jornada 07:20/dia (44h/sem em 6 dias), folga compensatória de feriado 1.0x.'
  },
  {
    code: 'metalurgicos',
    name: 'CNTM / SMABC — Metalúrgicos & Indústria',
    sector: 'industria',
    stateUf: 'SP',
    dailyMinutes: 528,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 365,
    note: 'Referência Indústria (seg–sex 44h): 08:48/dia, extra 1.5x, feriado 2.0x e banco anual (365 dias).'
  },
  {
    code: 'saude',
    name: 'SINDHOSP / Saúde & Hospitais',
    sector: 'saude',
    stateUf: 'SP',
    dailyMinutes: 360,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência Saúde: jornada de 06:00/dia (36h/sem), ajuste livre para 12:00 em escalas 12x36.'
  },
  {
    code: 'callcenter',
    name: 'Sintratel — Telemarketing & Atendimento',
    sector: 'servicos',
    stateUf: 'SP',
    dailyMinutes: 372,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    note: 'Referência Atendimento (NR-17): 06:12/dia, extra 1.5x e compensação 1.0x.'
  },
  {
    code: 'logistica',
    name: 'Fetrolog — Transportes & Logística',
    sector: 'logistica',
    stateUf: 'SP',
    dailyMinutes: 528,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência Logística (seg–sex 44h): 08:48/dia, extra 1.5x e feriado 2.0x.'
  },
  {
    code: 'educacao',
    name: 'SINPRO — Professores & Ensino Privado',
    sector: 'educacao',
    stateUf: 'SP',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    note: 'Referência Ensino Privado: base 08:00/dia, extra 1.5x, feriado 2.0x e compensação semestral.'
  },
  {
    code: 'clt_individual',
    name: 'Acordo Individual CLT (Art. 59 §5º — 1:1)',
    sector: 'servicos',
    stateUf: 'SP',
    dailyMinutes: 480,
    overtimeMultiplier: 1.0,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    note: 'Banco de horas individual semestral (180 dias) com compensação simples 1:1.'
  },
  {
    code: 'outro',
    name: 'Outro Sindicato / Acordo Personalizado',
    sector: 'outro',
    stateUf: 'SP',
    dailyMinutes: 480,
    overtimeMultiplier: 1.0,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    note: 'Ajuste manualmente a jornada (HH:MM), multiplicadores e prazo de validade.'
  }
];

export const SECTOR_CATALOG = [
  {
    code: 'tecnologia',
    label: 'Tecnologia, Software & Dados',
    unionCode: 'sindpd_sp',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.4,
    expiryDays: 180,
    desc: 'Ramo de TI (ref. SINDPD-SP): jornada de 08:00/dia, extra 1.5x e feriado trabalhado 1.4x (+40% em banco de horas: 08:00 = 11:12).'
  },
  {
    code: 'comercio',
    label: 'Comércio, Varejo & Lojas',
    unionCode: 'comerciarios',
    dailyMinutes: 440,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    desc: 'Ramo do Comércio: sugerimos 07:20/dia (44h/sem em 6 dias) com compensação de feriados em folga.'
  },
  {
    code: 'industria',
    label: 'Indústria & Manufatura',
    unionCode: 'metalurgicos',
    dailyMinutes: 528,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 365,
    desc: 'Ramo Industrial: sugerimos 08:48/dia (44h seg–sex), extra 1.5x, feriado 2.0x e banco anual (365 dias).'
  },
  {
    code: 'saude',
    label: 'Saúde, Clínicas & Hospitais',
    unionCode: 'saude',
    dailyMinutes: 360,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    desc: 'Ramo da Saúde: sugerimos 06:00/dia (ou edite para 12:00 em escala 12x36).'
  },
  {
    code: 'financeiro',
    label: 'Bancos, Fintechs & Financeiro',
    unionCode: 'bancarios',
    dailyMinutes: 360,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    desc: 'Ramo Financeiro: sugerimos jornada padrão de 06:00/dia (30h/sem), extra 1.5x e feriado 2.0x.'
  },
  {
    code: 'logistica',
    label: 'Logística, Armazenagem & Transportes',
    unionCode: 'logistica',
    dailyMinutes: 528,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    desc: 'Ramo de Logística: sugerimos 08:48/dia (44h seg–sex), extra 1.5x e feriado 2.0x.'
  },
  {
    code: 'servicos',
    label: 'Serviços, Escritório & Administrativo',
    unionCode: 'sindpd_sp',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 1.4,
    expiryDays: 180,
    desc: 'Ramo de Serviços/Escritório (ref. SINDPD-SP): jornada 08:00/dia, extra 1.5x e feriado 1.4x (+40% em horas), editável conforme sua CCT.'
  },
  {
    code: 'educacao',
    label: 'Educação, Escolas & Treinamento',
    unionCode: 'educacao',
    dailyMinutes: 480,
    overtimeMultiplier: 1.5,
    holidayMultiplier: 2.0,
    expiryDays: 180,
    desc: 'Ramo Educacional: sugerimos 08:00/dia, extra 1.5x, feriado 2.0x e validade de 180 dias.'
  },
  {
    code: 'publico',
    label: 'Setor Público / Autarquia (1:1)',
    unionCode: 'clt_individual',
    dailyMinutes: 480,
    overtimeMultiplier: 1.0,
    holidayMultiplier: 1.0,
    expiryDays: 365,
    desc: 'Setor Público: compensação simples 1:1 (08:00/dia) com prazo estendido de 365 dias.'
  },
  {
    code: 'outro',
    label: 'Outro Ramo / Personalizado',
    unionCode: 'outro',
    dailyMinutes: 480,
    overtimeMultiplier: 1.0,
    holidayMultiplier: 1.0,
    expiryDays: 180,
    desc: 'Ramo personalizado: defina sua jornada diária em HH:MM e os multiplicadores desejados.'
  }
];

export function findUnionByCode(code) {
  return UNION_CATALOG.find((u) => u.code === code) || null;
}

export function findSectorByCode(code) {
  return SECTOR_CATALOG.find((s) => s.code === code) || null;
}

export function getActiveRuleSummary(settings) {
  if (settings.unionMode === 'union') {
    const u = findUnionByCode(settings.unionCode);
    return u ? u.name.split('—')[0].trim() : (settings.unionCode || 'Sindicato');
  }
  if (settings.unionMode === 'custom') {
    return 'Regra Personalizada';
  }
  const s = findSectorByCode(settings.companySector);
  return s ? s.label.split(',')[0].trim() : (settings.companySector || 'Ramo');
}
