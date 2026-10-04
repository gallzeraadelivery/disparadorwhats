# Diagnóstico da integração

Data local: 03/10/2026, America/Cuiaba.

## Evidência

- Duas contas diferentes foram usadas nas conexões exclusivas. O WhatsApp retornou `isActive: true` e `RESTRICT_ALL_COMPANIONS` em consultas independentes. Não é apenas uma flag local de pausa.
- A segunda sessão registrou desconexão 401, voltou a `open` e depois emitiu `ERROR` para outra mensagem. Estado aberto e HTTP 201 não comprovam entrega.
- Produção usa Evolution 2.3.7, Baileys 7.0.0-rc.9 e Node 24.15.0. O DisparaZap não repete automaticamente os envios de falha. Intervalo e limite são compartilhados por instância.
- A Evolution 2.3.7 omite `messageStubParameters` no webhook `messages.update`, apesar de recebê-los do Baileys. Isso causa perda do motivo técnico no relatório.
- Versões posteriores do Baileys adicionaram correções de sessão, mídia, ciclo de tokens de conversas e tratamento de restrições. Isso sustenta uma hipótese de incompatibilidade da biblioteca antiga; não prova que ela provocou as restrições.

## Correções e preparação

O DisparaZap passa a persistir códigos numéricos de rejeição em recibos, inclusive quando chegam antes do resultado HTTP, e preservá-los no relatório. Credenciais e mensagens arbitrárias de diagnóstico não são armazenadas nesse campo. Recibos continuam autenticados e isolados por instância.

Uma candidata isolada atualiza Baileys para rc14 e encaminha parâmetros de rejeição no webhook. Foi construída a partir da imagem instalada, sem copiar contas, sessões, banco ou credenciais de produção. API e autenticação funcionam; a biblioteca carrega. A API de produção e o aparelho principal permanecem na integração existente.

## Limites e próxima validação

O motivo usado pelo WhatsApp para aplicar as restrições não foi fornecido. Não há prova de bloqueio de IP nem de causa no DisparaZap. A restrição existente pode persistir mesmo após atualizar a biblioteca. A candidata ainda precisa de roteamento separado para o DisparaZap, vinculação de um número exclusivo após liberação e teste neutro autorizado com confirmação de ACK. Não retomar campanhas como teste de atualização.

Referências: [Baileys rc10](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc10), [webhook Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts).
