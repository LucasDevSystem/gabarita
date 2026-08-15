// "Quem sou eu" — o frontend chama isso uma vez no boot pra confirmar o
// token guardado no localStorage ainda é válido e pra saber se precisa
// perguntar o nome (nomePersonalizado ainda vazio, primeiro acesso).
import type { FastifyInstance } from "fastify";
import { repo } from "../repo/index.js";

export function registrarRotaEu(app: FastifyInstance) {
  app.get("/api/eu", async (req) => {
    return req.cliente!;
  });

  app.put<{ Body: { nome?: string } }>("/api/eu", async (req, reply) => {
    const nome = req.body?.nome?.trim();
    if (!nome) {
      return reply.code(400).send({ erro: "Nome é obrigatório" });
    }
    await repo.atualizarNomePersonalizado(req.cliente!.guid, nome);
    return { ...req.cliente!, nomePersonalizado: nome };
  });
}
