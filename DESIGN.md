# SaldoHoras — Guia de Design & Tokens (`DESIGN.md`)

## Princípios Visuais
- **Superfície `Operate`:** interface clara, densa na medida certa, com destaque reservado ao estado do saldo e às ações primárias.
- **Identidade de Marca Preservada:** Primária **Indigo (`#4f46e5`)** (tema PWA, botões principais e foco). Evitar gradientes decorativos multi-cor concorrendo com dados críticos.
- **Separação Limpa (Sem "Ghost Cards"):**
  - **Cards estáticos:** borda fina `1px` (`slate-200` no claro / `slate-800` no escuro) e contraste de superfície sem sombras pesadas redundantes.
  - **Superfícies elevadas reais:** somente modais/bottom sheets, dropdowns, barra fixa mobile e toasts recebem sombra (`shadow-xl` / `shadow-2xl`).
  - **Cards mobile de lançamento:** borda externa uniforme `1px rounded-2xl` + indicador semântico interno vertical (sem barra lateral espessa `border-l-4` cortando cantos arredondados).

## Sistema Cromático
| Papel | Tema Claro | Tema Escuro | Uso |
| :--- | :--- | :--- | :--- |
| Canvas principal | `#f8fafc` (`slate-50`) | `#020617` (`slate-950`) | Fundo da página |
| Superfície de card | `#ffffff` (`white`) | `#0f172a` (`slate-900`) | Cards, tabelas e sheets |
| Superfície secundária | `#f1f5f9` (`slate-100`) | `#1e293b` (`slate-800`) | Inputs, painéis internos e pills |
| Ação primária / Foco | `#4f46e5` (`indigo-600`) | `#6366f1` / `#818cf8` | CTAs, aba ativa e anel `:focus-visible` |
| Crédito / Positivo | `#059669` (`emerald-600`) | `#34d399` (`emerald-400`) | Entradas, saldo positivo, confirmação |
| Débito / Erro | `#e11d48` (`rose-600`) | `#fb7185` (`rose-400`) | Folgas, erros inline, exclusão |
| Previsto / Alerta | `#d97706` (`amber-600`) | `#fbbf24` (`amber-400`) | Lançamentos previstos, créditos vencendo |

## Tipografia & Números
- **UI & Texto:** `Inter` (`system-ui`, `-apple-system`, `sans-serif`).
- **Horas, Datas & Totais:** `JetBrains Mono` com `font-variant-numeric: tabular-nums` obrigatório para evitar trepidação visual entre digitações e atualizações.
- **Cabeçalhos:** Preferir *Sentence Case* legível em KPIs e rótulos de formulário; reservar `uppercase tracking-wider` apenas para `<thead>` de tabelas e micro-células estruturais (`10px`).

## Ergonomia, Touch & Acessibilidade (WCAG AA)
- **Alvos de toque:** mínimo **`44 × 44 px`** em todos os botões, chips, seletores de ano, abas móveis e botões de fechar/voltar.
- **Navegação por teclado:** *Skip link* no topo (`#mainContent`), anel `:focus-visible` padronizado de `2px` e *focus trap* em todos os modais.
- **Anti-zoom iOS:** campos `input`, `select` e `textarea` mantêm `16px` em `< 768px`.

## Contrato de Movimento (`transitions-dev`)
- **Curva padrão:** `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Assimetria funcional:** entradas deliberadas (`250ms` modal/dropdown/acordeão, `350ms` toast) e saídas rápidas (`150ms` modal/dropdown, `250ms` toast) sem bloquear o próximo toque.
- **Micro-interações utilitárias:** acordeões via `grid-template-rows: 0fr → 1fr`, shake inline em erro (`280ms`), skeleton reveal sem spinner bloqueante e crossfade direto de ícones (`olho`/`tema`).
- **`prefers-reduced-motion: reduce`:** respeitado globalmente em todas as transições e keyframes.
