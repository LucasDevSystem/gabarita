import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { paths } from "./config.js";
import { registrarRotasFiltros } from "./routes/filtros.js";
import { registrarRotasQuestoes } from "./routes/questoes.js";
import { registrarRotasEstatisticas } from "./routes/estatisticas.js";

const isDev = process.env.NODE_ENV !== "production";

// Em dev, usa API_PORT (não PORT) de propósito: ferramentas de preview/dev
// costumam exportar PORT apontando pra porta do frontend, o que faria a API
// tentar escutar na mesma porta do Vite. Em produção (Render), a plataforma
// injeta a porta real em PORT e é isso que precisa ser respeitado.
const PORTA = Number(isDev ? process.env.API_PORT : (process.env.PORT ?? process.env.API_PORT)) || 4477;

async function main() {
  const app = Fastify({ logger: { level: isDev ? "info" : "warn" } });

  if (isDev) {
    await app.register(cors, { origin: true });
  }

  registrarRotasFiltros(app);
  registrarRotasQuestoes(app);
  registrarRotasEstatisticas(app);

  if (!isDev && fs.existsSync(paths.webDist)) {
    await app.register(fastifyStatic, { root: paths.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ erro: "Não encontrado" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  // 0.0.0.0 (não 127.0.0.1) é obrigatório pro Render conseguir rotear
  // tráfego externo pro processo.
  await app.listen({ port: PORTA, host: "0.0.0.0" });
  app.log.info(`Gabarita API na porta ${PORTA}`);
}

main();
