import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Tema = "dark" | "light";

const ThemeContext = createContext<{ tema: Tema; alternar: () => void } | null>(null);

const CHAVE = "gabarita-tema";

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === "dark" || salvo === "light") return salvo;
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaInicial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", tema === "dark");
    localStorage.setItem(CHAVE, tema);
  }, [tema]);

  const alternar = () => setTema((t) => (t === "dark" ? "light" : "dark"));

  return <ThemeContext.Provider value={{ tema, alternar }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return ctx;
}
