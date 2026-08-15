import { useState } from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useFiltrosSalvos } from "@/hooks/useFiltrosSalvos";
import type { FiltrosState } from "@/lib/types";

interface FiltrosSalvosProps {
  filtrosAtuais: FiltrosState;
  aoAplicar: (filtros: FiltrosState) => void;
}

export function FiltrosSalvos({ filtrosAtuais, aoAplicar }: FiltrosSalvosProps) {
  const { salvos, salvar, remover } = useFiltrosSalvos();
  const [aberto, setAberto] = useState(false);
  const [rotulo, setRotulo] = useState("");

  function aoSalvar() {
    const nome = rotulo.trim();
    if (!nome) return;
    salvar(nome, filtrosAtuais);
    setRotulo("");
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5 shrink-0">
          <Bookmark className="size-4" />
          Filtros salvos
          {salvos.length > 0 && (
            <span className="text-muted-foreground">({salvos.length})</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-2">
          <p className="text-xs font-medium">Salvar filtro atual</p>
          <div className="flex gap-1.5">
            <Input
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && aoSalvar()}
              placeholder="Ex: Direito Adm. FCC 2024"
              className="h-8 text-sm"
              maxLength={60}
            />
            <Button size="icon-sm" onClick={aoSalvar} disabled={!rotulo.trim()} aria-label="Salvar">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        <Separator className="my-3" />

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {salvos.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Nenhum filtro salvo ainda.
            </p>
          ) : (
            salvos.map((s) => (
              <div
                key={s.id}
                className="hover:bg-accent/60 group flex items-center gap-1 rounded-md pr-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    aoAplicar(s.filtros);
                    setAberto(false);
                  }}
                  className="flex-1 truncate px-2 py-1.5 text-left text-sm"
                >
                  {s.rotulo}
                </button>
                <button
                  type="button"
                  onClick={() => remover(s.id)}
                  aria-label={`Remover filtro ${s.rotulo}`}
                  className="text-muted-foreground hover:text-destructive shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
