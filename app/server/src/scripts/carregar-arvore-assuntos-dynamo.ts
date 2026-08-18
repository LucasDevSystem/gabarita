// Carrega o catálogo global da árvore de assuntos (33.302 nós: 208 raízes +
// 33.094 nós profundos) pro DynamoDB de produção, como tipo "assunto-no" em
// gabarita-lookups. Isso é dado ESTRUTURAL (pai/nome de cada nó), não
// contagem por disciplina — usado pelo repo/dynamo.ts como fonte de nome/pai
// no caminho de fallback (disciplina ainda não sincronizada) do seletor de
// Assunto, e existe em produção porque arvore_assuntos.json é gitignored e
// não sobe pro deploy do Render — só sincronizar-dynamo.ts (rodado
// localmente) tem acesso a esse arquivo.
//
// Roda uma vez (ou de novo se a árvore mudar — idempotente, sobrescreve):
//   AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//     pnpm --filter gabarita-server carregar:arvore-assuntos
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import { TABELA_LOOKUPS } from "../repo/dynamo.js";
import { carregarArvore } from "./assunto-arvore.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.aws.region }));
const MAX_LOTES_EM_VOO = 4;

// mesmo padrão de escrita em lote com retry já usado em sincronizar-dynamo.ts
// e recontar-lookups-dynamo.ts.
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
      if (!(e instanceof Error) || e.name !== "ThrottlingException") throw e;
    }
    tentativas++;
    if (tentativas > 10) throw new Error(`Muitas tentativas com throttling/itens pendentes em ${tabela}`);
    await new Promise((r) => setTimeout(r, 300 * tentativas));
  }
}

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

async function main() {
  const arvore = carregarArvore();
  console.log(`${arvore.size} nós na árvore (raízes + profundos). Gravando em ${TABELA_LOOKUPS}...`);

  const itens = [...arvore.entries()].map(([id, no]) => ({
    tipo: "assunto-no",
    id,
    nome: no.nome,
    pai: no.pai,
    qtdQuestoes: 0, // estrutural — contagem de verdade fica em assunto-disc-<disciplina>
  }));

  const inicio = Date.now();
  await escreverEmLotes(TABELA_LOOKUPS, itens);
  const seg = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`\nConcluído em ${seg}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
