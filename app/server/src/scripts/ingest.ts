import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
// stream-json é CJS e anexa exports nomeados como propriedades da função/classe
// exportada (não como "exports.x = ..." estático), o que o interoperador de
// ESM do Node não detecta — por isso importamos o módulo inteiro e desestruturamos.
import streamJsonPkg from "stream-json";
import StreamArrayPkg from "stream-json/streamers/StreamArray.js";
import { paths } from "../config.js";
import { getDb } from "../db/index.js";
import { slugParaNome } from "./slug-nome.js";
import { carregarArvore, calcularFecho } from "./assunto-arvore.js";

const { parser } = streamJsonPkg;
const { streamArray } = StreamArrayPkg;

type AnyRec = Record<string, any>;

const bool = (v: unknown) => (v ? 1 : 0);
const orNull = <T>(v: T | undefined | null) => v ?? null;

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function seedLookupTables(db: DatabaseSync) {
  console.log("Semeando tabelas de referência (bancas, orgãos, cargos, carreiras, áreas, assuntos)...");

  const insBanca = db.prepare(
    "INSERT OR IGNORE INTO bancas (id, nome, sigla, descricao, oab) VALUES (?, ?, ?, ?, ?)",
  );
  for (const b of readJson(paths.bancasJson) as AnyRec[]) {
    insBanca.run(b.id, b.nome, orNull(b.sigla), orNull(b.descricao), bool(b.oab));
  }

  const insOrgao = db.prepare(
    "INSERT OR IGNORE INTO orgaos (id, nome, sigla, esfera, uf) VALUES (?, ?, ?, ?, ?)",
  );
  const orgaoPayload = readJson(paths.orgaoJson);
  for (const o of orgaoPayload.data.rows as AnyRec[]) {
    insOrgao.run(o.id, o.nome, orNull(o.sigla), orNull(o.esfera), orNull(o.uf));
  }

  const insCargo = db.prepare("INSERT OR IGNORE INTO cargos (id, descricao) VALUES (?, ?)");
  for (const c of readJson(paths.cargosJson) as AnyRec[]) {
    insCargo.run(c.id, c.descricao);
  }

  const insCarreira = db.prepare(
    "INSERT OR IGNORE INTO carreiras (id, nome, descricao) VALUES (?, ?, ?)",
  );
  for (const c of readJson(paths.carreirasJson) as AnyRec[]) {
    insCarreira.run(c.id, c.nome, orNull(c.descricao));
  }

  const insArea = db.prepare("INSERT OR IGNORE INTO areas (id, descricao) VALUES (?, ?)");
  for (const a of readJson(paths.areasFormacaoJson) as AnyRec[]) {
    insArea.run(a.id, a.descricao);
  }

  // Semeia a árvore inteira (raízes + nós profundos) de uma vez, com OR
  // REPLACE — diferente das outras tabelas de referência acima, aqui
  // queremos que arvore_assuntos.json seja a fonte autoritativa de `pai`,
  // não "o que a primeira questão a referenciar esse id trouxe". Sem isso,
  // `pai` fica não-confiável: sempre NULL pras 208 raízes (INSERT OR IGNORE
  // nunca sobrescreve) e "primeiro que escrever ganha" pros nós profundos.
  const insAssunto = db.prepare(
    "INSERT OR REPLACE INTO assuntos (id, nome, materia, pai) VALUES (?, ?, ?, ?)",
  );
  for (const [id, no] of carregarArvore()) {
    insAssunto.run(id, no.nome, bool(no.materia), no.pai);
  }
}

interface Statements {
  insQuestao: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoBanca: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoOrgao: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoCargo: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoCarreira: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoArea: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoAssunto: ReturnType<DatabaseSync["prepare"]>;
  insQuestaoAno: ReturnType<DatabaseSync["prepare"]>;
  upsertBanca: ReturnType<DatabaseSync["prepare"]>;
  upsertOrgao: ReturnType<DatabaseSync["prepare"]>;
  upsertCargo: ReturnType<DatabaseSync["prepare"]>;
  upsertCarreira: ReturnType<DatabaseSync["prepare"]>;
  upsertArea: ReturnType<DatabaseSync["prepare"]>;
  upsertAssunto: ReturnType<DatabaseSync["prepare"]>;
}

function prepareStatements(db: DatabaseSync): Statements {
  return {
    insQuestao: db.prepare(`
      INSERT OR IGNORE INTO questoes (
        id, disciplina_id, dificuldade, tipo, nivel, anulada, desatualizada,
        has_image, has_image_itens, enunciado, enunciado_clean, resposta_item_id,
        hash, hash_id, timestamp,
        comentarios_ia, comentarios_professor, comentarios_professor_video, comentarios_aluno,
        comentarios_total_alunos, comentarios_total_professores,
        itens_json, provas_json, grupo_questao_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insQuestaoBanca: db.prepare(
      "INSERT OR IGNORE INTO questao_bancas (questao_id, banca_id) VALUES (?, ?)",
    ),
    insQuestaoOrgao: db.prepare(
      "INSERT OR IGNORE INTO questao_orgaos (questao_id, orgao_id) VALUES (?, ?)",
    ),
    insQuestaoCargo: db.prepare(
      "INSERT OR IGNORE INTO questao_cargos (questao_id, cargo_id) VALUES (?, ?)",
    ),
    insQuestaoCarreira: db.prepare(
      "INSERT OR IGNORE INTO questao_carreiras (questao_id, carreira_id) VALUES (?, ?)",
    ),
    insQuestaoArea: db.prepare(
      "INSERT OR IGNORE INTO questao_areas (questao_id, area_id) VALUES (?, ?)",
    ),
    insQuestaoAssunto: db.prepare(
      "INSERT OR IGNORE INTO questao_assuntos (questao_id, assunto_id) VALUES (?, ?)",
    ),
    insQuestaoAno: db.prepare(
      "INSERT OR IGNORE INTO questao_anos (questao_id, ano) VALUES (?, ?)",
    ),
    upsertBanca: db.prepare(
      "INSERT OR IGNORE INTO bancas (id, nome, sigla, descricao, oab) VALUES (?, ?, ?, ?, 0)",
    ),
    upsertOrgao: db.prepare(
      "INSERT OR IGNORE INTO orgaos (id, nome, sigla, esfera, uf) VALUES (?, ?, ?, ?, ?)",
    ),
    upsertCargo: db.prepare("INSERT OR IGNORE INTO cargos (id, descricao) VALUES (?, ?)"),
    upsertCarreira: db.prepare(
      "INSERT OR IGNORE INTO carreiras (id, nome, descricao) VALUES (?, ?, NULL)",
    ),
    upsertArea: db.prepare("INSERT OR IGNORE INTO areas (id, descricao) VALUES (?, ?)"),
    upsertAssunto: db.prepare(
      "INSERT OR IGNORE INTO assuntos (id, nome, materia, pai) VALUES (?, ?, ?, ?)",
    ),
  };
}

function ingestQuestao(st: Statements, disciplinaId: number, q: AnyRec) {
  const prova0 = q.provas?.[0];
  st.insQuestao.run(
    q.id,
    disciplinaId,
    orNull(q.dificuldade),
    orNull(q.tipo),
    orNull(prova0?.nivel),
    bool(q.anulada),
    bool(q.desatualizada),
    bool(q.hasImage),
    bool(q.hasImageItens),
    q.enunciado ?? "",
    q.enunciado_clean ?? "",
    orNull(q.resposta),
    orNull(q.hash),
    orNull(q.hashId),
    orNull(q.timestamp),
    bool(q.comentarios?.ia),
    bool(q.comentarios?.professor),
    bool(q.comentarios?.professorVideo),
    bool(q.comentarios?.aluno),
    q.comentarios?.totalAlunos ?? 0,
    q.comentarios?.totalProfessores ?? 0,
    JSON.stringify(q.itens ?? []),
    JSON.stringify(q.provas ?? []),
    q.grupoQuestao ? JSON.stringify(q.grupoQuestao) : null,
  );

  for (const b of q.bancas ?? []) {
    st.upsertBanca.run(b.id, b.nome, orNull(b.sigla), orNull(b.descricao));
    st.insQuestaoBanca.run(q.id, b.id);
  }
  for (const o of q.orgaos ?? []) {
    st.upsertOrgao.run(o.id, o.nome, orNull(o.sigla), orNull(o.esfera), orNull(o.uf));
    st.insQuestaoOrgao.run(q.id, o.id);
  }
  for (const c of q.cargos ?? []) {
    st.upsertCargo.run(c.id, c.descricao);
    st.insQuestaoCargo.run(q.id, c.id);
  }
  for (const c of q.carreiras ?? []) {
    st.upsertCarreira.run(c.id, c.nome);
    st.insQuestaoCarreira.run(q.id, c.id);
  }
  for (const a of q.areas ?? []) {
    st.upsertArea.run(a.id, a.descricao);
    st.insQuestaoArea.run(q.id, a.id);
  }
  // Fallback defensivo — normalmente redundante, já que seedLookupTables
  // semeia a árvore inteira antes de qualquer questão ser processada; só
  // entra em jogo se uma questão referenciar um id que não existe em
  // arvore_assuntos.json/assuntos.json (não observado, mas não custa nada
  // ter a rede de segurança).
  for (const a of q.assuntos ?? []) {
    st.upsertAssunto.run(a.id, a.nome, bool(a.materia), orNull(a.pai));
  }
  // Grava uma linha de junção por id marcado E por todo ancestral até a
  // raiz — assim "selecionar um nó pai" no filtro já casa com toda questão
  // marcada num descendente dele, sem precisar expandir o filtro (que
  // estouraria pra nós com centenas de descendentes — ver assunto-arvore.ts).
  const idsBase = (q.assuntos ?? [])
    .map((a: AnyRec) => a.id)
    .filter((id: unknown): id is number => typeof id === "number");
  for (const id of calcularFecho(idsBase, carregarArvore())) {
    st.insQuestaoAssunto.run(q.id, id);
  }
  for (const ano of q.anos ?? []) {
    st.insQuestaoAno.run(q.id, ano);
  }
}

const LOTE = 5000;

// Fração de cada arquivo a ingerir (0-1). INGEST_AMOSTRA=0.05 pnpm ingest ingere ~5% de cada disciplina.
const AMOSTRA = process.env.INGEST_AMOSTRA ? Number(process.env.INGEST_AMOSTRA) : 1;

// Alguns arquivos passam de 1GB (lingua_portuguesa.json tem quase 2GB), acima do limite
// de string do V8 (~536MB) — por isso o parse é feito em streaming, nunca lendo o
// arquivo inteiro pra memória de uma vez.
// dados/ também guarda arquivos de bookkeeping do scraper (ex.: status_sincronizacao.json,
// um objeto de progresso, não uma lista de questões) — só ingerimos arquivos cujo
// topo é de fato um array.
function comecaComArray(filePath: string): boolean {
  const buffer = Buffer.alloc(256);
  const fd = fs.openSync(filePath, "r");
  try {
    const bytesLidos = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const inicio = buffer.subarray(0, bytesLidos).toString("utf-8").trimStart();
    return inicio.startsWith("[");
  } finally {
    fs.closeSync(fd);
  }
}

function ingestDisciplina(
  db: DatabaseSync,
  st: Statements,
  disciplinaId: number,
  filePath: string,
): Promise<number> {
  if (fs.statSync(filePath).size < 10) return Promise.resolve(0);
  if (!comecaComArray(filePath)) return Promise.resolve(0);

  return new Promise((resolve, reject) => {
    let count = 0;
    let emAberto = false;

    const pipeline = fs
      .createReadStream(filePath)
      .pipe(parser())
      .pipe(streamArray());

    pipeline.on("data", ({ value }: { value: AnyRec }) => {
      if (AMOSTRA < 1 && Math.random() >= AMOSTRA) return;

      if (count % LOTE === 0) {
        if (emAberto) db.exec("COMMIT");
        db.exec("BEGIN");
        emAberto = true;
      }
      ingestQuestao(st, disciplinaId, value);
      count++;
    });

    pipeline.on("end", () => {
      if (emAberto) db.exec("COMMIT");
      resolve(count);
    });

    pipeline.on("error", (err: Error) => {
      if (emAberto) db.exec("COMMIT");
      reject(err);
    });
  });
}

function criarIndicesEContagens(db: DatabaseSync) {
  console.log("Criando índices...");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_questoes_disciplina ON questoes(disciplina_id);
    CREATE INDEX IF NOT EXISTS idx_questoes_dificuldade ON questoes(dificuldade);
    CREATE INDEX IF NOT EXISTS idx_questoes_tipo ON questoes(tipo);
    CREATE INDEX IF NOT EXISTS idx_questoes_nivel ON questoes(nivel);
    CREATE INDEX IF NOT EXISTS idx_questoes_anulada ON questoes(anulada);
    CREATE INDEX IF NOT EXISTS idx_questoes_desatualizada ON questoes(desatualizada);

    CREATE INDEX IF NOT EXISTS idx_qb_banca ON questao_bancas(banca_id);
    CREATE INDEX IF NOT EXISTS idx_qo_orgao ON questao_orgaos(orgao_id);
    CREATE INDEX IF NOT EXISTS idx_qc_cargo ON questao_cargos(cargo_id);
    CREATE INDEX IF NOT EXISTS idx_qca_carreira ON questao_carreiras(carreira_id);
    CREATE INDEX IF NOT EXISTS idx_qa_area ON questao_areas(area_id);
    CREATE INDEX IF NOT EXISTS idx_qas_assunto ON questao_assuntos(assunto_id);
    CREATE INDEX IF NOT EXISTS idx_qan_ano ON questao_anos(ano);
  `);

  console.log("Criando índice de busca por texto (FTS5)...");
  db.exec(`
    DROP TABLE IF EXISTS questoes_fts;
    CREATE VIRTUAL TABLE questoes_fts USING fts5(
      enunciado_clean, content='questoes', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    INSERT INTO questoes_fts(rowid, enunciado_clean) SELECT id, enunciado_clean FROM questoes;
  `);

  console.log("Calculando contagem de questões por filtro...");
  db.exec(`
    UPDATE disciplinas SET qtd_questoes = (SELECT COUNT(*) FROM questoes WHERE questoes.disciplina_id = disciplinas.id);
    UPDATE bancas SET qtd_questoes = (SELECT COUNT(*) FROM questao_bancas WHERE questao_bancas.banca_id = bancas.id);
    UPDATE orgaos SET qtd_questoes = (SELECT COUNT(*) FROM questao_orgaos WHERE questao_orgaos.orgao_id = orgaos.id);
    UPDATE cargos SET qtd_questoes = (SELECT COUNT(*) FROM questao_cargos WHERE questao_cargos.cargo_id = cargos.id);
    UPDATE carreiras SET qtd_questoes = (SELECT COUNT(*) FROM questao_carreiras WHERE questao_carreiras.carreira_id = carreiras.id);
    UPDATE areas SET qtd_questoes = (SELECT COUNT(*) FROM questao_areas WHERE questao_areas.area_id = areas.id);
    UPDATE assuntos SET qtd_questoes = (SELECT COUNT(*) FROM questao_assuntos WHERE questao_assuntos.assunto_id = assuntos.id);
  `);
}

async function main() {
  const inicio = Date.now();
  if (AMOSTRA < 1) console.log(`Amostragem ativa: ~${(AMOSTRA * 100).toFixed(0)}% de cada arquivo.`);
  fs.rmSync(paths.dbFile, { force: true });
  fs.rmSync(`${paths.dbFile}-wal`, { force: true });
  fs.rmSync(`${paths.dbFile}-shm`, { force: true });

  const db = getDb();
  seedLookupTables(db);
  const st = prepareStatements(db);

  let arquivos = fs
    .readdirSync(paths.dadosDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  // hook de teste rápido: INGEST_SOMENTE=farmacia.json,arquitetura.json pnpm ingest
  const somente = process.env.INGEST_SOMENTE?.split(",").map((s) => s.trim());
  if (somente?.length) {
    arquivos = arquivos.filter((f) => somente.includes(f));
  }

  const insDisciplina = db.prepare(
    "INSERT INTO disciplinas (id, slug, nome) VALUES (?, ?, ?)",
  );

  let total = 0;
  let pulados = 0;
  for (let i = 0; i < arquivos.length; i++) {
    const arquivo = arquivos[i];
    const slug = arquivo.replace(/\.json$/, "");
    const disciplinaId = i + 1;
    const filePath = path.join(paths.dadosDir, arquivo);
    const qtd = await ingestDisciplina(db, st, disciplinaId, filePath);

    if (qtd === 0) {
      pulados++;
      continue;
    }

    insDisciplina.run(disciplinaId, slug, slugParaNome(slug));
    total += qtd;
    const decorrido = ((Date.now() - inicio) / 1000).toFixed(0);
    console.log(
      `[${i + 1}/${arquivos.length}] ${slug}: ${qtd} questões (total ${total}, ${decorrido}s)`,
    );
  }

  criarIndicesEContagens(db);

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `\nConcluído em ${segundos}s. ${total} questões ingeridas de ${arquivos.length - pulados} disciplinas (${pulados} arquivos vazios ignorados).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
