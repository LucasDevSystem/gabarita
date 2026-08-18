import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarArvoreAssuntos } from "@/lib/api";
import type { OpcaoFiltro } from "@/lib/types";

interface SeletorAssuntoArvoreProps {
  valores: number[];
  aoMudar: (valores: number[]) => void;
  disciplinaIds: number[];
  disabled?: boolean;
  dicaDesabilitado?: string;
}

interface NoArvore {
  id: number;
  nome: string;
  qtd: number;
  filhos: NoArvore[];
}

// Reconstrói a árvore a partir da lista plana com `pai` que a API devolve
// (id sem pai, ou cujo pai não está no conjunto — ex.: raiz de outra
// disciplina que não passou o corte de qtd>0 — vira nó de topo). A ordem dos
// filhos segue a mesma ordenação da API (contagem desc.) — não a numeração
// curricular (1.2.3...), que exigiria transmitir mais dado por nó.
function construirArvore(opcoes: OpcaoFiltro[]): NoArvore[] {
  const porId = new Map<number, NoArvore>(opcoes.map((o) => [o.id, { id: o.id, nome: o.nome, qtd: o.qtdQuestoes, filhos: [] }]));
  const raizes: NoArvore[] = [];
  for (const o of opcoes) {
    const no = porId.get(o.id)!;
    const pai = o.pai != null ? porId.get(o.pai) : undefined;
    if (pai) pai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}

// Ids de todo nó que bate com o termo + toda a cadeia de ancestrais até a
// raiz — assim dá pra forçar aberto só o necessário pra tornar um resultado
// de busca visível, sem esconder a estrutura em volta dele.
function idsParaExpandir(opcoes: OpcaoFiltro[], termo: string): Set<number> {
  if (!termo.trim()) return new Set();
  const paiPorId = new Map(opcoes.map((o) => [o.id, o.pai ?? null]));
  const alvo = termo.trim().toLowerCase();
  const expandir = new Set<number>();
  for (const o of opcoes) {
    if (!o.nome.toLowerCase().includes(alvo)) continue;
    let atual: number | null = o.pai ?? null;
    while (atual != null && !expandir.has(atual)) {
      expandir.add(atual);
      atual = paiPorId.get(atual) ?? null;
    }
  }
  return expandir;
}

function NoLinha({
  no,
  profundidade,
  busca,
  abertosBusca,
  abertosManual,
  aoAlternarAberto,
  valores,
  aoAlternarValor,
}: {
  no: NoArvore;
  profundidade: number;
  busca: string;
  abertosBusca: Set<number>;
  abertosManual: Set<number>;
  aoAlternarAberto: (id: number) => void;
  valores: number[];
  aoAlternarValor: (id: number) => void;
}) {
  const termo = busca.trim().toLowerCase();
  const bateBusca = !termo || no.nome.toLowerCase().includes(termo);
  const temDescendenteVisivel = termo && !bateBusca ? contemDescendenteQueBate(no, termo) : true;
  if (termo && !bateBusca && !temDescendenteVisivel) return null;

  const temFilhos = no.filhos.length > 0;
  // Durante busca, ramo com resultado abre sozinho; sem busca, respeita o
  // que o usuário abriu/fechou manualmente.
  const aberto = termo ? abertosBusca.has(no.id) || (bateBusca && temFilhos) : abertosManual.has(no.id);

  return (
    <div>
      <div
        className="hover:bg-accent/60 flex items-center gap-1.5 rounded-md py-1 pr-2"
        style={{ paddingLeft: 6 + profundidade * 16 }}
      >
        {temFilhos ? (
          <button
            type="button"
            onClick={() => aoAlternarAberto(no.id)}
            className="text-muted-foreground shrink-0 rounded p-0.5"
            aria-label={aberto ? "Recolher" : "Expandir"}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", aberto && "rotate-90")} />
          </button>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <Checkbox
          checked={valores.includes(no.id)}
          onCheckedChange={() => aoAlternarValor(no.id)}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={() => aoAlternarValor(no.id)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="truncate text-sm">{no.nome}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{no.qtd.toLocaleString("pt-BR")}</span>
        </button>
      </div>
      {aberto &&
        no.filhos.map((filho) => (
          <NoLinha
            key={filho.id}
            no={filho}
            profundidade={profundidade + 1}
            busca={busca}
            abertosBusca={abertosBusca}
            abertosManual={abertosManual}
            aoAlternarAberto={aoAlternarAberto}
            valores={valores}
            aoAlternarValor={aoAlternarValor}
          />
        ))}
    </div>
  );
}

function contemDescendenteQueBate(no: NoArvore, termo: string): boolean {
  return no.filhos.some(
    (f) => f.nome.toLowerCase().includes(termo) || contemDescendenteQueBate(f, termo),
  );
}

export function SeletorAssuntoArvore({
  valores,
  aoMudar,
  disciplinaIds,
  disabled,
  dicaDesabilitado,
}: SeletorAssuntoArvoreProps) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [abertosManual, setAbertosManual] = useState<Set<number>>(new Set());
  const rotulosConhecidos = useRef(new Map<number, string>());

  const { data: opcoes, isFetching } = useQuery({
    queryKey: ["assunto-arvore", disciplinaIds.join(",")],
    queryFn: () => buscarArvoreAssuntos(disciplinaIds),
    enabled: aberto && disciplinaIds.length > 0,
  });

  const lista = opcoes ?? [];

  useEffect(() => {
    for (const o of lista) rotulosConhecidos.current.set(o.id, o.nome);
  }, [lista]);

  // Ao trocar de popover/disciplina, some o histórico manual de expansão —
  // evita um estado "aberto" órfão apontando pra um id que nem existe mais
  // na árvore da disciplina nova.
  useEffect(() => {
    setAbertosManual(new Set());
  }, [disciplinaIds.join(",")]);

  const arvore = useMemo(() => construirArvore(lista), [lista]);
  const abertosBusca = useMemo(() => idsParaExpandir(lista, busca), [lista, busca]);

  function alternarValor(id: number) {
    aoMudar(valores.includes(id) ? valores.filter((v) => v !== id) : [...valores, id]);
  }

  function alternarAberto(id: number) {
    setAbertosManual((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  return (
    <div>
      <Popover open={aberto && !disabled} onOpenChange={(v) => setAberto(v && !disabled)}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            disabled={disabled}
            title={disabled ? dicaDesabilitado : undefined}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {disabled && dicaDesabilitado ? dicaDesabilitado : "Assunto"}
              {!disabled && valores.length > 0 && (
                <span className="text-muted-foreground ml-1">({valores.length})</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="border-border/60 border-b p-2">
            <Input
              placeholder="Pesquisar..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {isFetching ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Carregando...
              </div>
            ) : arvore.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Nenhum assunto encontrado.</p>
            ) : (
              arvore.map((no) => (
                <NoLinha
                  key={no.id}
                  no={no}
                  profundidade={0}
                  busca={busca}
                  abertosBusca={abertosBusca}
                  abertosManual={abertosManual}
                  aoAlternarAberto={alternarAberto}
                  valores={valores}
                  aoAlternarValor={alternarValor}
                />
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {valores.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {valores.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-40 truncate">{rotulosConhecidos.current.get(v) ?? v}</span>
              <button
                type="button"
                onClick={() => alternarValor(v)}
                className="hover:bg-muted-foreground/20 rounded-sm"
                aria-label="Remover"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
