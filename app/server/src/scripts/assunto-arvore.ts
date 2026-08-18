// Catálogo completo da árvore de assuntos (raízes + nós profundos), usado só
// por scripts (ingest, sync, carregador do DynamoDB) — nunca pelo servidor
// rodando, já que arvore_assuntos.json não sobe pro git (é gitignored, como
// todo /*.json na raiz) e não existe no deploy do Render.
import fs from "node:fs";
import { paths } from "../config.js";

export interface NoAssunto {
  nome: string;
  pai: number | null;
  materia: boolean;
}

let cache: Map<number, NoAssunto> | null = null;

export function carregarArvore(): Map<number, NoAssunto> {
  if (cache) return cache;

  const mapa = new Map<number, NoAssunto>();

  const raizes = JSON.parse(fs.readFileSync(paths.assuntosJson, "utf-8")) as { id: number; nome: string }[];
  for (const r of raizes) {
    mapa.set(r.id, { nome: r.nome, pai: null, materia: true });
  }

  const arvore = JSON.parse(fs.readFileSync(paths.arvoreAssuntosJson, "utf-8")) as {
    id: number;
    nome: string;
    pai: number | null;
  }[];
  for (const n of arvore) {
    mapa.set(n.id, { nome: n.nome, pai: n.pai ?? null, materia: false });
  }

  cache = mapa;
  return mapa;
}

// Sobe de cada id marcado até a raiz, acumulando tudo num fecho. Assim
// "selecionar um nó" (raiz ou folha) casa direto com contains(assuntoIds,
// :id), sem precisar expandir pra baixo — que estouraria: alguns nós têm
// mais de mil descendentes, e um FilterExpression do DynamoDB com uma
// cláusula OR por descendente passa do limite de ~4KB da AWS.
export function calcularFecho(idsBase: number[], arvore: Map<number, NoAssunto>): number[] {
  const fechado = new Set<number>();
  for (const idInicial of idsBase) {
    let atual: number | null = idInicial;
    while (atual != null && !fechado.has(atual)) {
      fechado.add(atual);
      atual = arvore.get(atual)?.pai ?? null;
    }
  }
  return [...fechado];
}
