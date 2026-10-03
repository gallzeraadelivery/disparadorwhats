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
