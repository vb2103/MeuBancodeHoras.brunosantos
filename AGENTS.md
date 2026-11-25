# SaldoHoras — Contexto Permanente do Projeto

## Arquitetura & Hospedagem
- **Aplicação:** SaldoHoras — Controle de Banco de Horas, Feriados & Folgas.
- **Hospedagem:** GitHub Pages (`vb2103/MeuBancodeHoras.brunosantos`, branch `main`), 100% estática via ES Modules (`<script type="module">`) sem exigir runtime de servidor.
- **Caminhos:** Sempre usar caminhos relativos (`./`) para assets, `manifest.json`, `sw.js` e imports ES devido ao subpath `/MeuBancodeHoras.brunosantos/` no GitHub Pages.
- **Backend:** Supabase (`https://opctsxkugbljvghcgnvj.supabase.co`), tabelas `public.bh_params` e `public.bh_entries` com RLS (`auth.uid() = user_id`).

## Estrutura de Módulos
- `js/config.js`: Credenciais públicas Supabase, UFs, chaves de storage e utilitários de data local (`America/Sao_Paulo` / fuso do navegador).
- `js/time.js`: Motor puro em minutos inteiros (`HH:MM`), parser flexível (`01:30`, `1.5`, `90m`), cálculos de saldo, multiplicadores e ordenação determinística.
- `js/rules-catalog.js`: Catálogo de Sindicatos e Ramos de Empresa (jornada, multiplicadores, validade, UF).
- `js/holidays.js`: Calendário dinâmico de feriados brasileiros (BrasilAPI + cache `localStorage` + cálculo algorítmico offline de Páscoa/móveis/estaduais).
- `js/db.js`: Camada de acesso ao Supabase (mapeamento completo incluindo `minutes`, `worked_minutes`, `multiplier`, `category`, `daily_minutes`, regras sindicais e upsert em lote).
- `js/auth.js`: Fluxos Supabase Auth com filtro de eventos (`onAuthStateChange`).
- `js/modals.js`: Modais próprios acessíveis (confirmação sem `window.confirm`, lançamento, parâmetros), suporte a `ESC`, backdrop e tema claro/escuro.
- `js/charts.js`: Gráficos Chart.js em `HH:MM` adaptados ao tema.
- `js/export.js`: Exportação PDF, CSV, JSON com validação rigorosa e templates E-mail/WhatsApp.
- `js/app.js`: Orquestração da UI, filtros, abas e estado da aplicação.

## Regras de Ouro
1. **Precisão em Minutos (`HH:MM`) & Tudo Vira Banco de Horas:** Realizar todos os cálculos em minutos inteiros (sem valores financeiros/monetários) e enviar `minutes` (`NOT NULL`) e `daily_minutes` (`NOT NULL`) em todos os upserts no Supabase. Para **SINDPD-SP** e perfis vinculados, feriado trabalhado vale **`1.4x` (`+40%` em horas)**: `01:00` = `01:24` e `08:00` = `11:12`.
2. **Datas Locais:** Nunca usar `new Date().toISOString().split('T')[0]` para a data atual; usar `getLocalDateISO()`.
3. **Sem Diálogos Nativos:** Nunca usar `window.alert()` ou `window.confirm()`; usar os modais próprios de `js/modals.js`.
4. **Integridade de Dados:** Nunca apagar ou sobrescrever lançamentos existentes do usuário ao consultar/adicionar feriados; sempre sincronizar com rollback em caso de erro de rede.
5. **Segurança XSS:** Sempre aplicar `escapeHtml()` antes de inserir textos de usuário em HTML dinâmico.
