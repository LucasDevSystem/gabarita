import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Moon, Sun, BarChart3, ListChecks } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { FILTROS_PADRAO } from "@/router";

export function RootLayout() {
  const { tema, alternar } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <Link to="/" search={FILTROS_PADRAO}>
            <Logo />
          </Link>

          <nav className="flex items-center gap-1">
            <Link to="/" search={FILTROS_PADRAO}>
              <Button
                variant={pathname === "/" ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5"
              >
                <ListChecks className="size-4" />
                Questões
              </Button>
            </Link>
            <Link to="/estatisticas">
              <Button
                variant={pathname === "/estatisticas" ? "secondary" : "ghost"}
                size="sm"
                className="gap-1.5"
              >
                <BarChart3 className="size-4" />
                Estatísticas
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
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
