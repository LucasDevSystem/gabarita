import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "@/components/layout/RootLayout";
import { QuestoesPage } from "@/routes/QuestoesPage";
import { EstatisticasPage } from "@/routes/EstatisticasPage";
import type { FiltrosState, MinhasQuestoes } from "@/lib/types";

export const FILTROS_PADRAO: FiltrosState = {
  q: "",
  disciplina: [],
  assunto: [],
  banca: [],
  orgao: [],
  cargo: [],
  carreira: [],
  area: [],
  ano: [],
  dificuldade: [],
  escolaridade: [],
  tipo: [],
  comentarios: [],
  anuladas: "excluir",
  desatualizadas: "excluir",
  minhasQuestoes: "todas",
  page: 1,
  perPage: 20,
  sort: "recentes",
};

// O parser de search da rota tenta JSON.parse cada valor, então "?disciplina=113"
// (digitado à mão, fora do fluxo normal de navegação do app) chega aqui como o
// número 113, não como string ou array — por isso os dois casos abaixo tratam
// também um valor primitivo isolado como uma lista de um item.
const arrNum = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  if (typeof v === "string" && v) return v.split(",").map(Number).filter(Number.isFinite);
  if (typeof v === "number" && Number.isFinite(v)) return [v];
  return [];
};

const arrStr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return v.split(",");
  if (typeof v === "number") return [String(v)];
  return [];
};

function validateQuestoesSearch(search: Record<string, unknown>): FiltrosState {
  return {
    q: typeof search.q === "string" ? search.q : "",
    disciplina: arrNum(search.disciplina),
    assunto: arrNum(search.assunto),
    banca: arrNum(search.banca),
    orgao: arrNum(search.orgao),
    cargo: arrNum(search.cargo),
    carreira: arrNum(search.carreira),
    area: arrNum(search.area),
    ano: arrNum(search.ano),
    dificuldade: arrNum(search.dificuldade),
    escolaridade: arrStr(search.escolaridade),
    tipo: arrStr(search.tipo),
    comentarios: arrStr(search.comentarios),
    anuladas: search.anuladas === "incluir" ? "incluir" : "excluir",
    desatualizadas: search.desatualizadas === "incluir" ? "incluir" : "excluir",
    minhasQuestoes: (["resolvidas", "naoresolvidas", "certas", "erradas"] as MinhasQuestoes[]).includes(
      search.minhasQuestoes as MinhasQuestoes,
    )
      ? (search.minhasQuestoes as MinhasQuestoes)
      : "todas",
    page: Number(search.page) > 0 ? Number(search.page) : 1,
    perPage: Number(search.perPage) > 0 ? Number(search.perPage) : 20,
    sort: search.sort === "dificuldade_asc" || search.sort === "dificuldade_desc" ? search.sort : "recentes",
  };
}

const rootRoute = createRootRoute({ component: RootLayout });

const questoesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: QuestoesPage,
  validateSearch: validateQuestoesSearch,
});

const estatisticasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/estatisticas",
  component: EstatisticasPage,
});

const routeTree = rootRoute.addChildren([questoesRoute, estatisticasRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
