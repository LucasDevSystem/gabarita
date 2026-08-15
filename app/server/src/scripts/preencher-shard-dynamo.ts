// Preenche o atributo `shard` nas questões que ainda não o têm.
//
// O global-index (PK shard) atende a tela inicial, quando não há disciplina
// escolhida. Item sem `shard` simplesmente NÃO entra nesse índice — ficaria
// invisível na listagem sem filtro, sem erro nenhum. Isso acontece com tudo
// que foi carregado antes do shard existir: a amostra de 10% exportada do
// SQLite (exportar-dynamo.ts) e qualquer disciplina ainda não re-sincronizada.
//
// Varre a tabela procurando quem falta em vez de deduzir por disciplina, pra
// ser correto independente de como o dado entrou — e é idempotente, já que
// shard é função determinística do id.
//
// AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//   pnpm --filter gabarita-server preencher:shard
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../config.js";
import { TABELA_QUESTOES, TOTAL_SHARDS } from "../repo/dynamo.js";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.aws.region }));

const SEGMENTOS = 8;
const MAX_EM_VOO = 25;

async function main() {
  let lidos = 0;
  let atualizados = 0;
  let emVoo = 0;
  let erro: unknown = null;
  const inicio = Date.now();

  const atualizar = async (id: number) => {
    emVoo++;
    try {
      await doc.send(
        new UpdateCommand({
          TableName: TABELA_QUESTOES,
          Key: { id },
          UpdateExpression: "SET #s = :s",
          ExpressionAttributeNames: { "#s": "shard" },
          ExpressionAttributeValues: { ":s": id % TOTAL_SHARDS },
        }),
      );
      atualizados++;
      if (atualizados % 5000 === 0) {
        const seg = ((Date.now() - inicio) / 1000).toFixed(0);
        console.log(`   ${atualizados} atualizadas (${lidos} lidas) — ${seg}s`);
      }
    } catch (e) {
      erro = e;
    } finally {
      emVoo--;
    }
  };

  await Promise.all(
    Array.from({ length: SEGMENTOS }, async (_, Segment) => {
      let ExclusiveStartKey: ScanCommandInput["ExclusiveStartKey"];
      do {
        if (erro) return;
        const res = await doc.send(
          new ScanCommand({
            TableName: TABELA_QUESTOES,
            Segment,
            TotalSegments: SEGMENTOS,
            FilterExpression: "attribute_not_exists(#s)",
            ProjectionExpression: "#id",
            ExpressionAttributeNames: { "#s": "shard", "#id": "id" },
            ExclusiveStartKey,
          }),
        );
        lidos += res.ScannedCount ?? 0;
        for (const item of ((res.Items ?? []) as { id: number }[])) {
          void atualizar(item.id);
          while (emVoo >= MAX_EM_VOO) await new Promise((r) => setTimeout(r, 20));
        }
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    }),
  );

  while (emVoo > 0) await new Promise((r) => setTimeout(r, 20));
  if (erro) throw erro;

  const seg = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`\n${atualizados} questões receberam shard (${lidos} varridas) em ${seg}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
