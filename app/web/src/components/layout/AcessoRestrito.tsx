import { ShieldAlert } from "lucide-react";
import { Logo } from "./Logo";

export function AcessoRestrito({ mensagem }: { mensagem?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <div className="bg-muted/50 text-muted-foreground rounded-full p-3">
        <ShieldAlert className="size-5" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-foreground text-lg font-medium">Acesso restrito</p>
        <p className="text-muted-foreground text-sm">
          {mensagem ?? "Esse aplicativo só pode ser acessado por um link de convite. Peça o link a quem te convidou."}
        </p>
      </div>
    </div>
  );
}
