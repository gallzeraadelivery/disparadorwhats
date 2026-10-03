# DisparaZap

Painel em português para múltiplas conexões WhatsApp via Evolution API. Versão com contas individuais, cadastro público, administrador e isolamento de dados por usuário; login, importação CSV/vCard, listas, campanhas de texto/imagem/vídeo, agendamento, intervalos por conexão, limite por janela móvel de 24 horas, pausa e descadastro por link.

## Desenvolvimento

Node.js 22.13 ou superior. Execute `npm ci`, copie `.env.example` para `.env`, preencha uma senha de pelo menos 12 caracteres e um segredo de sessão de pelo menos 32 caracteres. Inicie com `node --env-file=.env server.js`. Execute `npm test` para testar os importadores e o fluxo completo com uma Evolution API simulada. Nenhum teste envia mensagens reais.

## Produção

Docker Compose, volume `./data`, rede externa `disparazap_web` e proxy HTTPS. Crie a rede com `docker network create disparazap_web`, prepare o diretório com `mkdir -p data && chown -R 1000:1000 data` e execute `docker compose up -d --build`. Conecte o proxy à mesma rede. Defina `COOKIE_SECURE=true` e `PUBLIC_URL` para a URL pública HTTPS. Não publique a porta diretamente.

As credenciais da Evolution API ficam exclusivamente no backend. Não versione `.env`, dados, contatos ou senhas. O administrador pode criar, ativar e desativar usuários. O cadastro público cria exclusivamente o perfil Usuário. Cada usuário tem contatos, mídias, campanhas e até três conexões próprias; o administrador tem até vinte conexões. Os dados anteriores são migrados para a conta administrativa. As conexões preexistentes na Evolution são atribuídas ao administrador uma única vez.

## Operação

1. Cadastre ou importe contatos CSV (`nome,telefone`) ou vCard (`.vcf`). Use DDI e DDD; números brasileiros sem DDI são normalizados com 55. Números internacionais devem ter `+` ou `00` quando ambíguos.
2. Registre a autorização do contato. A importação preserva permissões de contatos existentes e não reativa descadastrados.
3. Conecte uma instância pelo QR Code. Cada conexão recebe um identificador interno exclusivo e um nome amigável escolhido no painel. A instância existente `principal` permanece exclusivamente na conta administrativa.
4. Salve uma campanha em rascunho. A lista de destinatários é fotografada neste momento. A autorização e o descadastro são conferidos novamente antes de cada envio.
5. Inicie explicitamente. O agendamento respeita a data; o intervalo é compartilhado entre campanhas da mesma conexão. Os limites são operacionais e não garantem proteção contra bloqueios.
6. O destinatário pode se descadastrar pelo link individual incluído na mensagem. Abrir o link não descadastra; é necessário confirmar. O painel também permite descadastro manual.

Uma mensagem em andamento pode concluir após pausa/cancelamento. Envios com resultado incerto nunca são repetidos automaticamente: a campanha pausa para conferência. O estado “Aceito pela API” não significa entregue ou lido. Não há monitoramento de leitura nesta versão.

## Mídia e proxies

JPG/PNG e MP4 de até 20 MB. A mídia vai à Evolution em base64, sem URL pública do arquivo. O proxy opcional é configurado pelo administrador nas suas próprias instâncias na Evolution; não é mecanismo de anonimato ou garantia contra bloqueios. Valide com um provedor real antes de usar. A configuração de uma conexão existente pode afetar seus outros consumidores.

## Dados e backup

SQLite em modo WAL para esta primeira implantação de uma única réplica. A fila e as sessões são persistentes. Para aumentar capacidade ou operar múltiplos clientes/réplicas, migrar para PostgreSQL e workers com coordenação distribuída.

O script `scripts/backup.py` cria snapshots SQLite consistentes e inclui mídias. Configure uma tarefa diária no servidor, mantenha os arquivos fora do repositório e replique os backups para armazenamento externo. A cópia local não protege contra perda total do servidor.

## Próximas validações

- Envio real de texto, imagem e vídeo para um contato autorizado de teste.
- QR Code de uma nova conexão usando um segundo número.
- Proxy real, quando houver provedor e credenciais.
- Restore do backup e cópia externa.

## Contas e acesso

No acesso inicial, escolha **Criar minha conta** para cadastrar nome, usuário e senha de pelo menos 12 caracteres. O perfil administrativo é provisionado pelas variáveis `ADMIN_USER` e `ADMIN_PASSWORD`; essas variáveis atualizam o login administrativo na inicialização. Senhas de usuários são armazenadas com salt individual e scrypt. A configuração administrativa no servidor precisa permanecer privada. Sessões antigas do modelo de conta única são encerradas durante a migração.

Acesso administrativo: menu **Gerenciar usuários**. Desativar uma conta invalida suas sessões e pausa campanhas. Cada endpoint confere o proprietário dos contatos, mídias, campanhas e conexões. Mesmo o administrador administra suas próprias campanhas; o painel de usuários não dá acesso às agendas dos outros usuários.

A versão atual permite cadastro público sem confirmação por email. Existe limite de tentativas e de três conexões por usuário. Para comercialização, complementar recuperação de senha, verificação de email, quotas de armazenamento, termos e políticas, cobrança e observabilidade.

## Conectar pelo número

Novas conexões começam sem iniciar QR automaticamente. Escolha **Conectar pelo número**, informe DDI + DDD + telefone e digite o código exibido no WhatsApp, em **Aparelhos conectados → Conectar aparelho → Conectar com número de telefone**. O código não é SMS e não registra novamente a conta. A opção de QR permanece disponível. Se uma sessão já iniciou por QR, a Evolution pode devolver apenas esse QR; finalize por ele ou crie uma conexão nova para usar o código. A confirmação real exige o celular do titular.

## Aparelho principal protegido

A instância `principal` é reservada para outro serviço. O DisparaZap não permite criar ou iniciar campanhas com ela; a fila pausa campanhas existentes e o cliente de envio também bloqueia chamadas direcionadas a essa instância. Ela aparece como protegida no painel, sem controles de QR, código ou proxy. Nas campanhas é obrigatório escolher explicitamente um aparelho disponível; o principal não aparece na seleção. A conexão na Evolution permanece intacta para a outra plataforma.

### Descadastro por resposta SAIR

As conexões exclusivas `dz-` usam um webhook autenticado por instância para receber `MESSAGES_UPSERT` e `MESSAGES_UPDATE`. Uma mensagem direta recebida com `SAIR` (sem diferenciar maiúsculas, com espaços ou ponto/exclamação final) retira a autorização, marca descadastro e ignora os envios ainda pendentes desse contato na conta proprietária. Mensagens próprias, grupos e eventos com autenticação inválida são ignorados. Eventos repetidos não geram registros duplicados de descadastro.

Antes de iniciar e periodicamente durante a campanha, o backend verifica a configuração de respostas. Quando ela está válida, texto e legendas incluem “Para parar de receber mensagens, responda SAIR.” Se não estiver disponível, usa o link de descadastro. Links de campanhas anteriores continuam funcionando. Webhooks existentes de outras plataformas e o aparelho principal são preservados. Uma mensagem já aceita pela API pode terminar antes de o descadastro chegar; o webhook deve continuar disponível para bloquear os próximos envios.

### Modelos de mensagem

O menu Modelos de mensagem permite cadastrar, editar, excluir e reutilizar texto com imagem ou vídeo. Cada conta acessa apenas seus modelos e mídias. Campanhas também têm a ação Salvar como modelo. Usar na campanha abre um novo rascunho com o conteúdo preenchido; aparelho, lista e início são escolhas separadas. Alterar ou excluir um modelo preserva as campanhas existentes e suas mídias.

### Relatórios de campanha

Em Campanhas, Relatório mostra o resumo e cada destinatário com status, motivo registrado, última atualização e ID da mensagem quando disponível. Filtros incluem aceitos pela API, fila, falhas e envios não confirmados, ignorados e cancelados. Baixar CSV exporta o filtro selecionado em UTF-8; horários do arquivo são UTC. Relatórios e arquivos só podem ser acessados pelo dono da campanha. O aceite da API não confirma entrega ou leitura, e erros antigos mostram apenas o detalhe que foi registrado na época. Novas falhas incluem o detalhe textual retornado pela Evolution, quando disponível, com credenciais da integração ocultadas.

Quando a Evolution informa ERROR após o aceite, o relatório muda para Falha e a campanha em execução é pausada, sem reenvio automático. Os eventos autenticados ficam registrados por 30 dias para tratar também notificações que chegam antes da resposta de envio. A integração nem sempre fornece o motivo técnico do erro.

### Vários anexos

Campanhas e modelos aceitam até 10 fotos JPG/PNG e vídeos MP4, com até 20 MB por arquivo. A seleção permite vários arquivos, mantendo sua ordem; modelos existentes permitem remover anexos individualmente e acrescentar outros. O texto acompanha o primeiro arquivo e os demais levam a instrução de descadastro. Cada arquivo é uma mensagem separada e conta no limite de envios da conexão; os intervalos também valem entre anexos.

O destinatário só fica como aceito quando todas as mensagens forem aceitas pela API. O relatório e o CSV mostram o resultado e o ID de cada mensagem. Reiniciar o serviço preserva anexos já aceitos; falhas e envios sem confirmação pausam a campanha sem repetir arquivos. Campanhas e modelos anteriores mantêm suas mídias.
