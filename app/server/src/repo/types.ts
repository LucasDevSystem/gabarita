export type LookupTipo = "bancas" | "orgaos" | "cargos" | "assuntos";

export interface OpcaoFiltro {
  id: number;
  nome: string;
  qtdQuestoes: number;
}

export interface FiltrosBase {
  disciplinas: { id: number; nome: string; slug: string; qtdQuestoes: number }[];
  carreiras: OpcaoFiltro[];
  areas: OpcaoFiltro[];
  anos: { ano: number; qtdQuestoes: number }[];
  dificuldades: { dificuldade: number; qtdQuestoes: number }[];
  escolaridades: { nivel: string; qtdQuestoes: number }[];
  tipos: { tipo: string; qtdQuestoes: number }[];
}

export interface ItemQuestao {
  id: number;
  ordem: number;
  corpo: string;
  corpo_clean: string;
  rotulo: string;
}

export interface ProvaQuestao {
  id: number;
  nome: string;
  ano: number;
  nivel: string;
  banca: { nome: string; sigla: string };
  orgao: { nome: string; sigla: string };
  cargo: { descricao: string };
}

export interface Questao {
  id: number;
  dificuldade: number | null;
  tipo: string | null;
  nivel: string | null;
  anulada: boolean;
  desatualizada: boolean;
  hasImage: boolean;
  enunciado: string;
  disciplina: { id: number; nome: string };
  itens: ItemQuestao[];
  provas: ProvaQuestao[];
  comentarios: {
    ia: boolean;
    professor: boolean;
    professorVideo: boolean;
    aluno: boolean;
    totalAlunos: number;
    totalProfessores: number;
  };
  respostaCorretaId: number | null;
  minhaResposta: { itemId: number; correta: boolean; respondidoEm: string } | null;
}

export type MinhasQuestoes = "resolvidas" | "naoresolvidas" | "certas" | "erradas" | undefined;
export type Ordenacao = "recentes" | "dificuldade_asc" | "dificuldade_desc";

// Filtros já parseados (a camada HTTP nas rotas converte a querystring crua pra isso).
export interface FiltrosQuery {
  q?: string;
  disciplina: number[];
  assunto: number[];
  banca: number[];
  orgao: number[];
  cargo: number[];
  carreira: number[];
  area: number[];
  ano: number[];
  dificuldade: number[];
  escolaridade: string[];
  tipo: string[];
  comentarios: string[];
  incluirAnuladas: boolean;
  incluirDesatualizadas: boolean;
  minhasQuestoes: MinhasQuestoes;
  page: number;
  perPage: number;
  sort: Ordenacao;
}

export interface ListaQuestoesResultado {
  total: number;
  // Falso quando `total` é só um piso ("mais de N"). Contar exatamente uma
  // combinação arbitrária de filtros exige percorrer o conjunto inteiro, o
  // que não escala — então o backend DynamoDB devolve o total exato só quando
  // ele sai das contagens pré-calculadas (ver totalPreCalculado em
  // repo/dynamo.ts). No SQLite é sempre exato.
  totalExato: boolean;
  // Se existe pelo menos mais uma página adiante. O frontend usa isso pra
  // habilitar "Próxima" em vez de depender de total/perPage.
  temMais: boolean;
  page: number;
  perPage: number;
  rows: Questao[];
}

export interface RespostaEnviada {
  correta: boolean;
  respostaCorretaId: number | null;
}

export interface Estatisticas {
  respondidas: number;
  certas: number;
  erradas: number;
  percentualAcerto: number;
  porDisciplina: { id: number; nome: string; respondidas: number; certas: number }[];
}

export interface Capacidades {
  // Se falso, o frontend esconde as opções de ordenar por dificuldade (não
  // suportado com eficiência no backend DynamoDB — ver repo/dynamo.ts).
  ordenacaoPorDificuldade: boolean;
}

export interface Repositorio {
  capacidades: Capacidades;
  filtrosBase(): Promise<FiltrosBase>;
  // disciplinaIds só é usado (e obrigatório na prática) pro tipo "assuntos" —
  // assunto só faz sentido escopado a uma disciplina já escolhida. Os demais
  // tipos de lookup ignoram esse parâmetro.
  buscarLookup(
    tipo: LookupTipo,
    q: string,
    limit: number,
    disciplinaIds?: number[],
  ): Promise<OpcaoFiltro[]>;
  listarQuestoes(filtros: FiltrosQuery): Promise<ListaQuestoesResultado>;
  responder(questaoId: number, itemId: number): Promise<RespostaEnviada | null>;
  resetarResposta(questaoId: number): Promise<void>;
  estatisticas(): Promise<Estatisticas>;
}
