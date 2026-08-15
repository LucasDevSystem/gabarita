// Painel /admin — protegido pelo ADMIN_TOKEN (ver middleware/auth.ts), não
// pelo guid de cliente. O link compartilhável (?u=<guid>) é montado no
// frontend a partir de window.location.origin, não aqui — assim fica sempre
// correto (http local vs https em produção) sem precisar confiar em headers
// de proxy pra descobrir o protocolo público.
import type { FastifyInstance } from "fastify";
import { repo } from "../repo/index.js";

export function registrarRotasAdmin(app: FastifyInstance) {
  app.get("/api/admin/clientes", async () => {
    return repo.listarClientes();
  });

  app.post<{ Body: { nome?: string } }>("/api/admin/clientes", async (req) => {
    return repo.criarCliente(req.body?.nome);
  });
}
