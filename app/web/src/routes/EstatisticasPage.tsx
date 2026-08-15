import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ListChecks, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { buscarEstatisticas } from "@/lib/api";

function CartaoNumero({
  titulo,
  valor,
  icone,
  cor,
}: {
  titulo: string;
  valor: string;
  icone: React.ReactNode;
  cor?: string;
}) {
  return (
    <div className="bg-card border-border/60 flex items-center gap-3 rounded-xl border p-4">
      <div className={`rounded-lg p-2 ${cor ?? "bg-primary/10 text-primary"}`}>{icone}</div>
      <div>
        <p className="text-muted-foreground text-xs">{titulo}</p>
        <p className="text-xl font-semibold tabular-nums">{valor}</p>
      </div>
    </div>
  );
}

export function EstatisticasPage() {
  const { data, isLoading } = useQuery({ queryKey: ["estatisticas"], queryFn: buscarEstatisticas });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  if (data.respondidas === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
        <ListChecks className="size-8 opacity-50" />
        <p>Você ainda não respondeu nenhuma questão.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CartaoNumero
          titulo="Questões respondidas"
          valor={data.respondidas.toLocaleString("pt-BR")}
          icone={<ListChecks className="size-5" />}
        />
        <CartaoNumero
          titulo="Acertos"
          valor={`${data.certas.toLocaleString("pt-BR")} (${data.percentualAcerto.toFixed(0)}%)`}
          icone={<CheckCircle2 className="size-5" />}
          cor="bg-correct/15 text-correct"
        />
        <CartaoNumero
          titulo="Erros"
          valor={data.erradas.toLocaleString("pt-BR")}
          icone={<XCircle className="size-5" />}
          cor="bg-destructive/15 text-destructive"
        />
      </div>

      <div className="bg-card border-border/60 rounded-xl border p-5">
        <h2 className="mb-4 text-sm font-medium">Desempenho por disciplina</h2>
        <div className="space-y-3">
          {data.porDisciplina.map((d) => {
            const pct = d.respondidas > 0 ? (d.certas / d.respondidas) * 100 : 0;
            return (
              <div key={d.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{d.nome}</span>
                  <span className="text-muted-foreground">
                    {d.certas}/{d.respondidas} ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-correct h-full rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
