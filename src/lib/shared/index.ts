// Biblioteca Compartilhada (Core) do AgentFlow.
//
// Ponto único de import para as capacidades GENÉRICAS do motor — reaproveitadas
// por QUALQUER Módulo Vertical (`src/modules/**`), nunca o inverso: nada em
// `src/modules/**` é importado por este arquivo, nem pelos arquivos que ele
// reexporta. Essa é a regra de dependência que faz uma gaveta ser realmente
// plugável — ela injeta comportamento NO core, o core nunca depende de uma
// gaveta específica.
//
// Deliberadamente um BARRIL, não uma pasta física nova: PiiVault, o motor de
// guardrails, o AuditChain e o Circuit Breaker já moram em
// `src/lib/{guardrails,server}` e são importados, hoje, por dezenas de
// arquivos via esses caminhos. Mover os arquivos fisicamente só para caber em
// `src/lib/shared/` quebraria esses imports sem nenhum ganho real de
// arquitetura (Artigo IV — No Invention: não reescrever o que já funciona e
// está testado só por estética de pasta). Autores de uma gaveta nova devem
// importar DESTE arquivo (ou dos caminhos abaixo, diretamente), nunca
// duplicar lógica de PII/auditoria/circuit breaker dentro de `src/modules/**`.
//
// SERVER-ONLY como um todo: `auditChainStore` depende do Admin SDK. O motor
// de guardrails (`@/lib/guardrails`) e o núcleo de ROI (`@/lib/roi`) são
// isomórficos e podem ser importados diretamente desses caminhos por
// componentes "use client" quando necessário — só este barril agregador é
// que deve ser tratado como server-only.

// Shield-Layer de PII + motor de Guardrails & Validação Semântica
// (inspeção de entrada/saída, políticas por severidade, PiiVault).
export * from "@/lib/guardrails";

// Trilha de Auditoria (AuditChain) — selo encadeado e persistência.
export * from "@/lib/server/auditChainStore";

// Circuit Breaker genérico para chamadas a APIs externas — isomórfico, sem
// nenhuma dependência de Firestore/Admin SDK.
export * from "@/lib/server/externalApiBreaker";

// Núcleo financeiro de ROI (custo evitado) — base para as calculadoras de
// ROI específicas de cada gaveta (ver `VerticalModuleDefinition.valorMedioPipelineBrl`
// em `@/modules/types` para a contraparte de OPORTUNIDADE GERADA).
export * from "@/lib/roi";
