import { useEffect, useState } from "react";
import type { FiltrosState } from "@/lib/types";

export interface FiltroSalvo {
  id: string;
  rotulo: string;
  criadoEm: string;
  filtros: FiltrosState;
}

const CHAVE = "gabarita:filtros-salvos";

function ler(): FiltroSalvo[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as FiltroSalvo[]) : [];
  } catch {
    return [];
  }
}

function escrever(lista: FiltroSalvo[]) {
  localStorage.setItem(CHAVE, JSON.stringify(lista));
}

export function useFiltrosSalvos() {
  const [salvos, setSalvos] = useState<FiltroSalvo[]>(() => ler());

  useEffect(() => {
    function aoMudarStorage(e: StorageEvent) {
      if (e.key === CHAVE) setSalvos(ler());
    }
    window.addEventListener("storage", aoMudarStorage);
    return () => window.removeEventListener("storage", aoMudarStorage);
  }, []);

  function salvar(rotulo: string, filtros: FiltrosState) {
    const novo: FiltroSalvo = {
      id: crypto.randomUUID(),
      rotulo,
      criadoEm: new Date().toISOString(),
      filtros: { ...filtros, page: 1 },
    };
    const atualizados = [novo, ...salvos];
    setSalvos(atualizados);
    escrever(atualizados);
  }

  function remover(id: string) {
    const atualizados = salvos.filter((s) => s.id !== id);
    setSalvos(atualizados);
    escrever(atualizados);
  }

  return { salvos, salvar, remover };
}
