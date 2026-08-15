// Reconta qtdQuestoes de todos os filtros a partir do que está de fato em
// gabarita-questoes agora — não confia em contadores incrementais, então
// funciona corretamente mesmo com uma mistura de disciplinas em amostra
// parcial (10%) e disciplinas já sincronizadas 100% (ver sincronizar-dynamo.ts).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import { TABELA_LOOKUPS, TABELA_QUESTOES } from "../repo/dynamo.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.aws.region }));

interface ItemLeve {
  disciplinaId: number;
  dificuldade: number | null;
  nivel: string | null;
  tipo: string | null;
  anulada?: boolean;
  desatualizada?: boolean;
  bancaIds?: number[];
  orgaoIds?: number[];
  cargoIds?: number[];
  carreiraIds?: number[];
  areaIds?: number[];
  assuntoIds?: number[];
  anos?: number[];
}

async function scanCompleto<T>(params: ScanCommandInput): Promise<T[]> {
  const itens: T[] = [];
  let ExclusiveStartKey: ScanCommandInput["ExclusiveStartKey"];
  do {
    const res = await client.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    itens.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return itens;
}

const MAX_LOTES_EM_VOO = 4;

async function escreverUmLote(tabela: string, itensDoLote: Record<string, unknown>[]) {
  let lote = itensDoLote.map((Item) => ({ PutRequest: { Item } }));
  let tentativas = 0;
  while (lote.length) {
    try {
      const res = await client.send(new BatchWriteCommand({ RequestItems: { [tabela]: lote } }));
      const restantes = res.UnprocessedItems?.[tabela];
      if (!restantes?.length) break;
      lote = restantes as typeof lote;
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "ThrottlingException") throw e;
    }
    tentativas++;
    if (tentativas > 10) throw new Error("Muitas tentativas com throttling/itens pendentes ao regravar lookups");
    await new Promise((r) => setTimeout(r, 300 * tentativas));
  }
}

// Escreve vários lotes de 25 em paralelo (limitado) em vez de um de cada vez
// — com ~30 mil registros de lookup, sequencial levava minutos.
async function escreverEmLotes(tabela: string, itens: Record<string, unknown>[]) {
  let emVoo = 0;
  let erro: unknown = null;
  for (let i = 0; i < itens.length; i += 25) {
    if (erro) throw erro;
    const lote = itens.slice(i, i + 25);
    emVoo++;
    escreverUmLote(tabela, lote)
      .catch((e) => (erro = e))
      .finally(() => emVoo--);
    while (emVoo >= MAX_LOTES_EM_VOO) await new Promise((r) => setTimeout(r, 20));
  }
  while (emVoo > 0) await new Promise((r) => setTimeout(r, 20));
  if (erro) throw erro;
}

const inc = <K,>(mapa: Map<K, number>, chave: K) => mapa.set(chave, (mapa.get(chave) ?? 0) + 1);

export async function recomputarContagens(): Promise<void> {
  const disciplina = new Map<number, number>();
  const banca = new Map<number, number>();
  const orgao = new Map<number, number>();
  const cargo = new Map<number, number>();
  const carreira = new Map<number, number>();
  const area = new Map<number, number>();
  const assunto = new Map<number, number>();
  const ano = new Map<number, number>();
  const dificuldade = new Map<number, number>();
  const escolaridade = new Map<string, number>();
  const tipoQuestao = new Map<string, number>();

  let ExclusiveStartKey: ScanCommandInput["ExclusiveStartKey"];
  let lidos = 0;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: TABELA_QUESTOES,
        ProjectionExpression:
          "disciplinaId, dificuldade, nivel, tipo, anulada, desatualizada, bancaIds, orgaoIds, cargoIds, carreiraIds, areaIds, assuntoIds, anos",
        ExclusiveStartKey,
      }),
    );
    for (const item of (res.Items as ItemLeve[] | undefined) ?? []) {
      // Contagens descontam anuladas/desatualizadas, que a tela esconde por
      // padrão — assim o número exibido bate com o que a listagem devolve, e
      // totalPreCalculado (repo/dynamo.ts) pode confiar nele.
      if (item.anulada || item.desatualizada) continue;
      inc(disciplina, item.disciplinaId);
      if (item.dificuldade != null) inc(dificuldade, item.dificuldade);
      if (item.nivel) inc(escolaridade, item.nivel);
      if (item.tipo) inc(tipoQuestao, item.tipo);
      for (const id of item.bancaIds ?? []) inc(banca, id);
      for (const id of item.orgaoIds ?? []) inc(orgao, id);
      for (const id of item.cargoIds ?? []) inc(cargo, id);
      for (const id of item.carreiraIds ?? []) inc(carreira, id);
      for (const id of item.areaIds ?? []) inc(area, id);
      for (const id of item.assuntoIds ?? []) inc(assunto, id);
      for (const a of item.anos ?? []) inc(ano, a);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
    lidos += res.Items?.length ?? 0;
  } while (ExclusiveStartKey);
  console.log(`   ${lidos} questões no total na tabela.`);

  // disciplina/banca/orgao/cargo/carreira/area/assunto já têm nome/sigla/slug
  // gravados — busca o que existe hoje pra não perder isso ao regravar só a
  // contagem.
  const lookupsAtuais = await scanCompleto<Record<string, unknown>>({ TableName: TABELA_LOOKUPS });
  const porChave = new Map(lookupsAtuais.map((l) => [`${l.tipo}:${l.id}`, l]));

  const atualizacoes: Record<string, unknown>[] = [];
  const comNomeExistente: [string, Map<number, number>][] = [
    ["disciplina", disciplina],
    ["banca", banca],
    ["orgao", orgao],
    ["cargo", cargo],
    ["carreira", carreira],
    ["area", area],
    ["assunto", assunto],
  ];
  for (const [tipo, mapa] of comNomeExistente) {
    for (const [id, qtd] of mapa) {
      const atual = porChave.get(`${tipo}:${id}`);
      if (!atual) continue; // não deveria faltar — sincronizar-dynamo.ts faz upsert de nome antes de chamar isso
      atualizacoes.push({ ...atual, qtdQuestoes: qtd });
    }
  }

  // ano/dificuldade: o id É o próprio valor. escolaridade/tipoQuestao: o app
  // filtra pelo nome (string), não pelo id — então reatribuir ids
  // sequenciais novos a cada rodada é seguro (ver repo/dynamo.ts e
  // FiltroBarra.tsx, que usam sempre o valor, nunca o id, pra esses dois).
  for (const [valor, qtd] of ano) atualizacoes.push({ tipo: "ano", id: valor, nome: String(valor), qtdQuestoes: qtd });
  for (const [valor, qtd] of dificuldade)
    atualizacoes.push({ tipo: "dificuldade", id: valor, nome: String(valor), qtdQuestoes: qtd });
  let idEsc = 1;
  for (const [nome, qtd] of escolaridade)
    atualizacoes.push({ tipo: "escolaridade", id: idEsc++, nome, qtdQuestoes: qtd });
  let idTipo = 1;
  for (const [nome, qtd] of tipoQuestao)
    atualizacoes.push({ tipo: "tipoQuestao", id: idTipo++, nome, qtdQuestoes: qtd });

  console.log(`   gravando ${atualizacoes.length} registro(s) de contagem atualizados...`);
  await escreverEmLotes(TABELA_LOOKUPS, atualizacoes);
}
