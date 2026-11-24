# SaldoHoras — Banco de Horas & Folgas 2026

Aplicação web multiusuário para controle de **banco de horas, feriados trabalhados e folgas compensatórias**, com sincronização em nuvem e autenticação via **Supabase**.

## Funcionalidades
- **Autenticação completa:** Cadastro com confirmação de e-mail, login, recuperação de senha e isolamento de dados por usuário (RLS).
- **Extrato cronológico:** Controle de créditos (+ feriados/extras) e débitos (- folgas), status *Realizado* vs. *Previsto*, alertas de vencimento e layout responsivo em cards no celular.
- **Gráficos & Simulador:** Evolução do saldo acumulado e simulador interativo de dias de folga.
- **Comunicação RH/Gestão:** Modelos editáveis com envio direto via E-mail (`mailto:`) e WhatsApp (`wa.me`).
- **Exportação:** Relatório executivo em **PDF**, planilha **CSV** e backup/restauração em **JSON**.
