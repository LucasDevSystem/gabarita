import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

export interface OpcaoSelecao<T extends string | number> {
  valor: T;
  rotulo: string;
  qtd?: number;
}

interface SeletorMultiploProps<T extends string | number> {
  label: string;
  valores: T[];
  aoMudar: (valores: T[]) => void;
  opcoes?: OpcaoSelecao<T>[];
  buscar?: (q: string) => Promise<OpcaoSelecao<T>[]>;
  chaveCache?: string;
  className?: string;
  disabled?: boolean;
  dicaDesabilitado?: string;
}

export function SeletorMultiplo<T extends string | number>({
  label,
  valores,
  aoMudar,
  opcoes,
  buscar,
  chaveCache,
  className,
  disabled,
  dicaDesabilitado,
}: SeletorMultiploProps<T>) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebounce(busca, 250);
  const rotulosConhecidos = useRef(new Map<T, string>());

  const { data: opcoesAsync, isFetching } = useQuery({
    queryKey: ["seletor", chaveCache, buscaDebounced],
    queryFn: () => buscar!(buscaDebounced),
    enabled: !!buscar && aberto,
  });

  const listaAtual = buscar ? (opcoesAsync ?? []) : (opcoes ?? []);

  useEffect(() => {
    for (const o of listaAtual) rotulosConhecidos.current.set(o.valor, o.rotulo);
  }, [listaAtual]);

  const listaFiltrada = buscar
    ? listaAtual
    : listaAtual.filter((o) => o.rotulo.toLowerCase().includes(busca.toLowerCase()));

  function alternar(valor: T) {
    aoMudar(valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);
  }

  return (
    <div className={className}>
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
              {disabled && dicaDesabilitado ? dicaDesabilitado : label}
              {!disabled && valores.length > 0 && (
                <span className="text-muted-foreground ml-1">({valores.length})</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Buscar ${label.toLowerCase()}...`}
              value={busca}
              onValueChange={setBusca}
            />
            <CommandList>
              <CommandEmpty>
                {isFetching ? "Buscando..." : "Nenhum resultado"}
              </CommandEmpty>
              <CommandGroup>
                {listaFiltrada.map((o) => (
                  <CommandItem
                    key={o.valor}
                    value={String(o.valor)}
                    onSelect={() => alternar(o.valor)}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        valores.includes(o.valor) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1 truncate">{o.rotulo}</span>
                    {o.qtd != null && (
                      <span className="text-muted-foreground text-xs">{o.qtd.toLocaleString("pt-BR")}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {valores.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {valores.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-40 truncate">{rotulosConhecidos.current.get(v) ?? v}</span>
              <button
                type="button"
                onClick={() => alternar(v)}
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
