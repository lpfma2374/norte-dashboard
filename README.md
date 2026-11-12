# Norte Dashboard

**Site:** https://norte.luispedroalvim.dev (Cloudflare Access, app "Norte Dashboard": acesso exclusivo a luis.alvim@noesis.pt). O domínio `*.vercel.app` está protegido por login da Vercel.

Gestão das contas das **100 maiores empresas da região Norte**: interações (contactos no formato de ata de reunião),
pipeline de propostas, plano estratégico da conta, volume de negócio efetivo, decisores e experiência (success stories),
com os KPIs da região no header.

---

## 1. Tech stack

| Camada | Tecnologia | Notas |
|---|---|---|
| Frontend | **HTML + CSS + JavaScript puro** (sem build) | Estilo igual ao LeadSeeker (Apple, azul `#0071e3`). PDFs das atas gerados no browser com jsPDF. |
| API | **Vercel Serverless Functions** (Node 24, zero dependências em produção) | Falam com o D1 pela API HTTP da Cloudflare, sempre com queries parametrizadas. |
| Base de dados | **Cloudflare D1** `norte-dashboard-db` | Gestão de conta: `accounts`, `contacts`, `deals`, `account_plans`, `satisfaction`, `pipeline_links`, `settings` (ver `db/schema.sql`). |
| Empresas e decisores | **Cloudflare D1** `leadseeker-db` | Tabelas `companies` (`region = 'Norte'`, 100 empresas) e `decision_makers`. Fonte única partilhada com o LeadSeeker. |
| Pipeline | **Cloudflare D1** `presales-db` (app PACE, pipeline.luispedroalvim.dev) | Só leitura. Propostas associadas às empresas pelo nome do cliente, com correção manual. |
| Stories | **Cloudflare D1** `stories-db` | Igual ao LeadSeeker (`/api/stories`). |
| Documentos | **Cloudflare R2** bucket `norte-docs` | Anexos dos contactos (até 3 MB por ficheiro), servidos por URL assinado de 5 minutos. |
| Recolha inicial | **Firecrawl + Claude** | Ranking regional: Diário do Minho, 1000 Maiores do distrito de Braga (contas 2024) e listagem.pt 500 Maiores (contas 2022). |

```text
 Browser (index.html + js/app.js)
   │ fetch JSON
   ▼
 Vercel Functions  /api/dashboard · contacts · pipeline · account · decision-makers · settings · files · stories
   │ HTTP D1 API (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)          │ S3 API (R2_ACCESS_KEY_ID / SECRET)
   ▼                                                             ▼
 D1 norte-dashboard-db · leadseeker-db · presales-db · stories-db     R2 norte-docs
```

## 2. Página

**Header de KPIs**

| KPI | Cálculo |
|---|---|
| Atingimento do target de Sales | Σ situação atual ÷ Σ target dos planos de conta do ano corrente. Sem planos, usa o target global (botão *Target global*) e as vendas do ano. |
| Net Revenue Retention | Σ situação atual ÷ Σ situação inicial (final do ano anterior) dos planos de conta do ano corrente. |
| Volume do pipeline | nº e valor das propostas do PACE em carteira (em qualificação, em negociação, entregues) das contas do Norte. Papers excluídos. |
| Conversões em venda | propostas com estado *Ganha*, valor ganho e win rate = ganhas ÷ (ganhas + perdidas). |
| Satisfação do cliente | NPS e CSAT das avaliações dos últimos 12 meses; com planos de conta, também a média da satisfação atual, target e inicial (0 a 10). |

**Filtros:** Mercado, Sede (concelho), Empresa, Atividade (com contactos, com propostas em carteira, com negócio, com plano, com decisores, sem atividade).

**Lista** (100 empresas por ranking regional de volume de negócios)

| Coluna | Comportamento |
|---|---|
| # Norte | Posição no ranking regional. O círculo fica azul quando a conta tem pelo menos um destes: plano estratégico, contactos, propostas no pipeline, volume de negócio ou experiência (stories). |
| Empresa | Clicar abre a **ficha de conta**. No separador *Plano estratégico*, a tag **Adicionar plano** cria o plano do ano (ver abaixo). A tag por baixo do nome mostra o plano do ano e o desvio face ao target. Outros separadores: Volume de negócio (vendas) e Satisfação (NPS/CSAT). |
| Mercado | Setor. |
| Gestão Contatos | `+` cria um registo (título, participantes, agenda com o que foi dito em cada ponto, decisões, próximos passos, data, canal, anexos). O olho lista os registos do mais recente para o mais antigo; o olho de cada registo abre a ata completa, com pré-visualização e download em PDF, edição e eliminação. |
| Pipeline | Nº de propostas em carteira; abre a lista de propostas do PACE (abertas e fechadas), com *Registar venda* para propostas ganhas e associação/desassociação manual. |
| Volume | Negócio efetivo registado na conta (vendas manuais e propostas convertidas). |
| Decisores | Tag com o nº de decisores; abre a lista (nome, cargo, email quando existir); o olho abre o perfil público do LinkedIn. |
| Experiência | Igual ao LeadSeeker: stories da Noesis no cliente, com PDF. |

### Plano estratégico de conta

Um plano por empresa e por ano (`account_plans`, único por `company_id` + `plan_year`), com histórico dos anos anteriores.

| Campo | Significado |
|---|---|
| Situação inicial (€) | Volume de negócio conhecido no final do ano anterior. Pré-preenchida com a situação atual do plano do ano anterior. |
| Situação atual (€) | Volume de negócio conhecido na data do registo. |
| Evolução (%) | (atual − inicial) ÷ inicial. Calculada. |
| Target (€) | Volume de negócio pretendido no final do ano. |
| Desvio face ao target (%) | (atual − target) ÷ target. Calculado; negativo = abaixo do target. |
| Satisfação inicial / target / atual | Escala de 0 a 10: final do ano anterior, objetivo para o final do ano e valor apurado na data do registo. |
| Estratégia | Estado, próxima revisão, owner, tier, ambição, prioridades, objetivos, ofertas-alvo, whitespace, iniciativas e riscos. |

## 3. API

| Endpoint | Métodos |
|---|---|
| `/api/dashboard` | `GET` empresas com agregados + KPIs |
| `/api/contacts` | `GET ?company_id=` lista · `GET ?id=` detalhe · `POST` · `PUT ?id=` · `DELETE ?id=` |
| `/api/pipeline` | `GET ?company_id=` · `POST {action: link \| unlink \| convert, record_id, company_id}` |
| `/api/account` | `GET ?company_id=` (plano do ano + histórico) · `PUT {section: account \| plan}` · `POST {kind: deal \| survey}` · `DELETE &deal= \| &survey= \| &plan=` |
| `/api/decision-makers` | `GET ?company_id=` |
| `/api/settings` | `GET` · `PUT {sales_target_year, sales_target_eur}` |
| `/api/files` | `POST {company_id, name, type, data(base64)}` · `GET ?key=` (redirect assinado) · `DELETE ?key=` |
| `/api/stories` | `GET` · `GET ?id=` |

## 4. Variáveis de ambiente (Vercel)

| Variável | Obrigatória | Notas |
|---|---|---|
| `CF_ACCOUNT_ID` | sim | Account ID Cloudflare |
| `CLOUDFLARE_API_TOKEN` | sim | Token com **D1 Edit** (lê leadseeker/presales/stories e escreve na norte-dashboard-db) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | para anexos | Credenciais S3 do R2 com acesso ao bucket `norte-docs` |
| `NORTE_DB_ID`, `LEADSEEKER_DB_ID`, `PRESALES_DB_ID`, `STORIES_DB_ID`, `R2_BUCKET` | não | Já têm os valores de produção por defeito |

Os dados têm informação comercial e pessoal (decisores): manter o site atrás de proteção (Vercel Authentication no `*.vercel.app`
ou Cloudflare Access no domínio próprio, como no LeadSeeker).

## 5. Desenvolvimento

```bash
npm install
npm test          # Vitest: API contra um mock D1/R2 em SQLite em memória (node:sqlite, Node ≥ 22.5) + funções de formatação
npm run dev       # http://localhost:3000 com dados de exemplo (MOCK_D1=1)
```

## 6. Dados

- As 100 empresas estão na `leadseeker-db` (`companies.region = 'Norte'`): 49 já existentes no LeadSeeker e 51 acrescentadas
  em 2026-11-08 (`pt-norte-27` a `pt-norte-77`), com a fonte em `companies.source`. Duas sedes estão marcadas "a validar" (Gold Energy, Brasmar).
- Os decisores das empresas novas aparecem quando o agente LeadSeeker correr o "Run de hoje" para elas.
