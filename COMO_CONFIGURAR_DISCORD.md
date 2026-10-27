# Como ativar a atividade do Jota's Brain no Discord

A atividade aparece no perfil do Discord enquanto o **programa de desktop (.exe)** estiver aberto. Abrir `index.html` no navegador não inicia a integração.

## 1. Criar o aplicativo no Discord

1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications) e entre na sua conta.
2. Clique em **New Application** e dê o nome **Jota's Brain**.
3. Na página **General Information**, copie o **Application ID**. É um número público de identificação do aplicativo.
4. Envie o arquivo `icon.png` como ícone do aplicativo. Esse é o logo que identifica a atividade no Discord.

Não copie nem compartilhe Bot Token, Client Secret ou senha. A integração usa somente o Application ID.

## 2. Configurar o projeto

O `discord-presence.json` já está configurado com o Application ID do Jota's Brain. Só mexa nele se criar outro aplicativo no Discord. Formato:

```json
{
  "clientId": "123456789012345678",
  "details": "Prospecção de criadores",
  "state": "Jota’s Brain aberto",
  "largeImage": "",
  "largeText": "Jota’s Brain"
}
```

Mantenha o ID entre aspas. Deixe `largeImage` vazio para usar a identidade visual padrão do aplicativo no Discord. Se quiser uma imagem grande personalizada na atividade, cadastre uma imagem em **Rich Presence > Art Assets** no Developer Portal e coloque no campo `largeImage` a chave/nome do asset, não um caminho de arquivo.

## 3. Gerar e abrir o programa

Com o Discord para desktop aberto, gere novamente o executável seguindo [COMO_GERAR_EXE.md](./COMO_GERAR_EXE.md). Depois abra o instalador/portátil gerado em `dist`. A atividade deve mostrar **Jota's Brain** no Discord enquanto o programa estiver aberto.

Se não aparecer, confira se o Discord para desktop está aberto, se o Application ID está correto e se você gerou o executável depois de editar a configuração. A versão aberta direto pelo navegador não publica atividade.

A linha de detalhes da atividade acompanha a seção aberta no app (por exemplo, Discover, Pipeline ou Radar de vídeos). Depois de atualizar o projeto no GitHub e gerar um novo instalador, a seção atual aparecerá no Discord.


A atividade é atualizada em tempo real: a primeira linha mostra `Em [aba]` em português ou `In [tab]` em inglês; a segunda mostra quantos canais estão salvos no Pipeline. Ela conta apenas canais que você salvou no app.

