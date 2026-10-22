// progress.js — módulo de progresso dos jogos
// Fica na raiz do hub, na mesma pasta do supabase-client.js.
// Os jogos importam este arquivo pela URL completa:
//   https://joaopaulsenalves-art.github.io/Hub-do-Jhows/progress.js
//
// Uso nos jogos:
//   const salvo = await carregar('snake');   // sempre ANTES de salvar
//   salvar('snake', estado);                 // em eventos importantes
import { sb } from './supabase-client.js';

const ESPERA_MS = 1500;          // debounce: junta várias gravações seguidas em uma
const timers = new Map();        // um temporizador por jogo
const pendentes = new Map();     // progresso ainda não enviado à nuvem

// Dono do progresso local: o id do usuário logado ou 'visitante'.
// Assim, duas contas no mesmo navegador nunca misturam o progresso.
let dono = 'visitante';

sb.auth.onAuthStateChange((_evento, sessao) => {
  dono = sessao?.user?.id ?? 'visitante';   // só atribui, sem chamar o Supabase aqui dentro
});

const chaveLocal = (gameId, quem) => `progress:${quem}:${gameId}`;

function lerLocal(gameId, quem) {
  try { return JSON.parse(localStorage.getItem(chaveLocal(gameId, quem)) || 'null'); }
  catch { return null; }
}

function gravarLocal(gameId, quem, payload) {
  try { localStorage.setItem(chaveLocal(gameId, quem), JSON.stringify(payload)); }
  catch (e) { console.warn('Não foi possível salvar no aparelho:', e.message); }
}

export async function usuarioAtual() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// Envia à nuvem. Devolve true se deu certo.
async function enviar(gameId, payload) {
  const user = await usuarioAtual();
  if (!user) return false;                      // visitante: fica só no aparelho

  const { error } = await sb.from('game_progress').upsert(
    {
      user_id: user.id,
      game_id: gameId,
      data: payload,
      updated_at: new Date(payload._ts).toISOString()
    },
    { onConflict: 'user_id,game_id' }
  );

  if (error) {
    console.warn('Falha ao sincronizar, o progresso fica só neste aparelho:', error.message);
    return false;
  }
  return true;
}

// Carrega o progresso do jogo. Chame no início, antes de qualquer salvar().
export async function carregar(gameId) {
  const user = await usuarioAtual();
  dono = user ? user.id : 'visitante';

  // Visitante: só existe a cópia local
  if (!user) return lerLocal(gameId, 'visitante');

  const local = lerLocal(gameId, user.id);

  const { data, error } = await sb.from('game_progress')
    .select('data, updated_at')
    .eq('user_id', user.id)
    .eq('game_id', gameId)
    .maybeSingle();

  // Sem internet ou erro do servidor: usa o que tem no aparelho
  if (error) {
    console.warn('Não foi possível ler da nuvem:', error.message);
    return local;
  }

  const nuvem = data?.data ?? null;
  const tsNuvem = data ? new Date(data.updated_at).getTime() : 0;

  // Nada na nuvem ainda: aproveita o progresso do aparelho (da conta ou de quando era visitante)
  if (!nuvem) {
    const visitante = lerLocal(gameId, 'visitante');
    const candidato = local ?? visitante;
    if (candidato) {
      gravarLocal(gameId, user.id, candidato);
      await enviar(gameId, candidato);
      if (!local) localStorage.removeItem(chaveLocal(gameId, 'visitante'));
    }
    return candidato ?? null;
  }

  // A cópia do aparelho é mais nova que a da nuvem: ela vence e sobe à nuvem
  if (local && local._ts > tsNuvem) {
    enviar(gameId, local);
    return local;
  }

  // Caso normal: a nuvem vence e atualiza a cópia do aparelho
  gravarLocal(gameId, user.id, nuvem);
  return nuvem;
}

// Salva o progresso: grava no aparelho na hora e envia à nuvem com debounce.
export function salvar(gameId, estado) {
  const payload = { ...estado, _ts: Date.now() };
  gravarLocal(gameId, dono, payload);
  pendentes.set(gameId, payload);

  clearTimeout(timers.get(gameId));
  timers.set(gameId, setTimeout(() => {
    pendentes.delete(gameId);
    enviar(gameId, payload);
  }, ESPERA_MS));
}

// Salva e envia sem esperar o debounce (útil ao terminar uma fase).
export async function salvarAgora(gameId, estado) {
  clearTimeout(timers.get(gameId));
  const payload = { ...estado, _ts: Date.now() };
  gravarLocal(gameId, dono, payload);
  pendentes.delete(gameId);
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
