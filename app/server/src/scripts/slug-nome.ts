const CONECTIVOS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "a",
  "o",
  "no",
  "na",
  "ao",
  "aos",
  "para",
  "com",
  "sem",
  "um",
  "uma",
]);

const SIGLAS = new Set([
  "afo",
  "ti",
  "rh",
  "sus",
  "ctb",
  "prf",
  "lrf",
  "eca",
  "cpc",
  "lodf",
  "tce",
  "rn",
  "mg",
  "go",
  "df",
  "sp",
  "mp",
  "clt",
  "lgpd",
  "iso",
  "sp.",
]);

const ROMANOS = new Set(["i", "ii", "iii", "iv", "v", "vi"]);

function capitalizar(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}

// Converte o slug do arquivo (nome_do_arquivo) num nome de disciplina legível.
// Não é perfeito para todos os 150+ casos (números de lei, siglas incomuns),
// mas cobre bem o caso comum de "palavra_palavra" -> "Palavra Palavra".
export function slugParaNome(slug: string): string {
  const palavras = slug.split("_").filter(Boolean);

  return palavras
    .map((palavra, i) => {
      const chave = palavra.toLowerCase();
      if (/^\d+$/.test(chave)) return chave;
      if (SIGLAS.has(chave)) return chave.toUpperCase();
      if (ROMANOS.has(chave) && i === palavras.length - 1) {
        return chave.toUpperCase();
      }
      if (chave === "no" && /^\d+$/.test(palavras[i + 1] ?? "")) return "nº";
      if (i > 0 && CONECTIVOS.has(chave)) return chave;
      return capitalizar(chave);
    })
    .join(" ");
}
