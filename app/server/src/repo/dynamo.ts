import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import type {
  Capacidades,
  Estatisticas,
  FiltrosBase,
  FiltrosQuery,
  ItemQuestao,
  ListaQuestoesResultado,
  LookupTipo,
  OpcaoFiltro,
  ProvaQuestao,
  Questao,
  Repositorio,
  RespostaEnviada,
} from "./types.js";

// Desenho "simples" (ver plano): uma tabela de questões com PK = id (único
// globalmente), e um GSI por disciplinaId pra suportar o caso comum de
// filtrar por disciplina com eficiência. Todo o resto dos filtros (banca,
// órgão, cargo, carreira, área, assunto, ano, dificuldade, escolaridade,
// tipo, anuladas/desatualizadas, comentários, busca por texto) vira uma
// FilterExpression combinada, aplicada pelo próprio DynamoDB durante a
// Query/Scan — sem índice dedicado pra cada faceta. Isso é correto e simples,
// mas mais lento que SQL quando nenhuma disciplina é escolhida (Scan na
// tabela inteira) — aceitável na escala pessoal deste app.
export const TABELA_QUESTOES = `${env.aws.tablePrefix}questoes`;
export const TABELA_RESPOSTAS = `${env.aws.tablePrefix}respostas`;
export const TABELA_LOOKUPS = `${env.aws.tablePrefix}lookups`;
export const INDICE_DISCIPLINA = "disciplina-index";

interface ItemLookup {
  tipo: string;
  id: number;
  nome: string;
  slug?: string;
  qtdQuestoes: number;
}

interface ItemQuestaoDynamo {
  id: number;
  disciplinaId: number;
  disciplinaNome: string;
  dificuldade: number | null;
  tipo: string | null;
  nivel: string | null;
  anulada: boolean;
  desatualizada: boolean;
  hasImage: boolean;
  enunciado: string;
  enunciadoBusca: string;
  respostaItemId: number | null;
  itens: ItemQuestao[];
  provas: ProvaQuestao[];
  comentarios: Questao["comentarios"];
  bancaIds: number[];
  orgaoIds: number[];
  cargoIds: number[];
  carreiraIds: number[];
  areaIds: number[];
  assuntoIds: number[];
  anos: number[];
  timestamp: string;
}

interface ItemResposta {
  questaoId: number;
  itemId: number;
  correta: boolean;
  respondidoEm: string;
  disciplinaId: number;
}

let clienteDoc: DynamoDBDocumentClient | undefined;
function getCliente(): DynamoDBDocumentClient {
  if (clienteDoc) return clienteDoc;
  const base = new DynamoDBClient({ region: env.aws.region });
  clienteDoc = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return clienteDoc;
}

async function scanCompleto<T>(params: ScanCommandInput): Promise<T[]> {
  const doc = getCliente();
  const itens: T[] = [];
  let ExclusiveStartKey: ScanCommandInput["ExclusiveStartKey"];
  do {
    const res = await doc.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    itens.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return itens;
}

async function queryCompleto<T>(params: QueryCommandInput): Promise<T[]> {
  const doc = getCliente();
  const itens: T[] = [];
  let ExclusiveStartKey: QueryCommandInput["ExclusiveStartKey"];
  do {
    const res = await doc.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    itens.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return itens;
}

const LOOKUP_TIPO: Record<LookupTipo, string> = {
  bancas: "banca",
  orgaos: "orgao",
  cargos: "cargo",
  assuntos: "assunto",
};

function montarFilterExpression(f: FiltrosQuery) {
  const partes: string[] = [];
  const nomes: Record<string, string> = {};
  const valores: Record<string, unknown> = {};
  let contador = 0;

  const algumContem = (attr: string, valoresLista: (number | string)[]) => {
    nomes[`#${attr}`] = attr;
    const ors = valoresLista.map((v) => {
      const chave = `:v${contador++}`;
      valores[chave] = v;
      return `contains(#${attr}, ${chave})`;
    });
    return ors.length > 1 ? `(${ors.join(" OR ")})` : ors[0];
  };

  const algumIgual = (attr: string, valoresLista: (number | string)[]) => {
    nomes[`#${attr}`] = attr;
    const ors = valoresLista.map((v) => {
      const chave = `:v${contador++}`;
      valores[chave] = v;
      return `#${attr} = ${chave}`;
    });
    return ors.length > 1 ? `(${ors.join(" OR ")})` : ors[0];
  };

  if (f.assunto.length) partes.push(algumContem("assuntoIds", f.assunto));
  if (f.banca.length) partes.push(algumContem("bancaIds", f.banca));
  if (f.orgao.length) partes.push(algumContem("orgaoIds", f.orgao));
  if (f.cargo.length) partes.push(algumContem("cargoIds", f.cargo));
  if (f.carreira.length) partes.push(algumContem("carreiraIds", f.carreira));
  if (f.area.length) partes.push(algumContem("areaIds", f.area));
  if (f.ano.length) partes.push(algumContem("anos", f.ano));
  if (f.dificuldade.length) partes.push(algumIgual("dificuldade", f.dificuldade));
  if (f.escolaridade.length) partes.push(algumIgual("nivel", f.escolaridade));
  if (f.tipo.length) partes.push(algumIgual("tipo", f.tipo));

  if (!f.incluirAnuladas) {
    nomes["#anulada"] = "anulada";
    valores[":anuladaFalse"] = false;
    partes.push("#anulada = :anuladaFalse");
  }
  if (!f.incluirDesatualizadas) {
    nomes["#desatualizada"] = "desatualizada";
    valores[":desatFalse"] = false;
    partes.push("#desatualizada = :desatFalse");
  }

  const COMENTARIO_ATTR: Record<string, string> = {
    ia: "comentariosIa",
    professor: "comentariosProfessor",
    professorVideo: "comentariosProfessorVideo",
    aluno: "comentariosAluno",
  };
  const comentariosValidos = f.comentarios.filter((c) => c in COMENTARIO_ATTR);
  if (comentariosValidos.length) {
    valores[":cTrue"] = true;
    const ors = comentariosValidos.map((c) => {
      const attr = COMENTARIO_ATTR[c];
      nomes[`#${attr}`] = attr;
      return `#${attr} = :cTrue`;
    });
    partes.push(`(${ors.join(" OR ")})`);
  }

  if (f.q?.trim()) {
    nomes["#enunciadoBusca"] = "enunciadoBusca";
    valores[":q"] = f.q.trim().toLowerCase();
    partes.push("contains(#enunciadoBusca, :q)");
  }

  return {
    FilterExpression: partes.length ? partes.join(" AND ") : undefined,
    ExpressionAttributeNames: Object.keys(nomes).length ? nomes : undefined,
    ExpressionAttributeValues: Object.keys(valores).length ? valores : undefined,
  };
}

export class RepositorioDynamo implements Repositorio {
  capacidades: Capacidades = { ordenacaoPorDificuldade: false };

  private cacheLookups: Map<string, ItemLookup[]> | null = null;
  private cacheCandidatos = new Map<string, { expira: number; itens: ItemQuestaoDynamo[] }>();
  private readonly TTL_CACHE_MS = 60_000;

  private async carregarLookups(): Promise<Map<string, ItemLookup[]>> {
    if (this.cacheLookups) return this.cacheLookups;
    const itens = await scanCompleto<ItemLookup>({ TableName: TABELA_LOOKUPS });
    const mapa = new Map<string, ItemLookup[]>();
    for (const item of itens) {
      const lista = mapa.get(item.tipo) ?? [];
      lista.push(item);
      mapa.set(item.tipo, lista);
    }
    this.cacheLookups = mapa;
    return mapa;
  }

  async filtrosBase(): Promise<FiltrosBase> {
    const mapa = await this.carregarLookups();
    const porQtdDesc = (a: { qtdQuestoes: number }, b: { qtdQuestoes: number }) => b.qtdQuestoes - a.qtdQuestoes;
    const toOpcao = (i: ItemLookup): OpcaoFiltro => ({ id: i.id, nome: i.nome, qtdQuestoes: i.qtdQuestoes });

    return {
      disciplinas: (mapa.get("disciplina") ?? [])
        .map((i) => ({ id: i.id, nome: i.nome, slug: i.slug ?? "", qtdQuestoes: i.qtdQuestoes }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      carreiras: (mapa.get("carreira") ?? []).map(toOpcao).sort(porQtdDesc),
      areas: (mapa.get("area") ?? []).map(toOpcao).sort(porQtdDesc),
      anos: (mapa.get("ano") ?? [])
        .map((i) => ({ ano: i.id, qtdQuestoes: i.qtdQuestoes }))
        .sort((a, b) => b.ano - a.ano),
      dificuldades: (mapa.get("dificuldade") ?? [])
        .map((i) => ({ dificuldade: i.id, qtdQuestoes: i.qtdQuestoes }))
        .sort((a, b) => a.dificuldade - b.dificuldade),
      escolaridades: (mapa.get("escolaridade") ?? [])
        .map((i) => ({ nivel: i.nome, qtdQuestoes: i.qtdQuestoes }))
        .sort(porQtdDesc),
      tipos: (mapa.get("tipoQuestao") ?? [])
        .map((i) => ({ tipo: i.nome, qtdQuestoes: i.qtdQuestoes }))
        .sort(porQtdDesc),
    };
  }

  async buscarLookup(tipo: LookupTipo, q: string, limit: number): Promise<OpcaoFiltro[]> {
    const mapa = await this.carregarLookups();
    const lista = mapa.get(LOOKUP_TIPO[tipo]) ?? [];
    const termo = q.trim().toLowerCase();
    return lista
      .filter((i) => i.qtdQuestoes > 0 && (!termo || i.nome.toLowerCase().includes(termo)))
      .sort((a, b) => b.qtdQuestoes - a.qtdQuestoes)
      .slice(0, limit)
      .map((i) => ({ id: i.id, nome: i.nome, qtdQuestoes: i.qtdQuestoes }));
  }

  private async buscarCandidatos(f: FiltrosQuery): Promise<ItemQuestaoDynamo[]> {
    const assinatura = JSON.stringify({ ...f, page: undefined, perPage: undefined });
    const cache = this.cacheCandidatos.get(assinatura);
    if (cache && cache.expira > Date.now()) return cache.itens;

    const { FilterExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
      montarFilterExpression(f);

    let itens: ItemQuestaoDynamo[];
    if (f.disciplina.length) {
      const porDisciplina = await Promise.all(
        f.disciplina.map((disciplinaId) =>
          queryCompleto<ItemQuestaoDynamo>({
            TableName: TABELA_QUESTOES,
            IndexName: INDICE_DISCIPLINA,
            KeyConditionExpression: "disciplinaId = :disc",
            FilterExpression,
            ExpressionAttributeNames,
            ExpressionAttributeValues: { ...ExpressionAttributeValues, ":disc": disciplinaId },
          }),
        ),
      );
      itens = porDisciplina.flat();
    } else {
      itens = await scanCompleto<ItemQuestaoDynamo>({
        TableName: TABELA_QUESTOES,
        FilterExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      });
    }

    // Sem GSI de dificuldade nesse desenho "simples" — ordena sempre por id
    // (proxy de mais recente); capacidades.ordenacaoPorDificuldade=false diz
    // ao frontend pra não oferecer as opções de ordenar por dificuldade.
    itens.sort((a, b) => b.id - a.id);

    this.cacheCandidatos.set(assinatura, { expira: Date.now() + this.TTL_CACHE_MS, itens });
    return itens;
  }

  private async buscarRespostasEmLote(ids: number[]): Promise<Map<number, ItemResposta>> {
    const mapa = new Map<number, ItemResposta>();
    const doc = getCliente();
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      if (!lote.length) continue;
      const res = await doc.send(
        new BatchGetCommand({
          RequestItems: { [TABELA_RESPOSTAS]: { Keys: lote.map((id) => ({ questaoId: id })) } },
        }),
      );
      for (const item of (res.Responses?.[TABELA_RESPOSTAS] as ItemResposta[]) ?? []) {
        mapa.set(item.questaoId, item);
      }
    }
    return mapa;
  }

  private converterQuestao(item: ItemQuestaoDynamo, resposta?: ItemResposta): Questao {
    const jaRespondida = !!resposta;
    return {
      id: item.id,
      dificuldade: item.dificuldade,
      tipo: item.tipo,
      nivel: item.nivel,
      anulada: item.anulada,
      desatualizada: item.desatualizada,
      hasImage: item.hasImage,
      enunciado: item.enunciado,
      disciplina: { id: item.disciplinaId, nome: item.disciplinaNome },
      itens: item.itens,
      provas: item.provas,
      comentarios: item.comentarios,
      respostaCorretaId: jaRespondida ? item.respostaItemId : null,
      minhaResposta: jaRespondida
        ? { itemId: resposta.itemId, correta: resposta.correta, respondidoEm: resposta.respondidoEm }
        : null,
    };
  }

  async listarQuestoes(f: FiltrosQuery): Promise<ListaQuestoesResultado> {
    let itens = await this.buscarCandidatos(f);

    let mapaRespostas: Map<number, ItemResposta> | null = null;
    if (f.minhasQuestoes) {
      mapaRespostas = await this.buscarRespostasEmLote(itens.map((i) => i.id));
      itens = itens.filter((item) => {
        const r = mapaRespostas!.get(item.id);
        switch (f.minhasQuestoes) {
          case "resolvidas":
            return !!r;
          case "naoresolvidas":
            return !r;
          case "certas":
            return r?.correta === true;
          case "erradas":
            return r?.correta === false;
          default:
            return true;
        }
      });
    }

    const total = itens.length;
    const inicio = (f.page - 1) * f.perPage;
    const pagina = itens.slice(inicio, inicio + f.perPage);

    const respostasPagina = mapaRespostas ?? (await this.buscarRespostasEmLote(pagina.map((i) => i.id)));
    const rows = pagina.map((item) => this.converterQuestao(item, respostasPagina.get(item.id)));

    return { total, page: f.page, perPage: f.perPage, rows };
  }

  async responder(questaoId: number, itemId: number): Promise<RespostaEnviada | null> {
    const doc = getCliente();
    const res = await doc.send(new GetCommand({ TableName: TABELA_QUESTOES, Key: { id: questaoId } }));
    const questao = res.Item as ItemQuestaoDynamo | undefined;
    if (!questao) return null;

    const correta = questao.respostaItemId != null && itemId === questao.respostaItemId;

    await doc.send(
      new PutCommand({
        TableName: TABELA_RESPOSTAS,
        Item: {
          questaoId,
          itemId,
          correta,
          respondidoEm: new Date().toISOString(),
          disciplinaId: questao.disciplinaId,
        } satisfies ItemResposta,
      }),
    );

    return { correta, respostaCorretaId: questao.respostaItemId };
  }

  async resetarResposta(questaoId: number): Promise<void> {
    await getCliente().send(new DeleteCommand({ TableName: TABELA_RESPOSTAS, Key: { questaoId } }));
  }

  async estatisticas(): Promise<Estatisticas> {
    const todas = await scanCompleto<ItemResposta>({ TableName: TABELA_RESPOSTAS });
    const respondidas = todas.length;
    const certas = todas.filter((r) => r.correta).length;
    const erradas = respondidas - certas;

    const porDisciplinaMapa = new Map<number, { respondidas: number; certas: number }>();
    for (const r of todas) {
      const atual = porDisciplinaMapa.get(r.disciplinaId) ?? { respondidas: 0, certas: 0 };
      atual.respondidas++;
      if (r.correta) atual.certas++;
      porDisciplinaMapa.set(r.disciplinaId, atual);
    }

    const mapaLookups = await this.carregarLookups();
    const nomesPorId = new Map((mapaLookups.get("disciplina") ?? []).map((d) => [d.id, d.nome]));

    const porDisciplina = [...porDisciplinaMapa.entries()]
      .map(([id, v]) => ({
        id,
        nome: nomesPorId.get(id) ?? `Disciplina ${id}`,
        respondidas: v.respondidas,
        certas: v.certas,
      }))
      .sort((a, b) => b.respondidas - a.respondidas);

    return {
      respondidas,
      certas,
      erradas,
      percentualAcerto: respondidas > 0 ? (certas / respondidas) * 100 : 0,
      porDisciplina,
    };
  }
}
