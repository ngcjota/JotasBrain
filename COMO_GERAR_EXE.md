# 🎯 Jota's Brain — Como gerar o .exe (App de Janela)

Este projeto transforma o Jota's Brain num **programa de desktop** (.exe) para Windows,
com janela própria, ícone e atalho na área de trabalho.

---

## ✅ Pré-requisito (instala uma vez só)

Você precisa do **Node.js**. Se ainda não tem:

1. Acesse https://nodejs.org
2. Baixe a versão **LTS** (botão verde da esquerda)
3. Instale clicando "Avançar" em tudo

Para confirmar que instalou, abra o **Prompt de Comando** (tecla Windows → digite `cmd`) e digite:
```
node --version
```
Se aparecer um número (ex: `v20.11.0`), está pronto.

---

## 🚀 Gerar o .exe (3 passos)

**1.** Esta pasta (`files (1)`, dentro de `Documentos\Jota's Brain WebSite`) é a pasta do projeto.

**2.** Abra o Prompt de Comando **dentro da pasta**:
   - Abra a pasta do projeto no Explorador de Arquivos
   - Clique na barra de endereço no topo, apague tudo, digite `cmd` e aperte Enter
   - (Vai abrir uma tela preta já dentro da pasta certa)

**3.** Cole estes dois comandos, um de cada vez (aperte Enter após cada):

```
npm install
```
*(baixa o Electron — demora 1-2 minutos na primeira vez)*

```
npm run dist:win
```
*(monta o .exe — demora mais 1-2 minutos)*

---

## 📦 Onde fica o .exe

Quando terminar, abra a pasta **`dist`** dentro da pasta do projeto.

Lá dentro você terá **dois** executáveis:

| Arquivo | O que é |
|---|---|
| **Jota's Brain Setup 1.0.0.exe** | Instalador — instala o app no PC com atalho na área de trabalho |
| **JotasBrain-Portable.exe** | Versão portátil — roda direto, sem instalar, dá pra levar num pendrive |

Use o que preferir. O portátil é o mais prático para testar.

---

## 🔁 Atualizar o app depois

Se eu te mandar um `index.html` novo:
1. Substitua o `index.html` antigo na pasta do projeto pelo novo
2. Rode de novo só: `npm run dist:win`
3. Pegue o `.exe` atualizado na pasta `dist`

(Não precisa rodar `npm install` de novo)

---

## ❓ Problemas

- **"npm não é reconhecido"** → o Node.js não foi instalado ou o PC precisa reiniciar. Instale de novo de nodejs.org e reinicie.
- **Erro no meio do `npm install`** → verifique sua internet e rode o comando de novo.
- **Antivírus reclamando do .exe** → é normal com apps não-assinados. O Electron é seguro (é o mesmo motor do Discord/VS Code). Você pode liberar nas exceções do antivírus.

---

## 📁 Conteúdo da pasta

```
files (1)/
├── index.html             ← o app (toda a interface e a lógica do Jota's Brain)
├── main.js                ← cria a janela do programa e a atividade no Discord
├── preload.js             ← ponte entre a página e o main.js (Discord e PDF do invoice)
├── qrcode.min.js          ← gerador de QR Code (PIX do apoio e do invoice), funciona offline
├── package.json           ← configuração do build
├── discord-presence.json  ← Application ID do Discord
├── icon.png / icon.ico    ← ícones do app
├── COMO_GERAR_EXE.md      ← este guia
└── COMO_CONFIGURAR_DISCORD.md
```

Para testar sem gerar o .exe, rode `npm start` dentro da pasta: o app abre na hora com o `index.html` atual.


## Presença no Discord

Para mostrar o Jota's Brain como atividade no Discord, configure primeiro o Application ID em `discord-presence.json` e envie `icon.png` como ícone do aplicativo no Developer Portal. Siga o passo a passo em [COMO_CONFIGURAR_DISCORD.md](./COMO_CONFIGURAR_DISCORD.md). Gere o executável novamente depois de alterar a configuração. A atividade aparece somente no app desktop (.exe), com o Discord para desktop aberto; abrir o `index.html` no navegador não ativa a presença.

