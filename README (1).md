# Hub do Jhows

Hub de jogos no GitHub Pages com cadastro, login e progresso salvo na nuvem (Supabase).

Endereço do hub: `https://joaopaulsenalves-art.github.io/Hub-do-Jhows/`

## Como funciona

- **Hub e jogos** são sites estáticos, cada um em um repositório do GitHub Pages sob `joaopaulsenalves-art.github.io`.
- **Supabase** cuida do cadastro/login (Auth) e do banco (PostgreSQL). Não há servidor próprio.
- Todos os sites têm a **mesma origem** (`joaopaulsenalves-art.github.io`), então compartilham a sessão de login pelo `localStorage`. O login é feito no hub e vale para os jogos.
- A segurança vem do **RLS** do banco: cada jogador só lê e grava as próprias linhas. A chave `publishable/anon` é pública de propósito. A `secret`/`service_role` **nunca** vai para o GitHub.

## Arquivos do hub (raiz do repositório)

| Arquivo | Função |
|---|---|
| `index.html` | Página inicial, lista de jogos, barra com Entrar / Criar conta / Olá, nome / Sair |
| `cadastro.html` | Criar conta |
| `login.html` | Entrar e "esqueci a senha" |
| `redefinir.html` | Define a nova senha (destino do link do e-mail) |
| `supabase-client.js` | Cria o cliente do Supabase (URL + chave pública) e as funções de login |
| `progress.js` | Módulo que os jogos importam para carregar e salvar o progresso |
| `schema.sql` | Estrutura do banco, segurança e validações (pode rodar várias vezes) |
| `style.css` | Estilos |

## Banco de dados

- `public.profiles`: um perfil por jogador (`id`, `username`, `created_at`). Criado automaticamente no cadastro por um gatilho.
- `public.game_progress`: uma linha por jogador por jogo (`user_id`, `game_id`, `data` em JSON, `updated_at`). Máximo de 50 KB por linha, só `game_id`s da lista abaixo.

## Jogos e formato dos dados (`data`)

O `progress.js` acrescenta `_ts` (hora do salvamento) em todos os jogos. Ele é usado para decidir qual cópia é mais nova.

| game_id | Repositório | Formato |
|---|---|---|
| `snake` | `OldSnakeGame` | `{ schemaVersion: 1, conquistas: { id: true }, skinIndex: 0, recorde: 0 }` |
| `moto` | `Moto-Art-Grau` | `{ schemaVersion: 1, recordes: { <modo>: { pontos, distancia?, zonaMs?, tempoMs? } } }` com os modos `normal`, `competitivo`, `maluco`, `precisao`, `perigo`, `cidade` |
| `labirinto` | `Labirinto-game` | `{ schemaVersion: 1, melhorPontuacao: 0 }` (soma das pontuações de todas as fases da jornada) |

Regras de combinação entre progresso de visitante e da conta: recordes ficam com o **maior** valor, tempos de vitória com o **menor**, conquistas com a **união**.

## Integrar um jogo novo

1. Escolha um `game_id` e acrescente-o à constraint `game_id_valido` no `schema.sql`. Rode o script no **SQL Editor**.
2. No jogo, defina o estado a salvar (somente o que o jogador não quer perder) e um `schemaVersion`.
3. Use este padrão:

```js
const GAME_ID = "meu-jogo";
const URL_PROGRESSO = "https://joaopaulsenalves-art.github.io/Hub-do-Jhows/progress.js";
let progresso = null;   // continua null se a nuvem falhar: o jogo segue normal

const montarEstado = () => ({ schemaVersion: 1, /* seus dados */ });
const salvarProgresso = () => { if (progresso) progresso.salvar(GAME_ID, montarEstado()); };

async function iniciarProgresso() {
  try {
    const m = await import(URL_PROGRESSO);
    m.indicadorDeStatus();
    const salvo = await m.carregar(GAME_ID, {
      versaoAtual: 1,
      migrar: (e) => e,
      aoConflito: (local, nuvem) => ({ /* combine os dois */ })
    });
    /* aplique `salvo` ao jogo, validando os tipos */
    progresso = m;
  } catch (e) { progresso = null; }
}
iniciarProgresso();
```

4. Chame `salvarProgresso()` em eventos importantes (fase, recorde, opção) e `progresso.salvarAgora(GAME_ID, montarEstado())` no fim da partida.
5. Valide todo dado vindo da nuvem antes de usar e use `textContent` (nunca `innerHTML`) para texto de usuário.

## Configuração do Supabase

- **Authentication → URL Configuration**
  - Site URL: `https://joaopaulsenalves-art.github.io/Hub-do-Jhows/`
  - Redirect URLs: `https://joaopaulsenalves-art.github.io/**`
- **Authentication → Sign In / Providers → Email**: confirmação de e-mail ligada, senha mínima de 8 caracteres.
- **Authentication → Emails → SMTP Settings**: SMTP próprio (o envio padrão tem limite baixo para o projeto inteiro).

## Rotina de manutenção

- **Backup:** exporte `profiles` e `game_progress` em CSV (Table Editor ou resultado do SQL Editor) pelo menos uma vez por semana. O plano gratuito não garante backups automáticos.
- **Projeto ativo:** o workflow `.github/workflows/manter-ativo.yml` faz uma consulta leve duas vezes por semana, para o plano gratuito não pausar o projeto por inatividade.
- **Monitoramento:** painel do Supabase em **Reports**, **Logs → Auth** e **Database → Advisors** (alertas de segurança).
- **Se a chave secreta vazar:** gere uma nova em **Project Settings → API Keys** e apague a antiga.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| E-mail de confirmação leva a uma página 404 | Site URL ou Redirect URLs sem o nome do repositório |
| `Invalid path specified in request URL` | `SUPABASE_URL` com `/rest/v1/` no final |
| `ERR_NAME_NOT_RESOLVED` para `seu-id.supabase.co` | `supabase-client.js` publicado ainda com o texto de exemplo |
| Muitas tentativas / e-mail não chega | Limite de e-mails do envio padrão: configure SMTP próprio |
| Progresso não aparece na tabela | Jogador sem login, `progress.js` antigo no hub, ou partida sem pontos |
