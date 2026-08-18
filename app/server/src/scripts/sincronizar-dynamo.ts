// Sincroniza disciplinas específicas direto de dados/*.json pro DynamoDB de
// produção, SEM passar pelo SQLite local (mais rápido, e não mexe no banco
// local de dev, que continua na amostra de 10%).
//
// Progresso é salvo em server/data/sync-status.json a cada disciplina
// concluída — se o processo for interrompido (erro, timeout, Ctrl+C), rodar
// de novo pula o que já terminou e continua de onde parou.
//
// AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//   SYNC_PREFIXO=direito pnpm --filter gabarita-server sincronizar:dynamo
//
// SYNC_PREFIXO=direito   -> processa dados/direito*.json (padrão: "direito")
// SYNC_ARQUIVOS=a.json,b.json -> lista explícita, ignora SYNC_PREFIXO
// SYNC_LIMITE=5           -> processa no máximo N arquivos nessa execução
// SYNC_FORCAR=1            -> reprocessa mesmo os já marcados "concluido"
// SYNC_PULAR_RECONTAGEM=1  -> pula o recálculo global de contagens no fim
//                             (útil pra smoke test; varre a tabela inteira)
import fs from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import streamJsonPkg from "stream-json";
import StreamArrayPkg from "stream-json/streamers/StreamArray.js";
import { env, paths } from "../config.js";
import { getDb } from "../db/index.js";
import {
  PREFIXO_ASSUNTO_DISCIPLINA,
  TABELA_LOOKUPS,
  TABELA_QUESTOES,
  TOTAL_SHARDS,
} from "../repo/dynamo.js";
import { slugParaNome } from "./slug-nome.js";
import { recomputarContagens } from "./recontar-lookups-dynamo.js";
import { carregarArvore, calcularFecho } from "./assunto-arvore.js";

const { parser } = streamJsonPkg;
const { streamArray } = StreamArrayPkg;

type AnyRec = Record<string, any>;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.aws.region }));
const ARQUIVO_STATUS = path.join(paths.serverRoot, "data", "sync-status.json");
// baixo de propósito: todos os writes de um arquivo caem na mesma partição
// da GSI disciplina-index (mesmo disciplinaId), então concorrência alta vira
// hot partition e derruba em ThrottlingException em vez de ganhar throughput.
const MAX_LOTES_EM_VOO = 4;

interface StatusDisciplina {
  disciplinaId: number;
  disciplinaNome: string;
  status: "em_andamento" | "concluido" | "erro";
  totalLinhasArquivo?: number;
  questoesUnicas?: number;
  iniciadoEm?: string;
  concluidoEm?: string;
  erro?: string;
}

type Status = Record<string, StatusDisciplina>;

function lerStatus(): Status {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_STATUS, "utf-8"));
  } catch {
    return {};
  }
}

function salvarStatus(status: Status) {
  fs.mkdirSync(path.dirname(ARQUIVO_STATUS), { recursive: true });
  fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(status, null, 2));
}

function comecaComArray(filePath: string): boolean {
  const buffer = Buffer.alloc(256);
  const fd = fs.openSync(filePath, "r");
  try {
    const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, n).toString("utf-8").trimStart().startsWith("[");
  } finally {
    fs.closeSync(fd);
  }
}

// lote precisa ter no máximo 25 itens — limite rígido do BatchWriteItem.
async function escreverLote(tabela: string, lote: Record<string, unknown>[]) {
  let pendente = lote.map((Item) => ({ PutRequest: { Item } }));
  let tentativas = 0;
  while (pendente.length) {
    try {
      const res = await client.send(new BatchWriteCommand({ RequestItems: { [tabela]: pendente } }));
      const restantes = res.UnprocessedItems?.[tabela];
      if (!restantes?.length) break;
      pendente = restantes as typeof pendente;
    } catch (e) {
      // throttling (inclusive hot partition em GSI) é transitório — espera e
      // tenta de novo em vez de derrubar o arquivo inteiro. qualquer outro
      // erro (ex.: validação) sobe na hora.
      if (!(e instanceof Error) || e.name !== "ThrottlingException") throw e;
    }
    tentativas++;
    if (tentativas > 10) throw new Error(`Muitas tentativas com throttling/itens pendentes em ${tabela}`);
    await new Promise((r) => setTimeout(r, 300 * tentativas));
  }
}

// escreverLote em pedaços de 25 (limite do BatchWriteItem), com um pouco de
// concorrência — usado pra lotes que podem ser grandes (ex.: lookups
// coletados durante o streaming, que não passam por sincronizarArquivo).
async function escreverEmLotes(tabela: string, itens: Record<string, unknown>[]) {
  let emVoo = 0;
  let erro: unknown = null;
  for (let i = 0; i < itens.length; i += 25) {
    if (erro) throw erro;
    const lote = itens.slice(i, i + 25);
    emVoo++;
    escreverLote(tabela, lote)
      .catch((e) => (erro = e))
      .finally(() => emVoo--);
    while (emVoo >= MAX_LOTES_EM_VOO) await new Promise((r) => setTimeout(r, 20));
  }
  while (emVoo > 0) await new Promise((r) => setTimeout(r, 20));
  if (erro) throw erro;
}

// ids de disciplina precisam bater com o que já existe no DynamoDB.
//
// sync-status.json é a fonte AUTORITATIVA — reflete o que já está gravado em
// produção — e entra primeiro. O SQLite local só serve de fallback pra slugs
// que o status ainda não conhece (disciplina nunca sincronizada por este
// script). Isso é proposital e já causou corrupção uma vez quando invertido:
// o SQLite local pode ser reconstruído a qualquer momento (reingestão
// parcial, amostra diferente, teste local) e nesse caso os ids que ele
// atribui não têm relação nenhuma com o que já foi gravado em produção — se
// o SQLite tivesse prioridade, uma reingestão local podia fazer esta função
// devolver um id diferente pra uma disciplina JÁ sincronizada, e o próximo
// SYNC_FORCAR=1 reescreveria as questões dela sob o id errado, colidindo com
// qualquer disciplina que já tivesse esse id em produção.
function mapaDisciplinas(statusAtual: Status) {
  const porSlug = new Map<string, { id: number; nome: string }>();
  let maiorId = 0;

  for (const [arquivo, info] of Object.entries(statusAtual)) {
    const slug = arquivo.replace(/\.json$/, "");
    porSlug.set(slug, { id: info.disciplinaId, nome: info.disciplinaNome });
    maiorId = Math.max(maiorId, info.disciplinaId);
  }

  const db = getDb();
  const linhas = db.prepare("SELECT id, slug, nome FROM disciplinas").all() as {
    id: number;
    slug: string;
    nome: string;
  }[];
  for (const l of linhas) {
    if (!porSlug.has(l.slug)) porSlug.set(l.slug, { id: l.id, nome: l.nome });
    maiorId = Math.max(maiorId, l.id);
  }

  return { porSlug, proximoId: maiorId + 1 };
}

function idValido(id: unknown): id is number {
  return typeof id === "number" && Number.isFinite(id);
}

// alguns registros do dado bruto têm um id nulo dentro de um dos arrays de
// referência (ex.: assuntos[2].id = null, visto em direito_sanitario_e_saude)
// — filtra em vez de deixar entrar, senão vira id de chave (partition/sort
// key) inválido na hora de gravar o lookup correspondente.
function idsValidos(arr: AnyRec[] | undefined): number[] {
  return (arr ?? []).map((x) => x?.id).filter(idValido);
}

// assuntoIds recebido já pronto (fecho calculado uma vez no chamador, e
// reaproveitado também pra contagemAssuntos — ver sincronizarArquivo) em vez
// de recalculado aqui, pra não repetir o cálculo por questão.
function converterQuestao(q: AnyRec, disciplinaId: number, disciplinaNome: string, assuntoIds: number[]) {
  return {
    id: q.id,
    // partição sintética do global-index, que atende a tela inicial (sem
    // filtro de disciplina) sem precisar varrer a tabela inteira.
    shard: q.id % TOTAL_SHARDS,
    disciplinaId,
    disciplinaNome,
    dificuldade: q.dificuldade ?? null,
    tipo: q.tipo ?? null,
    nivel: q.provas?.[0]?.nivel ?? null,
    anulada: !!q.anulada,
    desatualizada: !!q.desatualizada,
    hasImage: !!q.hasImage,
    enunciado: q.enunciado ?? "",
    enunciadoBusca: String(q.enunciado_clean ?? "").toLowerCase(),
    respostaItemId: q.resposta ?? null,
    itens: q.itens ?? [],
    provas: q.provas ?? [],
    comentarios: {
      ia: !!q.comentarios?.ia,
      professor: !!q.comentarios?.professor,
      professorVideo: !!q.comentarios?.professorVideo,
      aluno: !!q.comentarios?.aluno,
      totalAlunos: q.comentarios?.totalAlunos ?? 0,
      totalProfessores: q.comentarios?.totalProfessores ?? 0,
    },
    bancaIds: idsValidos(q.bancas),
    orgaoIds: idsValidos(q.orgaos),
    cargoIds: idsValidos(q.cargos),
    carreiraIds: idsValidos(q.carreiras),
    areaIds: idsValidos(q.areas),
    assuntoIds,
    anos: q.anos ?? [],
    timestamp: q.timestamp ?? null,
  };
}

// Registros de referência (nome/sigla) encontrados durante a leitura, pra
// upsert em lote ao final de CADA arquivo — evita gravar a mesma
// banca/assunto centenas de vezes durante o streaming. Importante: por
// arquivo, não pro run inteiro — um coletor único pro run inteiro, gravado só
// no fim, perde tudo se o write final falhar (já aconteceu: 14k registros
// perdidos porque um ValidationException no fim do run derrubou o processo
// depois que vários arquivos já tinham sido marcados "concluido").
interface RegistroLookup {
  tipo: string;
  id: number;
  nome: string;
  sigla?: string;
}

function coletarLookups(q: AnyRec, coletor: Map<string, RegistroLookup>) {
  const add = (tipo: string, id: unknown, nome: string, sigla?: string) => {
    if (!idValido(id)) return;
    coletor.set(`${tipo}:${id}`, { tipo, id, nome, sigla });
  };
  for (const b of q.bancas ?? []) add("banca", b.id, b.nome, b.sigla);
  for (const o of q.orgaos ?? []) add("orgao", o.id, o.nome, o.sigla);
  for (const c of q.cargos ?? []) add("cargo", c.id, c.descricao);
  for (const c of q.carreiras ?? []) add("carreira", c.id, c.nome);
  for (const a of q.areas ?? []) add("area", a.id, a.descricao);
  for (const a of q.assuntos ?? []) add("assunto", a.id, a.nome);
}

async function sincronizarArquivo(
  filePath: string,
  disciplinaId: number,
  disciplinaNome: string,
  aoProgredir: (gravadas: number, totalLinhas: number) => void,
): Promise<{
  totalLinhas: number;
  questoesUnicas: number;
  lookups: Map<string, RegistroLookup>;
  contagemAssuntos: Map<number, number>;
}> {
  const pipeline = fs.createReadStream(filePath).pipe(parser()).pipe(streamArray());

  let totalLinhas = 0;
  let gravadas = 0;
  let emVoo = 0;
  let erro: unknown = null;
  const idsVistos = new Set<number>();
  const lookups = new Map<string, RegistroLookup>();
  // quantas questões DESTA disciplina cada assunto tem — evita que o seletor
  // de Assunto precise percorrer a partição inteira da disciplina só pra
  // contar (era o mesmo O(N) que derrubava a listagem). Já é a contagem
  // "enrolada" (nó pai soma os descendentes), porque a chave usada é o fecho
  // de cada questão, não só os ids marcados diretamente — ver calcularFecho.
  const contagemAssuntos = new Map<number, number>();
  const arvoreAssuntos = carregarArvore();
  let loteAtual: Record<string, unknown>[] = [];

  async function despachar(lote: Record<string, unknown>[]) {
    emVoo++;
    try {
      await escreverLote(TABELA_QUESTOES, lote);
      gravadas += lote.length;
      aoProgredir(gravadas, totalLinhas);
    } catch (e) {
      erro = e;
    } finally {
      emVoo--;
    }
  }

  for await (const { value } of pipeline as AsyncIterable<{ value: AnyRec }>) {
    totalLinhas++;
    if (erro) break;
    if (!idsVistos.has(value.id)) {
      idsVistos.add(value.id);
      // Sobe até a raiz a partir de cada id marcado — assim "selecionar um nó
      // pai" no filtro casa com toda questão marcada num descendente dele,
      // sem precisar expandir o filtro pra baixo (que estouraria o limite de
      // ~4KB do FilterExpression pra nós com centenas de descendentes — ver
      // assunto-arvore.ts). Calculado uma vez, usado tanto no item gravado
      // quanto na contagem por disciplina.
      const fecho = calcularFecho(idsValidos(value.assuntos), arvoreAssuntos);
      loteAtual.push(converterQuestao(value, disciplinaId, disciplinaNome, fecho));
      coletarLookups(value, lookups);
      for (const assuntoId of fecho) {
        contagemAssuntos.set(assuntoId, (contagemAssuntos.get(assuntoId) ?? 0) + 1);
      }
    }

    if (loteAtual.length >= 25) {
      const lote = loteAtual;
      loteAtual = [];
      void despachar(lote);
      while (emVoo >= MAX_LOTES_EM_VOO) await new Promise((r) => setTimeout(r, 20));
    }
  }

  if (loteAtual.length) void despachar(loteAtual);
  while (emVoo > 0) await new Promise((r) => setTimeout(r, 20));
  if (erro) throw erro;

  return { totalLinhas, questoesUnicas: idsVistos.size, lookups, contagemAssuntos };
}

async function main() {
  const arvoreAssuntos = carregarArvore();
  const prefixo = process.env.SYNC_PREFIXO ?? "direito";
  const arquivosExplicitos = process.env.SYNC_ARQUIVOS?.split(",").map((s) => s.trim());
  const limite = process.env.SYNC_LIMITE ? Number(process.env.SYNC_LIMITE) : Infinity;
  const forcar = process.env.SYNC_FORCAR === "1";

  const candidatos = (
    arquivosExplicitos ?? fs.readdirSync(paths.dadosDir).filter((f) => f.startsWith(prefixo) && f.endsWith(".json"))
  ).filter((f) => {
    const p = path.join(paths.dadosDir, f);
    // arquivos vazios (ex.: "[]", 3 bytes) começam com "[" também — sem esse
    // corte eles viram "disciplinas" fantasma com 0 questões, desperdiçando
    // (ou pior, colidindo) um id de disciplina real.
    return fs.statSync(p).size >= 10 && comecaComArray(p);
  });

  // menor pro maior — banca progresso rápido, deixa os arquivos gigantes
  // (900MB+) por último, com mais confiança já acumulada.
  candidatos.sort(
    (a, b) => fs.statSync(path.join(paths.dadosDir, a)).size - fs.statSync(path.join(paths.dadosDir, b)).size,
  );

  const status = lerStatus();
  const { porSlug, proximoId } = mapaDisciplinas(status);
  let idLivre = proximoId;

  const pendentes = candidatos.filter((f) => forcar || status[f]?.status !== "concluido").slice(0, limite);

  console.log(`${candidatos.length} arquivo(s) com prefixo "${prefixo}", ${pendentes.length} pendente(s) nessa execução.\n`);

  for (const [i, arquivo] of pendentes.entries()) {
    const slug = arquivo.replace(/\.json$/, "");
    const filePath = path.join(paths.dadosDir, arquivo);
    const tamanhoMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);

    let info = porSlug.get(slug);
    if (!info) {
      info = { id: idLivre++, nome: slugParaNome(slug) };
      porSlug.set(slug, info);
    }

    console.log(`[${i + 1}/${pendentes.length}] ${slug} (${tamanhoMb} MB) — id ${info.id}`);
    status[arquivo] = {
      disciplinaId: info.id,
      disciplinaNome: info.nome,
      status: "em_andamento",
      iniciadoEm: new Date().toISOString(),
    };
    salvarStatus(status);

    const inicio = Date.now();
    try {
      const { totalLinhas, questoesUnicas, lookups, contagemAssuntos } = await sincronizarArquivo(
        filePath,
        info.id,
        info.nome,
        (gravadas, total) => {
          if (gravadas % 2500 === 0) {
            const seg = ((Date.now() - inicio) / 1000).toFixed(0);
            console.log(`   ${gravadas} gravadas (lidas ${total}) — ${seg}s`);
          }
        },
      );

      // grava tudo (disciplina + referências coletadas nesse arquivo) ANTES
      // de marcar "concluido" — só assim "concluido" garante que nada ficou
      // pra trás, já que esse arquivo nunca mais será reprocessado.
      //
      // nome/pai vêm do módulo da árvore (cobertura completa dos 33k+208
      // nós), não das tags cruas vistas durante o streaming — um ancestral
      // que nunca é marcado diretamente em nenhuma questão do arquivo (só
      // entra via calcularFecho) nunca apareceria no coletor de lookups.
      const registrosLookup = [
        { tipo: "disciplina", id: info.id, nome: info.nome, slug, qtdQuestoes: questoesUnicas },
        ...lookups.values(),
        // contagem de assunto escopada nesta disciplina, numa partição própria
        // — o seletor de Assunto lê só essa partição, não a disciplina inteira.
        ...[...contagemAssuntos.entries()].map(([assuntoId, qtd]) => ({
          tipo: `${PREFIXO_ASSUNTO_DISCIPLINA}${info!.id}`,
          id: assuntoId,
          nome: arvoreAssuntos.get(assuntoId)?.nome ?? `Assunto ${assuntoId}`,
          pai: arvoreAssuntos.get(assuntoId)?.pai ?? null,
          qtdQuestoes: qtd,
        })),
      ] as unknown as Record<string, unknown>[];
      await escreverEmLotes(TABELA_LOOKUPS, registrosLookup);

      status[arquivo] = {
        disciplinaId: info.id,
        disciplinaNome: info.nome,
        status: "concluido",
        totalLinhasArquivo: totalLinhas,
        questoesUnicas,
        iniciadoEm: status[arquivo].iniciadoEm,
        concluidoEm: new Date().toISOString(),
      };
      salvarStatus(status);

      const seg = ((Date.now() - inicio) / 1000).toFixed(0);
      console.log(`   concluído: ${questoesUnicas} questões únicas, ${lookups.size} referências em ${seg}s\n`);
    } catch (e) {
      status[arquivo] = {
        ...status[arquivo],
        status: "erro",
        erro: e instanceof Error ? e.message : String(e),
      };
      salvarStatus(status);
      console.error(`   ERRO em ${slug}:`, e);
      console.error("   Status salvo — rode de novo pra continuar dos demais arquivos.\n");
    }
  }

  if (process.env.SYNC_PULAR_RECONTAGEM === "1") {
    console.log("\nRecontagem pulada (SYNC_PULAR_RECONTAGEM=1).");
  } else {
    console.log("\nRecalculando contagens de todos os filtros (varre a tabela inteira, pode levar um tempo)...");
    await recomputarContagens();
  }

  console.log("\nSincronização concluída pra essa execução.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
