// Gate de acesso por convite: toda rota /api/* exige um token válido no
// header Authorization. Duas identidades possíveis:
//   - /api/admin/*  -> token precisa bater com ADMIN_TOKEN (segredo único,
//     variável de ambiente — ver config.ts).
//   - demais /api/* -> token precisa ser o guid de um cliente cadastrado
//     (ver repo, método buscarCliente). O cliente resolvido fica disponível
//     em request.cliente pro resto do handler.
// /api/saude fica de fora — é o healthCheckPath do Render (render.yaml), que
// bate sem Authorization pra decidir se o serviço está de pé.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config.js";
import { repo } from "../repo/index.js";
import type { Cliente } from "../repo/types.js";

declare module "fastify" {
  interface FastifyRequest {
    cliente?: Cliente;
  }
}

const ROTAS_PUBLICAS = new Set(["/api/saude"]);

// Não atualiza ultimoAcesso a cada requisição — só quando já passou desse
// tempo desde a última vez, mesmo TTL usado nos caches de repo/dynamo.ts.
const INTERVALO_REGISTRO_ACESSO_MS = 60_000;

function extrairToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function registrarAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.raw.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/")) return;
    if (ROTAS_PUBLICAS.has(url)) return;

    const token = extrairToken(req);
    if (!token) {
      reply.code(401).send({ erro: "Acesso restrito — link de convite necessário" });
      return;
    }

    if (url.startsWith("/api/admin/")) {
      // env.adminToken é "" (nunca undefined) quando não configurado — string
      // vazia nunca bate com token, que já foi checado como não-vazio acima.
      if (!env.adminToken || token !== env.adminToken) {
        reply.code(401).send({ erro: "Token de admin inválido" });
      }
      return;
    }

    const cliente = await repo.buscarCliente(token);
    if (!cliente) {
      reply.code(401).send({ erro: "Link de convite inválido" });
      return;
    }
    req.cliente = cliente;

    const acessoDesatualizado =
      !cliente.ultimoAcesso || Date.now() - Date.parse(cliente.ultimoAcesso) > INTERVALO_REGISTRO_ACESSO_MS;
    if (acessoDesatualizado) await repo.registrarAcesso(cliente.guid);
  });
}
