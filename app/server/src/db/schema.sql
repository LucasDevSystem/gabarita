-- Lookup tables (populated from the reference JSON files at the project root)
CREATE TABLE IF NOT EXISTS disciplinas (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bancas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  sigla TEXT,
  descricao TEXT,
  oab INTEGER NOT NULL DEFAULT 0,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orgaos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  sigla TEXT,
  esfera TEXT,
  uf TEXT,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cargos (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS carreiras (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assuntos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  materia INTEGER NOT NULL DEFAULT 0,
  pai INTEGER,
  qtd_questoes INTEGER NOT NULL DEFAULT 0
);

-- Main questions table (id is the real question id from the source, used as rowid)
CREATE TABLE IF NOT EXISTS questoes (
  id INTEGER PRIMARY KEY,
  disciplina_id INTEGER NOT NULL,
  dificuldade INTEGER,
  tipo TEXT,
  nivel TEXT,
  anulada INTEGER NOT NULL DEFAULT 0,
  desatualizada INTEGER NOT NULL DEFAULT 0,
  has_image INTEGER NOT NULL DEFAULT 0,
  has_image_itens INTEGER NOT NULL DEFAULT 0,
  enunciado TEXT NOT NULL,
  enunciado_clean TEXT NOT NULL,
  resposta_item_id INTEGER,
  hash TEXT,
  hash_id TEXT,
  timestamp TEXT,
  comentarios_ia INTEGER NOT NULL DEFAULT 0,
  comentarios_professor INTEGER NOT NULL DEFAULT 0,
  comentarios_professor_video INTEGER NOT NULL DEFAULT 0,
  comentarios_aluno INTEGER NOT NULL DEFAULT 0,
  comentarios_total_alunos INTEGER NOT NULL DEFAULT 0,
  comentarios_total_professores INTEGER NOT NULL DEFAULT 0,
  itens_json TEXT NOT NULL,
  provas_json TEXT NOT NULL,
  grupo_questao_json TEXT
);

-- N:N junction tables between questoes and the lookup tables
CREATE TABLE IF NOT EXISTS questao_bancas (
  questao_id INTEGER NOT NULL,
  banca_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, banca_id)
);
CREATE TABLE IF NOT EXISTS questao_orgaos (
  questao_id INTEGER NOT NULL,
  orgao_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, orgao_id)
);
CREATE TABLE IF NOT EXISTS questao_cargos (
  questao_id INTEGER NOT NULL,
  cargo_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, cargo_id)
);
CREATE TABLE IF NOT EXISTS questao_carreiras (
  questao_id INTEGER NOT NULL,
  carreira_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, carreira_id)
);
CREATE TABLE IF NOT EXISTS questao_areas (
  questao_id INTEGER NOT NULL,
  area_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, area_id)
);
CREATE TABLE IF NOT EXISTS questao_assuntos (
  questao_id INTEGER NOT NULL,
  assunto_id INTEGER NOT NULL,
  PRIMARY KEY (questao_id, assunto_id)
);
CREATE TABLE IF NOT EXISTS questao_anos (
  questao_id INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  PRIMARY KEY (questao_id, ano)
);

-- Identidade de quem acessa via link de convite (?u=<guid>) — ver
-- middleware/auth.ts. Cadastrado pelo painel /admin.
CREATE TABLE IF NOT EXISTS clientes (
  guid TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nome_personalizado TEXT,
  criado_em TEXT NOT NULL,
  ultimo_acesso TEXT
);

-- Progresso de resposta, escopado por cliente. NOTA: isso é uma alteração de
-- schema, não uma migração — CREATE TABLE IF NOT EXISTS não altera a PK de um
-- app.db já existente. Se você tinha um app.db de antes dessa mudança
-- (respostas sem cliente_guid), apague o arquivo (app/server/data/app.db) e
-- deixe recriar do zero.
CREATE TABLE IF NOT EXISTS respostas_usuario (
  cliente_guid TEXT NOT NULL,
  questao_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  correta INTEGER NOT NULL,
  respondido_em TEXT NOT NULL,
  PRIMARY KEY (cliente_guid, questao_id)
);
