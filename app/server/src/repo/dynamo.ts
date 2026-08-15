import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import type {
  Capacidades,
  Cliente,
  ClienteComEstatisticas,
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
// PK clienteGuid, SK questaoId — respostas são escopadas por cliente (ver
// middleware/auth.ts). Serve tanto a leitura/escrita pontual quanto "quantas
// questões o cliente X respondeu" como Query na partição dele, sem Scan.
export const TABELA_RESPOSTAS = `${env.aws.tablePrefix}respostas`;
export const TABELA_LOOKUPS = `${env.aws.tablePrefix}lookups`;
// PK guid, sem SK — identidade de quem acessa via link de convite.
export const TABELA_CLIENTES = `${env.aws.tablePrefix}clientes`;
// Índice original, com ProjectionType ALL. Nenhuma consulta usa mais — fica
// aqui só pro script de limpeza saber o nome. Pode ser apagado depois que os
// índices enxutos estiverem em produção.
export const INDICE_DISCIPLINA = "disciplina-index";

// Índices enxutos (ProjectionType INCLUDE só com o que os filtros leem). O
// disciplina-index antigo projeta ALL, ou seja, cada entrada é uma cópia
// integral da questão (~3,2KB) — ler só os ids dele custava 375 itens por ida
// ao DynamoDB. Com a projeção enxuta cabem ~3x mais itens por página de 1MB.
export const INDICE_BUSCA = "busca-index";
export const INDICE_GLOBAL = "global-index";

// Sem filtro de disciplina não há partição natural pra consultar em ordem —
// esse shard sintético (id % TOTAL_SHARDS) dá ao global-index um punhado de
// partições que dá pra varrer em paralelo e juntar por merge, em vez de um
// Scan da tabela inteira. Precisa bater com o valor gravado pelo
// sincronizar-dynamo.ts; mudar isso exige regravar todas as questões.
export const TOTAL_SHARDS = 8;

// Partição de lookup com a contagem de assuntos escopada a uma disciplina:
// tipo = "assunto-disc-<disciplinaId>", id = assuntoId. Assim o seletor de
// Assunto lê uma partição pequena em vez de percorrer todas as questões da
// disciplina só pra contar.
export const PREFIXO_ASSUNTO_DISCIPLINA = "assunto-disc-";

// Atributos que o busca-index/global-index projetam. Tudo que
// montarFilterExpression consegue tocar precisa estar aqui, senão o filtro
// silenciosamente não casa (a projeção é aplicada na escrita do índice).
export const ATRIBUTOS_PROJETADOS = [
  "bancaIds",
  "orgaoIds",
  "cargoIds",
  "carreiraIds",
  "areaIds",
  "assuntoIds",
  "anos",
  "dificuldade",
  "nivel",
  "tipo",
  "anulada",
  "desatualizada",
  "comentarios",
  "enunciadoBusca",
];

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
  clienteGuid: string;
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

  // O item grava um mapa aninhado (comentarios: {ia, professor, ...}), não
  // atributos de topo. Antes isso apontava pra "comentariosIa" e afins, que
  // não existem em item nenhum — o filtro de comentários nunca casava e
  // sempre devolvia zero questões. FilterExpression aceita caminho aninhado.
  const CAMPO_COMENTARIO: Record<string, string> = {
    ia: "ia",
    professor: "professor",
    professorVideo: "professorVideo",
    aluno: "aluno",
  };
  const comentariosValidos = f.comentarios.filter((c) => c in CAMPO_COMENTARIO);
  if (comentariosValidos.length) {
    nomes["#comentarios"] = "comentarios";
    valores[":cTrue"] = true;
    const ors = comentariosValidos.map((c) => {
      const campo = CAMPO_COMENTARIO[c];
      nomes[`#c_${campo}`] = campo;
      return `#comentarios.#c_${campo} = :cTrue`;
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

// Espelho em memória de montarFilterExpression, usado só no caminho de
// resolvidas/certas/erradas, onde o conjunto candidato vem da tabela de
// respostas (pequeno) em vez do índice. Mexeu num, mexa no outro.
function casaFiltros(q: ItemQuestaoDynamo, f: FiltrosQuery): boolean {
  const algum = (ids: number[] | undefined, escolhidos: number[]) =>
    !escolhidos.length || escolhidos.some((v) => (ids ?? []).includes(v));

  if (!algum(q.assuntoIds, f.assunto)) return false;
  if (!algum(q.bancaIds, f.banca)) return false;
  if (!algum(q.orgaoIds, f.orgao)) return false;
  if (!algum(q.cargoIds, f.cargo)) return false;
  if (!algum(q.carreiraIds, f.carreira)) return false;
  if (!algum(q.areaIds, f.area)) return false;
  if (!algum(q.anos, f.ano)) return false;
  if (f.disciplina.length && !f.disciplina.includes(q.disciplinaId)) return false;
  if (f.dificuldade.length && (q.dificuldade == null || !f.dificuldade.includes(q.dificuldade))) return false;
  if (f.escolaridade.length && (!q.nivel || !f.escolaridade.includes(q.nivel))) return false;
  if (f.tipo.length && (!q.tipo || !f.tipo.includes(q.tipo))) return false;
  if (!f.incluirAnuladas && q.anulada) return false;
  if (!f.incluirDesatualizadas && q.desatualizada) return false;

  if (f.comentarios.length) {
    const c = q.comentarios;
    const bate = f.comentarios.some(
      (nome) =>
        (nome === "ia" && c?.ia) ||
        (nome === "professor" && c?.professor) ||
        (nome === "professorVideo" && c?.professorVideo) ||
        (nome === "aluno" && c?.aluno),
    );
    if (!bate) return false;
  }

  const termo = f.q?.trim().toLowerCase();
  if (termo && !(q.enunciadoBusca ?? "").includes(termo)) return false;

  return true;
}

// Estado do merge k-way entre as partições consultadas (as disciplinas
// escolhidas, ou os shards do global-index quando não há disciplina).
interface EstadoParticao {
  cursor?: Record<string, unknown>;
  esgotada: boolean;
  buffer: number[];
}

interface EstadoPagina {
  particoes: Map<number, EstadoParticao>;
  // quantos ids já foram entregues desde a página 1 — vira o "1.000+" quando
  // não dá pra saber o total exato.
  entregues: number;
}

// Teto de idas ao DynamoDB por página, pra um filtro muito seletivo (que lê
// muito e aproveita pouco) não transformar uma requisição em varredura.
const MAX_IDAS_POR_PAGINA = 60;

function novoEstado(f: FiltrosQuery): EstadoPagina {
  const chaves = f.disciplina.length
    ? f.disciplina
    : Array.from({ length: TOTAL_SHARDS }, (_, i) => i);
  return {
    particoes: new Map(chaves.map((c) => [c, { esgotada: false, buffer: [] }])),
    entregues: 0,
  };
}

function clonarEstado(e: EstadoPagina): EstadoPagina {
  return {
    entregues: e.entregues,
    particoes: new Map(
      [...e.particoes].map(([c, p]) => [
        c,
        { cursor: p.cursor, esgotada: p.esgotada, buffer: [...p.buffer] },
      ]),
    ),
  };
}

const chaveEstado = (assinatura: string, perPage: number, page: number) =>
  `${assinatura}|${perPage}|${page}`;

export class RepositorioDynamo implements Repositorio {
  capacidades: Capacidades = { ordenacaoPorDificuldade: false };

  private cacheLookups = new Map<string, ItemLookup[]>();
  // Cursor de cada (filtro, perPage, página), pra servir a página seguinte sem
  // repercorrer o que já foi lido. RepositorioDynamo é uma instância única
  // reaproveitada por todas as requisições do processo — a chave (assinatura,
  // ver listarQuestoes) inclui o clienteGuid de propósito, senão o cursor
  // cacheado do filtro "não resolvidas" de um cliente vazaria pro próximo
  // cliente que pedir a mesma combinação de filtros.
  private cacheEstados = new Map<string, { expira: number; estado: EstadoPagina }>();
  // Por cliente — mesmo motivo acima. Um Map único e compartilhado misturaria
  // as respostas de clientes diferentes.
  private cacheRespostas = new Map<string, { expira: number; itens: ItemResposta[] }>();
  private cacheAssuntosPorDisciplina = new Map<
    string,
    { expira: number; contagens: Map<number, { nome: string; qtd: number }> }
  >();
  private readonly TTL_CACHE_MS = 60_000;

  // Assuntos de uma disciplina, com quantas questões cada um tem ali dentro.
  // O caminho rápido lê a contagem que o sync já deixou pronta numa partição
  // pequena; sem ela, percorre a partição da disciplina e conta (era o único
  // caminho antes, e custava os mesmos ~30s da listagem).
  private async contarAssuntosPorDisciplina(
    disciplinaIds: number[],
  ): Promise<Map<number, { nome: string; qtd: number }>> {
    const chave = [...disciplinaIds].sort((a, b) => a - b).join(",");
    const cache = this.cacheAssuntosPorDisciplina.get(chave);
    if (cache && cache.expira > Date.now()) return cache.contagens;

    const porDisciplina = await Promise.all(
      disciplinaIds.map(async (disciplinaId) => {
        // Caminho rápido: contagem já pré-calculada pelo sync, numa partição
        // própria e pequena.
        const prontas = await queryCompleto<ItemLookup>({
          TableName: TABELA_LOOKUPS,
          KeyConditionExpression: "tipo = :t",
          ExpressionAttributeValues: { ":t": `${PREFIXO_ASSUNTO_DISCIPLINA}${disciplinaId}` },
        });
        // O registro pré-calculado já traz o nome, então nem precisa carregar
        // a lista inteira de assuntos pra montar o seletor.
        if (prontas.length) return prontas.map((l) => [l.id, { nome: l.nome, qtd: l.qtdQuestoes }] as const);

        // Disciplina ainda não re-sincronizada (as que só têm a amostra de
        // 10%): percorre a partição inteira pra contar. Lento, mas correto —
        // e some sozinho conforme as disciplinas são migradas. Usa o
        // busca-index (não o disciplina-index antigo, que projeta ALL e custa
        // ~3x mais por item lido) pra que o índice antigo possa ser apagado.
        const itens = await queryCompleto<{ assuntoIds?: number[] }>({
          TableName: TABELA_QUESTOES,
          IndexName: INDICE_BUSCA,
          KeyConditionExpression: "disciplinaId = :disc",
          ProjectionExpression: "assuntoIds",
          ExpressionAttributeValues: { ":disc": disciplinaId },
        });
        const parcial = new Map<number, number>();
        for (const item of itens) {
          for (const assuntoId of item.assuntoIds ?? []) {
            parcial.set(assuntoId, (parcial.get(assuntoId) ?? 0) + 1);
          }
        }
        // Sem contagem pronta não há nome junto: aí sim busca a lista de
        // assuntos (caminho lento, só pras disciplinas ainda não migradas).
        const nomes = new Map((await this.lookups("assunto")).map((i) => [i.id, i.nome]));
        return [...parcial.entries()].map(
          ([id, qtd]) => [id, { nome: nomes.get(id) ?? `Assunto ${id}`, qtd }] as const,
        );
      }),
    );

    const contagens = new Map<number, { nome: string; qtd: number }>();
    for (const lista of porDisciplina) {
      for (const [assuntoId, info] of lista) {
        const atual = contagens.get(assuntoId);
        contagens.set(assuntoId, { nome: info.nome, qtd: (atual?.qtd ?? 0) + info.qtd });
      }
    }

    if (this.cacheAssuntosPorDisciplina.size > 50) this.cacheAssuntosPorDisciplina.clear();
    this.cacheAssuntosPorDisciplina.set(chave, { expira: Date.now() + this.TTL_CACHE_MS, contagens });
    return contagens;
  }

  // Carrega UM tipo de lookup, sob demanda. Query por tipo (que é a PK) em vez
  // de Scan: a tabela também guarda as partições "assunto-disc-<id>", que
  // somadas passam de 100 mil itens e não têm nada a ver com os filtros base.
  //
  // Sob demanda, e não tudo de uma vez, porque "assunto" sozinho tem ~30 mil
  // registros e quase nenhuma tela precisa dele — carregar os 11 tipos juntos
  // custava 3-4s na primeira requisição, o que no Render free (que hiberna)
  // seria pago toda vez que o serviço acorda.
  private async lookups(tipo: string): Promise<ItemLookup[]> {
    const emCache = this.cacheLookups.get(tipo);
    if (emCache) return emCache;
    const itens = await queryCompleto<ItemLookup>({
      TableName: TABELA_LOOKUPS,
      KeyConditionExpression: "tipo = :t",
      ExpressionAttributeValues: { ":t": tipo },
    });
    this.cacheLookups.set(tipo, itens);
    return itens;
  }

  async filtrosBase(): Promise<FiltrosBase> {
    // Só os tipos que esta tela mostra — "assunto" (o maior, ~30 mil) fica de
    // fora porque o seletor de Assunto é carregado à parte, por disciplina.
    const [disciplina, carreira, area, ano, dificuldade, escolaridade, tipoQuestao] = await Promise.all(
      ["disciplina", "carreira", "area", "ano", "dificuldade", "escolaridade", "tipoQuestao"].map((t) =>
        this.lookups(t),
      ),
    );
    const porQtdDesc = (a: { qtdQuestoes: number }, b: { qtdQuestoes: number }) => b.qtdQuestoes - a.qtdQuestoes;
    const toOpcao = (i: ItemLookup): OpcaoFiltro => ({ id: i.id, nome: i.nome, qtdQuestoes: i.qtdQuestoes });

    return {
      disciplinas: disciplina
        .map((i) => ({ id: i.id, nome: i.nome, slug: i.slug ?? "", qtdQuestoes: i.qtdQuestoes }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      carreiras: carreira.map(toOpcao).sort(porQtdDesc),
      areas: area.map(toOpcao).sort(porQtdDesc),
      anos: ano.map((i) => ({ ano: i.id, qtdQuestoes: i.qtdQuestoes })).sort((a, b) => b.ano - a.ano),
      dificuldades: dificuldade
        .map((i) => ({ dificuldade: i.id, qtdQuestoes: i.qtdQuestoes }))
        .sort((a, b) => a.dificuldade - b.dificuldade),
      escolaridades: escolaridade.map((i) => ({ nivel: i.nome, qtdQuestoes: i.qtdQuestoes })).sort(porQtdDesc),
      tipos: tipoQuestao.map((i) => ({ tipo: i.nome, qtdQuestoes: i.qtdQuestoes })).sort(porQtdDesc),
    };
  }

  async buscarLookup(
    tipo: LookupTipo,
    q: string,
    limit: number,
    disciplinaIds?: number[],
  ): Promise<OpcaoFiltro[]> {
    const termo = q.trim().toLowerCase();

    if (tipo === "assuntos") {
      if (!disciplinaIds?.length) return [];
      const contagens = await this.contarAssuntosPorDisciplina(disciplinaIds);
      return [...contagens.entries()]
        .map(([id, { nome, qtd }]) => ({ id, nome, qtdQuestoes: qtd }))
        .filter((o) => !termo || o.nome.toLowerCase().includes(termo))
        .sort((a, b) => b.qtdQuestoes - a.qtdQuestoes)
        .slice(0, limit);
    }

    const lista = await this.lookups(LOOKUP_TIPO[tipo]);
    return lista
      .filter((i) => i.qtdQuestoes > 0 && (!termo || i.nome.toLowerCase().includes(termo)))
      .sort((a, b) => b.qtdQuestoes - a.qtdQuestoes)
      .slice(0, limit)
      .map((i) => ({ id: i.id, nome: i.nome, qtdQuestoes: i.qtdQuestoes }));
  }

  // Avança o estado de paginação em `quantidade` ids, na ordem global de id
  // decrescente, lendo só o necessário.
  //
  // O desenho anterior materializava TODOS os ids que batiam com o filtro,
  // ordenava em memória e cortava a página — O(N) por requisição. Medido em
  // produção com 566 mil questões: 304 idas ao DynamoDB e ~38.000 RCU pra
  // devolver 20 itens (30s). Aqui os índices já entregam ordenado por id
  // (SK do índice, com ScanIndexForward: false), então basta ler a página:
  // ~10 RCU e uma ida por partição.
  private async avancar(
    f: FiltrosQuery,
    estado: EstadoPagina,
    quantidade: number,
    ignorar?: Set<number>,
  ): Promise<number[]> {
    const { FilterExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
      montarFilterExpression(f);
    const porDisciplina = f.disciplina.length > 0;
    const doc = getCliente();

    // Com FilterExpression o Limit conta itens LIDOS, não os que passam — ler
    // blocos maiores evita dezenas de viagens quando o filtro é seletivo.
    const limitePorIda = FilterExpression ? 400 : Math.max(quantidade, 25);
    let idas = 0;

    const abastecer = async (chave: number, p: EstadoParticao) => {
      while (!p.esgotada && p.buffer.length === 0 && idas < MAX_IDAS_POR_PAGINA) {
        idas++;
        const res = await doc.send(
          new QueryCommand({
            TableName: TABELA_QUESTOES,
            IndexName: porDisciplina ? INDICE_BUSCA : INDICE_GLOBAL,
            // "shard" é palavra reservada no DynamoDB — só funciona via alias.
            KeyConditionExpression: "#pk = :p",
            FilterExpression,
            ProjectionExpression: "#id",
            ExpressionAttributeNames: {
              ...ExpressionAttributeNames,
              "#id": "id",
              "#pk": porDisciplina ? "disciplinaId" : "shard",
            },
            ExpressionAttributeValues: { ...ExpressionAttributeValues, ":p": chave },
            ScanIndexForward: false,
            Limit: limitePorIda,
            ExclusiveStartKey: p.cursor,
          }),
        );
        for (const item of ((res.Items ?? []) as { id: number }[])) {
          if (!ignorar?.has(item.id)) p.buffer.push(item.id);
        }
        p.cursor = res.LastEvaluatedKey;
        if (!res.LastEvaluatedKey) p.esgotada = true;
      }
    };

    const ids: number[] = [];
    while (ids.length < quantidade) {
      // Todas as partições precisam ter pelo menos um id disponível antes de
      // escolher o próximo, senão o merge pode entregar fora de ordem.
      await Promise.all([...estado.particoes].map(([chave, p]) => abastecer(chave, p)));

      let melhorChave: number | null = null;
      let melhorId = -Infinity;
      for (const [chave, p] of estado.particoes) {
        if (p.buffer.length && p.buffer[0] > melhorId) {
          melhorId = p.buffer[0];
          melhorChave = chave;
        }
      }
      // nada disponível em partição nenhuma (tudo esgotado, ou o teto de idas
      // foi atingido) — devolve o que deu
      if (melhorChave === null) break;

      estado.particoes.get(melhorChave)!.buffer.shift();
      ids.push(melhorId);
    }

    estado.entregues += ids.length;
    return ids;
  }

  private temMais(estado: EstadoPagina): boolean {
    return [...estado.particoes.values()].some((p) => p.buffer.length > 0 || !p.esgotada);
  }

  // Estado inicial da página pedida. Página 1 começa do zero; as demais
  // reaproveitam o cursor guardado ao servir a página anterior, e só
  // percorrem de novo se o cache expirou (agora barato: cada página custa
  // ~10 RCU, não 38.000).
  private async estadoParaPagina(
    f: FiltrosQuery,
    assinatura: string,
    ignorar?: Set<number>,
  ): Promise<EstadoPagina> {
    if (f.page <= 1) return novoEstado(f);

    const direto = this.cacheEstados.get(chaveEstado(assinatura, f.perPage, f.page));
    if (direto && direto.expira > Date.now()) return clonarEstado(direto.estado);

    let paginaBase = 1;
    let estado = novoEstado(f);
    for (let p = f.page - 1; p > 1; p--) {
      const c = this.cacheEstados.get(chaveEstado(assinatura, f.perPage, p));
      if (c && c.expira > Date.now()) {
        paginaBase = p;
        estado = clonarEstado(c.estado);
        break;
      }
    }
    for (let p = paginaBase; p < f.page; p++) {
      await this.avancar(f, estado, f.perPage, ignorar);
    }
    return estado;
  }

  private guardarEstado(assinatura: string, perPage: number, page: number, estado: EstadoPagina) {
    if (this.cacheEstados.size > 200) this.cacheEstados.clear();
    this.cacheEstados.set(chaveEstado(assinatura, perPage, page), {
      expira: Date.now() + this.TTL_CACHE_MS,
      estado: clonarEstado(estado),
    });
  }

  // Total exato só quando sai de graça das contagens já pré-calculadas em
  // gabarita-lookups. Numa combinação de filtros, contar exige percorrer o
  // conjunto inteiro — exatamente o que esta reescrita eliminou —, então aí
  // o total vira "quantos vimos até agora" e o frontend mostra "1.000+".
  private async totalPreCalculado(f: FiltrosQuery): Promise<number | null> {
    // As contagens são gravadas já descontando anuladas/desatualizadas, que é
    // o padrão da tela; pedir pra incluí-las sai desse caminho.
    if (f.incluirAnuladas || f.incluirDesatualizadas) return null;
    if (f.minhasQuestoes || f.q?.trim()) return null;

    const facetas: [string, (number | string)[]][] = [
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
      ["tipoQuestao", f.tipo],
      ["comentarios", f.comentarios],
    ];
    const ativas = facetas.filter(([, v]) => v.length);

    if (!ativas.length) {
      return (await this.lookups("disciplina")).reduce((s, d) => s + d.qtdQuestoes, 0);
    }
    // Duas facetas = interseção; vários valores da mesma faceta = união com
    // possível sobreposição. Nenhum dos dois dá pra derivar das contagens.
    const [tipo, valores] = ativas[0];
    if (ativas.length > 1 || valores.length !== 1 || tipo === "comentarios") return null;

    const lista = await this.lookups(tipo);
    const alvo = valores[0];
    // escolaridade e tipoQuestao são filtrados pelo nome (string); o resto por id.
    const achado =
      typeof alvo === "string" ? lista.find((i) => i.nome === alvo) : lista.find((i) => i.id === alvo);
    return achado ? achado.qtdQuestoes : null;
  }

  private async buscarQuestoesPorId(ids: number[]): Promise<ItemQuestaoDynamo[]> {
    if (!ids.length) return [];
    const doc = getCliente();
    const itens: ItemQuestaoDynamo[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const res = await doc.send(
        new BatchGetCommand({
          RequestItems: { [TABELA_QUESTOES]: { Keys: lote.map((id) => ({ id })) } },
        }),
      );
      itens.push(...((res.Responses?.[TABELA_QUESTOES] as ItemQuestaoDynamo[]) ?? []));
    }
    return itens;
  }

  private async buscarRespostasEmLote(clienteGuid: string, ids: number[]): Promise<Map<number, ItemResposta>> {
    const mapa = new Map<number, ItemResposta>();
    const doc = getCliente();
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      if (!lote.length) continue;
      const res = await doc.send(
        new BatchGetCommand({
          RequestItems: {
            [TABELA_RESPOSTAS]: { Keys: lote.map((id) => ({ clienteGuid, questaoId: id })) },
          },
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

  // Todas as respostas já dadas por um cliente. A partição de um cliente é
  // pequena por natureza (só o que ele mesmo respondeu), então cabe em
  // memória e evita ida por questão. Query (não Scan) na partição do cliente
  // — mais barato, e naturalmente escopado.
  private async carregarRespostas(clienteGuid: string): Promise<ItemResposta[]> {
    const cache = this.cacheRespostas.get(clienteGuid);
    if (cache && cache.expira > Date.now()) return cache.itens;
    const itens = await queryCompleto<ItemResposta>({
      TableName: TABELA_RESPOSTAS,
      KeyConditionExpression: "clienteGuid = :g",
      ExpressionAttributeValues: { ":g": clienteGuid },
    });
    this.cacheRespostas.set(clienteGuid, { expira: Date.now() + this.TTL_CACHE_MS, itens });
    return itens;
  }

  async listarQuestoes(clienteGuid: string, f: FiltrosQuery): Promise<ListaQuestoesResultado> {
    // "resolvidas/certas/erradas" já têm o conjunto candidato pronto e pequeno
    // na tabela de respostas — percorrer o índice de questões pra depois
    // descartar quase tudo seria muito pior.
    if (f.minhasQuestoes && f.minhasQuestoes !== "naoresolvidas") {
      return this.listarPorRespostas(clienteGuid, f);
    }

    const ignorar =
      f.minhasQuestoes === "naoresolvidas"
        ? new Set((await this.carregarRespostas(clienteGuid)).map((r) => r.questaoId))
        : undefined;

    // clienteGuid entra na assinatura de propósito — ver comentário em
    // cacheEstados.
    const assinatura = JSON.stringify({ clienteGuid, ...f, page: undefined, perPage: undefined });
    const estado = await this.estadoParaPagina(f, assinatura, ignorar);
    const ids = await this.avancar(f, estado, f.perPage, ignorar);
    const temMais = this.temMais(estado);
    this.guardarEstado(assinatura, f.perPage, f.page + 1, estado);

    const rows = await this.montarLinhas(clienteGuid, ids);

    const preCalculado = await this.totalPreCalculado(f);
    return {
      total: preCalculado ?? estado.entregues,
      // sem contagem pronta, "entregues" é só um piso — a menos que já tenha
      // acabado, aí o que vimos É o total.
      totalExato: preCalculado !== null || !temMais,
      temMais,
      page: f.page,
      perPage: f.perPage,
      rows,
    };
  }

  // Caminho para resolvidas/certas/erradas: parte da tabela de respostas
  // (pequena e já é o conjunto candidato) e aplica os demais filtros em
  // memória sobre os corpos — ver casaFiltros, que espelha
  // montarFilterExpression.
  private async listarPorRespostas(clienteGuid: string, f: FiltrosQuery): Promise<ListaQuestoesResultado> {
    const respostas = await this.carregarRespostas(clienteGuid);
    const candidatas = respostas.filter((r) =>
      f.minhasQuestoes === "certas" ? r.correta : f.minhasQuestoes === "erradas" ? !r.correta : true,
    );
    const ids = candidatas.map((r) => r.questaoId).sort((a, b) => b - a);

    const questoes = await this.buscarQuestoesPorId(ids);
    const porId = new Map(questoes.map((q) => [q.id, q]));
    const filtradas = ids.map((id) => porId.get(id)).filter((q): q is ItemQuestaoDynamo => !!q && casaFiltros(q, f));

    const inicio = (f.page - 1) * f.perPage;
    const pagina = filtradas.slice(inicio, inicio + f.perPage);
    const mapaRespostas = new Map(respostas.map((r) => [r.questaoId, r]));

    return {
      total: filtradas.length,
      totalExato: true,
      temMais: inicio + f.perPage < filtradas.length,
      page: f.page,
      perPage: f.perPage,
      rows: pagina.map((q) => this.converterQuestao(q, mapaRespostas.get(q.id))),
    };
  }

  // Só agora busca o corpo inteiro das questões — e só das ~20 a 100 desta
  // página, nunca do conjunto de candidatos inteiro.
  private async montarLinhas(clienteGuid: string, ids: number[]): Promise<Questao[]> {
    if (!ids.length) return [];
    const [questoes, respostas] = await Promise.all([
      this.buscarQuestoesPorId(ids),
      this.buscarRespostasEmLote(clienteGuid, ids),
    ]);
    const porId = new Map(questoes.map((q) => [q.id, q]));
    return ids
      .map((id) => porId.get(id))
      .filter((item): item is ItemQuestaoDynamo => !!item)
      .map((item) => this.converterQuestao(item, respostas.get(item.id)));
  }

  async responder(clienteGuid: string, questaoId: number, itemId: number): Promise<RespostaEnviada | null> {
    const doc = getCliente();
    const res = await doc.send(new GetCommand({ TableName: TABELA_QUESTOES, Key: { id: questaoId } }));
    const questao = res.Item as ItemQuestaoDynamo | undefined;
    if (!questao) return null;

    const correta = questao.respostaItemId != null && itemId === questao.respostaItemId;

    await doc.send(
      new PutCommand({
        TableName: TABELA_RESPOSTAS,
        Item: {
          clienteGuid,
          questaoId,
          itemId,
          correta,
          respondidoEm: new Date().toISOString(),
          disciplinaId: questao.disciplinaId,
        } satisfies ItemResposta,
      }),
    );

    // Sem isso o filtro "não resolvidas" continuaria mostrando esta questão
    // por até 60s (TTL do cache).
    this.cacheRespostas.delete(clienteGuid);
    return { correta, respostaCorretaId: questao.respostaItemId };
  }

  async resetarResposta(clienteGuid: string, questaoId: number): Promise<void> {
    await getCliente().send(
      new DeleteCommand({ TableName: TABELA_RESPOSTAS, Key: { clienteGuid, questaoId } }),
    );
    this.cacheRespostas.delete(clienteGuid);
  }

  async estatisticas(clienteGuid: string): Promise<Estatisticas> {
    const todas = await this.carregarRespostas(clienteGuid);
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

    const nomesPorId = new Map((await this.lookups("disciplina")).map((d) => [d.id, d.nome]));

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

  // Contagem enxuta (sem porDisciplina) — usada na listagem do /admin, onde
  // calcular o detalhamento por disciplina de cada cliente seria trabalho
  // que a tela nem exibe.
  private async contarRespostas(guid: string): Promise<{ respondidas: number; certas: number; erradas: number }> {
    const itens = await this.carregarRespostas(guid);
    const certas = itens.filter((r) => r.correta).length;
    return { respondidas: itens.length, certas, erradas: itens.length - certas };
  }

  async criarCliente(nome?: string): Promise<Cliente> {
    const cliente: Cliente = {
      guid: crypto.randomUUID(),
      nome: nome?.trim() || "Cliente novo",
      nomePersonalizado: null,
      criadoEm: new Date().toISOString(),
      ultimoAcesso: null,
    };
    await getCliente().send(new PutCommand({ TableName: TABELA_CLIENTES, Item: cliente }));
    return cliente;
  }

  async listarClientes(): Promise<ClienteComEstatisticas[]> {
    const clientes = await scanCompleto<Cliente>({ TableName: TABELA_CLIENTES });
    return Promise.all(
      clientes.map(async (c) => ({ ...c, ...(await this.contarRespostas(c.guid)) })),
    );
  }

  async buscarCliente(guid: string): Promise<Cliente | null> {
    const res = await getCliente().send(new GetCommand({ TableName: TABELA_CLIENTES, Key: { guid } }));
    return (res.Item as Cliente | undefined) ?? null;
  }

  async atualizarNomePersonalizado(guid: string, nome: string): Promise<void> {
    await getCliente().send(
      new UpdateCommand({
        TableName: TABELA_CLIENTES,
        Key: { guid },
        UpdateExpression: "SET nomePersonalizado = :n",
        ExpressionAttributeValues: { ":n": nome.trim() },
      }),
    );
  }

  async registrarAcesso(guid: string): Promise<void> {
    await getCliente().send(
      new UpdateCommand({
        TableName: TABELA_CLIENTES,
        Key: { guid },
        UpdateExpression: "SET ultimoAcesso = :u",
        ExpressionAttributeValues: { ":u": new Date().toISOString() },
      }),
    );
  }
}
