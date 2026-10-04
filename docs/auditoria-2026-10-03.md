# Auditoria do DisparaZap — 03/10/2026

## Resultado e alcance

Auditoria de código, testes com Evolution simulada, implantação do aplicativo e verificações limitadas dos servidores. Não houve novos envios reais, retomada de campanhas nem alteração da sessão/aparelho principal. Não é uma certificação de segurança ou garantia de ausência de restrições do WhatsApp.

## Correções verificadas

- Reinicialização durante uma requisição: registra resultado incerto e pausa a campanha, sem repetir automaticamente.
- Cancelamento e resposta SAIR durante o envio: preserva a parte já aceita e encerra os próximos anexos; não deixa partes pendentes sem explicação.
- Rejeição tardia: registra motivo disponível, encerra próximos anexos e pausa para conferência. A Evolution de produção pode omitir o código técnico; o relatório não inventa motivos.
- Número explicitamente informado pela API como inexistente no WhatsApp: registra falha somente daquele destinatário e segue para o próximo. Erros genéricos, desconexão e restrição de conta não são classificados como erro do destinatário.
- Resposta HTTP bem-sucedida sem identificador de mensagem válido: resultado incerto, sem contar como aceito. Aceitação pela API não comprova entrega ou leitura.
- Restrição confirmada: o fim do prazo informado não libera automaticamente a fila. A restrição mantém `active=1` até confirmação de liberação; campanhas continuam pausadas mesmo após liberação.
- Anexos: ffprobe verifica JPG/PNG e MP4 H.264 com áudio AAC ou sem áudio, na importação e antes do envio. Arquivos inválidos são removidos da importação. Não há conversão automática nem validação completa de todos os quadros.
- Recursos: dois uploads de mídia simultâneos, até 20 MB por arquivo; importação de contatos até 2 MB e 10.000 registros; limite de tamanho de registro CSV.
- Privacidade local: criação de arquivos com umask 0077; banco SQLite, WAL e SHM com modo 0600. Dados e credenciais fora do Git; CSV pessoal explicitamente ignorado.

## Evidência de testes

`npm test`: 17 testes passaram, 0 falhas, usando serviços simulados locais e arquivos de mídia neutros. Cobrem fluxo autenticado, isolamento por usuário, proteção do aparelho principal, consentimento/descadastro, importação, modelos/anexos, fila, migração, restrição, cancelamento e resultados incertos. A primeira execução restrita pelo sandbox não pôde abrir portas localhost; a execução com permissão apropriada passou integralmente.

`npm audit --omit=dev` do DisparaZap: 0 vulnerabilidades conhecidas na consulta desta auditoria. Esse inventário não cobre sistema operacional, FFmpeg, infraestrutura nem todos os comportamentos da aplicação.

Backup anterior à publicação: `/opt/backups/disparazap/disparazap-20261004T013157Z.tar.gz`. Data do nome em UTC. Backup local consistente não substitui cópia externa e teste de restauração.

Publicação verificada: container `disparazap-app` em estado `running healthy`, `/health` público retornando `status=ok`, ffprobe 8.1.2 instalado e banco/WAL/SHM em modo 0600. Painel autenticado confirmou preservação da proteção do aparelho principal e aviso de confirmação de liberação após o prazo da restrição.

## Evolution e restrições

Consulta autorizada confirmou `RESTRICT_ALL_COMPANIONS` em duas contas, terminadas em 3748 e 3225. Isso afeta aparelhos vinculados e explica por que o telefone principal pode enviar manualmente. O motivo da aplicação da restrição não foi fornecido. Não há evidência suficiente para atribuí-la a IP, vídeo ou código do DisparaZap. Diagnóstico interno temporário foi encerrado; não foi usado para modificar a sessão principal.

Evolution compartilhada: 2.3.7/Baileys 7.0.0-rc.9. Inventário npm observado: 3 críticas, 26 altas, 54 moderadas. Não foi alterada porque atende outro serviço e não houve validação de migração em produção.

Candidata isolada: mesma base fixa, Baileys 7.0.0-rc14 e encaminhamento de códigos de rejeição no webhook. Banco, rede, chave e volumes próprios; somente `127.0.0.1:18080`. API inicial e consulta autenticada retornaram HTTP 200; zero instâncias conectadas. Instância sem sessão foi criada/consultada/removida em teste anterior. Após correções compatíveis do inventário npm: 0 críticas, 10 altas, 6 moderadas. Há alertas sem correção e mudanças de compatibilidade ainda necessárias; não foi promovida nem ligada às campanhas.

Não aplicar `npm audit fix --force` na integração compartilhada. Alertas remanescentes incluem link-preview-js/Baileys, SDK Chatwoot/axios, Prisma/deepmerge-ts/effect, lodash e sharp. Chatwoot está desativado na candidata, mas seus pacotes estão instalados. Alterações de dependências precisam de validação de compatibilidade; o smoke test não comprova entrega.

## Pendências reais

1. Confirmar a liberação de uma conta pelo WhatsApp. Não testar contas ainda restritas nem retomar a campanha para tentar contornar a restrição.
2. Resolver/avaliar dependências remanescentes antes de promover a candidata; criar roteamento separado para conexões exclusivas sem alterar o aparelho principal.
3. Nova vinculação pelo titular e piloto neutro autorizado, acompanhando aceitação, ACK e recebimento no destinatário. A candidata ainda não teve esse teste.
4. Confirmar autorização efetiva dos destinatários. A marcação de consentimento no banco, por solicitação administrativa, não comprova que cada pessoa autorizou mensagens. Respeitar SAIR e pedidos de descadastro.
5. Testar restauração e manter cópia externa do backup.

Intervalos e limites operacionais não garantem ausência de bloqueios. A documentação oficial informa que mensagens indesejadas e uso adversarial de automação podem levar a restrições. Proxy, troca de número e continuidade após uma restrição não constituem correção da causa.

Fontes: [Diretrizes oficiais do WhatsApp](https://www.whatsapp.com/legal/messaging-guidelines), [política de mensagens Business](https://whatsappbusiness.com/policy/), [release Baileys rc10](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc10), [código da integração Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts). A release descreve mudanças técnicas; não comprova a causa destas restrições.
