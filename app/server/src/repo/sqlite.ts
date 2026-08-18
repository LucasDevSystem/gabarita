import { getDb } from "../db/index.js";
import type {
  Capacidades,
  Cliente,
  ClienteComEstatisticas,
  Estatisticas,
  FiltrosBase,
  FiltrosQuery,
  ListaQuestoesResultado,
  LookupTipo,
  OpcaoFiltro,
  Repositorio,
  RespostaEnviada,
} from "./types.js";

// comSigla: banca e órgão têm sigla própria (ex.: "CESPE", "TJSP") — busca
// passa a casar também contra ela, e o rótulo exibido prefere a sigla ao
// nome completo quando ela existe. Cargo/assunto não têm essa coluna.
const LOOKUP_TABELAS: Record<LookupTipo, { tabela: string; coluna: string; comSigla: boolean }> = {
  bancas: { tabela: "bancas", coluna: "nome", comSigla: true },
  orgaos: { tabela: "orgaos", coluna: "nome", comSigla: true },
  cargos: { tabela: "cargos", coluna: "descricao", comSigla: false },
  assuntos: { tabela: "assuntos", coluna: "nome", comSigla: false },
};

function ftsQueryDe(texto: string): string {
  const termos = texto
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean);
  return termos.map((t) => `"${t}"*`).join(" AND ");
}

const COMENTARIO_COLUNAS: Record<string, string> = {
  ia: "comentarios_ia",
  professor: "comentarios_professor",
  professorVideo: "comentarios_professor_video",
  aluno: "comentarios_aluno",
};

function montarFiltros(f: FiltrosQuery) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const placeholders = (n: number) => Array(n).fill("?").join(",");

  if (f.disciplina.length) {
    where.push(`q.disciplina_id IN (${placeholders(f.disciplina.length)})`);
    params.push(...f.disciplina);
  }
  if (f.dificuldade.length) {
    where.push(`q.dificuldade IN (${placeholders(f.dificuldade.length)})`);
    params.push(...f.dificuldade);
  }
  if (f.escolaridade.length) {
    where.push(`q.nivel IN (${placeholders(f.escolaridade.length)})`);
    params.push(...f.escolaridade);
  }
  if (f.tipo.length) {
    where.push(`q.tipo IN (${placeholders(f.tipo.length)})`);
    params.push(...f.tipo);
  }

  if (!f.incluirAnuladas) where.push("q.anulada = 0");
  if (!f.incluirDesatualizadas) where.push("q.desatualizada = 0");

  const juncoes: [number[], string, string][] = [
    [f.banca, "questao_bancas", "banca_id"],
    [f.orgao, "questao_orgaos", "orgao_id"],
    [f.cargo, "questao_cargos", "cargo_id"],
    [f.carreira, "questao_carreiras", "carreira_id"],
    [f.area, "questao_areas", "area_id"],
    [f.assunto, "questao_assuntos", "assunto_id"],
  ];
  for (const [ids, tabela, coluna] of juncoes) {
    if (ids.length) {
      where.push(
        `q.id IN (SELECT questao_id FROM ${tabela} WHERE ${coluna} IN (${placeholders(ids.length)}))`,
      );
      params.push(...ids);
    }
  }

  if (f.ano.length) {
    where.push(`q.id IN (SELECT questao_id FROM questao_anos WHERE ano IN (${placeholders(f.ano.length)}))`);
    params.push(...f.ano);
  }

  const comentarios = f.comentarios.filter((c) => c in COMENTARIO_COLUNAS);
  if (comentarios.length) {
    where.push(`(${comentarios.map((c) => `q.${COMENTARIO_COLUNAS[c]} = 1`).join(" OR ")})`);
  }

  switch (f.minhasQuestoes) {
    case "resolvidas":
      where.push("ru.questao_id IS NOT NULL");
      break;
    case "naoresolvidas":
      where.push("ru.questao_id IS NULL");
      break;
    case "certas":
      where.push("ru.correta = 1");
      break;
    case "erradas":
      where.push("ru.correta = 0");
      break;
  }

  if (f.q?.trim()) {
    where.push("q.id IN (SELECT rowid FROM questoes_fts WHERE questoes_fts MATCH ?)");
    params.push(ftsQueryDe(f.q.trim()));
  }

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function ordemSql(sort: FiltrosQuery["sort"]): string {
  switch (sort) {
    case "dificuldade_asc":
      return "ORDER BY q.dificuldade ASC, q.id DESC";
    case "dificuldade_desc":
      return "ORDER BY q.dificuldade DESC, q.id DESC";
    default:
      return "ORDER BY q.timestamp DESC, q.id DESC";
  }
}

export class RepositorioSqlite implements Repositorio {
  capacidades: Capacidades = { ordenacaoPorDificuldade: true };

  async filtrosBase(): Promise<FiltrosBase> {
    const db = getDb();
    const disciplinas = db
      .prepare(
        "SELECT id, nome, slug, qtd_questoes AS qtdQuestoes FROM disciplinas WHERE qtd_questoes > 0 ORDER BY nome",
      )
      .all() as FiltrosBase["disciplinas"];

    const carreiras = db
      .prepare(
        "SELECT id, nome, qtd_questoes AS qtdQuestoes FROM carreiras WHERE qtd_questoes > 0 ORDER BY qtd_questoes DESC",
      )
      .all() as unknown as OpcaoFiltro[];

    const areas = db
      .prepare(
        "SELECT id, descricao AS nome, qtd_questoes AS qtdQuestoes FROM areas WHERE qtd_questoes > 0 ORDER BY qtd_questoes DESC",
      )
      .all() as unknown as OpcaoFiltro[];

    const anos = db
      .prepare(
        "SELECT ano, COUNT(DISTINCT questao_id) AS qtdQuestoes FROM questao_anos GROUP BY ano ORDER BY ano DESC",
      )
      .all() as FiltrosBase["anos"];

    const dificuldades = db
      .prepare(
        "SELECT dificuldade, COUNT(*) AS qtdQuestoes FROM questoes WHERE dificuldade IS NOT NULL GROUP BY dificuldade ORDER BY dificuldade",
      )
      .all() as FiltrosBase["dificuldades"];

    const escolaridades = db
      .prepare(
        "SELECT nivel, COUNT(*) AS qtdQuestoes FROM questoes WHERE nivel IS NOT NULL GROUP BY nivel ORDER BY qtdQuestoes DESC",
      )
      .all() as FiltrosBase["escolaridades"];

    const tipos = db
      .prepare(
        "SELECT tipo, COUNT(*) AS qtdQuestoes FROM questoes WHERE tipo IS NOT NULL GROUP BY tipo ORDER BY qtdQuestoes DESC",
      )
      .all() as FiltrosBase["tipos"];

    return { disciplinas, carreiras, areas, anos, dificuldades, escolaridades, tipos };
  }

  async buscarLookup(
    tipo: LookupTipo,
    q: string,
    limit: number,
    disciplinaIds?: number[],
  ): Promise<OpcaoFiltro[]> {
    const db = getDb();

    // Assunto só faz sentido escopado a uma disciplina — sem isso, devolve
    // vazio (o frontend nem deveria chamar esse caminho, mas reforça a regra
    // no servidor também). A contagem também é recalculada só dentro da(s)
    // disciplina(s) escolhida(s), não o total global do assunto.
    if (tipo === "assuntos") {
      if (!disciplinaIds?.length) return [];
      const placeholders = disciplinaIds.map(() => "?").join(",");
      // a.pai deixa o frontend reconstruir a árvore a partir da lista plana.
      // A contagem em si não muda: questao_assuntos já tem uma linha por
      // ancestral (gravada pelo ingest.ts via calcularFecho), então um nó
      // pai já sai "enrolado" (soma de si + descendentes) de graça.
      const sql = `
        SELECT a.id, a.nome, a.pai, COUNT(DISTINCT qa.questao_id) AS qtdQuestoes
        FROM assuntos a
        JOIN questao_assuntos qa ON qa.assunto_id = a.id
        JOIN questoes qu ON qu.id = qa.questao_id
        WHERE qu.disciplina_id IN (${placeholders})
        ${q ? "AND a.nome LIKE ?" : ""}
        GROUP BY a.id, a.nome, a.pai
        ORDER BY qtdQuestoes DESC
        LIMIT ?
      `;
      const params = q ? [...disciplinaIds, `%${q}%`, limit] : [...disciplinaIds, limit];
      return db.prepare(sql).all(...params) as unknown as OpcaoFiltro[];
    }

    const { tabela, coluna, comSigla } = LOOKUP_TABELAS[tipo];
    // sigla vazia ("") não deve "vencer" o nome — NULLIF trata isso como nulo
    // pra cair no fallback do COALESCE.
    const rotulo = comSigla ? `COALESCE(NULLIF(sigla, ''), ${coluna})` : coluna;
    const onde = comSigla ? `(sigla LIKE ? OR ${coluna} LIKE ?)` : `${coluna} LIKE ?`;
    const sql = q
      ? `SELECT id, ${rotulo} AS nome, qtd_questoes AS qtdQuestoes FROM ${tabela}
         WHERE ${onde} AND qtd_questoes > 0
         ORDER BY qtd_questoes DESC LIMIT ?`
      : `SELECT id, ${rotulo} AS nome, qtd_questoes AS qtdQuestoes FROM ${tabela}
         WHERE qtd_questoes > 0
         ORDER BY qtd_questoes DESC LIMIT ?`;
    const params = q ? (comSigla ? [`%${q}%`, `%${q}%`, limit] : [`%${q}%`, limit]) : [limit];
    return db.prepare(sql).all(...params) as unknown as OpcaoFiltro[];
  }

  async listarQuestoes(clienteGuid: string, f: FiltrosQuery): Promise<ListaQuestoesResultado> {
    const db = getDb();
    const { whereSql, params } = montarFiltros(f);
    const offset = (f.page - 1) * f.perPage;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM questoes q
         LEFT JOIN respostas_usuario ru ON ru.questao_id = q.id AND ru.cliente_guid = ?
         ${whereSql}`,
      )
      .get(clienteGuid, ...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT
           q.id, q.dificuldade, q.tipo, q.nivel, q.anulada, q.desatualizada,
           q.has_image AS hasImage, q.enunciado, q.enunciado_clean AS enunciadoClean,
           q.resposta_item_id AS respostaItemId, q.itens_json AS itensJson, q.provas_json AS provasJson,
           q.comentarios_ia AS comentariosIa, q.comentarios_professor AS comentariosProfessor,
           q.comentarios_professor_video AS comentariosProfessorVideo, q.comentarios_aluno AS comentariosAluno,
           q.comentarios_total_alunos AS comentariosTotalAlunos,
           q.comentarios_total_professores AS comentariosTotalProfessores,
           d.id AS disciplinaId, d.nome AS disciplinaNome,
           ru.item_id AS minhaRespostaItemId, ru.correta AS minhaRespostaCorreta,
           ru.respondido_em AS minhaRespostaEm
         FROM questoes q
         JOIN disciplinas d ON d.id = q.disciplina_id
         LEFT JOIN respostas_usuario ru ON ru.questao_id = q.id AND ru.cliente_guid = ?
         ${whereSql}
         ${ordemSql(f.sort)}
         LIMIT ? OFFSET ?`,
      )
      .all(clienteGuid, ...params, f.perPage, offset) as Record<string, unknown>[];

    const parsed = rows.map((r) => {
      const jaRespondida = r.minhaRespostaItemId != null;
      return {
        id: r.id as number,
        dificuldade: r.dificuldade as number | null,
        tipo: r.tipo as string | null,
        nivel: r.nivel as string | null,
        anulada: !!r.anulada,
        desatualizada: !!r.desatualizada,
        hasImage: !!r.hasImage,
        enunciado: r.enunciado as string,
        disciplina: { id: r.disciplinaId as number, nome: r.disciplinaNome as string },
        itens: JSON.parse(r.itensJson as string),
        provas: JSON.parse(r.provasJson as string),
        comentarios: {
          ia: !!r.comentariosIa,
          professor: !!r.comentariosProfessor,
          professorVideo: !!r.comentariosProfessorVideo,
          aluno: !!r.comentariosAluno,
          totalAlunos: r.comentariosTotalAlunos as number,
          totalProfessores: r.comentariosTotalProfessores as number,
        },
        respostaCorretaId: jaRespondida ? (r.respostaItemId as number) : null,
        minhaResposta: jaRespondida
          ? {
              itemId: r.minhaRespostaItemId as number,
              correta: !!r.minhaRespostaCorreta,
              respondidoEm: r.minhaRespostaEm as string,
            }
          : null,
      };
    });

    // SQL conta o conjunto inteiro de graça, então aqui o total é sempre exato
    // (diferente do backend DynamoDB — ver ListaQuestoesResultado).
    return {
      total: totalRow.total,
      totalExato: true,
      temMais: f.page * f.perPage < totalRow.total,
      page: f.page,
      perPage: f.perPage,
      rows: parsed,
    };
  }

  async responder(clienteGuid: string, questaoId: number, itemId: number): Promise<RespostaEnviada | null> {
    const db = getDb();
    const questao = db
      .prepare("SELECT resposta_item_id AS respostaItemId FROM questoes WHERE id = ?")
      .get(questaoId) as { respostaItemId: number | null } | undefined;

    if (!questao) return null;

    const correta = questao.respostaItemId != null && itemId === questao.respostaItemId;

    db.prepare(
      `INSERT INTO respostas_usuario (cliente_guid, questao_id, item_id, correta, respondido_em)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cliente_guid, questao_id) DO UPDATE SET item_id = excluded.item_id, correta = excluded.correta, respondido_em = excluded.respondido_em`,
    ).run(clienteGuid, questaoId, itemId, correta ? 1 : 0, new Date().toISOString());

    return { correta, respostaCorretaId: questao.respostaItemId };
  }

  async resetarResposta(clienteGuid: string, questaoId: number): Promise<void> {
    getDb()
      .prepare("DELETE FROM respostas_usuario WHERE cliente_guid = ? AND questao_id = ?")
      .run(clienteGuid, questaoId);
  }

  async estatisticas(clienteGuid: string): Promise<Estatisticas> {
    const db = getDb();
    const geral = db
      .prepare(
        `SELECT COUNT(*) AS respondidas, SUM(correta) AS certas, COUNT(*) - SUM(correta) AS erradas
         FROM respostas_usuario WHERE cliente_guid = ?`,
      )
      .get(clienteGuid) as { respondidas: number; certas: number | null; erradas: number | null };

    const porDisciplina = db
      .prepare(
        `SELECT d.id, d.nome, COUNT(*) AS respondidas, SUM(ru.correta) AS certas
         FROM respostas_usuario ru
         JOIN questoes q ON q.id = ru.questao_id
         JOIN disciplinas d ON d.id = q.disciplina_id
         WHERE ru.cliente_guid = ?
         GROUP BY d.id
         ORDER BY respondidas DESC`,
      )
      .all(clienteGuid) as Estatisticas["porDisciplina"];

    return {
      respondidas: geral.respondidas,
      certas: geral.certas ?? 0,
      erradas: geral.erradas ?? 0,
      percentualAcerto: geral.respondidas > 0 ? ((geral.certas ?? 0) / geral.respondidas) * 100 : 0,
      porDisciplina,
    };
  }

  async criarCliente(nome?: string): Promise<Cliente> {
    const db = getDb();
    const guid = crypto.randomUUID();
    const criadoEm = new Date().toISOString();
    const nomeFinal = nome?.trim() || "Cliente novo";
    db.prepare(
      "INSERT INTO clientes (guid, nome, nome_personalizado, criado_em, ultimo_acesso) VALUES (?, ?, NULL, ?, NULL)",
    ).run(guid, nomeFinal, criadoEm);
    return { guid, nome: nomeFinal, nomePersonalizado: null, criadoEm, ultimoAcesso: null };
  }

  async listarClientes(): Promise<ClienteComEstatisticas[]> {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.guid, c.nome, c.nome_personalizado AS nomePersonalizado, c.criado_em AS criadoEm,
                c.ultimo_acesso AS ultimoAcesso,
                COUNT(ru.questao_id) AS respondidas,
                COALESCE(SUM(ru.correta), 0) AS certas
         FROM clientes c
         LEFT JOIN respostas_usuario ru ON ru.cliente_guid = c.guid
         GROUP BY c.guid
         ORDER BY c.criado_em DESC`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => {
      const respondidas = r.respondidas as number;
      const certas = r.certas as number;
      return {
        guid: r.guid as string,
        nome: r.nome as string,
        nomePersonalizado: r.nomePersonalizado as string | null,
        criadoEm: r.criadoEm as string,
        ultimoAcesso: r.ultimoAcesso as string | null,
        respondidas,
        certas,
        erradas: respondidas - certas,
      };
    });
  }

  async buscarCliente(guid: string): Promise<Cliente | null> {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT guid, nome, nome_personalizado AS nomePersonalizado, criado_em AS criadoEm,
                ultimo_acesso AS ultimoAcesso
         FROM clientes WHERE guid = ?`,
      )
      .get(guid) as Cliente | undefined;
    return row ?? null;
  }

  async atualizarNomePersonalizado(guid: string, nome: string): Promise<void> {
    getDb().prepare("UPDATE clientes SET nome_personalizado = ? WHERE guid = ?").run(nome.trim(), guid);
  }

  async registrarAcesso(guid: string): Promise<void> {
    getDb().prepare("UPDATE clientes SET ultimo_acesso = ? WHERE guid = ?").run(new Date().toISOString(), guid);
  }
}
