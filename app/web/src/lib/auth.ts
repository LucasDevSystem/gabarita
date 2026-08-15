// Captura o token de acesso por convite (?u=<guid>) na primeira visita,
// grava em localStorage e limpa a URL — dali em diante a navegação não
// carrega mais o guid visível na barra de endereço.
//
// IMPORTANTE: este módulo precisa ser importado ANTES de "./router" em
// main.tsx. createRouter() lê window.location na hora em que o módulo
// router.tsx é avaliado — se o import do router rodar primeiro, a captura
// chega tarde (o guid já teria sido lido como um search param qualquer).
//
// Duas identidades possíveis, na mesma query string (?u=), diferenciadas
// pelo path atual: em /admin vai pro token de admin, no resto vai pro token
// de cliente.
const CHAVE_CLIENTE = "gabarita:cliente-token";
const CHAVE_ADMIN = "gabarita:admin-token";

function capturarToken() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("u");
  if (!token) return;

  const chave = window.location.pathname.startsWith("/admin") ? CHAVE_ADMIN : CHAVE_CLIENTE;
  localStorage.setItem(chave, token);

  params.delete("u");
  const resto = params.toString();
  const novaUrl = window.location.pathname + (resto ? `?${resto}` : "") + window.location.hash;
  window.history.replaceState(null, "", novaUrl);
}

capturarToken();

export function tokenCliente(): string | null {
  return localStorage.getItem(CHAVE_CLIENTE);
}

export function tokenAdmin(): string | null {
  return localStorage.getItem(CHAVE_ADMIN);
}
