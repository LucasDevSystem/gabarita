import { tokenAdmin, tokenCliente } from "./auth";
import type {
  Cliente,
  ClienteComEstatisticas,
  Estatisticas,
  FiltrosBase,
  FiltrosState,
  ListaQuestoesResponse,
  OpcaoFiltro,
  RespostaEnviada,
} from "./types";

// Toda chamada à API passa por aqui pra anexar o token de acesso — client ou
// admin, conforme a chamada. Sem token nenhuma requisição autenticada
// funciona (ver middleware/auth.ts no servidor).
async function chamar<T>(url: string, opts: RequestInit, token: string | null): Promise<T> {
  const headers = new Headers(opts.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw new Error(`Falha na requisição: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

const apiFetch = <T>(url: string, opts: RequestInit = {}) => chamar<T>(url, opts, tokenCliente());
const adminFetch = <T>(url: string, opts: RequestInit = {}) => chamar<T>(url, opts, tokenAdmin());

export function buscarEu(): Promise<Cliente> {
  return apiFetch("/api/eu");
}

export function atualizarMeuNome(nome: string): Promise<Cliente> {
  return apiFetch("/api/eu", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome }),
  });
}

export function listarClientesAdmin(): Promise<ClienteComEstatisticas[]> {
  return adminFetch("/api/admin/clientes");
}

export function criarClienteAdmin(nome?: string): Promise<Cliente> {
  return adminFetch("/api/admin/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome }),
  });
}

export function buscarFiltrosBase(): Promise<FiltrosBase> {
  return apiFetch("/api/filtros");
}

const LOOKUPS = ["bancas", "orgaos", "cargos", "assuntos"] as const;
export type LookupFiltro = (typeof LOOKUPS)[number];

export function buscarLookup(
  tipo: LookupFiltro,
  q = "",
  disciplina: number[] = [],
): Promise<OpcaoFiltro[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (disciplina.length) params.set("disciplina", disciplina.join(","));
  return apiFetch(`/api/filtros/${tipo}?${params.toString()}`);
}

// Diferente de buscarLookup: traz a árvore inteira da disciplina de uma vez
// (sem termo de busca, teto bem mais alto no servidor — ver
// routes/filtros.ts) em vez de uma lista por relevância. A árvore é buscada
// e ordenada/filtrada por texto do lado do cliente — precisa de todo mundo
// de uma vez pra reconstruir a estrutura pai/filho corretamente.
export function buscarArvoreAssuntos(disciplina: number[]): Promise<OpcaoFiltro[]> {
  const params = new URLSearchParams();
  if (disciplina.length) params.set("disciplina", disciplina.join(","));
  params.set("limit", "2000");
  return apiFetch(`/api/filtros/assuntos?${params.toString()}`);
}

function paramsDeFiltros(f: FiltrosState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  const multi: [string, (string | number)[]][] = [
    ["disciplina", f.disciplina],
    ["assunto", f.assunto],
    ["banca", f.banca],
    ["orgao", f.orgao],
    ["cargo", f.cargo],
    ["carreira", f.carreira],
    ["area", f.area],
    ["ano", f.ano],
    ["dificuldade", f.dificuldade],
    ["escolaridade", f.escolaridade],
    ["tipo", f.tipo],
    ["comentarios", f.comentarios],
  ];
  for (const [chave, valores] of multi) {
    if (valores.length) p.set(chave, valores.join(","));
  }
  if (f.anuladas === "incluir") p.set("anuladas", "incluir");
  if (f.desatualizadas === "incluir") p.set("desatualizadas", "incluir");
  if (f.minhasQuestoes !== "todas") p.set("minhasQuestoes", f.minhasQuestoes);
  p.set("page", String(f.page));
  p.set("perPage", String(f.perPage));
  if (f.sort !== "recentes") p.set("sort", f.sort);
  return p;
}

export function buscarQuestoes(f: FiltrosState): Promise<ListaQuestoesResponse> {
  return apiFetch(`/api/questoes?${paramsDeFiltros(f).toString()}`);
}

export function responderQuestao(id: number, itemId: number): Promise<RespostaEnviada> {
  return apiFetch(`/api/questoes/${id}/responder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
}

export function resetarResposta(id: number): Promise<void> {
  return apiFetch(`/api/questoes/${id}/responder`, { method: "DELETE" });
}

export function buscarEstatisticas(): Promise<Estatisticas> {
  return apiFetch("/api/estatisticas");
}
