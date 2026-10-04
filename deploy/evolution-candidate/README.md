# Candidata isolada de integração

Imagem base fixa da Evolution 2.3.7, Baileys 7.0.0-rc14 e correção para encaminhar `messageStubType` e `messageStubParameters` no webhook de atualização. A correção verifica um único trecho conhecido do código compilado e recusa builds quando ele muda; os campos adicionais não são gravados pelo Prisma.

A candidata tem PostgreSQL, volume de sessões e chave próprios. Escuta somente em `127.0.0.1:18080`; não está conectada ao DisparaZap nem a números de produção. O arquivo `.env` privado requer `CANDIDATE_API_KEY` e `CANDIDATE_DB_PASSWORD` e fica fora do Git e do contexto de build. Gere valores aleatórios próprios. Nunca reutilize credenciais ou banco da Evolution compartilhada.

Preparação: `docker compose -p disparazap-evolution-candidate up -d --build`. Após validar uma imagem, preserve seu digest para implantação e rollback; dependências transitivas podem variar em uma nova build. Não migre o aparelho principal. Não use ambas as integrações para enviar pela mesma sessão. A migração dos números exclusivos exige roteamento separado e nova vinculação pelo titular; não deve apagar o histórico de falhas nem as restrições confirmadas.

A inicialização e a API autenticada foram verificadas sem sessão WhatsApp. Isso não comprova entrega, não determina o motivo de uma restrição e não remove restrições já aplicadas. A validação real deve ocorrer após confirmar a liberação, com mensagem neutra para destinatário autorizado e acompanhamento do ACK, sem campanhas.

A build aplica `npm audit fix` sem `--force`, mantém o lock coerente com a instalação e recusa vulnerabilidades críticas. Na verificação de 03/10/2026, ficaram 0 críticas, 10 altas e 6 moderadas. Isso não torna a candidata pronta para produção: há alertas sem correção disponível e outros que exigem mudanças de compatibilidade (incluindo sharp e dependências do Prisma). Chatwoot está desativado, mas seus pacotes continuam presentes. Não force atualizações de versões principais nem promova esta imagem sem testes de compatibilidade e entrega. A Evolution compartilhada não foi atualizada nesta auditoria.
