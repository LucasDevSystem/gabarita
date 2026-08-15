// Cria as tabelas do DynamoDB usadas em produção (ver server/src/repo/dynamo.ts).
// Roda uma vez, com as credenciais AWS de quem for fazer o deploy:
//   AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... pnpm --filter gabarita-server criar:tabelas
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { env } from "../config.js";
import { INDICE_DISCIPLINA, TABELA_LOOKUPS, TABELA_QUESTOES, TABELA_RESPOSTAS } from "../repo/dynamo.js";

const client = new DynamoDBClient({ region: env.aws.region });

async function existe(nome: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: nome }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false;
    throw err;
  }
}

async function criarSeNaoExiste(nome: string, criar: () => Promise<unknown>) {
  if (await existe(nome)) {
    console.log(`[ok] ${nome} já existe`);
    return;
  }
  console.log(`Criando ${nome}...`);
  await criar();
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: nome });
  console.log(`[ok] ${nome} criada`);
}

async function main() {
  await criarSeNaoExiste(TABELA_QUESTOES, () =>
    client.send(
      new CreateTableCommand({
        TableName: TABELA_QUESTOES,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "id", AttributeType: "N" },
          { AttributeName: "disciplinaId", AttributeType: "N" },
        ],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        GlobalSecondaryIndexes: [
          {
            IndexName: INDICE_DISCIPLINA,
            KeySchema: [
              { AttributeName: "disciplinaId", KeyType: "HASH" },
              { AttributeName: "id", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    ),
  );

  await criarSeNaoExiste(TABELA_RESPOSTAS, () =>
    client.send(
      new CreateTableCommand({
        TableName: TABELA_RESPOSTAS,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: "questaoId", AttributeType: "N" }],
        KeySchema: [{ AttributeName: "questaoId", KeyType: "HASH" }],
      }),
    ),
  );

  await criarSeNaoExiste(TABELA_LOOKUPS, () =>
    client.send(
      new CreateTableCommand({
        TableName: TABELA_LOOKUPS,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "tipo", AttributeType: "S" },
          { AttributeName: "id", AttributeType: "N" },
        ],
        KeySchema: [
          { AttributeName: "tipo", KeyType: "HASH" },
          { AttributeName: "id", KeyType: "RANGE" },
        ],
      }),
    ),
  );

  console.log("\nPronto. Agora rode: pnpm --filter gabarita-server exportar:dynamo");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
