# SaldoHoras — Documento de Produto (`PRODUCT.md`)

## Visão Geral
**SaldoHoras** é um aplicativo web estático (PWA) mobile-first projetado para trabalhadores brasileiros acompanharem seu **banco de horas em tempo real (`HH:MM`)** — sem valores monetários e sem jargões contábeis complexos.

## Enquadramento de Experiência (`Operate` Mode)
O produto opera como uma ferramenta utilitária diária:
- **Clareza e previsibilidade acima de ornamento:** números tabulares (`JetBrains Mono`), alto contraste entre ganhos (esmeralda), folgas/saídas (rosa) e prazos vencendo (âmbar).
- **Zero fricção em movimento:** registro pelo ponto (`Entrada`, `Saída`, turno noturno cruzando meia-noite e desconto de intervalo), atalhos rápidos (`30m`, `1h`, `2h`, `Meio dia`, `1 dia`) e consulta por card no celular.
- **Uso leigo seguro:** onboarding de 2 passos, saldo inicial ajustável, baixa limpa de horas vencidas mantendo trilha de auditoria e toast com botão `Desfazer` após exclusões.

## Regras de Negócio Imutáveis
1. **Precisão em minutos inteiros (`HH:MM`):** toda conversão usa aritmética inteira de minutos.
2. **Multiplicadores sindicais (SINDPD-SP e catálogo):** feriado trabalhado no perfil SINDPD-SP aplica fator `1.4x` (`+40%`), ex.: `08:00` trabalhadas = `+11:12` no banco.
3. **Ordem FIFO de vencimento:** débitos/folgas consomem sempre os créditos abertos que vencem mais cedo.
4. **Integridade no Supabase:** `minutes` (`NOT NULL`) e `daily_minutes` (`NOT NULL`) devem estar sempre presentes; RLS garante isolamento por `auth.uid() = user_id`.
5. **Resiliência offline e subpath:** fila local sincronizada automaticamente quando a rede retorna; caminhos relativos (`./`) obrigatórios para GitHub Pages.

## Fluxos Principais
1. **Extrato Cronológico:** Hero Card mobile / 4 KPIs desktop, barra de vencimento FIFO, busca com filtro rápido e detalhe em bottom sheet.
2. **Gráficos & Simulador:** Simulador de dias de folga + alerta de saldo negativo + linha do tempo de vencimentos + gráficos analíticos (`Chart.js`).
3. **Comunicação RH & Exportação:** Modelos prontos para WhatsApp/E-mail, impressão nativa offline, PDF oficial, Excel `.xlsx`, CSV, XML estruturado (SHA-256) e Agenda `.ics`.
4. **Conta & Parâmetros:** Perfil, senha forte, regras por sindicato/área/UF, calendário nacional/estadual de feriados e backup JSON.
