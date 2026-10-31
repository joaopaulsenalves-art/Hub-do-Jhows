// progress.js — módulo de progresso dos jogos (versão do Dia 5)
// Fica na raiz do hub, na mesma pasta do supabase-client.js.
// Os jogos importam este arquivo pela URL completa:
//   https://joaopaulsenalves-art.github.io/Hub-do-Jhows/progress.js
//
// Uso nos jogos:
//   const m = await import(URL);
//   m.indicadorDeStatus();                                  // mostra "Salvo na nuvem" etc.
//   const salvo = await m.carregar('snake', { versaoAtual: 1, migrar });
//   m.salvar('snake', estado);                              // em eventos importantes
import { sb } from './supabase-client.js';

const ESPERA_MS = 1500;          // debounce: junta várias gravações seguidas em uma
const timers = new Map();        // um temporizador por jogo
const pendentes = new Map();     // aguardando o debounce
const falhas = new Map();        // falharam ao enviar; serão reenviadas

// Dono do progresso local: o id do usuário logado ou 'visitante'.
// Assim, duas contas no mesmo navegador nunca misturam o progresso.
let dono = 'visitante';

sb.auth.onAuthStateChange((_evento, sessao) => {
  dono = sessao?.user?.id ?? 'visitante';   // só atribui, sem chamar o Supabase aqui dentro
});

// ---------------------------------------------------------------- status
// 'visitante' | 'salvando' | 'nuvem' | 'pendente'
const ouvintes = new Set();
let statusAtual = 'visitante';

function definirStatus(novo) {
  statusAtual = novo;
  ouvintes.forEach((fn) => { try { fn(novo); } catch { /* ignora */ } });
}

export function aoMudarStatus(fn) {
  ouvintes.add(fn);
  fn(statusAtual);
  return () => ouvintes.delete(fn);
}

const TEXTOS = {
  visitante: 'Sem login: progresso só neste aparelho',
  salvando: 'Salvando...',
  nuvem: 'Salvo na nuvem',
  pendente: 'Salvo neste aparelho, sincroniza depois'
};

// Cria um aviso discreto no canto da tela.
export function indicadorDeStatus() {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:8px;left:8px;font:12px sans-serif;color:#aaa;' +
    'background:rgba(0,0,0,.45);padding:4px 8px;border-radius:6px;z-index:9999;pointer-events:none';
  const montar = () => document.body.appendChild(el);
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  aoMudarStatus((s) => { el.textContent = TEXTOS[s] ?? ''; });   // textContent: seguro
  return el;
}

// --------------------------------------------------------- armazenamento
const chaveLocal = (gameId, quem) => `progress:${quem}:${gameId}`;

function lerLocal(gameId, quem) {
  try { return JSON.parse(localStorage.getItem(chaveLocal(gameId, quem)) || 'null'); }
  catch { return null; }
}

function gravarLocal(gameId, quem, payload) {
  try { localStorage.setItem(chaveLocal(gameId, quem), JSON.stringify(payload)); }
  catch (e) { console.warn('Não foi possível salvar no aparelho:', e.message); }
}

function apagarLocal(gameId, quem) {
  try { localStorage.removeItem(chaveLocal(gameId, quem)); } catch { /* ignora */ }
}

export async function usuarioAtual() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// ----------------------------------------------------------------- envio
async function enviar(gameId, payload) {
  const user = await usuarioAtual();
  if (!user) { definirStatus('visitante'); return false; }   // visitante: só no aparelho

  definirStatus('salvando');
  const ts = payload._ts ?? Date.now();

  const { error } = await sb.from('game_progress').upsert(
    {
      user_id: user.id,
      game_id: gameId,
      data: { ...payload, _ts: ts },
      updated_at: new Date(ts).toISOString()
    },
    { onConflict: 'user_id,game_id' }
  );

  if (error) {
    console.warn('Falha ao sincronizar, o progresso fica neste aparelho:', error.message);
    falhas.set(gameId, payload);
    definirStatus('pendente');
    return false;
  }

  falhas.delete(gameId);
  definirStatus(falhas.size ? 'pendente' : 'nuvem');
  return true;
}

// Tenta de novo o que falhou (volta a rede ou passaram 30 s).
function reenviarFalhas() {
  for (const [gameId, payload] of [...falhas]) {
    if (!pendentes.has(gameId)) enviar(gameId, payload);
  }
}
window.addEventListener('online', reenviarFalhas);
setInterval(reenviarFalhas, 30000);

// --------------------------------------------------------------- carregar
// Aplica a migração de versão, se o jogo informou uma.
function preparar(estado, { versaoAtual = 1, migrar } = {}) {
  if (!estado) return null;
  let e = estado;
  if (typeof migrar === 'function' && (e.schemaVersion ?? 1) < versaoAtual) {
    try { e = migrar(e) ?? e; }
    catch (x) { console.warn('Falha ao migrar o progresso:', x); }
    e = { ...e, schemaVersion: versaoAtual };
  }
  return e;
}

// Decide entre o progresso de quando era visitante e o da conta.
// O jogo pode passar opcoes.aoConflito(local, nuvem) e devolver:
//   'local', 'nuvem' ou um objeto com o estado já combinado.
async function decidir(aoConflito, local, nuvem) {
  if (typeof aoConflito === 'function') return aoConflito(local, nuvem);
  const usarConta = window.confirm(
    'Encontramos progresso salvo neste aparelho e também na sua conta.\n\n' +
    'OK = usar o progresso da conta\nCancelar = usar o deste aparelho'
  );
  return usarConta ? 'nuvem' : 'local';
}

// Carrega o progresso do jogo. Chame no início, antes de qualquer salvar().
export async function carregar(gameId, opcoes = {}) {
  const user = await usuarioAtual();
  dono = user ? user.id : 'visitante';

  // Visitante: só existe a cópia local
  if (!user) {
    definirStatus('visitante');
    return preparar(lerLocal(gameId, 'visitante'), opcoes);
  }

  const local = lerLocal(gameId, user.id);
  const visitante = lerLocal(gameId, 'visitante');

  const { data, error } = await sb.from('game_progress')
    .select('data, updated_at')
    .eq('user_id', user.id)
    .eq('game_id', gameId)
    .maybeSingle();

  // Sem internet ou erro do servidor: usa o que tem no aparelho
  if (error) {
    console.warn('Não foi possível ler da nuvem:', error.message);
    definirStatus('pendente');
    return preparar(local, opcoes);
  }

  const nuvem = data?.data ?? null;
  const tsNuvem = data ? new Date(data.updated_at).getTime() : 0;
  let escolhido = null;

  if (!nuvem) {
    // Nada na nuvem: aproveita o que existe no aparelho
    escolhido = local ?? visitante ?? null;
    if (visitante) apagarLocal(gameId, 'visitante');
  } else if (visitante) {
    // Existe progresso de visitante e também da conta: pergunta (ou o jogo combina)
    const escolha = await decidir(opcoes.aoConflito, visitante, nuvem);
    apagarLocal(gameId, 'visitante');
    if (escolha === 'local') escolhido = { ...visitante, _ts: Date.now() };
    else if (escolha && typeof escolha === 'object') escolhido = { ...escolha, _ts: Date.now() };
    else escolhido = nuvem;
  } else if (local && local._ts > tsNuvem) {
    escolhido = local;          // a cópia do aparelho é mais nova
  } else {
    escolhido = nuvem;          // caso normal
  }

  if (escolhido) {
    gravarLocal(gameId, user.id, escolhido);
    if (escolhido !== nuvem) await enviar(gameId, escolhido);   // sobe o que é mais novo
    else definirStatus('nuvem');
  } else {
    definirStatus('nuvem');
  }

  return preparar(escolhido, opcoes);
}

// ----------------------------------------------------------------- salvar
// Grava no aparelho na hora e envia à nuvem com debounce.
export function salvar(gameId, estado) {
  const payload = { ...estado, _ts: Date.now() };
  gravarLocal(gameId, dono, payload);

  if (dono === 'visitante') { definirStatus('visitante'); return; }

  pendentes.set(gameId, payload);
  clearTimeout(timers.get(gameId));
  timers.set(gameId, setTimeout(() => {
    pendentes.delete(gameId);
    enviar(gameId, payload);
  }, ESPERA_MS));
}

// Salva e envia sem esperar o debounce (útil ao terminar uma fase ou partida).
export async function salvarAgora(gameId, estado) {
  clearTimeout(timers.get(gameId));
  pendentes.delete(gameId);
  const payload = { ...estado, _ts: Date.now() };
  gravarLocal(gameId, dono, payload);
  return enviar(gameId, payload);
}

// Ao esconder ou fechar a aba, envia o que ainda estava esperando o debounce.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  for (const [gameId, payload] of pendentes) {
    clearTimeout(timers.get(gameId));
    enviar(gameId, payload);
  }
  pendentes.clear();
});
