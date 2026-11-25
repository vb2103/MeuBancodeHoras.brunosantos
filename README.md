# SaldoHoras — Banco de Horas & Folgas

Aplicação web modular (100% estática para **GitHub Pages**) para controle de **banco de horas em `HH:MM`, feriados dinâmicos, regras por sindicato/ramo e folgas compensatórias**, com autenticação e sincronização em nuvem via **Supabase**.

## Funcionalidades
- **Autenticação completa:** Cadastro com confirmação de e-mail, login, recuperação/redefinição de senha e isolamento por usuário (RLS).
- **Motor `HH:MM` em minutos inteiros:** Lançamentos, multiplicadores, jornada configurável, saldo acumulado determinístico e controle de vencimentos via FIFO.
- **Sindicato ou Ramo da Empresa:** Preenchimento automático de jornada, multiplicadores (extra/feriado), UF e prazo de validade (editável manualmente).
- **Calendário dinâmico de feriados:** Navegação entre anos, suporte às 27 UFs, consulta via BrasilAPI + cache local + cálculo algorítmico offline, com adição seletiva sem apagar dados existentes.
- **Gráficos, Simulador & Comunicação RH:** Evolução do saldo, proporção créditos/folgas, simulador de dias de descanso e modelos editáveis para E-mail (`mailto:`) e WhatsApp (`wa.me`).
- **Exportação & PWA:** Relatório executivo **PDF**, planilha **CSV**, backup/restauração **JSON** validado, modais próprios acessíveis e Service Worker (`./sw.js`).
