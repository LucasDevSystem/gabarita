export interface OpcaoFiltro {
  id: number;
  nome: string;
  qtdQuestoes: number;
  // Só populado pro tipo "assuntos" (árvore) — undefined pros demais.
  pai?: number | null;
}

export interface OpcaoContagem<T = string> {
  [key: string]: T | number;
  qtdQuestoes: number;
}

export interface Capacidades {
  // Falso quando a API está rodando sobre o backend DynamoDB (sem GSI de
  // dificuldade nesse desenho) — nesse caso escondemos as opções de ordenar
  // por dificuldade em vez de oferecer algo que não funciona de verdade.
  ordenacaoPorDificuldade: boolean;
}

export interface FiltrosBase {
  disciplinas: OpcaoFiltro[];
  carreiras: OpcaoFiltro[];
  areas: OpcaoFiltro[];
  anos: { ano: number; qtdQuestoes: number }[];
  dificuldades: { dificuldade: number; qtdQuestoes: number }[];
  escolaridades: { nivel: string; qtdQuestoes: number }[];
  tipos: { tipo: string; qtdQuestoes: number }[];
  capacidades: Capacidades;
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

export interface ListaQuestoesResponse {
  total: number;
  // Quando falso, `total` é um piso ("mais de N") — contar exatamente uma
  // combinação de filtros no DynamoDB exigiria percorrer tudo.
  totalExato: boolean;
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

export interface Cliente {
  guid: string;
  nome: string;
  nomePersonalizado: string | null;
  criadoEm: string;
  ultimoAcesso: string | null;
}

export interface ClienteComEstatisticas extends Cliente {
  respondidas: number;
  certas: number;
  erradas: number;
}

export type MinhasQuestoes = "todas" | "resolvidas" | "naoresolvidas" | "certas" | "erradas";
export type Anuladas = "excluir" | "incluir";

export interface FiltrosState {
  q: string;
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
  anuladas: Anuladas;
  desatualizadas: Anuladas;
  minhasQuestoes: MinhasQuestoes;
  page: number;
  perPage: number;
  sort: "recentes" | "dificuldade_asc" | "dificuldade_desc";
}
