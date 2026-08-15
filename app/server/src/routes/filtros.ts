import type { FastifyInstance } from "fastify";
import { repo } from "../repo/index.js";
import type { LookupTipo } from "../repo/types.js";

interface BuscaQuery {
  q?: string;
  limit?: string;
}

function registrarBuscaLookup(app: FastifyInstance, rota: string, tipo: LookupTipo) {
  app.get<{ Querystring: BuscaQuery }>(rota, async (req) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    return repo.buscarLookup(tipo, req.query.q?.trim() ?? "", limit);
  });
}

export function registrarRotasFiltros(app: FastifyInstance) {
  app.get("/api/filtros", async () => {
    const base = await repo.filtrosBase();
    return { ...base, capacidades: repo.capacidades };
  });

  registrarBuscaLookup(app, "/api/filtros/bancas", "bancas");
  registrarBuscaLookup(app, "/api/filtros/orgaos", "orgaos");
  registrarBuscaLookup(app, "/api/filtros/cargos", "cargos");
  registrarBuscaLookup(app, "/api/filtros/assuntos", "assuntos");
}
