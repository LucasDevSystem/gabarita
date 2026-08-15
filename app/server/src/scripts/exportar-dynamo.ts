// Lê o app.db do SQLite (já ingerido localmente via `pnpm ingest`) e exporta
// pro DynamoDB de produção: lookups (bancas, órgãos, cargos, carreiras,
// áreas, assuntos, disciplinas + agregados de ano/dificuldade/escolaridade/
// tipo) e as questões em si. NÃO exporta respostas_usuario — isso é
// progresso por ambiente, não dado de referência.
//
// Roda com as credenciais AWS de quem for fazer o deploy, depois de rodar
// criar-tabelas-dynamo.ts uma vez:
//   AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... pnpm --filter gabarita-server exportar:dynamo
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import { getDb } from "../db/index.js";
import { TABELA_LOOKUPS, TABELA_QUESTOES } from "../repo/dynamo.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.aws.region }));

async function escreverEmLotes(tabela: string, itens: Record<string, unknown>[]) {
  let escritos = 0;
  for (let i = 0; i < itens.length; i += 25) {
    let lote = itens.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    let tentativas = 0;
    while (lote.length) {
      const res = await client.send(new BatchWriteCommand({ RequestItems: { [tabela]: lote } }));
      const pendentes = res.UnprocessedItems?.[tabela];
      if (!pendentes?.length) break;
      lote = pendentes as typeof lote;
      tentativas++;
      if (tentativas > 8) throw new Error(`Muitas tentativas com itens pendentes em ${tabela}`);
      await new Promise((r) => setTimeout(r, 200 * tentativas));
    }
    escritos += itens.slice(i, i + 25).length;
    if (escritos % 500 === 0) console.log(`  ${tabela}: ${escritos}/${itens.length}`);
  }
  console.log(`  ${tabela}: ${itens.length}/${itens.length} concluído`);
}

function mapaJuncao(db: ReturnType<typeof getDb>, tabela: string, coluna: string): Map<number, number[]> {
  const linhas = db.prepare(`SELECT questao_id, ${coluna} FROM ${tabela}`).all() as Record<string, number>[];
  const mapa = new Map<number, number[]>();
  for (const l of linhas) {
    const lista = mapa.get(l.questao_id) ?? [];
    lista.push(l[coluna]);
    mapa.set(l.questao_id, lista);
  }
  return mapa;
}

async function exportarLookups(db: ReturnType<typeof getDb>) {
  console.log("Exportando lookups...");
  const itens: Record<string, unknown>[] = [];

  const push = (tipo: string, id: number, nome: string, qtdQuestoes: number, extra: Record<string, unknown> = {}) =>
    itens.push({ tipo, id, nome, qtdQuestoes, ...extra });

  for (const d of db
    .prepare("SELECT id, nome, slug, qtd_questoes AS qtdQuestoes FROM disciplinas WHERE qtd_questoes > 0")
    .all() as { id: number; nome: string; slug: string; qtdQuestoes: number }[])
    push("disciplina", d.id, d.nome, d.qtdQuestoes, { slug: d.slug });

  for (const [tipo, tabela, coluna] of [
    ["banca", "bancas", "nome"],
    ["orgao", "orgaos", "nome"],
    ["cargo", "cargos", "descricao"],
    ["carreira", "carreiras", "nome"],
    ["area", "areas", "descricao"],
    ["assunto", "assuntos", "nome"],
  ] as const) {
    const linhas = db
      .prepare(`SELECT id, ${coluna} AS nome, qtd_questoes AS qtdQuestoes FROM ${tabela} WHERE qtd_questoes > 0`)
      .all() as { id: number; nome: string; qtdQuestoes: number }[];
    for (const l of linhas) push(tipo, l.id, l.nome, l.qtdQuestoes);
  }

  for (const a of db
    .prepare(
      "SELECT ano AS id, COUNT(DISTINCT questao_id) AS qtdQuestoes FROM questao_anos GROUP BY ano",
    )
    .all() as { id: number; qtdQuestoes: number }[])
    push("ano", a.id, String(a.id), a.qtdQuestoes);

  for (const d of db
    .prepare(
      "SELECT dificuldade AS id, COUNT(*) AS qtdQuestoes FROM questoes WHERE dificuldade IS NOT NULL GROUP BY dificuldade",
    )
    .all() as { id: number; qtdQuestoes: number }[])
    push("dificuldade", d.id, String(d.id), d.qtdQuestoes);

  let proximoIdEscolaridade = 1;
  for (const e of db
    .prepare(
      "SELECT nivel, COUNT(*) AS qtdQuestoes FROM questoes WHERE nivel IS NOT NULL GROUP BY nivel",
    )
    .all() as { nivel: string; qtdQuestoes: number }[])
    push("escolaridade", proximoIdEscolaridade++, e.nivel, e.qtdQuestoes);

  let proximoIdTipo = 1;
  for (const t of db
    .prepare("SELECT tipo, COUNT(*) AS qtdQuestoes FROM questoes WHERE tipo IS NOT NULL GROUP BY tipo")
    .all() as { tipo: string; qtdQuestoes: number }[])
    push("tipoQuestao", proximoIdTipo++, t.tipo, t.qtdQuestoes);

  await escreverEmLotes(TABELA_LOOKUPS, itens);
}

async function exportarQuestoes(db: ReturnType<typeof getDb>) {
  console.log("Carregando junções em memória...");
  const bancaIds = mapaJuncao(db, "questao_bancas", "banca_id");
  const orgaoIds = mapaJuncao(db, "questao_orgaos", "orgao_id");
  const cargoIds = mapaJuncao(db, "questao_cargos", "cargo_id");
  const carreiraIds = mapaJuncao(db, "questao_carreiras", "carreira_id");
  const areaIds = mapaJuncao(db, "questao_areas", "area_id");
  const assuntoIds = mapaJuncao(db, "questao_assuntos", "assunto_id");
  const anos = mapaJuncao(db, "questao_anos", "ano");

  console.log("Exportando questões...");
  const linhas = db
    .prepare(
      `SELECT
         q.id, q.dificuldade, q.tipo, q.nivel, q.anulada, q.desatualizada,
         q.has_image AS hasImage, q.enunciado, q.enunciado_clean AS enunciadoClean,
         q.resposta_item_id AS respostaItemId, q.itens_json AS itensJson, q.provas_json AS provasJson,
         q.comentarios_ia AS comentariosIa, q.comentarios_professor AS comentariosProfessor,
         q.comentarios_professor_video AS comentariosProfessorVideo, q.comentarios_aluno AS comentariosAluno,
         q.comentarios_total_alunos AS comentariosTotalAlunos,
         q.comentarios_total_professores AS comentariosTotalProfessores,
         q.timestamp,
         d.id AS disciplinaId, d.nome AS disciplinaNome
       FROM questoes q
       JOIN disciplinas d ON d.id = q.disciplina_id`,
    )
    .all() as Record<string, unknown>[];

  const itens = linhas.map((r) => ({
    id: r.id,
    disciplinaId: r.disciplinaId,
    disciplinaNome: r.disciplinaNome,
    dificuldade: r.dificuldade,
    tipo: r.tipo,
    nivel: r.nivel,
    anulada: !!r.anulada,
    desatualizada: !!r.desatualizada,
    hasImage: !!r.hasImage,
    enunciado: r.enunciado,
    enunciadoBusca: String(r.enunciadoClean ?? "").toLowerCase(),
    respostaItemId: r.respostaItemId,
    itens: JSON.parse(r.itensJson as string),
    provas: JSON.parse(r.provasJson as string),
    comentarios: {
      ia: !!r.comentariosIa,
      professor: !!r.comentariosProfessor,
      professorVideo: !!r.comentariosProfessorVideo,
      aluno: !!r.comentariosAluno,
      totalAlunos: r.comentariosTotalAlunos,
      totalProfessores: r.comentariosTotalProfessores,
    },
    bancaIds: bancaIds.get(r.id as number) ?? [],
    orgaoIds: orgaoIds.get(r.id as number) ?? [],
    cargoIds: cargoIds.get(r.id as number) ?? [],
    carreiraIds: carreiraIds.get(r.id as number) ?? [],
    areaIds: areaIds.get(r.id as number) ?? [],
    assuntoIds: assuntoIds.get(r.id as number) ?? [],
    anos: anos.get(r.id as number) ?? [],
    timestamp: r.timestamp,
  }));

  await escreverEmLotes(TABELA_QUESTOES, itens);
}

async function main() {
  if (env.dbDriver !== "dynamodb") {
    console.log(
      "Aviso: DB_DRIVER não está como 'dynamodb' — isso não afeta esse script (ele sempre escreve no " +
        "DynamoDB), é só um lembrete de que a API local vai continuar lendo do SQLite até você mudar essa env var.",
    );
  }

  const db = getDb();
  await exportarLookups(db);
  await exportarQuestoes(db);
  console.log("\nExportação concluída.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
