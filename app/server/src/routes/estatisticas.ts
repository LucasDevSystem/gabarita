import type { FastifyInstance } from "fastify";
import { repo } from "../repo/index.js";

export function registrarRotasEstatisticas(app: FastifyInstance) {
  app.get("/api/estatisticas", async () => {
    return repo.estatisticas();
  });
}
