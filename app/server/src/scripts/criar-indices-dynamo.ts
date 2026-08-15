// Cria os índices enxutos que a listagem usa (ver repo/dynamo.ts).
//
// O disciplina-index original projeta ALL, ou seja, cada entrada do índice é
// uma cópia integral da questão (~3,2KB). Como a projeção é aplicada DEPOIS
// da leitura, pedir só o "id" não adiantava nada: uma página de 1MB devolvia
// apenas 375 itens. Estes índices projetam só o que os filtros leem, então
// cabem ~3x mais itens por ida — e a paginação por cursor faz o resto.
//
// O DynamoDB faz o backfill sozinho, mas um índice por vez: o script cria um,
// espera ficar ACTIVE, e só então cria o próximo.
//
// AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//   pnpm --filter gabarita-server criar:indices
import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
  type GlobalSecondaryIndexDescription,
} from "@aws-sdk/client-dynamodb";
import { env } from "../config.js";
import {
  ATRIBUTOS_PROJETADOS,
  INDICE_BUSCA,
  INDICE_GLOBAL,
  TABELA_QUESTOES,
} from "../repo/dynamo.js";

const client = new DynamoDBClient({ region: env.aws.region });

interface Definicao {
  nome: string;
  chaveParticao: string;
}

const INDICES: Definicao[] = [
  // filtro por disciplina (o caso comum), já ordenado por id decrescente
  { nome: INDICE_BUSCA, chaveParticao: "disciplinaId" },
  // tela inicial, sem disciplina escolhida: shards sintéticos pra conseguir
  // ler em ordem sem varrer a tabela
  { nome: INDICE_GLOBAL, chaveParticao: "shard" },
];

async function descrever(): Promise<GlobalSecondaryIndexDescription[]> {
  const res = await client.send(new DescribeTableCommand({ TableName: TABELA_QUESTOES }));
  return res.Table?.GlobalSecondaryIndexes ?? [];
}

async function esperarAtivo(nome: string) {
  process.stdout.write(`   aguardando ${nome} ficar ACTIVE`);
  for (;;) {
    const indices = await descrever();
    const alvo = indices.find((i) => i.IndexName === nome);
    if (alvo?.IndexStatus === "ACTIVE" && !alvo.Backfilling) {
      console.log(`\n   ${nome} pronto (${alvo.ItemCount ?? "?"} itens indexados).`);
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function criar(def: Definicao) {
  const existentes = await descrever();
  if (existentes.some((i) => i.IndexName === def.nome)) {
    console.log(`${def.nome} já existe — pulando.`);
    return;
  }

  console.log(`Criando ${def.nome} (PK ${def.chaveParticao}, SK id)...`);
  await client.send(
    new UpdateTableCommand({
      TableName: TABELA_QUESTOES,
      AttributeDefinitions: [
        { AttributeName: def.chaveParticao, AttributeType: "N" },
        { AttributeName: "id", AttributeType: "N" },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: def.nome,
            KeySchema: [
              { AttributeName: def.chaveParticao, KeyType: "HASH" },
              { AttributeName: "id", KeyType: "RANGE" },
            ],
            Projection: {
              ProjectionType: "INCLUDE",
              NonKeyAttributes: ATRIBUTOS_PROJETADOS,
            },
          },
        },
      ],
    }),
  );
  await esperarAtivo(def.nome);
}

async function main() {
  for (const def of INDICES) await criar(def);
  console.log("\nÍndices prontos.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
