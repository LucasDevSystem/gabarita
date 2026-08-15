import "dotenv/config";
import path from "node:path";

const serverRoot = path.resolve(import.meta.dirname, "..");
const projectRoot = path.resolve(serverRoot, "../..");

export const paths = {
  serverRoot,
  dadosDir: path.join(projectRoot, "dados"),
  bancasJson: path.join(projectRoot, "bancas.json"),
  cargosJson: path.join(projectRoot, "cargos.json"),
  orgaoJson: path.join(projectRoot, "orgao.json"),
  carreirasJson: path.join(projectRoot, "carreiras.json"),
  areasFormacaoJson: path.join(projectRoot, "areasformacao.json"),
  assuntosJson: path.join(projectRoot, "assuntos.json"),
  dbFile: path.join(serverRoot, "data", "app.db"),
  webDist: path.resolve(projectRoot, "app", "web", "dist"),
};

// Credenciais AWS nunca são lidas aqui diretamente — o SDK da AWS já pega
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY do ambiente sozinho (cadeia padrão
// de provedores de credenciais), então esse módulo nunca precisa tocar nelas.
export const env = {
  dbDriver: (process.env.DB_DRIVER === "dynamodb" ? "dynamodb" : "sqlite") as "sqlite" | "dynamodb",
  nodeEnv: process.env.NODE_ENV ?? "development",
  apiPort: Number(process.env.API_PORT) || 4477,
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    tablePrefix: process.env.DYNAMO_TABLE_PREFIX || "gabarita-",
  },
  // Segredo único pro painel /admin (ver middleware/auth.ts) — mesmo padrão
  // das credenciais AWS: só variável de ambiente, nunca commitado. String
  // vazia de propósito quando ausente, não undefined — evita que uma
  // requisição sem header Authorization "combine" com um ADMIN_TOKEN não
  // configurado.
  adminToken: process.env.ADMIN_TOKEN ?? "",
};
