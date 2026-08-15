// Público de propósito — é o healthCheckPath do Render (render.yaml). Fica
// fora do gate de autenticação (ver middleware/auth.ts) porque o Render bate
// aqui sem Authorization pra decidir se o serviço está de pé.
import type { FastifyInstance } from "fastify";

export function registrarRotaSaude(app: FastifyInstance) {
  app.get("/api/saude", async () => {
    return { ok: true };
  });
}
