# OPVTT Desktop

Aplicação desktop de mesa virtual construída com Electron, React, TypeScript e
Tailwind CSS. A aplicação JavaFX original não é modificada por este projeto.

## Requisitos

- Windows (o resolvedor de media online só está suportado no Windows)
- Node.js 22 ou superior e npm

## Desenvolvimento

```powershell
npm ci
npm run dev
```

Também é possível iniciar com `run.cmd`; o script instala as dependências se
`node_modules` ainda não existir.

## Verificação e build

```powershell
npm run typecheck
npm run build
```

Para criar o instalador Windows x64:

```powershell
npm run dist:win
```

`build.cmd` executa o mesmo comando. O instalador e os ficheiros de build são
gerados em `release/` e `out/`; não devem ser incluídos no controlo de versões.

## Funcionalidades

- Salas e descrições guardadas numa base de dados SQLite, com seleção, importação
  e cópias de segurança locais.
- Mesa com camadas de imagem, tokens, nevoeiro, anúncios, zoom, deslocação,
  desfazer/refazer e pré-visualização do ecrã público.
- Fichas privadas de personagens, inventário, capacidades, notas e atributos
  configuráveis.
- Biblioteca de media local, notas privadas do mestre e dados configuráveis.
- Reprodução de vídeo e áudio, incluindo media online resolvida através de
  yt-dlp, Deno e FFmpeg.
- Janela de público independente e transmissão LAN via WebRTC. O conteúdo enviado
  é a composição pública da mesa; não são usados câmara, microfone ou serviços
  STUN/TURN.
- Tema claro/escuro, opções de ecrã, e preferências de qualidade e porta da
  transmissão.

## Dados locais

Em desenvolvimento, a aplicação cria e guarda a base de dados em `dados/`.
Na versão instalada, os dados ficam na pasta de utilizador gerida pelo Electron.
Bases de dados, backups, media importada e as cópias locais em `public/images/`
e `public/videos/` são ignorados pelo Git. Não são necessários para iniciar uma
instalação nova e não devem ser enviados para o repositório sem confirmar que
podem ser partilhados.

Os ficheiros em `release/` e `out/` são artefactos reproduzíveis. Para instalar
dependências a partir do lockfile, use `npm ci`.

O projeto mantém a versão 1 do esquema SQLite e as chaves de configuração
versionadas existentes para abrir bases de dados compatíveis sem conversão. A
primeira utilização de media online descarrega yt-dlp, Deno e FFmpeg para
`%LOCALAPPDATA%\OPVTT\media-tools`, verificando os respetivos SHA-256.
Playlists e media com restrições de login ou DRM não são suportadas. Use media
online apenas quando tiver autorização para a aceder e partilhar.

O projeto continua em desenvolvimento; valide o instalador e a transmissão LAN
nos dispositivos de destino antes de distribuir.
