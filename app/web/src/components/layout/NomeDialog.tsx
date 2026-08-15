import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { atualizarMeuNome } from "@/lib/api";

// Aparece uma única vez, no primeiro acesso de um cliente (nomePersonalizado
// ainda vazio) — ver RootLayout.tsx. Sem botão de fechar/ESC/clique fora de
// propósito: não tem como "pular" e continuar sem nome.
export function NomeDialog() {
  const [nome, setNome] = useState("");
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: () => atualizarMeuNome(nome.trim()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eu"] }),
  });

  const confirmar = () => {
    if (nome.trim() && !mut.isPending) mut.mutate();
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Como podemos te chamar?</DialogTitle>
          <DialogDescription>Só aparece pra você — em vez do nome genérico do cadastro.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmar()}
          placeholder="Seu nome"
          maxLength={60}
        />
        <DialogFooter>
          <Button onClick={confirmar} disabled={!nome.trim() || mut.isPending} className="gap-1.5">
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
