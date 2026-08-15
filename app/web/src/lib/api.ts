import type {
  Estatisticas,
  FiltrosBase,
  FiltrosState,
  ListaQuestoesResponse,
  OpcaoFiltro,
  RespostaEnviada,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha na requisição: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export function buscarFiltrosBase(): Promise<FiltrosBase> {
  return getJson("/api/filtros");
}

const LOOKUPS = ["bancas", "orgaos", "cargos", "assuntos"] as const;
export type LookupFiltro = (typeof LOOKUPS)[number];

export function buscarLookup(tipo: LookupFiltro, q = ""): Promise<OpcaoFiltro[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  return getJson(`/api/filtros/${tipo}?${params.toString()}`);
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
  return getJson(`/api/questoes?${paramsDeFiltros(f).toString()}`);
}

export async function responderQuestao(id: number, itemId: number): Promise<RespostaEnviada> {
  const res = await fetch(`/api/questoes/${id}/responder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  if (!res.ok) throw new Error("Falha ao enviar resposta");
  return res.json();
}

export async function resetarResposta(id: number): Promise<void> {
  const res = await fetch(`/api/questoes/${id}/responder`, { method: "DELETE" });
  if (!res.ok) throw new Error("Falha ao resetar resposta");
}

export function buscarEstatisticas(): Promise<Estatisticas> {
  return getJson("/api/estatisticas");
}
