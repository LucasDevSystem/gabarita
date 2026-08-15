import type { FastifyInstance } from "fastify";
import { repo } from "../repo/index.js";
import type { FiltrosQuery, MinhasQuestoes, Ordenacao } from "../repo/types.js";

interface ListaQuery {
  q?: string;
  disciplina?: string;
  assunto?: string;
  banca?: string;
  orgao?: string;
  cargo?: string;
  carreira?: string;
  area?: string;
  ano?: string;
  dificuldade?: string;
  escolaridade?: string;
  tipo?: string;
  comentarios?: string;
  anuladas?: string;
  desatualizadas?: string;
  minhasQuestoes?: string;
  page?: string;
  perPage?: string;
  sort?: string;
}

const ints = (v?: string) =>
  v
    ? v
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : [];

const strs = (v?: string) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const MINHAS_QUESTOES_VALIDAS: MinhasQuestoes[] = ["resolvidas", "naoresolvidas", "certas", "erradas"];
const ORDENACOES_VALIDAS: Ordenacao[] = ["recentes", "dificuldade_asc", "dificuldade_desc"];

function parseFiltros(query: ListaQuery): FiltrosQuery {
  return {
    q: query.q?.trim(),
    disciplina: ints(query.disciplina),
    assunto: ints(query.assunto),
    banca: ints(query.banca),
    orgao: ints(query.orgao),
    cargo: ints(query.cargo),
    carreira: ints(query.carreira),
    area: ints(query.area),
    ano: ints(query.ano),
    dificuldade: ints(query.dificuldade),
    escolaridade: strs(query.escolaridade),
    tipo: strs(query.tipo),
    comentarios: strs(query.comentarios),
    incluirAnuladas: query.anuladas === "incluir",
    incluirDesatualizadas: query.desatualizadas === "incluir",
    minhasQuestoes: MINHAS_QUESTOES_VALIDAS.includes(query.minhasQuestoes as MinhasQuestoes)
      ? (query.minhasQuestoes as MinhasQuestoes)
      : undefined,
    page: Math.max(1, Number(query.page) || 1),
    perPage: Math.min(100, Math.max(1, Number(query.perPage) || 20)),
    sort: ORDENACOES_VALIDAS.includes(query.sort as Ordenacao) ? (query.sort as Ordenacao) : "recentes",
  };
}

export function registrarRotasQuestoes(app: FastifyInstance) {
  app.get<{ Querystring: ListaQuery }>("/api/questoes", async (req) => {
    return repo.listarQuestoes(req.cliente!.guid, parseFiltros(req.query));
  });

  app.post<{ Params: { id: string }; Body: { itemId: number } }>(
    "/api/questoes/:id/responder",
    async (req, reply) => {
      const resultado = await repo.responder(req.cliente!.guid, Number(req.params.id), req.body.itemId);
      if (!resultado) {
        return reply.code(404).send({ erro: "Questão não encontrada" });
      }
      return resultado;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/questoes/:id/responder", async (req) => {
    await repo.resetarResposta(req.cliente!.guid, Number(req.params.id));
    return { ok: true };
  });
}
