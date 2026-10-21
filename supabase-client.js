// supabase-client.js
// Fica na raiz do hub, ao lado do index.html.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Troque pelos seus dados (Project Settings > Data API e API Keys).
// Use SÓ a chave publishable/anon. NUNCA a secret ou service_role.
const SUPABASE_URL = 'https://ootdrxnoywwdwymzmwxt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vdGRyeG5veXd3ZHd5bXptd3h0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODUyMTYsImV4cCI6MjEwODA2MTIxNn0.Gx1StwS9snFOUJEIrnuuMUveGd3prOTqJPb6uWE82a8';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function cadastrar(email, senha, username) {
  const { data, error } = await sb.auth.signUp({
    email,
    password: senha,
    options: {
      data: { username },
      emailRedirectTo: 'https://joaopaulsenalves-art.github.io/Hub-do-Jhows/index.html'
    }
  });
  if (error) throw error;
  return data;
}

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

export const sair = () => sb.auth.signOut();

// Ajuste o caminho se o hub estiver em subpasta (ex.: '/nome-do-repo/redefinir.html')
export const recuperarSenha = (email) =>
  sb.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('redefinir.html', location.href).href
  });

export async function usuarioAtual() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
