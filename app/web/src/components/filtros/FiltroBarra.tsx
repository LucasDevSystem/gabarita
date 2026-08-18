import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { buscarFiltrosBase, buscarLookup } from "@/lib/api";
import type { FiltrosState } from "@/lib/types";
import { FILTROS_PADRAO } from "@/router";
import { FiltrosSalvos } from "./FiltrosSalvos";
import { SeletorMultiplo } from "./SeletorMultiplo";
import { SeletorAssuntoArvore } from "./SeletorAssuntoArvore";

interface FiltroBarraProps {
  filtros: FiltrosState;
  aoMudar: (parcial: Partial<FiltrosState>) => void;
}

const ESCOLARIDADE_ROTULO: Record<string, string> = {
  Fundamental: "Fundamental",
  Médio: "Médio",
  Superior: "Superior",
};

const DIFICULDADE_ROTULO: Record<number, string> = {
  1: "Muito fácil",
  2: "Fácil",
  3: "Médio",
  4: "Difícil",
  5: "Muito difícil",
};

export function FiltroBarra({ filtros, aoMudar }: FiltroBarraProps) {
  const { data: base } = useQuery({ queryKey: ["filtros-base"], queryFn: buscarFiltrosBase });

  const filtrosAtivos =
    filtros.disciplina.length +
    filtros.assunto.length +
    filtros.banca.length +
    filtros.orgao.length +
    filtros.cargo.length +
    filtros.carreira.length +
    filtros.area.length +
    filtros.ano.length +
    filtros.dificuldade.length +
    filtros.escolaridade.length +
    filtros.tipo.length +
    filtros.comentarios.length +
    (filtros.anuladas === "incluir" ? 1 : 0) +
    (filtros.desatualizadas === "incluir" ? 1 : 0) +
    (filtros.minhasQuestoes !== "todas" ? 1 : 0) +
    (filtros.q ? 1 : 0);

  const incluirValores = [
    ...(filtros.anuladas === "incluir" ? ["anuladas"] : []),
    ...(filtros.desatualizadas === "incluir" ? ["desatualizadas"] : []),
  ];

  return (
    <div className="bg-card border-border/60 space-y-4 rounded-xl border p-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={filtros.q}
            onChange={(e) => aoMudar({ q: e.target.value, page: 1 })}
            placeholder="Pesquisar no enunciado das questões..."
            className="pl-9"
          />
        </div>
        <FiltrosSalvos filtrosAtuais={filtros} aoAplicar={aoMudar} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SeletorMultiplo
          label="Disciplina"
          valores={filtros.disciplina}
          aoMudar={(v) => aoMudar({ disciplina: v, assunto: [], page: 1 })}
          opcoes={base?.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome, qtd: d.qtdQuestoes })) ?? []}
        />
        <SeletorAssuntoArvore
          valores={filtros.assunto}
          aoMudar={(v) => aoMudar({ assunto: v, page: 1 })}
          disciplinaIds={filtros.disciplina}
          disabled={filtros.disciplina.length === 0}
          dicaDesabilitado="Escolha a disciplina primeiro"
        />
        <SeletorMultiplo
          label="Banca"
          valores={filtros.banca}
          aoMudar={(v) => aoMudar({ banca: v, page: 1 })}
          buscar={(q) =>
            buscarLookup("bancas", q).then((r) =>
              r.map((o) => ({ valor: o.id, rotulo: o.nome, qtd: o.qtdQuestoes })),
            )
          }
          chaveCache="bancas"
        />
        <SeletorMultiplo
          label="Instituição"
          valores={filtros.orgao}
          aoMudar={(v) => aoMudar({ orgao: v, page: 1 })}
          buscar={(q) =>
            buscarLookup("orgaos", q).then((r) =>
              r.map((o) => ({ valor: o.id, rotulo: o.nome, qtd: o.qtdQuestoes })),
            )
          }
          chaveCache="orgaos"
        />
        <SeletorMultiplo
          label="Cargo"
          valores={filtros.cargo}
          aoMudar={(v) => aoMudar({ cargo: v, page: 1 })}
          buscar={(q) =>
            buscarLookup("cargos", q).then((r) =>
              r.map((o) => ({ valor: o.id, rotulo: o.nome, qtd: o.qtdQuestoes })),
            )
          }
          chaveCache="cargos"
        />
        <SeletorMultiplo
          label="Ano"
          valores={filtros.ano}
          aoMudar={(v) => aoMudar({ ano: v, page: 1 })}
          opcoes={base?.anos.map((a) => ({ valor: a.ano, rotulo: String(a.ano), qtd: a.qtdQuestoes })) ?? []}
        />
        <SeletorMultiplo
          label="Carreira"
          valores={filtros.carreira}
          aoMudar={(v) => aoMudar({ carreira: v, page: 1 })}
          opcoes={base?.carreiras.map((c) => ({ valor: c.id, rotulo: c.nome, qtd: c.qtdQuestoes })) ?? []}
        />
        <SeletorMultiplo
          label="Área de formação"
          valores={filtros.area}
          aoMudar={(v) => aoMudar({ area: v, page: 1 })}
          opcoes={base?.areas.map((a) => ({ valor: a.id, rotulo: a.nome, qtd: a.qtdQuestoes })) ?? []}
        />
        <SeletorMultiplo
          label="Escolaridade"
          valores={filtros.escolaridade}
          aoMudar={(v) => aoMudar({ escolaridade: v, page: 1 })}
          opcoes={
            base?.escolaridades.map((e) => ({
              valor: e.nivel,
              rotulo: ESCOLARIDADE_ROTULO[e.nivel] ?? e.nivel,
              qtd: e.qtdQuestoes,
            })) ?? []
          }
        />
        <SeletorMultiplo
          label="Dificuldade"
          valores={filtros.dificuldade}
          aoMudar={(v) => aoMudar({ dificuldade: v, page: 1 })}
          opcoes={
            base?.dificuldades.map((d) => ({
              valor: d.dificuldade,
              rotulo: DIFICULDADE_ROTULO[d.dificuldade] ?? String(d.dificuldade),
              qtd: d.qtdQuestoes,
            })) ?? []
          }
        />
      </div>

      <Separator />

      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <FiltroChips label="Tipo de questão">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={filtros.tipo}
            onValueChange={(v) => aoMudar({ tipo: v, page: 1 })}
          >
            <ToggleGroupItem value="certo e errado">Certo e errado</ToggleGroupItem>
            <ToggleGroupItem value="multipla escolha">Múltipla escolha</ToggleGroupItem>
          </ToggleGroup>
        </FiltroChips>

        <FiltroChips label="Minhas questões">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={filtros.minhasQuestoes === "todas" ? "" : filtros.minhasQuestoes}
            onValueChange={(v) =>
              aoMudar({ minhasQuestoes: (v || "todas") as FiltrosState["minhasQuestoes"], page: 1 })
            }
          >
            <ToggleGroupItem value="resolvidas">Resolvidas</ToggleGroupItem>
            <ToggleGroupItem value="naoresolvidas">Não resolvidas</ToggleGroupItem>
            <ToggleGroupItem value="certas">Certas</ToggleGroupItem>
            <ToggleGroupItem value="erradas">Erradas</ToggleGroupItem>
          </ToggleGroup>
        </FiltroChips>

        <FiltroChips label="Incluir questões">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={incluirValores}
            onValueChange={(v) =>
              aoMudar({
                anuladas: v.includes("anuladas") ? "incluir" : "excluir",
                desatualizadas: v.includes("desatualizadas") ? "incluir" : "excluir",
                page: 1,
              })
            }
          >
            <ToggleGroupItem value="anuladas">Anuladas</ToggleGroupItem>
            <ToggleGroupItem value="desatualizadas">Desatualizadas</ToggleGroupItem>
          </ToggleGroup>
        </FiltroChips>

        <FiltroChips label="Comentários">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={filtros.comentarios}
            onValueChange={(v) => aoMudar({ comentarios: v, page: 1 })}
          >
            <ToggleGroupItem value="professor">Professores</ToggleGroupItem>
            <ToggleGroupItem value="aluno">Alunos</ToggleGroupItem>
            <ToggleGroupItem value="professorVideo">Vídeo</ToggleGroupItem>
            <ToggleGroupItem value="ia">IA</ToggleGroupItem>
          </ToggleGroup>
        </FiltroChips>
      </div>

      {filtrosAtivos > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => aoMudar(FILTROS_PADRAO)}>
            <X className="size-3.5" />
            Limpar filtros ({filtrosAtivos})
          </Button>
        </div>
      )}
    </div>
  );
}

function FiltroChips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {children}
    </div>
  );
}
