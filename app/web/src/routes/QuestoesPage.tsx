import { useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FiltroBarra } from "@/components/filtros/FiltroBarra";
import { QuestaoCard } from "@/components/questao/QuestaoCard";
import { buscarFiltrosBase, buscarQuestoes } from "@/lib/api";
import type { FiltrosState } from "@/lib/types";

export function QuestoesPage() {
  const filtros = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });

  const aoMudar = (parcial: Partial<FiltrosState>) => {
    navigate({ search: (prev) => ({ ...prev, ...parcial }) });
  };

  const { data: base } = useQuery({ queryKey: ["filtros-base"], queryFn: buscarFiltrosBase });
  const ordenacaoPorDificuldade = base?.capacidades.ordenacaoPorDificuldade ?? true;

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["questoes", filtros],
    queryFn: () => buscarQuestoes(filtros),
    placeholderData: keepPreviousData,
  });

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="space-y-4">
      <FiltroBarra filtros={filtros} aoMudar={aoMudar} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {data ? (
            <>
              <span className="text-foreground font-medium">
                {data.total.toLocaleString("pt-BR")}
              </span>{" "}
              questões encontradas
            </>
          ) : (
            "Carregando..."
          )}
          {isFetching && !isLoading && <span className="ml-1 opacity-60">· atualizando</span>}
        </p>

        <div className="flex items-center gap-2">
          <Select
            value={String(filtros.perPage)}
            onValueChange={(v) => aoMudar({ perPage: Number(v), page: 1 })}
          >
            <SelectTrigger size="sm" className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.sort}
            onValueChange={(v) => aoMudar({ sort: v as FiltrosState["sort"], page: 1 })}
          >
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recentes">Mais recentes</SelectItem>
              {ordenacaoPorDificuldade && (
                <>
                  <SelectItem value="dificuldade_asc">Dificuldade: menor</SelectItem>
                  <SelectItem value="dificuldade_desc">Dificuldade: maior</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : data?.rows.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <SearchX className="size-8 opacity-50" />
          <p>Nenhuma questão encontrada com esses filtros.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data?.rows.map((questao) => (
            <QuestaoCard key={questao.id} questao={questao} />
          ))}
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filtros.page <= 1}
            onClick={() => aoMudar({ page: filtros.page - 1 })}
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <span className="text-muted-foreground text-sm">
            Página {filtros.page} de {totalPaginas.toLocaleString("pt-BR")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filtros.page >= totalPaginas}
            onClick={() => aoMudar({ page: filtros.page + 1 })}
          >
            Próxima
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
