// Descobre o que já existe na conta AWS antes de criar/exportar pro DynamoDB.
// Rode com as credenciais no ambiente:
//   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... pnpm --filter gabarita-server verificar:aws
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { DescribeTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { env } from "../config.js";

async function main() {
  const sts = new STSClient({ region: env.aws.region });
  const identidade = await sts.send(new GetCallerIdentityCommand({}));
  console.log("Conta AWS:", identidade.Account);
  console.log("Identidade (ARN):", identidade.Arn);
  console.log("Região configurada:", env.aws.region);
  console.log("Prefixo de tabela configurado:", env.aws.tablePrefix);

  const ddb = new DynamoDBClient({ region: env.aws.region });
  const { TableNames = [] } = await ddb.send(new ListTablesCommand({}));

  console.log(`\nTabelas DynamoDB existentes na região (${TableNames.length}):`);
  if (!TableNames.length) console.log("  (nenhuma)");

  for (const nome of TableNames) {
    const info = await ddb.send(new DescribeTableCommand({ TableName: nome }));
    const t = info.Table;
    const tamanhoMb = ((t?.TableSizeBytes ?? 0) / 1024 / 1024).toFixed(2);
    console.log(
      `  - ${nome}: ${t?.ItemCount ?? 0} itens, ${tamanhoMb} MB, billing=${t?.BillingModeSummary?.BillingMode ?? "PROVISIONED"}, gsis=${t?.GlobalSecondaryIndexes?.length ?? 0}`,
    );
  }

  const relevantes = TableNames.filter((n) => n.startsWith(env.aws.tablePrefix));
  console.log(
    relevantes.length
      ? `\n${relevantes.length} tabela(s) já usam o prefixo "${env.aws.tablePrefix}" deste projeto.`
      : `\nNenhuma tabela com o prefixo "${env.aws.tablePrefix}" deste projeto ainda — serão criadas do zero.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
