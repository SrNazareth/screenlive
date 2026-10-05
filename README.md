# ScreenLive — versão para internet

O projeto usa Node.js + Express + Socket.IO para sinalização e WebRTC para transportar áudio/vídeo.

## Rodar localmente

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Publicar na internet

O servidor precisa ficar hospedado em uma URL pública HTTPS. Serviços de hospedagem de Node.js, como Render, podem fornecer uma URL `onrender.com`.

Configuração sugerida:
- Build Command: `npm install`
- Start Command: `npm start`

O servidor já usa `process.env.PORT` e `0.0.0.0`, necessários para hospedagem desse tipo.

## Link compartilhável

Depois de hospedado, se o endereço for:

https://seu-app.onrender.com

uma sala criada ficará, por exemplo:

https://seu-app.onrender.com/?room=AB12CD

Esse é o link que você pode enviar para outra pessoa.

## Importante sobre WebRTC

STUN ajuda a descobrir caminhos de conexão, mas algumas redes/NATs exigem TURN. Para uso público mais confiável, configure um servidor TURN e coloque os servidores TURN na constante `rtcConfig` de `public/app.js`.

O transporte de mídia é WebRTC; o servidor Node não recebe nem retransmite diretamente o vídeo em uma arquitetura P2P de um transmissor para poucos espectadores.

Conteúdo protegido por DRM pode impedir a captura de vídeo/áudio pelo navegador. O projeto não tenta contornar essas proteções.

## Limite atual

A versão é P2P: cada espectador recebe uma conexão diretamente do computador do transmissor. Para muitas pessoas assistindo simultaneamente, a arquitetura recomendada é um SFU (por exemplo, mediasoup/LiveKit/Janus) para evitar que o transmissor tenha de enviar uma cópia separada para cada espectador.
