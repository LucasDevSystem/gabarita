import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/layout/Logo";
import { AcessoRestrito } from "@/components/layout/AcessoRestrito";
import { tokenAdmin } from "@/lib/auth";
import { criarClienteAdmin, listarClientesAdmin } from "@/lib/api";
import type { ClienteComEstatisticas } from "@/lib/types";

function linkDe(guid: string): string {
  return `${window.location.origin}/?u=${guid}`;
}

function copiarLink(guid: string) {
  navigator.clipboard.writeText(linkDe(guid));
  toast.success("Link copiado");
}

function formatarData(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function LinhaCliente({ cliente }: { cliente: ClienteComEstatisticas }) {
  const pct = cliente.respondidas > 0 ? (cliente.certas / cliente.respondidas) * 100 : 0;
  return (
    <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{cliente.nomePersonalizado || cliente.nome}</p>
        <p className="text-muted-foreground text-xs">
          criado em {formatarData(cliente.criadoEm)} · último acesso {formatarData(cliente.ultimoAcesso)}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right text-sm">
          <p className="tabular-nums">{cliente.respondidas.toLocaleString("pt-BR")} respondidas</p>
          {cliente.respondidas > 0 && (
            <p className="text-muted-foreground text-xs tabular-nums">{pct.toFixed(0)}% de acerto</p>
          )}
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => copiarLink(cliente.guid)}
          aria-label={`Copiar link de convite de ${cliente.nomePersonalizado || cliente.nome}`}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function AdminPage() {
  const [nome, setNome] = useState("");
  const temToken = !!tokenAdmin();
  const queryClient = useQueryClient();

  const {
    data: clientes,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["admin-clientes"],
    queryFn: listarClientesAdmin,
    enabled: temToken,
    retry: false,
  });

  const mut = useMutation({
    mutationFn: () => criarClienteAdmin(nome.trim() || undefined),
    onSuccess: (cliente) => {
      setNome("");
      queryClient.invalidateQueries({ queryKey: ["admin-clientes"] });
      copiarLink(cliente.guid);
      toast.success("Cliente criado — link copiado", { description: linkDe(cliente.guid) });
    },
  });

  if (!temToken || isError) {
    return <AcessoRestrito mensagem="Painel restrito. Acesse pelo link com o token de administrador." />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <Logo />

      <div>
        <h1 className="text-lg font-semibold">Clientes</h1>
        <p className="text-muted-foreground text-sm">
          Cadastre um cliente novo e compartilhe o link gerado — ele autoriza o acesso e atribui as
          respostas a esse cliente.
        </p>
      </div>

      <div className="bg-card border-border/60 flex gap-2 rounded-xl border p-4">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !mut.isPending && mut.mutate()}
          placeholder="Nome (opcional)"
          maxLength={60}
        />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="shrink-0 gap-1.5">
          {mut.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          Criar cliente
        </Button>
      </div>

      <div className="bg-card border-border/60 rounded-xl border p-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !clientes?.length ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Nenhum cliente cadastrado ainda.</p>
        ) : (
          clientes.map((c) => <LinhaCliente key={c.guid} cliente={c} />)
        )}
      </div>
    </div>
  );
}
