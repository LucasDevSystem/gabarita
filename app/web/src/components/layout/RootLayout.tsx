import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useIsFetching, useIsMutating, useQuery } from "@tanstack/react-query";
import { Moon, Sun, BarChart3, ListChecks, Loader2 } from "lucide-react";
import { Logo } from "./Logo";
import { AcessoRestrito } from "./AcessoRestrito";
import { NomeDialog } from "./NomeDialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { tokenCliente } from "@/lib/auth";
import { buscarEu } from "@/lib/api";
import { FILTROS_PADRAO } from "@/router";

function BarraCarregando() {
  const emFetch = useIsFetching();
  const emMutacao = useIsMutating();
  const carregando = emFetch + emMutacao > 0;

  return (
    <div className="bg-border/40 relative h-0.5 w-full overflow-hidden">
      {carregando && (
        <div className="barra-carregando bg-primary absolute inset-y-0 left-0 w-1/3 rounded-full" />
      )}
    </div>
  );
}

export function RootLayout() {
  const { tema, alternar } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ehAdmin = pathname.startsWith("/admin");

  // /admin tem seu próprio gate (token de admin, não de cliente) e sua
  // própria tela — não passa pelo cabeçalho/nav do app comum.
  const temToken = !ehAdmin && !!tokenCliente();
  const {
    data: eu,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["eu"],
    queryFn: buscarEu,
    enabled: temToken,
    retry: false,
  });

  if (ehAdmin) return <Outlet />;

  if (!temToken || isError) return <AcessoRestrito />;

  if (isLoading || !eu) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4">
          <Link to="/" search={FILTROS_PADRAO} className="shrink-0">
            <Logo />
          </Link>

          <nav className="flex shrink-0 items-center gap-1">
            <Link to="/" search={FILTROS_PADRAO}>
              <Button
                variant={pathname === "/" ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5 px-2 sm:px-3"
              >
                <ListChecks className="size-4" />
                <span className="hidden sm:inline">Questões</span>
              </Button>
            </Link>
            <Link to="/estatisticas">
              <Button
                variant={pathname === "/estatisticas" ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5 px-2 sm:px-3"
              >
                <BarChart3 className="size-4" />
                <span className="hidden sm:inline">Estatísticas</span>
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={alternar}
              aria-label="Alternar tema"
              className={cn("ml-1")}
            >
              {tema === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </nav>
        </div>
        <BarraCarregando />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      {!eu.nomePersonalizado && <NomeDialog />}
    </div>
  );
}
