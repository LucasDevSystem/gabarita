import { useState } from "react";
import DOMPurify from "dompurify";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { responderQuestao, resetarResposta } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Questao } from "@/lib/types";
import { BadgeDificuldade } from "./BadgeDificuldade";

export function QuestaoCard({ questao }: { questao: Questao }) {
  const queryClient = useQueryClient();
  const [respostaLocal, setRespostaLocal] = useState(questao.minhaResposta);
  const [respostaCorretaId, setRespostaCorretaId] = useState(questao.respostaCorretaId);
  const [selecionado, setSelecionado] = useState<number | null>(
    questao.minhaResposta?.itemId ?? null,
  );
  const [riscados, setRiscados] = useState<Set<number>>(new Set());

  const respondida = respostaLocal;

  const mutResponder = useMutation({
    mutationFn: (itemId: number) => responderQuestao(questao.id, itemId),
    onSuccess: (res, itemId) => {
      setRespostaLocal({ itemId, correta: res.correta, respondidoEm: new Date().toISOString() });
      setRespostaCorretaId(res.respostaCorretaId);
      queryClient.invalidateQueries({ queryKey: ["estatisticas"] });
    },
    onError: () => toast.error("Não deu pra enviar sua resposta. Tenta de novo."),
  });

  const mutResetar = useMutation({
    mutationFn: () => resetarResposta(questao.id),
    onSuccess: () => {
      setRespostaLocal(null);
      setSelecionado(null);
      setRiscados(new Set());
      queryClient.invalidateQueries({ queryKey: ["estatisticas"] });
    },
  });

  function alternarRiscado(itemId: number) {
    setRiscados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(itemId)) proximo.delete(itemId);
      else proximo.add(itemId);
      return proximo;
    });
  }

  const prova = questao.provas[0];
  const enunciadoLimpo = DOMPurify.sanitize(questao.enunciado);

  return (
    <div className="bg-card border-border/60 relative overflow-hidden rounded-xl border">
      <div
        className={cn(
          "absolute top-0 left-0 h-full w-1",
          respondida ? (respondida.correta ? "bg-correct" : "bg-destructive") : "bg-primary/50",
        )}
      />

      <div className="space-y-4 p-5 pl-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">Q{questao.id}</Badge>
          <Badge variant="outline">{questao.disciplina.nome}</Badge>
          {prova && (
            <Badge variant="outline">
              {prova.banca?.sigla || prova.banca?.nome} · {prova.ano}
            </Badge>
          )}
          {questao.anulada && <Badge variant="destructive">Anulada</Badge>}
          {questao.desatualizada && <Badge variant="destructive">Desatualizada</Badge>}
          <span className="ml-auto" />
          <BadgeDificuldade dificuldade={questao.dificuldade} />
        </div>

        {prova && <p className="text-muted-foreground text-xs">{prova.nome}</p>}

        <div
          className="text-[0.95rem] leading-relaxed [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_p]:mb-2 [&_p:last-child]:mb-0"
          dangerouslySetInnerHTML={{ __html: enunciadoLimpo }}
        />

        <div className="space-y-2">
          {questao.itens.map((item) => {
            const escolhido = respondida?.itemId === item.id;
            const correto = item.id === respostaCorretaId;
            const mostrarResultado = !!respondida;
            const marcado = !mostrarResultado && selecionado === item.id;
            const riscado = riscados.has(item.id);

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-stretch overflow-hidden rounded-lg border text-sm transition-colors",
                  !mostrarResultado && !marcado && "border-border",
                  !mostrarResultado && marcado && "border-primary bg-primary/5",
                  mostrarResultado && correto && "border-correct bg-correct/10",
                  mostrarResultado && escolhido && !correto && "border-destructive bg-destructive/10",
                  mostrarResultado && !correto && !escolhido && "border-border opacity-60",
                )}
              >
                {!mostrarResultado && (
                  <button
                    type="button"
                    onClick={() => alternarRiscado(item.id)}
                    aria-pressed={riscado}
                    aria-label="Riscar alternativa"
                    title="Riscar alternativa"
                    className={cn(
                      "border-border/70 flex w-9 shrink-0 items-center justify-center border-r transition-colors",
                      riscado
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Scissors className="size-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  disabled={mostrarResultado || mutResponder.isPending}
                  onClick={() => setSelecionado(item.id)}
                  className="flex flex-1 items-start gap-3 px-3.5 py-2.5 text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                      mostrarResultado && correto && "border-correct bg-correct text-correct-foreground",
                      mostrarResultado &&
                        escolhido &&
                        !correto &&
                        "border-destructive bg-destructive text-white",
                      marcado && "border-primary bg-primary text-primary-foreground",
                      !marcado &&
                        !(mostrarResultado && (correto || escolhido)) &&
                        "border-muted-foreground/40",
                    )}
                  >
                    {mostrarResultado && correto ? (
                      <Check className="size-3" />
                    ) : mostrarResultado && escolhido && !correto ? (
                      <X className="size-3" />
                    ) : (
                      item.rotulo?.trim() || item.ordem
                    )}
                  </span>
                  <span
                    className={cn(
                      "flex-1 [&_p]:inline",
                      riscado && !mostrarResultado && "text-muted-foreground line-through",
                    )}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.corpo) }}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {!respondida && (
          <div className="flex justify-end">
            <Button
              onClick={() => selecionado != null && mutResponder.mutate(selecionado)}
              disabled={selecionado == null || mutResponder.isPending}
            >
              Responder
            </Button>
          </div>
        )}

        {respondida && (
          <div className="flex items-center justify-between border-t pt-3">
            <p
              className={cn(
                "text-sm font-medium",
                respondida.correta ? "text-correct" : "text-destructive",
              )}
            >
              {respondida.correta ? "Você acertou!" : "Você errou."}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => mutResetar.mutate()}
              disabled={mutResetar.isPending}
            >
              <RotateCcw className="size-3.5" />
              Refazer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
